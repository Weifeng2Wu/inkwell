import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function databasePath(directory) {
  return process.env.INKWELL_DATABASE_PATH || path.join(directory, "inkwell.sqlite");
}

const PREFIXES = [
  "inkwell-agent-config-v1:",
  "inkwell-external-chat-v1:",
  "inkwell-conversation-archive-v1:",
];
const KEYS = new Set([
  "editor-settings",
  "latex-settings",
  "recent-projects",
  "sidebarWidth",
  "rightPanelWidth",
  "terminalHeight",
  "inkwell-agent-selection-v1",
  "inkwell-layout-parser-v1",
  "inkwell-keyboard-shortcuts-v1",
  "inkwell-locale",
  "opencode-selected-agent",
  "opencode-selected-model",
  "theme",
]);
export function supportedStorageKey(key) {
  return (
    typeof key === "string" &&
    key.length <= 8192 &&
    (KEYS.has(key) || PREFIXES.some((prefix) => key.startsWith(prefix)))
  );
}
function validString(value, max = 8192) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function scopeKey(key, prefix) {
  const scope = JSON.parse(key.slice(prefix.length));
  if (!Array.isArray(scope) || scope.length !== 2 || !scope.every((part) => validString(part)))
    throw new Error("Invalid conversation scope.");
  return scope;
}
function safeSetting(key, value) {
  if (
    value === null ||
    (!key.startsWith("inkwell-agent-config-v1:") && key !== "inkwell-layout-parser-v1")
  )
    return value;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid provider configuration.");
  const allowed =
    key === "inkwell-layout-parser-v1"
      ? ["provider", "language", "forceOcr", "baseUrl", "model", "prompt"]
      : [
          "provider",
          "protocol",
          "baseUrl",
          "model",
          "personalPrompt",
          "answerLanguage",
          "skillIds",
          "permissionMode",
          "allowRead",
          "allowEdits",
        ];
  return JSON.stringify(
    Object.fromEntries(Object.entries(parsed).filter(([field]) => allowed.includes(field))),
  );
}
export class AppDatabase {
  constructor(filename) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename, { timeout: 5000 });
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
      );
      const version = this.db.prepare("PRAGMA user_version").get().user_version;
      if (version > 1) throw new Error("Database was created by a newer Inkwell version.");
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS legacy_backup (key TEXT PRIMARY KEY, value TEXT NOT NULL, imported_at INTEGER NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS conversations (scope TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, modified TEXT NOT NULL, renamed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope,id)) STRICT;
          CREATE INDEX IF NOT EXISTS conversations_recent ON conversations(scope,modified DESC,id);
          CREATE TABLE IF NOT EXISTS messages (scope TEXT NOT NULL, conversation_id TEXT NOT NULL, position INTEGER NOT NULL, id TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, PRIMARY KEY(scope,conversation_id,position), FOREIGN KEY(scope,conversation_id) REFERENCES conversations(scope,id) ON DELETE CASCADE) STRICT;
          CREATE TABLE IF NOT EXISTS conversation_flags (scope TEXT NOT NULL, id TEXT NOT NULL, archived INTEGER NOT NULL, PRIMARY KEY(scope,id)) STRICT;
          CREATE TABLE IF NOT EXISTS skill_registry (scope TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS app_records (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(namespace,key)) STRICT;
          CREATE TABLE IF NOT EXISTS session_index (root TEXT NOT NULL, key TEXT NOT NULL, project TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL NOT NULL, ctime REAL NOT NULL, metadata TEXT NOT NULL, PRIMARY KEY(root,key)) STRICT;
          CREATE INDEX IF NOT EXISTS session_index_project ON session_index(root,project);
          PRAGMA user_version=1;
        `);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  transaction(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  settings() {
    const entries = this.db
      .prepare("SELECT key,value FROM settings")
      .all()
      .map(({ key, value }) => [key, value]);
    const flags = this.db.prepare("SELECT scope,id FROM conversation_flags WHERE archived=1").all();
    const groups = new Map();
    for (const flag of flags) {
      const ids = groups.get(flag.scope) ?? [];
      ids.push(flag.id);
      groups.set(flag.scope, ids);
    }
    for (const [scope, ids] of groups)
      entries.push([`inkwell-conversation-archive-v1:${scope}`, JSON.stringify(ids)]);
    return Object.fromEntries(entries);
  }
  set(key, value) {
    if (
      !supportedStorageKey(key) ||
      key.startsWith("inkwell-external-chat-v1:") ||
      (value !== null && (typeof value !== "string" || Buffer.byteLength(value) > 2 * 1024 * 1024))
    )
      throw new Error("Invalid setting.");
    value = safeSetting(key, value);
    if (key.startsWith("inkwell-conversation-archive-v1:")) {
      const scope = JSON.stringify(scopeKey(key, "inkwell-conversation-archive-v1:"));
      const ids = value === null ? [] : JSON.parse(value);
      if (!Array.isArray(ids) || ids.length > 100000 || !ids.every((id) => validString(id)))
        throw new Error("Invalid archive.");
      this.db.prepare("DELETE FROM conversation_flags WHERE scope=?").run(scope);
      const insert = this.db.prepare("INSERT INTO conversation_flags VALUES (?,?,1)");
      for (const id of new Set(ids)) insert.run(scope, id);
    } else if (value === null) this.db.prepare("DELETE FROM settings WHERE key=?").run(key);
    else
      this.db
        .prepare(
          "INSERT INTO settings VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
        )
        .run(key, value, Date.now());
  }
  saveConversation(scope, record) {
    scopeKey(`inkwell-external-chat-v1:${scope}`, "inkwell-external-chat-v1:");
    if (
      !record ||
      !validString(record.id) ||
      typeof record.title !== "string" ||
      record.title.length > 1000 ||
      !validString(record.modified, 100) ||
      !Array.isArray(record.messages) ||
      record.messages.length > 100000 ||
      Buffer.byteLength(JSON.stringify(record)) > 16 * 1024 * 1024 ||
      !record.messages.every(
        (message) =>
          message &&
          validString(message.id) &&
          ["user", "assistant"].includes(message.role) &&
          typeof message.content === "string",
      )
    )
      throw new Error("Invalid conversation.");
    this.db
      .prepare(
        "INSERT INTO conversations VALUES (?,?,?,?,?) ON CONFLICT(scope,id) DO UPDATE SET title=CASE WHEN conversations.renamed=1 THEN conversations.title ELSE excluded.title END,modified=excluded.modified,renamed=MAX(conversations.renamed,excluded.renamed)",
      )
      .run(scope, record.id, record.title, record.modified, record.renamed ? 1 : 0);
    this.db
      .prepare("DELETE FROM messages WHERE scope=? AND conversation_id=?")
      .run(scope, record.id);
    const insert = this.db.prepare("INSERT INTO messages VALUES (?,?,?,?,?,?)");
    for (const [position, message] of record.messages.entries())
      insert.run(scope, record.id, position, message.id, message.role, message.content);
  }
  listConversations(scope, offset = 0, limit = 100) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000
    )
      throw new Error("Invalid history pagination.");
    return this.db
      .prepare(
        "SELECT scope,id,title,modified,renamed,(SELECT COUNT(*) FROM messages WHERE messages.scope=c.scope AND conversation_id=c.id) AS messageCount FROM conversations c WHERE scope=? ORDER BY modified DESC,id LIMIT ? OFFSET ?",
      )
      .all(scope, limit, offset)
      .map(({ scope: ignored, ...record }) => ({
        ...record,
        renamed: record.renamed === 1,
        messages: [],
      }));
  }
  readConversation(scope, id) {
    const record = this.db
      .prepare("SELECT id,title,modified,renamed FROM conversations WHERE scope=? AND id=?")
      .get(scope, id);
    if (!record) throw new Error("Conversation not found.");
    return {
      ...record,
      renamed: record.renamed === 1,
      messages: this.db
        .prepare(
          "SELECT id,role,content FROM messages WHERE scope=? AND conversation_id=? ORDER BY position",
        )
        .all(scope, id)
        .map((message) => ({ ...message })),
    };
  }
  migrate(entries) {
    if (!Array.isArray(entries) || entries.length > 10000)
      throw new Error("Invalid storage migration.");
    return this.transaction(() => {
      for (const [key, rawValue] of entries) {
        if (!supportedStorageKey(key) || typeof rawValue !== "string") continue;
        const migration = `webview:${key}`;
        if (this.db.prepare("SELECT 1 FROM migrations WHERE id=?").get(migration)) continue;
        const value = safeSetting(key, rawValue);
        this.db
          .prepare("INSERT INTO legacy_backup VALUES (?,?,?) ON CONFLICT(key) DO NOTHING")
          .run(key, value, Date.now());
        if (key.startsWith("inkwell-external-chat-v1:")) {
          const scope = JSON.stringify(scopeKey(key, "inkwell-external-chat-v1:"));
          const records = JSON.parse(value);
          if (!Array.isArray(records))
            throw new Error("Invalid legacy conversation history. Original data is unchanged.");
          for (const record of records) {
            if (
              !this.db
                .prepare("SELECT 1 FROM conversations WHERE scope=? AND id=?")
                .get(scope, record.id)
            )
              this.saveConversation(scope, record);
          }
        } else if (!this.db.prepare("SELECT 1 FROM settings WHERE key=?").get(key))
          this.set(key, value);
        this.db.prepare("INSERT INTO migrations VALUES (?,?)").run(migration, Date.now());
      }
      return this.settings();
    });
  }
  request(request) {
    if (request.type === "record_read" || request.type === "record_write") {
      if (!["agent-review", "skill-sync"].includes(request.namespace) || !validString(request.key))
        throw new Error("Invalid record scope.");
      if (request.type === "record_read") {
        const record = this.db
          .prepare("SELECT value FROM app_records WHERE namespace=? AND key=?")
          .get(request.namespace, request.key);
        return { value: record ? JSON.parse(record.value) : null };
      }
      const value = JSON.stringify(request.value);
      if (typeof value !== "string" || Buffer.byteLength(value) > 60 * 1024 * 1024)
        throw new Error("Invalid application record.");
      return this.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO app_records VALUES (?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
          )
          .run(request.namespace, request.key, value, Date.now());
        return { ok: true };
      });
    }
    if (request.type === "bootstrap")
      return {
        settings: this.migrate(request.entries ?? []),
        migratedKeys: this.db
          .prepare("SELECT id FROM migrations")
          .all()
          .map(({ id }) => id.slice("webview:".length)),
      };
    if (request.type === "settings_write")
      return this.transaction(() => {
        if (!Array.isArray(request.entries) || request.entries.length > 1000)
          throw new Error("Invalid settings batch.");
        for (const [key, value] of request.entries) this.set(key, value);
        return { ok: true };
      });
    const scope = request.scope;
    if (!validString(scope)) throw new Error("Invalid storage scope.");
    scopeKey(`inkwell-external-chat-v1:${scope}`, "inkwell-external-chat-v1:");
    if (
      request.type !== "conversation_list" &&
      request.type !== "conversation_save" &&
      !validString(request.id)
    )
      throw new Error("Invalid conversation id.");
    if (request.type === "conversation_list")
      return this.listConversations(scope, request.offset ?? 0, request.limit ?? 100);
    if (request.type === "conversation_read") return this.readConversation(scope, request.id);
    if (request.type === "conversation_save")
      return this.transaction(() => {
        this.saveConversation(scope, request.record);
        return { ok: true };
      });
    if (request.type === "conversation_rename")
      return this.transaction(() => {
        if (!validString(request.title, 200) || !request.title.trim())
          throw new Error("Invalid title.");
        const result = this.db
          .prepare("UPDATE conversations SET title=?,renamed=1 WHERE scope=? AND id=?")
          .run(request.title.trim(), scope, request.id);
        return { changed: Number(result.changes) > 0 };
      });
    if (request.type === "conversation_delete")
      return this.transaction(() => {
        this.db
          .prepare("DELETE FROM conversation_flags WHERE scope=? AND id=?")
          .run(scope, request.id);
        const result = this.db
          .prepare("DELETE FROM conversations WHERE scope=? AND id=?")
          .run(scope, request.id);
        return { changed: Number(result.changes) > 0 };
      });
    throw new Error("Unsupported database operation.");
  }
}
if (process.argv[1]?.endsWith("storage.mjs")) {
  let database;
  try {
    process.stdin.setEncoding("utf8");
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 64 * 1024 * 1024)
        throw new Error("Database request too large.");
    }
    database = new AppDatabase(process.argv[2]);
    process.stdout.write(JSON.stringify(database.request(JSON.parse(input))));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : "Database operation failed.");
    process.exitCode = 1;
  } finally {
    database?.close();
  }
}
