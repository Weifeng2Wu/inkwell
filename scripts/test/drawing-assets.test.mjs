import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareDrawingAssets } from "../prepare-drawing-assets.mjs";

test("bundles all Excalidraw font families and their licenses for offline use", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-drawing-fonts-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  prepareDrawingAssets(directory);
  const families = await readdir(path.join(directory, "fonts"));
  assert.ok(families.includes("Excalifont"));
  assert.ok(families.includes("Xiaolai"));
  const files = await readdir(path.join(directory, "fonts"), { recursive: true });
  assert.ok(files.some((name) => name.endsWith(".woff2")));
  const licenses = await readdir(path.join(directory, "licenses"));
  for (const family of families) assert.ok(licenses.includes(`${family}.txt`), family);
  assert.ok(licenses.includes("Excalidraw.txt"));
});
