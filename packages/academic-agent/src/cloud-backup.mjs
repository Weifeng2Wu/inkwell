import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ObjectStore, sha256, validateCloudConfig } from "./object-store.mjs";
import { AppDatabase } from "./storage.mjs";

export const DEFAULT_CLOUD_CONFIG = {
  provider: "r2",
  endpoint: "",
  bucket: "",
  prefix: "inkwell",
  region: "auto",
  enabled: false,
  intervalMinutes: 30,
};
const MAX_FILE = 2 * 1024 ** 3;
const MAX_TOTAL = 20 * 1024 ** 3;
const MAX_FILES = 50_000;
const IGNORED = new Set([
  "node_modules",
  "target",
  "dist",
  "build",
  "out",
  "__pycache__",
  "inkwell.sqlite",
  "inkwell.sqlite-wal",
  "inkwell.sqlite-shm",
]);
const accountFor = (config) =>
  sha256(JSON.stringify(["cloud-backup", config.endpoint, config.bucket]));
const targetFor = (config) =>
  sha256(JSON.stringify([config.endpoint, config.bucket, config.prefix]));
const inside = (root, target) =>
  target === root ||
  (!path.relative(root, target).startsWith(`..${path.sep}`) &&
    path.relative(root, target) !== ".." &&
    !path.isAbsolute(path.relative(root, target)));

