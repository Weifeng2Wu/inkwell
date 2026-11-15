import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CloudBackup, DEFAULT_CLOUD_CONFIG, validateManifest } from "../src/cloud-backup.mjs";
import { ObjectStore, sha256, validateCloudConfig } from "../src/object-store.mjs";
import { AppDatabase } from "../src/storage.mjs";

async function fixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-cloud-"));
  const project = path.join(directory, "研究项目");
  await mkdir(project);
  const objects = new Map();
  const writes = [];
  let failUploads = false;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    const key = decodeURIComponent(url.pathname.slice("/test-bucket/".length));
    const finish = (status, body = "") => {
      response.writeHead(status);
      response.end(body);
    };
    if (!request.headers.authorization?.includes("AWS4-HMAC-SHA256 Credential=test-access/"))
      return finish(403);
    if (request.method === "PUT") {
      if (failUploads && key.includes("/blobs/")) return finish(503);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (sha256(body) !== request.headers["x-amz-content-sha256"]) return finish(400);
      objects.set(key, body);
      writes.push(key);
      return finish(200);
    }
    if (request.method === "DELETE") {
      objects.delete(key);
      return finish(204);
    }
    if (url.searchParams.has("list-type")) {
      const keys = [...objects.keys()]
        .filter((value) => value.startsWith(url.searchParams.get("prefix")))
        .sort();
      const start = Number(url.searchParams.get("continuation-token") ?? 0);
      const page = keys.slice(start, start + 2);
      const more = start + page.length < keys.length;
      return finish(
        200,
        `<ListBucketResult><IsTruncated>${more}</IsTruncated>${page.map((value) => `<Contents><Key>${value}</Key></Contents>`).join("")}${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ""}</ListBucketResult>`,
      );
    }
    if (!objects.has(key)) return finish(404);
    return finish(200, request.method === "HEAD" ? "" : objects.get(key));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const database = new AppDatabase(path.join(directory, "db", "inkwell.sqlite"));
  const backup = new CloudBackup(database);
  const config = {
    ...DEFAULT_CLOUD_CONFIG,
    provider: "s3",
    region: "us-east-1",
    endpoint: `http://127.0.0.1:${server.address().port}`,
    bucket: "test-bucket",
  };
  const credentials = { accessKeyId: "test-access", secretAccessKey: "test-secret" };
  backup.save(config, credentials);
  context.after(async () => {
    database.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    project,
    objects,
    writes,
    backup,
    config,
    credentials,
    failUploads: () => {
      failUploads = true;
    },
  };
}

test("incremental snapshots restore files and preserve older versions and deletions", async (context) => {
  const { project, backup, directory, writes, objects } = await fixture(context);
  await writeFile(path.join(project, "笔记.md"), "first version");
  await mkdir(path.join(project, "papers"));
  await writeFile(path.join(project, "papers", "paper.pdf"), Buffer.from([0, 1, 2, 255]));
  await writeFile(path.join(project, ".env"), "excluded-secret");
  await mkdir(path.join(project, "node_modules"));
  await writeFile(path.join(project, "node_modules", "cache"), "excluded");
  await symlink(path.join(project, "笔记.md"), path.join(project, "link.md"));
  await backup.test();
  assert.equal(
    [...objects.keys()].some((key) => key.includes("/checks/")),
    false,
  );
  const first = await backup.backup(project);
  assert.equal(first.fileCount, 2);
  assert.equal(first.uploadedFiles, 2);
  assert.equal(first.skippedCount, 3);
  const writeCount = writes.length;
  const unchanged = await backup.backup(project);
  assert.equal(unchanged.unchanged, true);
  assert.equal(unchanged.key, first.key);
  assert.equal(writes.length, writeCount);
  await writeFile(path.join(project, "笔记.md"), "second version");
  const second = await backup.backup(project);
  assert.equal(second.uploadedFiles, 1);
  await rm(path.join(project, "papers", "paper.pdf"));
  const third = await backup.backup(project);
  assert.equal(third.uploadedFiles, 0);
  assert.equal(third.fileCount, 1);
  objects.set("inkwell/snapshots/unrelated.json", Buffer.from("{}"));
  const history = await backup.list();
  assert.equal(history.length, 3);
  assert.equal(history[0].project, "研究项目");
  const restored = await backup.restore(first.key, directory);
  assert.equal(await readFile(path.join(restored.directory, "笔记.md"), "utf8"), "first version");
  assert.deepEqual(
    await readFile(path.join(restored.directory, "papers", "paper.pdf")),
    Buffer.from([0, 1, 2, 255]),
  );
  assert.equal(await readFile(path.join(project, "笔记.md"), "utf8"), "second version");
  assert.equal(JSON.stringify(backup.status(project)).includes("test-secret"), false);
  assert.equal(
    JSON.stringify([...objects.values()].map((value) => value.toString())).includes(
      "excluded-secret",
    ),
    false,
  );
});

