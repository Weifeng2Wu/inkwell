import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  assertNoSymlinks,
  materializeDeployment,
  nodeDistribution,
  runtimeResources,
  runtimeTarget,
  tauriDirectory,
  validateTarget,
  verifyArchive,
  verifySdk,
  windowsResourcePattern,
  withRuntimeBundleConfig,
} from "../desktop-runtime.mjs";

test("passes bundle configuration as a JSON file and cleans up after success or failure", async () => {
  for (const fails of [false, true]) {
    let configurationPath;
    const build = withRuntimeBundleConfig(
      async (filename) => {
        configurationPath = filename;
        assert.equal(path.extname(filename), ".json");
        const configuration = JSON.parse(await readFile(filename, "utf8"));
        const resources = path.win32.resolve(tauriDirectory, "..", "iw-agent");
        assert.deepEqual(configuration.bundle.resources, {
          [windowsResourcePattern(tauriDirectory, resources)]: "agent/",
        });
        assert.deepEqual(configuration.bundle.externalBin, ["binaries/inkwell-node"]);
        assert.equal(configuration.bundle.macOS.entitlements, "Entitlements.plist");
        if (fails) throw new Error("build failed");
        return "built";
      },
      { INKWELL_RUNTIME_RESOURCES: path.win32.resolve(tauriDirectory, "..", "iw-agent") },
      "win32",
    );
    if (fails) await assert.rejects(build, /build failed/);
    else assert.equal(await build, "built");
    await assert.rejects(access(configurationPath), { code: "ENOENT" });
  }
});

test("uses rooted Windows resource patterns without retaining the long project prefix", () => {
  const project = "D:\\a\\inkwell\\inkwell\\apps\\desktop\\src-tauri";
  const resources = "D:\\iw-agent";
  const pattern = windowsResourcePattern(project, resources);
  assert.equal(pattern, "/iw-agent");
  assert.equal(path.win32.resolve(project, pattern), resources);
  assert.throws(() => windowsResourcePattern(project, "C:\\iw-agent"), /same drive/);
  assert.equal(windowsResourcePattern(project, "d:\\iw-agent\\cache\\.."), "/iw-agent");
  assert.throws(
    () => windowsResourcePattern("\\\\server\\share\\project", "\\\\server\\share\\agent"),
    /local drive/,
  );
});

test("uses short absolute Windows resource staging only when explicitly configured", () => {
  const environment = { INKWELL_RUNTIME_RESOURCES: "C:\\iw-agent" };
  assert.equal(runtimeResources(environment, "win32"), "C:\\iw-agent");
  assert.equal(runtimeResources(environment, "darwin"), runtimeResources({}, "darwin"));
  assert.throws(() => runtimeResources({ INKWELL_RUNTIME_RESOURCES: "relative" }, "win32"));
});

