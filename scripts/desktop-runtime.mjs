import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const tauriDirectory = path.join(root, "apps/desktop/src-tauri");

export function run(program, args, cwd = root) {
  const result = spawnSync(program, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && program === "pnpm",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited with status ${result.status}.`);
}

export function runtimeTarget(platform, arch) {
  const targets = {
    "win32-x64": "x86_64-pc-windows-msvc",
    "darwin-x64": "x86_64-apple-darwin",
    "darwin-arm64": "aarch64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
  };
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error(`Unsupported desktop runtime: ${platform}-${arch}`);
  return target;
}

export function validateTarget(args, target) {
  for (const [index, argument] of args.entries()) {
    if (argument === "--config" || argument === "-c" || argument.startsWith("--config=")) {
      throw new Error("Custom bundle configs are not supported by the release wrapper.");
    }
    if (argument === "--debug") throw new Error("Use pnpm tauri:dev for development builds.");
    const selected =
      argument === "--target" || argument === "-t"
        ? args[index + 1]
        : argument.startsWith("--target=")
          ? argument.slice(9)
          : undefined;
    if ((argument === "--target" || argument === "-t") && !selected) {
      throw new Error("Missing desktop build target.");
    }
    if (selected && selected !== target) {
      throw new Error(`Build natively on ${selected}; the bundled runtime belongs to ${target}.`);
    }
  }
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

export function verifyArchive(contents, sums, filename) {
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((entry) => entry[1] === filename)?.[0];
  const actual = createHash("sha256").update(contents).digest("hex");
  if (!expected || expected !== actual)
    throw new Error(`Node.js archive checksum mismatch: ${filename}`);
  return actual;
}

export async function assertNoSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Runtime contains a non-portable symlink: ${filename}`);
    if (entry.isDirectory()) await assertNoSymlinks(filename);
  }
}

export function verifySdk(node, sdk, cwd) {
  run(
    node,
    [
      "--input-type=module",
      "--eval",
      `const sdk = await import(${JSON.stringify(pathToFileURL(sdk).href)}); if (typeof sdk.createAgentSession !== 'function') throw new Error('Invalid Agent SDK');`,
    ],
    cwd,
  );
}

export async function prepareRuntime() {
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Desktop packaging requires Node.js 24.x.");
  const target = runtimeTarget(process.platform, process.arch);
  const source = JSON.parse(
    await readFile(path.join(root, "packages/academic-agent/runtime-source.json"), "utf8"),
  );
  if (!/^[a-f0-9]{40}$/.test(source.revision)) throw new Error("Invalid pinned runtime revision.");
  const checkout = path.join(
    root,
    ".cache/agent-runtime",
    `${source.revision}-${process.platform}-${process.arch}`,
  );
  let ready = false;
  try {
    const metadata = JSON.parse(await readFile(path.join(checkout, "inkwell-build.json"), "utf8"));
    ready =
      metadata.revision === source.revision &&
      metadata.platform === process.platform &&
      metadata.arch === process.arch;
    await access(path.join(checkout, "packages/coding-agent/dist/index.js"));
  } catch {
    ready = false;
  }
  if (!ready) run(process.execPath, [path.join(root, "scripts/setup-agent-runtime.mjs")]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "inkwell-package-"));
  try {
    const deployed = path.join(temporary, "deployed");
    const sdk = path.join(temporary, "sdk");
    run(
      "pnpm",
      [
        "--filter",
        "@nanopi/pi-coding-agent",
        "--prod",
        "deploy",
        "--legacy",
        "--ignore-scripts",
        "--offline",
        deployed,
      ],
      checkout,
    );
    await cp(deployed, sdk, {
      recursive: true,
      dereference: true,
      filter: (filename) => path.basename(filename) !== ".bin",
    });
    await assertNoSymlinks(sdk);
    const filename = `node-${process.version}-${process.platform}-${process.arch}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
    const base = `https://nodejs.org/dist/${process.version}/`;
    const [archive, checksums] = await Promise.all([
      download(base + filename),
      download(`${base}SHASUMS256.txt`),
    ]);
    const archiveSha256 = verifyArchive(archive, checksums.toString("utf8"), filename);
    const archivePath = path.join(temporary, filename);
    await writeFile(archivePath, archive);
    run("tar", ["-xf", archivePath, "-C", temporary]);
    const distribution = path.join(
      temporary,
      `node-${process.version}-${process.platform}-${process.arch}`,
    );
    const node = path.join(distribution, process.platform === "win32" ? "node.exe" : "bin/node");
    verifySdk(node, path.join(sdk, "dist/index.js"), temporary);
    const resources = path.join(tauriDirectory, "resources/agent");
    const binaries = path.join(tauriDirectory, "binaries");
    await mkdir(resources, { recursive: true });
    await mkdir(binaries, { recursive: true });
    await rm(path.join(resources, "sdk"), { recursive: true, force: true });
    await cp(sdk, path.join(resources, "sdk"), { recursive: true });
    await copyFile(path.join(distribution, "LICENSE"), path.join(resources, "NODE-LICENSE"));
    await copyFile(path.join(checkout, "LICENSE"), path.join(resources, "AGENT-LICENSE"));
    await copyFile(
      path.join(checkout, "inkwell-build.json"),
      path.join(resources, "inkwell-build.json"),
    );
    const executable = path.join(
      binaries,
      `inkwell-node-${target}${process.platform === "win32" ? ".exe" : ""}`,
    );
    await copyFile(node, executable);
    if (process.platform !== "win32") await chmod(executable, 0o755);
    await writeFile(
      path.join(resources, "runtime.json"),
      JSON.stringify(
        {
          revision: source.revision,
          repository: source.repository,
          target,
          nodeVersion: process.version,
          nodeArchive: filename,
          archiveSha256,
        },
        null,
        2,
      ),
    );
    console.log(`Portable Agent runtime verified: ${target}, ${process.version}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
