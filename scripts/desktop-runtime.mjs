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
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const tauriDirectory = path.join(root, "apps/desktop/src-tauri");

export function runtimeResources(environment = process.env, platform = process.platform) {
  if (platform === "win32" && environment.INKWELL_RUNTIME_RESOURCES) {
    if (!path.win32.isAbsolute(environment.INKWELL_RUNTIME_RESOURCES))
      throw new Error("Windows runtime resource staging must use an absolute path.");
    return environment.INKWELL_RUNTIME_RESOURCES;
  }
  return path.join(tauriDirectory, "resources/agent");
}

export async function withRuntimeBundleConfig(
  build,
  environment = process.env,
  platform = process.platform,
) {
  const configuration = JSON.parse(
    await readFile(path.join(tauriDirectory, "tauri.bundle.conf.json"), "utf8"),
  );
  if (platform === "win32" && environment.INKWELL_RUNTIME_RESOURCES)
    configuration.bundle.resources = {
      [windowsResourcePattern(tauriDirectory, runtimeResources(environment, platform))]: "agent/",
    };
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-bundle-config-"));
  try {
    const filename = path.join(directory, "tauri.bundle.conf.json");
    await writeFile(filename, JSON.stringify(configuration));
    return await build(filename);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function windowsResourcePattern(projectDirectory, resources) {
  const relative = path.win32.relative(projectDirectory, resources);
  if (path.win32.isAbsolute(relative))
    throw new Error("Windows runtime resources must be staged on the same drive as the project.");
  const absolute = path.win32.resolve(projectDirectory, resources);
  const resourceRoot = path.win32.parse(absolute).root;
  if (resourceRoot.startsWith("\\\\"))
    throw new Error("Windows runtime resources must be staged on a local drive.");
  return `/${absolute.slice(resourceRoot.length).replaceAll("\\", "/")}`;
}

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

export function nodeDistribution(version, platform, arch) {
  runtimeTarget(platform, arch);
  const directory = `node-${version}-${platform === "win32" ? "win" : platform}-${arch}`;
  return {
    directory,
    filename: `${directory}.${platform === "win32" ? "zip" : "tar.gz"}`,
  };
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

export async function assertWindowsInstallPaths(directory) {
  const installDirectoryLength = 80;
  const resourcePrefixLength = installDirectoryLength + "\\agent\\".length;
  async function inspect(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await inspect(filename);
      } else {
        const relative = path.relative(directory, filename).split(path.sep).join("\\");
        const installedLength = resourcePrefixLength + relative.length;
        const parentLength = resourcePrefixLength + path.win32.dirname(relative).length;
        if (installedLength >= 260 || parentLength > 247)
          throw new Error(
            `Windows installer resource path is too long (${installedLength} characters with an ${installDirectoryLength}-character install directory): agent\\${relative}. Reduce runtime dependency nesting before packaging. Shortening the build staging directory does not shorten installed paths.`,
          );
      }
    }
  }
  await inspect(directory);
}

function nodeExportTargets(exports, conditions) {
  if (typeof exports === "string") return [exports];
  if (!exports || typeof exports !== "object") return [];
  if (Array.isArray(exports))
    return exports.flatMap((entry) => nodeExportTargets(entry, conditions));
  const entries = Object.entries(exports);
  if (entries.some(([name]) => name.startsWith(".")))
    return entries.flatMap(([, entry]) => nodeExportTargets(entry, conditions));
  const selected = entries.find(([condition]) => conditions.has(condition));
  return selected ? nodeExportTargets(selected[1], conditions) : [];
}

export function omitAlternateAwsBuild(manifest) {
  if (!/^@(aws-sdk|smithy)\//.test(manifest.name) || !/^\.\/dist-cjs\//.test(manifest.main ?? ""))
    return false;
  if (JSON.stringify(manifest.imports ?? {}).includes("dist-es")) return false;
  return ["import", "require"].every((mode) =>
    nodeExportTargets(
      manifest.exports,
      new Set(["node", "node-addons", "module-sync", "default", mode]),
    ).every((target) => target !== "./dist-es" && !target.startsWith("./dist-es/")),
  );
}

export async function materializeDeployment(deployed, destination) {
  const packages = new Map();
  let copied = 0;
  let phase = "scanning dependencies";
  const started = Date.now();
  const progress = () =>
    console.log(
      `Agent SDK: ${phase}; ${packages.size} unique packages, ${copied} copies (${Math.round((Date.now() - started) / 1000)}s).`,
    );
  async function resolveDependency(source, name) {
    let directory = source;
    while (true) {
      try {
        return await realpath(path.join(directory, "node_modules", name));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const parent = path.dirname(directory);
      if (parent === directory) {
        const error = new Error(`Missing runtime dependency: ${name} from ${source}`);
        error.code = "ENOENT";
        throw error;
      }
      directory = parent;
    }
  }
  async function scanPackage(source) {
    const canonical = await realpath(source);
    if (packages.has(canonical)) return canonical;
    const manifest = JSON.parse(await readFile(path.join(canonical, "package.json"), "utf8"));
    if (
      typeof manifest.name !== "string" ||
      !/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(manifest.name)
    )
      throw new Error("Invalid deployed runtime package name.");
    const entry = {
      name: manifest.name,
      omitEsBuild: omitAlternateAwsBuild(manifest),
      dependencies: new Map(),
    };
    packages.set(canonical, entry);
    const optional = manifest.optionalDependencies ?? {};
    for (const name of Object.keys({ ...manifest.dependencies, ...optional })) {
      if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name))
        throw new Error(`Invalid runtime dependency name: ${name}`);
      let dependency;
      try {
        dependency = await resolveDependency(canonical, name);
      } catch (error) {
        if (Object.hasOwn(optional, name) && error.code === "ENOENT") continue;
        throw error;
      }
      entry.dependencies.set(name, await scanPackage(dependency));
    }
    return canonical;
  }
  const heartbeat = setInterval(progress, 10_000);
  heartbeat.unref();
  try {
    progress();
    const canonicalRoot = await scanPackage(deployed);
    const rootPlacement = {
      canonical: canonicalRoot,
      target: destination,
      parent: undefined,
      children: new Map(),
    };
    const placements = [rootPlacement];
    function place(owner, name, canonical) {
      const placement = {
        name,
        canonical,
        target: path.join(owner.target, "node_modules", name),
        parent: owner,
        children: new Map(),
      };
      owner.children.set(name, placement);
      placements.push(placement);
    }
    const candidates = new Map();
    for (const entry of packages.values()) {
      for (const [name, canonical] of entry.dependencies) {
        if (!candidates.has(name)) candidates.set(name, new Map());
        const counts = candidates.get(name);
        counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
      }
    }
    for (const [name, canonical] of packages.get(canonicalRoot).dependencies)
      place(rootPlacement, name, canonical);
    for (const [name, counts] of candidates) {
      if (rootPlacement.children.has(name)) continue;
      const preferred = [...counts].sort((first, second) => second[1] - first[1])[0][0];
      place(rootPlacement, name, preferred);
    }
    phase = "planning dependency layout";
    for (const owner of placements) {
      for (const [name, canonical] of packages.get(owner.canonical).dependencies) {
        let scope = owner;
        while (scope && !scope.children.has(name)) scope = scope.parent;
        if (scope?.children.get(name).canonical === canonical) continue;
        if (placements.length >= Math.max(1024, packages.size * 8))
          throw new Error(
            "Agent dependency layout expanded unexpectedly; refusing excessive copies.",
          );
        place(owner, name, canonical);
      }
    }
    phase = "shortening dependency paths";
    function resolvesDependencies() {
      return placements.every((owner) =>
        [...packages.get(owner.canonical).dependencies].every(([name, canonical]) => {
          let scope = owner;
          while (scope && !scope.children.has(name)) scope = scope.parent;
          return scope?.children.get(name).canonical === canonical;
        }),
      );
    }
    let shortened;
    do {
      shortened = false;
      for (const placement of placements.slice(1)) {
        const previous = placement.parent;
        const { name } = placement;
        const ancestors = [];
        for (let ancestor = previous.parent; ancestor; ancestor = ancestor.parent)
          ancestors.push(ancestor);
        for (const ancestor of ancestors.reverse()) {
          if (ancestor.children.has(name)) continue;
          previous.children.delete(name);
          ancestor.children.set(name, placement);
          placement.parent = ancestor;
          if (resolvesDependencies()) {
            shortened = true;
            break;
          }
          placement.parent = previous;
          ancestor.children.delete(name);
          previous.children.set(name, placement);
        }
      }
    } while (shortened);
    function updateTargets(owner) {
      for (const [name, child] of owner.children) {
        child.target = path.join(owner.target, "node_modules", name);
        updateTargets(child);
      }
    }
    updateTargets(rootPlacement);
    phase = "copying dependencies";
    progress();
    for (const placement of placements) {
      await cp(placement.canonical, placement.target, {
        recursive: true,
        dereference: true,
        filter: (filename) =>
          path.basename(filename) !== "node_modules" &&
          !/\.d\.(?:ts|mts|cts)(?:\.map)?$/i.test(filename) &&
          !(
            packages.get(placement.canonical).omitEsBuild &&
            path.relative(placement.canonical, filename) === "dist-es"
          ),
      });
      copied += 1;
    }
    phase = "checking portable files";
    progress();
    await assertNoSymlinks(destination);
    phase = "complete";
    progress();
    return { uniquePackages: packages.size, copies: copied };
  } finally {
    clearInterval(heartbeat);
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
    console.log("Deploying production Agent dependencies...");
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
    const resources = runtimeResources();
    const binaries = path.join(tauriDirectory, "binaries");
    await mkdir(resources, { recursive: true });
    await mkdir(binaries, { recursive: true });
    const bundledSdk = path.join(resources, "sdk");
    await rm(bundledSdk, { recursive: true, force: true });
    await materializeDeployment(deployed, bundledSdk);
    const { filename, directory } = nodeDistribution(
      process.version,
      process.platform,
      process.arch,
    );
    const base = `https://nodejs.org/dist/${process.version}/`;
    console.log(`Downloading and verifying Node.js runtime: ${filename}`);
    const [archive, checksums] = await Promise.all([
      download(base + filename),
      download(`${base}SHASUMS256.txt`),
    ]);
    const archiveSha256 = verifyArchive(archive, checksums.toString("utf8"), filename);
    const archivePath = path.join(temporary, filename);
    await writeFile(archivePath, archive);
    console.log("Extracting Node.js runtime...");
    run("tar", ["-xf", archivePath, "-C", temporary]);
    const distribution = path.join(temporary, directory);
    const node = path.join(distribution, process.platform === "win32" ? "node.exe" : "bin/node");
    console.log("Verifying relocated Agent SDK with the bundled Node.js runtime...");
    verifySdk(node, path.join(bundledSdk, "dist/index.js"), temporary);
    console.log("Installing verified Node.js runtime and licenses...");
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
    if (process.platform === "win32") await assertWindowsInstallPaths(resources);
    console.log(`Portable Agent runtime verified: ${target}, ${process.version}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
