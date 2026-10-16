import assert from "node:assert/strict";
import { test } from "node:test";
import { promptImages } from "../src/attachments.mjs";

test("images are forwarded as typed content without UI metadata", () => {
  assert.deepEqual(promptImages([{ name: "x.png", mimeType: "image/png", data: "eA==" }], true), [
    { type: "image", mimeType: "image/png", data: "eA==" },
  ]);
  assert.deepEqual(promptImages(undefined, false), []);
});
test("unsupported vision, oversized data, active formats and too many images fail explicitly", () => {
  const image = { mimeType: "image/png", data: "eA==" };
  assert.throws(() => promptImages([image], false), /does not support/);
  assert.throws(() => promptImages([{ ...image, mimeType: "image/svg+xml" }], true), /Invalid/);
  assert.throws(() => promptImages([{ ...image, data: "A".repeat(327681) }], true), /oversized/);
  assert.throws(() => promptImages(Array(5).fill(image), true), /Invalid/);
  assert.throws(() => promptImages([{ ...image, data: "<script>" }], true), /Invalid/);
});
