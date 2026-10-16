import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonlDecoder } from "../src/protocol.mjs";

test("JSONL preserves Unicode separators and split UTF-8 characters", () => {
  const records = [];
  const decoder = new JsonlDecoder((record) => records.push(record));
  const expected = { text: "中文\u2028second\u2029third" };
  const data = Buffer.from(`${JSON.stringify(expected)}\r\n`);
  for (const byte of data) decoder.push(Buffer.from([byte]));
  decoder.end();
  assert.deepEqual(records, [expected]);
});

test("malformed, oversized and incomplete records fail", () => {
  assert.throws(() => new JsonlDecoder(() => {}).push(Buffer.from("not-json\n")));
  assert.throws(() => new JsonlDecoder(() => {}, 5).push(Buffer.from("123456")), /large/);
  const decoder = new JsonlDecoder(() => {});
  decoder.push(Buffer.from('{"id":1}'));
  assert.throws(() => decoder.end(), /incomplete/);
});
