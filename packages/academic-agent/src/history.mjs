import { lstat, mkdir, readdir, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { isWithin } from "./library.mjs";
import { AppDatabase, databasePath } from "./storage.mjs";

const KEY_PATTERN = /^[a-f0-9]{64}\/[a-zA-Z0-9_.-]+\.jsonl$/;
const MAX_SESSION_BYTES = 16 * 1024 * 1024;

export class SessionHistory {
  constructor(sdk, directory, project) {
    this.sdk = sdk;
    this.directory = directory;
    this.project = project;
  }

  async resolve(key) {
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) throw new Error("Invalid history key.");
    const root = await realpath(this.directory);
    const filename = path.join(root, ...key.split("/"));
    const parent = path.dirname(filename);
    if ((await lstat(parent)).isSymbolicLink() || (await realpath(parent)) !== parent)
      throw new Error("Linked session directories are not allowed.");
    const info = await lstat(filename);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > MAX_SESSION_BYTES
    )
      throw new Error("Invalid or oversized history file.");
    const resolved = await realpath(filename);
    if (!isWithin(root, resolved) || resolved !== filename)
      throw new Error("History path escapes the session store.");
    const content = await readFile(filename, "utf8");
    const header = JSON.parse(content.split("\n", 1)[0]);
    if (
      header.type !== "session" ||
      header.cwd !== this.project ||
      typeof header.id !== "string" ||
      typeof header.timestamp !== "string"
    )
      throw new Error("Invalid conversation header or project.");
    const manager = this.sdk.SessionManager.open(filename, parent);
    if (manager.getCwd() !== this.project)
      throw new Error("This conversation belongs to another project.");
    return { filename, manager, info };
  }

  metadata(key, manager, info) {
    const entries = manager.getEntries();
    const messages = entries
      .filter((entry) => entry.type === "message")
      .map((entry) => entry.message);
    const first = messages.find((message) => message.role === "user");
    const text =
      typeof first?.content === "string"
        ? first.content
        : (first?.content
            ?.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(" ") ?? "");
    return {
      key,
      sessionId: manager.getSessionId(),
      title: manager.getSessionName() || text.trim().slice(0, 100),
      created: manager.getHeader()?.timestamp ?? info.birthtime.toISOString(),
      modified: info.mtime.toISOString(),
      messageCount: messages.filter(
        (message) => message.role === "user" || message.role === "assistant",
      ).length,
    };
  }

  async list() {
    await mkdir(this.directory, { recursive: true });
    const root = await realpath(this.directory);
    const database = new AppDatabase(databasePath(path.dirname(root)));
    try {
      const cached = new Map(
        database.db
          .prepare("SELECT * FROM session_index WHERE root=? AND project=?")
          .all(root, this.project)
          .map((row) => [row.key, row]),
      );
      const result = [];
      const seen = new Set();
      const updates = [];
      const buckets = await readdir(root, { withFileTypes: true });
      for (const bucket of buckets) {
        if (!bucket.isDirectory() || !/^[a-f0-9]{64}$/.test(bucket.name)) continue;
        const parent = path.join(root, bucket.name);
        if ((await realpath(parent)) !== parent) continue;
        const files = await readdir(parent, { withFileTypes: true });
        for (const file of files) {
          const key = `${bucket.name}/${file.name}`;
          if (!file.isFile() || !KEY_PATTERN.test(key)) continue;
          try {
            const filename = path.join(parent, file.name);
            const info = await lstat(filename);
            if (
              !info.isFile() ||
              info.isSymbolicLink() ||
              info.nlink !== 1 ||
              info.size > MAX_SESSION_BYTES ||
              (await realpath(filename)) !== filename
            )
              continue;
            const previous = cached.get(key);
            if (
              previous &&
              previous.size === info.size &&
              previous.mtime === info.mtimeMs &&
              previous.ctime === info.ctimeMs
            ) {
              result.push(JSON.parse(previous.metadata));
            } else {
              const resolved = await this.resolve(key);
              const metadata = this.metadata(key, resolved.manager, resolved.info);
              updates.push([
                root,
                key,
                this.project,
                resolved.info.size,
                resolved.info.mtimeMs,
                resolved.info.ctimeMs,
                JSON.stringify(metadata),
              ]);
              result.push(metadata);
            }
            seen.add(key);
          } catch (error) {
            if (error.code === "EACCES") throw error;
          }
        }
      }
      database.transaction(() => {
        const upsert = database.db.prepare(
          "INSERT INTO session_index VALUES (?,?,?,?,?,?,?) ON CONFLICT(root,key) DO UPDATE SET project=excluded.project,size=excluded.size,mtime=excluded.mtime,ctime=excluded.ctime,metadata=excluded.metadata",
        );
        for (const row of updates) upsert.run(...row);
        const remove = database.db.prepare(
          "DELETE FROM session_index WHERE root=? AND key=? AND project=?",
        );
        for (const key of cached.keys()) if (!seen.has(key)) remove.run(root, key, this.project);
      });
      return result.sort((first, second) => second.modified.localeCompare(first.modified));
    } finally {
      database.close();
    }
  }

  async read(key) {
    const { manager, info } = await this.resolve(key);
    return {
      ...this.metadata(key, manager, info),
      messages: this.sdk.buildSessionContext(manager.getEntries(), manager.getLeafId()).messages,
    };
  }

  async rename(key, title, currentManager) {
    if (typeof title !== "string" || !title.trim() || title.length > 200)
      throw new Error("Conversation title must contain 1–200 characters.");
    const { filename, manager } = await this.resolve(key);
    const target = currentManager?.getSessionFile() === filename ? currentManager : manager;
    target.appendSessionInfo(title.trim());
  }

  async remove(key) {
    const { filename } = await this.resolve(key);
    await unlink(filename);
  }
}
