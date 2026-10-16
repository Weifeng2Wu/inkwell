import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SessionHistory } from "../src/history.mjs";

const sdk = {
  SessionManager: {
    open(filename) {
      const [header, ...entries] = readFileSync(filename, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      return {
        getCwd: () => header.cwd,
        getEntries: () => entries,
        getSessionId: () => header.id,
        getHeader: () => header,
        getLeafId: () => null,
        getSessionName: () => entries.findLast((entry) => entry.type === "session_info")?.name,
        getSessionFile: () => filename,
        appendSessionInfo: (name) =>
          appendFileSync(filename, `${JSON.stringify({ type: "session_info", name })}\n`),
      };
    },
  },
  buildSessionContext: (entries) => ({
    messages: entries.filter((entry) => entry.type === "message").map((entry) => entry.message),
  }),
};

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-history-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const store = path.join(root, "sessions");
  const bucket = "a".repeat(64);
  await mkdir(project);
  await mkdir(path.join(store, bucket), { recursive: true });
  const key = `${bucket}/saved.jsonl`;
  const filename = path.join(store, key);
  const header = {
    type: "session",
    id: "saved-session",
    cwd: project,
    timestamp: "2026-10-16T00:00:00Z",
  };
  await writeFile(
    filename,
    [
      header,
      { type: "message", message: { role: "user", content: "Discuss the manuscript" } },
      {
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Draft feedback" }] },
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
  );
  return {
    history: new SessionHistory(sdk, store, project),
    root,
    project,
    store,
    key,
    filename,
    header,
  };
}

test("history lists, previews, renames, and deletes a local conversation", async (context) => {
  const { history, key, filename } = await fixture(context);
  const sessions = await history.list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "Discuss the manuscript");
  assert.equal(sessions[0].messageCount, 2);
  assert.equal((await history.read(key)).messages.length, 2);
  await history.rename(key, "New title");
  assert.equal((await history.list())[0].title, "New title");
  await assert.rejects(history.rename(key, " "), /1–200/);
  await history.remove(key);
  assert.deepEqual(await history.list(), []);
  await assert.rejects(readFile(filename), /ENOENT/);
});

test("history rejects path traversal, other projects, symlinks, and corrupt files", async (context) => {
  const { history, store, key, filename, header } = await fixture(context);
  await assert.rejects(history.read("../../outside.jsonl"), /Invalid history key/);
  await writeFile(filename, JSON.stringify({ ...header, cwd: "/other-project" }) + "\n");
  assert.deepEqual(await history.list(), []);
  await assert.rejects(history.read(key), /project/);
  await writeFile(filename, "invalid JSON\n");
  assert.deepEqual(await history.list(), []);
  await rm(filename);
  const target = path.join(store, "outside.jsonl");
  await writeFile(target, JSON.stringify(header) + "\n");
  await symlink(target, filename);
  await assert.rejects(history.read(key), /Invalid or oversized/);
  assert.deepEqual(await history.list(), []);
});

test("unchanged JSONL sessions use SQLite metadata while changed logs are reindexed", async (context) => {
  const { history, key, filename } = await fixture(context);
  let opens = 0;
  history.sdk = {
    ...sdk,
    SessionManager: {
      open: (...arguments_) => {
        opens += 1;
        return sdk.SessionManager.open(...arguments_);
      },
    },
  };
  await history.list();
  assert.equal(opens, 1);
  await history.list();
  assert.equal(opens, 1);
  await history.rename(key, "Renamed externally");
  assert.equal((await history.list())[0].title, "Renamed externally");
  assert.equal(opens, 3);
  await history.read(key);
  assert.equal(opens, 4);
  await rm(filename);
  assert.deepEqual(await history.list(), []);
});
