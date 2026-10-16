import { lstat, mkdir, readdir, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { isWithin } from "./library.mjs";

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
    const result = [];
    const buckets = await readdir(this.directory, { withFileTypes: true });
    for (const bucket of buckets) {
      if (!bucket.isDirectory() || !/^[a-f0-9]{64}$/.test(bucket.name)) continue;
      const files = await readdir(path.join(this.directory, bucket.name), { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile()) continue;
        const key = `${bucket.name}/${file.name}`;
        if (!KEY_PATTERN.test(key)) continue;
        try {
          const { manager, info } = await this.resolve(key);
          result.push(this.metadata(key, manager, info));
        } catch (error) {
          if (error.code === "EACCES") throw error;
        }
      }
    }
    return result.sort((first, second) => second.modified.localeCompare(first.modified));
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
