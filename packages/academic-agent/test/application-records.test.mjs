import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppDatabase } from "../src/storage.mjs";

test("review state and skill sync state are durable isolated application records", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-records-"));
  const filename = path.join(directory, "inkwell.sqlite");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const database = new AppDatabase(filename);
  try {
    database.request({
      type: "record_write",
      namespace: "agent-review",
      key: "/paper",
      value: { baseline: { "paper.tex": "Original 稿件" } },
    });
    database.request({
      type: "record_write",
      namespace: "skill-sync",
      key: "/paper",
      value: { checkedAt: 123 },
    });
    assert.throws(() =>
      database.request({ type: "record_read", namespace: "unknown", key: "/paper" }),
    );
  } finally {
    database.close();
  }
  const reopened = new AppDatabase(filename);
  try {
    assert.deepEqual(
      reopened.request({ type: "record_read", namespace: "agent-review", key: "/paper" }).value,
      { baseline: { "paper.tex": "Original 稿件" } },
    );
    assert.deepEqual(
      reopened.request({ type: "record_read", namespace: "skill-sync", key: "/paper" }).value,
      { checkedAt: 123 },
    );
    assert.equal(
      reopened.request({ type: "record_read", namespace: "agent-review", key: "/other" }).value,
      null,
    );
  } finally {
    reopened.close();
  }
});
