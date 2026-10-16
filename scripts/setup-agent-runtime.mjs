import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { repository, revision } = JSON.parse(
  await readFile(path.join(root, "packages/academic-agent/runtime-source.json"), "utf8"),
);
const directory = path.join(
  root,
  ".cache",
  "agent-runtime",
  `${revision}-${process.platform}-${process.arch}`,
);
if (
  typeof repository !== "string" ||
  !repository.startsWith("https://github.com/") ||
  !/^[a-f0-9]{40}$/.test(revision)
) {
  throw new Error("Invalid pinned runtime source metadata.");
}

function run(program, args, cwd = directory) {
  const result = spawnSync(program, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && program === "pnpm",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed with status ${result.status}.`);
}

if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24+ is required.");
console.log(
  `Preparing Inkwell Agent runtime ${revision}. This downloads and builds third-party source; no model request is made.`,
);
await mkdir(directory, { recursive: true });
try {
  await access(path.join(directory, ".git"));
} catch {
  run("git", ["init"]);
  run("git", ["remote", "add", "origin", repository]);
}
run("git", ["fetch", "--depth", "1", repository, revision]);
run("git", ["checkout", "--detach", revision]);
const actual = spawnSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" });
if (actual.status !== 0 || actual.stdout.trim() !== revision)
  throw new Error("Runtime revision verification failed.");
run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
run("pnpm", ["run", "hydrate:model-data"]);
run("pnpm", ["run", "build:offline"]);
await access(path.join(directory, "packages", "coding-agent", "dist", "index.js"));
run(process.execPath, [
  "--input-type=module",
  "--eval",
  `await import(${JSON.stringify(pathToFileURL(path.join(directory, "packages/coding-agent/dist/index.js")).href)})`,
]);
const catalogDirectory = path.join(directory, "packages/ai/src/providers/data");
const catalogs = {};
for (const filename of (await readdir(catalogDirectory))
  .filter((entry) => entry.endsWith(".json"))
  .sort()) {
  catalogs[filename] = createHash("sha256")
    .update(await readFile(path.join(catalogDirectory, filename)))
    .digest("hex");
}
await writeFile(
  path.join(directory, "inkwell-build.json"),
  JSON.stringify(
    {
      revision,
      platform: process.platform,
      arch: process.arch,
      builtAt: new Date().toISOString(),
      catalogs,
    },
    null,
    2,
  ),
);
console.log(
  "Inkwell Agent is ready. Start Inkwell with pnpm tauri:dev and connect the Agent panel.",
);
