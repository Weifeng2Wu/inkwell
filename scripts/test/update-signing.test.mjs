import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configureUpdateSigning } from "../update-signing.mjs";

test("loads local signing credentials only when the public key matches", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-signing-test-"));
  try {
    const keys = path.join(directory, ".inkwell-signing");
    await mkdir(keys);
    await writeFile(path.join(keys, "updater.key"), "test-private-key\n");
    await writeFile(path.join(keys, "updater.key.pub"), "test-public-key\n");
    const environment = { INKWELL_UPDATER_PUBLIC_KEY: "test-public-key" };
    await configureUpdateSigning(environment, directory);
    assert.equal(environment.TAURI_SIGNING_PRIVATE_KEY, "test-private-key");
    assert.equal(environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "");
    await assert.rejects(
      configureUpdateSigning({ INKWELL_UPDATER_PUBLIC_KEY: "wrong-key" }, directory),
      /does not match/,
    );
    await rm(path.join(keys, "updater.key"));
    await assert.rejects(
      configureUpdateSigning({ INKWELL_UPDATER_PUBLIC_KEY: "test-public-key" }, directory),
      /Restore the existing key/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps CI credentials and passwords intact", async () => {
  const environment = {
    INKWELL_UPDATER_PUBLIC_KEY: "ci-public-key",
    TAURI_SIGNING_PRIVATE_KEY: "ci-private-key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "ci-password",
  };
  await configureUpdateSigning(environment);
  assert.equal(environment.TAURI_SIGNING_PRIVATE_KEY, "ci-private-key");
  assert.equal(environment.TAURI_SIGNING_PRIVATE_KEY_PASSWORD, "ci-password");
});

test("pull request builds do not require or enable release signing", async () => {
  const environment = { INKWELL_UNSIGNED_BUILD: "1", INKWELL_UPDATER_PUBLIC_KEY: "ignored" };
  await configureUpdateSigning(environment);
  assert.equal(environment.INKWELL_UPDATER_PUBLIC_KEY, undefined);
  assert.equal(environment.TAURI_SIGNING_PRIVATE_KEY, undefined);
});