test("selects native platform runtime targets", () => {
  assert.equal(runtimeTarget("win32", "x64"), "x86_64-pc-windows-msvc");
  assert.equal(runtimeTarget("darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(runtimeTarget("darwin", "x64"), "x86_64-apple-darwin");
  assert.equal(runtimeTarget("linux", "x64"), "x86_64-unknown-linux-gnu");
  assert.throws(() => runtimeTarget("win32", "ia32"));
});

test("selects official Node archive names and extraction directories", () => {
  for (const [platform, arch, directory, extension] of [
    ["win32", "x64", "node-v24.17.0-win-x64", "zip"],
    ["darwin", "arm64", "node-v24.17.0-darwin-arm64", "tar.gz"],
    ["darwin", "x64", "node-v24.17.0-darwin-x64", "tar.gz"],
    ["linux", "x64", "node-v24.17.0-linux-x64", "tar.gz"],
  ]) {
    assert.deepEqual(nodeDistribution("v24.17.0", platform, arch), {
      directory,
      filename: `${directory}.${extension}`,
    });
  }
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

test("materializes pnpm dependencies without traversing the deployed root self-reference", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell deploy test "));
  try {
    const deployed = path.join(directory, "deployed");
    const destination = path.join(directory, "sdk");
    const hoisted = path.join(deployed, "node_modules/.pnpm/node_modules");
    const dependency = path.join(
      deployed,
      "node_modules/.pnpm/dependency@1/node_modules/dependency",
    );
    await mkdir(path.join(hoisted, "@nanopi"), { recursive: true });
    await mkdir(dependency, { recursive: true });
    await writeFile(
      path.join(deployed, "package.json"),
      JSON.stringify({
        name: "@nanopi/pi-coding-agent",
        type: "module",
        dependencies: { dependency: "1" },
      }),
    );
    await writeFile(
      path.join(dependency, "package.json"),
      JSON.stringify({ name: "dependency", main: "index.cjs" }),
    );
    await writeFile(path.join(dependency, "index.cjs"), "exports.ready = true;\n");
    await writeFile(
      path.join(deployed, "index.mjs"),
      "import dependency from 'dependency'; export const createAgentSession = dependency.ready ? () => {} : null;\n",
    );
    await symlink(
      path.join(directory, "missing-root"),
      path.join(hoisted, "@nanopi/pi-coding-agent"),
      "junction",
    );
    await symlink(dependency, path.join(deployed, "node_modules/dependency"), "junction");
    await symlink(dependency, path.join(hoisted, "dependency"), "junction");
    await materializeDeployment(deployed, destination);
    await assert.rejects(
      access(path.join(destination, "node_modules/.pnpm/node_modules/@nanopi/pi-coding-agent")),
    );
    assert.equal(
      await readFile(path.join(destination, "node_modules/dependency/index.cjs"), "utf8"),
      "exports.ready = true;\n",
    );
    await rm(deployed, { recursive: true, force: true });
    verifySdk(process.execPath, path.join(destination, "index.mjs"), directory);
    await assertNoSymlinks(destination);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not silently skip broken runtime dependencies", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell broken deploy "));
  try {
    const deployed = path.join(directory, "deployed");
    await mkdir(path.join(deployed, "node_modules"), { recursive: true });
    await writeFile(
      path.join(deployed, "package.json"),
      JSON.stringify({ name: "runtime", dependencies: { required: "1" } }),
    );
    await symlink(
      path.join(directory, "missing"),
      path.join(deployed, "node_modules/required"),
      "junction",
    );
    await assert.rejects(materializeDeployment(deployed, path.join(directory, "sdk")), {
      code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves isolated transitive dependency resolution after relocation", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell transitive "));
  try {
    const deployed = path.join(directory, "deployed");
    const destination = path.join(directory, "sdk");
    const first = path.join(
      deployed,
      "node_modules/.pnpm/brace-expansion@1/node_modules/brace-expansion",
    );
    const second = path.join(
      deployed,
      "node_modules/.pnpm/balanced-match@1/node_modules/balanced-match",
    );
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(
      path.join(deployed, "package.json"),
      JSON.stringify({
        name: "runtime",
        type: "module",
        dependencies: { "brace-expansion": "1" },
        optionalDependencies: { absent: "1" },
      }),
    );
    await writeFile(
      path.join(deployed, "index.mjs"),
      "import { ready } from 'brace-expansion'; export const createAgentSession = ready ? () => {} : null;",
    );
    await writeFile(
      path.join(first, "package.json"),
      JSON.stringify({
        name: "brace-expansion",
        type: "module",
        main: "index.js",
        dependencies: { "balanced-match": "1" },
      }),
    );
    await writeFile(path.join(first, "index.js"), "export { ready } from 'balanced-match';");
    await writeFile(
      path.join(second, "package.json"),
      JSON.stringify({ name: "balanced-match", type: "module", main: "index.js" }),
    );
    await writeFile(path.join(second, "index.js"), "export const ready = true;");
    await symlink(first, path.join(deployed, "node_modules/brace-expansion"), "junction");
    await symlink(second, path.join(path.dirname(first), "balanced-match"), "junction");
    await materializeDeployment(deployed, destination);
    await rm(deployed, { recursive: true, force: true });
    verifySdk(process.execPath, path.join(destination, "index.mjs"), directory);
    await assertNoSymlinks(destination);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shares diamond dependencies while preserving conflicting versions and cycles", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell shared dependencies "));
  try {
    const deployed = path.join(directory, "deployed");
    const destination = path.join(directory, "sdk");
    async function createPackage(location, name, dependencies, contents) {
      await mkdir(location, { recursive: true });
      await writeFile(
        path.join(location, "package.json"),
        JSON.stringify({ name, type: "module", main: "index.js", dependencies }),
      );
      await writeFile(path.join(location, "index.js"), contents);
    }
    const first = path.join(deployed, "node_modules/first");
    const second = path.join(deployed, "node_modules/second");
    const shared = path.join(deployed, "node_modules/shared");
    await createPackage(
      deployed,
      "runtime",
      { first: "1", second: "1" },
      "import { value as first } from 'first'; import { value as second } from 'second'; export const result = [first, second];",
    );
    for (const [location, name, version] of [
      [first, "first", "one"],
      [second, "second", "two"],
    ]) {
      await createPackage(
        location,
        name,
        { shared: "1", conflicting: version },
        "import { shared } from 'shared'; import { version } from 'conflicting'; export const value = shared + version;",
      );
      await createPackage(
        path.join(location, "node_modules/conflicting"),
        "conflicting",
        {},
        `export const version = ${JSON.stringify(version)};`,
      );
    }
    await createPackage(
      shared,
      "shared",
      { first: "1" },
      "import 'first'; export const shared = 'shared-';",
    );
    const statistics = await materializeDeployment(deployed, destination);
    assert.deepEqual(statistics, { uniquePackages: 6, copies: 6 });
    await assert.rejects(access(path.join(destination, "node_modules/first/node_modules/shared")));
    await assert.rejects(access(path.join(destination, "node_modules/second/node_modules/shared")));
    await access(path.join(destination, "node_modules/shared/index.js"));
    await rm(deployed, { recursive: true, force: true });
    const relocated = await import(pathToFileURL(path.join(destination, "index.js")).href);
    assert.deepEqual(relocated.result, ["shared-one", "shared-two"]);
    await assertNoSymlinks(destination);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bounds copying when conflicting packages form repeated dependency diamonds", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell dependency diamonds "));
  try {
    const deployed = path.join(directory, "deployed");
    const destination = path.join(directory, "sdk");
    const depth = 8;
    async function createPackage(location, name, dependencies, contents) {
      await mkdir(location, { recursive: true });
      await writeFile(
        path.join(location, "package.json"),
        JSON.stringify({ name, type: "module", main: "index.js", dependencies }),
      );
      await writeFile(path.join(location, "index.js"), contents);
    }
    await createPackage(
      deployed,
      "runtime",
      { "layer-0": "1", alternate: "1" },
      "import { value } from 'layer-0'; export const result = value;",
    );
    const alternate = path.join(deployed, "node_modules/alternate");
    await createPackage(alternate, "alternate", { "layer-0": "2" }, "export const ready = true;");
    for (let level = 0; level < depth; level += 1) {
      for (const version of [1, 2]) {
        const name = `layer-${level}`;
        const location = path.join(directory, "store", `${name}-${version}`);
        const dependencies =
          level + 1 < depth ? { [`layer-${level + 1}`]: "1", [`alias-${level + 1}`]: "2" } : {};
        await createPackage(
          location,
          name,
          dependencies,
          level + 1 < depth
            ? `import { value as first } from 'layer-${level + 1}'; import { value as second } from 'alias-${level + 1}'; export const value = first + second;`
            : "export const value = 1;",
        );
        if (level + 1 < depth) {
          await mkdir(path.join(location, "node_modules"));
          for (const [alias, nextVersion] of [
            [`layer-${level + 1}`, 1],
            [`alias-${level + 1}`, 2],
          ])
            await symlink(
              path.join(directory, "store", `layer-${level + 1}-${nextVersion}`),
              path.join(location, "node_modules", alias),
              "junction",
            );
        }
      }
    }
    await mkdir(path.join(alternate, "node_modules"));
    await symlink(
      path.join(directory, "store/layer-0-1"),
      path.join(deployed, "node_modules/layer-0"),
      "junction",
    );
    await symlink(
      path.join(directory, "store/layer-0-2"),
      path.join(alternate, "node_modules/layer-0"),
      "junction",
    );
    const statistics = await materializeDeployment(deployed, destination);
    assert.equal(statistics.uniquePackages, depth * 2 + 2);
    assert.equal(statistics.copies, depth * 2 + 2);
    await rm(deployed, { recursive: true, force: true });
    await rm(path.join(directory, "store"), { recursive: true, force: true });
    const relocated = await import(pathToFileURL(path.join(destination, "index.js")).href);
    assert.equal(relocated.result, 2 ** (depth - 1));
    await assertNoSymlinks(destination);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