export function validBackupPath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    !/[\\<>:"|?*]/.test(value) &&
    [...value].every((character) => character.charCodeAt(0) >= 32) &&
    value
      .split("/")
      .every(
        (part) =>
          part &&
          !part.startsWith(".") &&
          !/[. ]$/.test(part) &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

async function openProjectFile(root, relative) {
  if (!validBackupPath(relative)) throw new Error("CLOUD_PATH");
  const filename = path.join(root, ...relative.split("/"));
  if (!inside(root, await realpath(filename))) throw new Error("CLOUD_PATH");
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw new Error("CLOUD_PATH");
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const opened = await handle.stat();
  if (
    !opened.isFile() ||
    opened.ino !== info.ino ||
    opened.dev !== info.dev ||
    opened.nlink > 1 ||
    opened.size > MAX_FILE
  ) {
    await handle.close();
    throw new Error("CLOUD_SIZE_LIMIT");
  }
  return handle;
}

export async function scanProject(directory) {
  const root = await realpath(directory);
  const files = [];
  const skipped = [];
  let totalBytes = 0;
  let entriesSeen = 0;
  const seen = new Set();
  async function walk(relative = "") {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (++entriesSeen > 100_000 || relative.split("/").length > 100)
        throw new Error("CLOUD_SIZE_LIMIT");
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (
        entry.name.startsWith(".") ||
        IGNORED.has(entry.name) ||
        entry.isSymbolicLink() ||
        (!entry.isDirectory() && !entry.isFile())
      ) {
        skipped.push(name);
        continue;
      }
      if (!validBackupPath(name) || seen.has(name.normalize("NFC").toLowerCase()))
        throw new Error("CLOUD_PATH");
      seen.add(name.normalize("NFC").toLowerCase());
      if (entry.isDirectory()) {
        if (
          !inside(root, await realpath(path.join(root, name))) ||
          (await lstat(path.join(root, name))).isSymbolicLink()
        )
          throw new Error("CLOUD_PATH");
        await walk(name);
        continue;
      }
      const handle = await openProjectFile(root, name);
      try {
        const before = await handle.stat();
        const digest = createHash("sha256");
        for await (const chunk of handle.createReadStream({ autoClose: false }))
          digest.update(chunk);
        const after = await handle.stat();
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          throw new Error("CLOUD_CHANGED");
        files.push({ path: name, size: before.size, sha256: digest.digest("hex") });
        totalBytes += before.size;
        if (files.length > MAX_FILES || totalBytes > MAX_TOTAL) throw new Error("CLOUD_SIZE_LIMIT");
      } finally {
        await handle.close();
      }
    }
  }
  await walk();
  return { root, files, totalBytes, skipped };
}

export function validateManifest(value) {
  if (
    value?.version !== 1 ||
    !Array.isArray(value.files) ||
    value.files.length > MAX_FILES ||
    typeof value.project !== "string" ||
    value.project.length > 500 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    throw new Error("CLOUD_MANIFEST");
  const names = new Set();
  let total = 0;
  for (const file of value.files) {
    if (
      !file ||
      !validBackupPath(file.path) ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > MAX_FILE
    )
      throw new Error("CLOUD_MANIFEST");
    const name = file.path.normalize("NFC").toLowerCase();
    if (names.has(name)) throw new Error("CLOUD_MANIFEST");
    names.add(name);
    total += file.size;
    if (total > MAX_TOTAL) throw new Error("CLOUD_SIZE_LIMIT");
  }
  for (const name of names) {
    const parts = name.split("/");
    parts.pop();
    while (parts.length) {
      if (names.has(parts.join("/"))) throw new Error("CLOUD_MANIFEST");
      parts.pop();
    }
  }
  return value;
}

export class CloudBackup {
  constructor(database) {
    this.database = database;
  }
  read(key) {
    return this.database.request({ type: "record_read", namespace: "cloud-backup", key }).value;
  }
  write(key, value) {
    this.database.request({ type: "record_write", namespace: "cloud-backup", key, value });
  }
  credentials(config) {
    const record = this.database.request({
      type: "credential_read",
      account: accountFor(config),
    }).value;
    if (!record) throw new Error("CLOUD_CREDENTIALS");
    return JSON.parse(record);
  }
  status(projectPath) {
    const config = this.read("config") ?? DEFAULT_CLOUD_CONFIG;
    let hasCredentials = false;
    try {
      hasCredentials = Boolean(this.credentials(config));
    } catch {}
    return {
      config,
      hasCredentials,
      lastBackup: projectPath
        ? this.read(`project:${targetFor(config)}:${sha256(projectPath)}`)
        : null,
    };
  }
  save(config, credentials) {
    const normalized = validateCloudConfig(config);
    if (credentials) {
      if (
        !["accessKeyId", "secretAccessKey"].every(
          (key) =>
            typeof credentials[key] === "string" &&
            credentials[key].trim().length > 0 &&
            credentials[key].length <= 4096 &&
            !/[\r\n]/.test(credentials[key]),
        ) ||
        (credentials.sessionToken &&
          (typeof credentials.sessionToken !== "string" ||
            credentials.sessionToken.length > 4096 ||
            /[\r\n]/.test(credentials.sessionToken)))
      )
        throw new Error("CLOUD_CREDENTIALS");
      this.database.request({
        type: "credential_write",
        account: accountFor(normalized),
        apiKey: JSON.stringify({
          accessKeyId: credentials.accessKeyId.trim(),
          secretAccessKey: credentials.secretAccessKey.trim(),
          ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken.trim() } : {}),
        }),
      });
    }
    if (normalized.enabled) this.credentials(normalized);
    this.write("config", normalized);
    return this.status();
  }
  store() {
    const config = validateCloudConfig(this.read("config"));
    return new ObjectStore(config, this.credentials(config));
  }
  async test() {
    const store = this.store();
    const key = `${store.config.prefix}/checks/${randomUUID()}`;
    const body = Buffer.from("Glossa connection check");
    await store.put(key, body);
    try {
      if (!(await store.get(key, 1024)).equals(body)) throw new Error("CLOUD_INTEGRITY");
      await store.list(`${store.config.prefix}/snapshots/`);
    } finally {
      const response = await store.request("DELETE", key);
      await response.body?.cancel();
    }
    return { ok: true };
  }
  async backup(projectPath) {
    const store = this.store();
    const scan = await scanProject(projectPath);
    const fingerprint = sha256(JSON.stringify(scan.files));
    const recordKey = `project:${targetFor(store.config)}:${sha256(projectPath)}`;
    const previous = this.read(recordKey);
    if (previous?.fingerprint === fingerprint && (await store.has(previous.key)))
      return {
        ...previous,
        unchanged: true,
        uploadedFiles: 0,
        skipped: scan.skipped.slice(0, 50),
        skippedCount: scan.skipped.length,
      };
    let uploadedFiles = 0;
    for (const file of scan.files) {
      const key = `${store.config.prefix}/blobs/${file.sha256}`;
      if (await store.has(key)) continue;
      const handle = await openProjectFile(scan.root, file.path);
      try {
        const digest = createHash("sha256");
        const stream = handle.createReadStream({ autoClose: false });
        const body = async function* () {
          for await (const chunk of stream) {
            digest.update(chunk);
            yield chunk;
          }
        };
        await store.put(key, body(), file.sha256, file.size);
        if (digest.digest("hex") !== file.sha256) throw new Error("CLOUD_CHANGED");
        uploadedFiles++;
      } finally {
        await handle.close();
      }
    }
    const createdAt = new Date().toISOString();
    const manifest = {
      version: 1,
      project: path.basename(scan.root),
      createdAt,
      files: scan.files,
    };
    const slug = Buffer.from(manifest.project).toString("base64url");
    const key = `${store.config.prefix}/snapshots/${createdAt.replace(/[:.]/g, "-")}--${slug}--${randomUUID()}.json`;
    const encoded = Buffer.from(JSON.stringify(manifest));
    if (encoded.length > 16 * 1024 * 1024) throw new Error("CLOUD_SIZE_LIMIT");
    await store.put(key, encoded);
    const result = {
      key,
      fingerprint,
      createdAt,
      project: manifest.project,
      fileCount: scan.files.length,
      totalBytes: scan.totalBytes,
      uploadedFiles,
      unchanged: false,
      skipped: scan.skipped.slice(0, 50),
      skippedCount: scan.skipped.length,
    };
    this.write(recordKey, result);
    return result;
  }
  async list() {
    const store = this.store();
    const prefix = `${store.config.prefix}/snapshots/`;
    const keys = await store.list(prefix);
    return keys
      .sort()
      .reverse()
      .flatMap((key) => {
        if (!key.startsWith(prefix)) return [];
        const match =
          /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)--([A-Za-z0-9_-]+)--[a-f0-9-]{36}\.json$/.exec(
            key.slice(prefix.length),
          );
        if (!match) return [];
        const createdAt = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
        if (!Number.isFinite(Date.parse(createdAt))) return [];
        return [
          {
            key,
            createdAt,
            project: Buffer.from(match[2], "base64url").toString("utf8").slice(0, 500),
          },
        ];
      })
      .slice(0, 100);
  }
  async restore(key, parent) {
    const store = this.store();
    const prefix = `${store.config.prefix}/snapshots/`;
    if (
      typeof key !== "string" ||
      !key.startsWith(prefix) ||
      key.slice(prefix.length).includes("/") ||
      !key.endsWith(".json")
    )
      throw new Error("CLOUD_MANIFEST");
    let manifest;
    try {
      manifest = validateManifest(JSON.parse(await store.get(key)));
    } catch (error) {
      if (String(error.message).startsWith("CLOUD_")) throw error;
      throw new Error("CLOUD_MANIFEST");
    }
    const directory = await realpath(parent);
    const identifier = randomUUID();
    const staging = path.join(directory, `.inkwell-restore-${identifier}`);
    const destination = path.join(directory, `inkwell-restored-${identifier}`);
    await mkdir(staging, { mode: 0o700 });
    try {
      for (const file of manifest.files) {
        const target = path.join(staging, ...file.path.split("/"));
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const handle = await open(target, "wx", 0o600);
        try {
          const response = await store.request(
            "GET",
            `${store.config.prefix}/blobs/${file.sha256}`,
          );
          const digest = createHash("sha256");
          let size = 0;
          for await (const chunk of response.body) {
            size += chunk.length;
            if (size > file.size) throw new Error("CLOUD_INTEGRITY");
            digest.update(chunk);
            await handle.writeFile(chunk);
          }
          if (size !== file.size || digest.digest("hex") !== file.sha256)
            throw new Error("CLOUD_INTEGRITY");
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      await rename(staging, destination);
      return { directory: destination, fileCount: manifest.files.length };
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }
  async request(request) {
    switch (request.type) {
      case "status":
        return this.status(request.projectPath);
      case "save":
        return this.save(request.config, request.credentials);
      case "test":
        return this.test();
      case "backup":
        return this.backup(request.projectPath);
      case "list":
        return this.list();
      case "restore":
        return this.restore(request.key, request.destination);
      default:
        throw new Error("CLOUD_CONFIG");
    }
  }
}

if (process.argv[1]?.endsWith("cloud-backup.mjs")) {
  let database;
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 64 * 1024) throw new Error("CLOUD_SIZE_LIMIT");
    }
    database = new AppDatabase(process.argv[2]);
    const result = await new CloudBackup(database).request(JSON.parse(input));
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write(/^CLOUD_[A-Z_]+(?::\d{3})?$/.test(message) ? message : "CLOUD_LOCAL");
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}
