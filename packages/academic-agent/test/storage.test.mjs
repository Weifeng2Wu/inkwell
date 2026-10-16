import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppDatabase } from "../src/storage.mjs";

async function fixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-database-"));
  const filename = path.join(directory, "inkwell.sqlite");
  const database = new AppDatabase(filename);
  context.after(() => {
    database.close();
    return rm(directory, { recursive: true, force: true });
  });
  return { database, filename };
}
const scope = JSON.stringify(["/project", "codex"]);
const record = (id = "one", modified = "2026-10-17T00:00:00Z") => ({
  id,
  title: "Paper discussion",
  modified,
  messages: [{ id: "message", role: "user", content: "Check the format" }],
});

test("legacy migration is transactional, durable and idempotent", async (context) => {
  const { database, filename } = await fixture(context);
  const entries = [
    ["editor-settings", '{"fontSize":14}'],
    [`inkwell-external-chat-v1:${scope}`, JSON.stringify([record()])],
    [`inkwell-conversation-archive-v1:${scope}`, '["one"]'],
  ];
  database.request({ type: "bootstrap", entries });
  database.request({ type: "settings_write", entries: [["editor-settings", '{"fontSize":18}']] });
  database.request({ type: "conversation_delete", scope, id: "one" });
  database.request({ type: "bootstrap", entries });
  assert.equal(database.settings()["editor-settings"], '{"fontSize":18}');
  assert.equal(database.listConversations(scope).length, 0);
  const reopened = new AppDatabase(filename);
  try {
    assert.equal(reopened.settings()["editor-settings"], '{"fontSize":18}');
  } finally {
    reopened.close();
  }
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM migrations").get().count, 3);
});

test("malformed legacy history rolls back without consuming migration markers", async (context) => {
  const { database } = await fixture(context);
  assert.throws(() =>
    database.migrate([
      ["theme", "nord"],
      [`inkwell-external-chat-v1:${scope}`, "invalid"],
    ]),
  );
  assert.deepEqual(database.settings(), {});
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM migrations").get().count, 0);
  assert.equal(database.db.prepare("SELECT COUNT(*) AS count FROM legacy_backup").get().count, 0);
});

test("conversation metadata is paged, bodies are lazy, scopes isolated and deletes cascade", async (context) => {
  const { database } = await fixture(context);
  database.request({ type: "conversation_save", scope, record: record("older", "2026-10-16") });
  database.request({ type: "conversation_save", scope, record: record("newer", "2026-10-17") });
  assert.equal(database.listConversations(scope, 0, 1)[0].id, "newer");
  assert.equal(database.listConversations(scope, 1, 1)[0].id, "older");
  assert.deepEqual(database.listConversations(scope)[0].messages, []);
  assert.equal(database.listConversations(scope)[0].messageCount, 1);
  assert.deepEqual(database.listConversations(JSON.stringify(["/other", "codex"])), []);
  assert.deepEqual(database.readConversation(scope, "newer").messages, record().messages);
  database.request({ type: "conversation_rename", scope, id: "newer", title: "Custom title" });
  database.request({ type: "conversation_save", scope, record: record("newer") });
  assert.equal(database.readConversation(scope, "newer").title, "Custom title");
  database.request({ type: "conversation_delete", scope, id: "newer" });
  assert.equal(
    database.db
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id='newer'")
      .get().count,
    0,
  );
});

test("provider secrets never enter SQLite settings or migration backups", async (context) => {
  const { database } = await fixture(context);
  const config = JSON.stringify({
    provider: "custom",
    model: "test",
    apiKey: "secret-value",
    token: "secret-token",
    skillIds: [],
  });
  database.migrate([
    ["inkwell-agent-config-v1:/project", config],
    ["inkwell-layout-parser-v1", config],
    ["unknown-secret", "secret-value"],
  ]);
  const settings = JSON.stringify(database.settings());
  const backup = JSON.stringify(database.db.prepare("SELECT * FROM legacy_backup").all());
  assert.doesNotMatch(settings + backup, /secret-value|secret-token/);
  assert.throws(() => database.set("apiKey", "secret"), /Invalid setting/);
  assert.throws(() => database.request({ type: "conversation_list", scope: "../escape" }));
  assert.throws(() => database.request({ type: "conversation_list", scope, limit: -1 }));
});

test("invalid settings batches and messages roll back rather than leave partial writes", async (context) => {
  const { database } = await fixture(context);
  assert.throws(() =>
    database.request({
      type: "settings_write",
      entries: [
        ["theme", "dark"],
        ["unknown", "bad"],
      ],
    }),
  );
  assert.deepEqual(database.settings(), {});
  database.request({ type: "conversation_save", scope, record: record() });
  assert.throws(() =>
    database.request({
      type: "conversation_save",
      scope,
      record: { ...record(), messages: [{ id: "bad", role: "system", content: "bad" }] },
    }),
  );
  assert.deepEqual(database.readConversation(scope, "one").messages, record().messages);
});

test("newer schema versions are rejected without resetting user data", async (context) => {
  const { database, filename } = await fixture(context);
  database.set("theme", "nord");
  database.db.exec("PRAGMA user_version=999");
  assert.throws(() => new AppDatabase(filename), /newer Inkwell version/);
  assert.equal(database.settings().theme, "nord");
});
