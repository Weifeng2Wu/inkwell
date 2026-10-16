import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertNoSymlinks,
  runtimeTarget,
  validateTarget,
  verifyArchive,
  verifySdk,
} from "../desktop-runtime.mjs";

test("selects native platform runtime targets", () => {
  assert.equal(runtimeTarget("win32", "x64"), "x86_64-pc-windows-msvc");
  assert.equal(runtimeTarget("darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(runtimeTarget("darwin", "x64"), "x86_64-apple-darwin");
  assert.equal(runtimeTarget("linux", "x64"), "x86_64-unknown-linux-gnu");
  assert.throws(() => runtimeTarget("win32", "ia32"));
});

test("rejects mismatched architectures and config overrides", () => {
  const target = runtimeTarget("linux", "x64");
  validateTarget(["--target", target, "--bundles", "deb,appimage"], target);
  validateTarget([`--target=${target}`], target);
  for (const args of [
    ["--target", "aarch64-apple-darwin"],
    ["--target"],
    ["--debug"],
    ["--config=override.json"],
    ["-c", "override.json"],
  ]) {
    assert.throws(() => validateTarget(args, target));
  }
});

test("verifies the exact Node distribution checksum", () => {
  const contents = Buffer.from("test distribution");
  const digest = createHash("sha256").update(contents).digest("hex");
  assert.equal(verifyArchive(contents, `${digest}  node.tar.gz\r\n`, "node.tar.gz"), digest);
  assert.throws(() => verifyArchive(contents, `${digest}  other.tar.gz`, "node.tar.gz"));
  assert.throws(() =>
    verifyArchive(Buffer.from("tampered"), `${digest}  node.tar.gz`, "node.tar.gz"),
  );
});

test("relocated SDK imports using a path containing spaces", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell sdk test "));
  try {
    const sdk = path.join(directory, "index.mjs");
    await writeFile(sdk, "export function createAgentSession() {}\n");
    verifySdk(process.execPath, sdk, directory);
    await mkdir(path.join(directory, "nested"));
    await assertNoSymlinks(directory);
    await symlink(path.join(directory, "nested"), path.join(directory, "linked"), "junction");
    await assert.rejects(assertNoSymlinks(directory), /non-portable symlink/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
