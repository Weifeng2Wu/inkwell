import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { withRuntimeBundleConfig } from "../desktop-runtime.mjs";
import { generateUpdateManifest } from "../generate-update-manifest.mjs";

async function fixture(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-updates-test-"));
  const names = [
    "Inkwell_aarch64.app.tar.gz",
    "Inkwell_0.2.0_x64-setup.exe",
    "Inkwell_0.2.0_amd64.AppImage",
  ];
  try {
    for (const name of names) {
      await mkdir(path.join(directory, name.split(".").at(-1)), { recursive: true });
      const filename = path.join(directory, name.split(".").at(-1), name);
      await writeFile(filename, "package");
      await writeFile(`${filename}.sig`, "signed-package\n");
    }
    await run(directory, names);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const options = {
  version: "0.2.0",
  repository: "EvolvingLMMs-Lab/inkwell",
  pubDate: "2026-10-22T00:00:00Z",
};
test("generates platform-specific signed update URLs from downloaded CI artifacts", async () => {
  await fixture(async (directory) => {
    const manifest = await generateUpdateManifest({ ...options, directory });
    assert.equal(manifest.version, "0.2.0");
    assert.deepEqual(Object.keys(manifest.platforms).sort(), [
      "darwin-aarch64",
      "linux-x86_64",
      "windows-x86_64",
    ]);
    assert.equal(manifest.platforms["darwin-aarch64"].signature, "signed-package");
    assert.equal(
      manifest.platforms["darwin-aarch64"].url,
      "https://github.com/EvolvingLMMs-Lab/inkwell/releases/download/v0.2.0/Inkwell_aarch64.app.tar.gz",
    );
  });
});
test("refuses to publish when a platform or matching signed package is missing", async () => {
  await fixture(async (directory, names) => {
    await rm(path.join(directory, "exe", `${names[1]}.sig`));
    await assert.rejects(
      generateUpdateManifest({ ...options, directory }),
      /Missing signed update: windows/,
    );
  });
  await fixture(async (directory, names) => {
    await rm(path.join(directory, "gz", names[0]));
    await assert.rejects(generateUpdateManifest({ ...options, directory }), /ENOENT/);
  });
});
test("requires a private signing key when building an update-enabled application", async () => {
  await assert.rejects(
    withRuntimeBundleConfig(() => {}, { INKWELL_UPDATER_PUBLIC_KEY: "public-key" }),
    /TAURI_SIGNING_PRIVATE_KEY/,
  );
});