test("failed uploads publish no snapshot and corrupt restores leave no destination", async (context) => {
  const { backup, project, directory, objects, failUploads } = await fixture(context);
  await writeFile(path.join(project, "note.md"), "original");
  const first = await backup.backup(project);
  objects.set(`inkwell/blobs/${sha256("original")}`, Buffer.from("tampered"));
  await assert.rejects(backup.restore(first.key, directory), /CLOUD_INTEGRITY/);
  assert.equal(
    (await readdir(directory)).some((name) => name.includes("restore")),
    false,
  );
  await assert.rejects(
    backup.restore("inkwell/snapshots/../../other.json", directory),
    /CLOUD_MANIFEST/,
  );
  await writeFile(path.join(project, "note.md"), "changed");
  failUploads();
  await assert.rejects(backup.backup(project), /CLOUD_HTTP:503/);
  assert.equal((await backup.list()).length, 1);
  assert.equal(backup.status(project).lastBackup.key, first.key);
});

test("credentials remain backend-only and belong to their endpoint and bucket", async (context) => {
  const { backup, config } = await fixture(context);
  assert.equal(backup.status().hasCredentials, true);
  backup.save({ ...config, prefix: "another-prefix", enabled: true });
  assert.equal(backup.status().hasCredentials, true);
  backup.save({ ...config, bucket: "other-bucket" });
  assert.equal(backup.status().hasCredentials, false);
  assert.throws(
    () => backup.save({ ...config, bucket: "other-bucket", enabled: true }),
    /CLOUD_CREDENTIALS/,
  );
  backup.save(config);
  assert.equal(backup.status().hasCredentials, true);
});

test("the native service JSON protocol supports backup and returns sanitized status", async (context) => {
  const { directory, project } = await fixture(context);
  await writeFile(path.join(project, "note.md"), "project data");
  const call = (request) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        fileURLToPath(new URL("../src/cloud-backup.mjs", import.meta.url)),
        path.join(directory, "db", "inkwell.sqlite"),
      ]);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)),
      );
      child.stdin.end(JSON.stringify(request));
    });
  const snapshot = await call({ type: "backup", projectPath: project });
  assert.equal(snapshot.fileCount, 1);
  const status = await call({ type: "status", projectPath: project });
  assert.equal(status.lastBackup.key, snapshot.key);
  assert.equal(status.hasCredentials, true);
  assert.equal(JSON.stringify(status).includes("test-secret"), false);
  await assert.rejects(call({ type: "unsupported" }), /CLOUD_CONFIG/);
});

test("untrusted manifests reject traversal, duplicates and directory/file collisions", () => {
  for (const paths of [
    ["../note"],
    ["/note"],
    ["C:/note"],
    ["notes\\escape"],
    [".env"],
    ["CON.txt"],
    ["A.md", "a.md"],
    ["note", "note/child"],
  ]) {
    assert.throws(
      () =>
        validateManifest({
          version: 1,
          createdAt: new Date().toISOString(),
          project: "notes",
          files: paths.map((filename) => ({ path: filename, size: 0, sha256: sha256("") })),
        }),
      /CLOUD_MANIFEST/,
    );
  }
});

test("configuration requires a secure endpoint and bounded storage responses", async (context) => {
  const { config, credentials, objects } = await fixture(context);
  for (const endpoint of [
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com/path",
    "https://example.com/?secret=1",
  ])
    assert.throws(() => validateCloudConfig({ ...config, endpoint }), /CLOUD_CONFIG/);
  assert.equal(validateCloudConfig({ ...config, provider: "r2" }).region, "auto");
  objects.set("large", Buffer.alloc(100));
  const store = new ObjectStore(config, credentials);
  await assert.rejects(store.get("large", 99), /CLOUD_SIZE_LIMIT/);
  assert.equal(await store.has("missing"), false);
});
