import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../packages/academic-agent/skills/venue-checker-factory/", import.meta.url);
const files = {};
async function collect(relative = "") {
  for (const entry of (await readdir(new URL(relative || ".", root), { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith(".") || entry.name === "__pycache__") continue;
    const name = `${relative}${entry.name}`;
    if (entry.isDirectory()) await collect(`${name}/`);
    else if (/\.(md|py)$/.test(name))
      files[name] = (await readFile(new URL(name, root), "utf8")).replaceAll("\r\n", "\n");
  }
}
await collect();
const output = `${JSON.stringify(
  {
    revision: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
    files,
  },
  null,
  2,
)}\n`;
const target = new URL("../venue-factory-bundle.json", root);
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")).replaceAll("\r\n", "\n") !== output)
    throw new Error("Venue factory bundle is stale. Run node scripts/bundle-venue-factory.mjs");
} else await writeFile(target, output);
