import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Rebuild after changing the skill. The packaged snapshot is used offline by both runtimes.
const root = new URL("../packages/academic-agent/skills/", import.meta.url);
const files = {};
for (const file of [
  "SKILL.md",
  "references/format.md",
  "references/design.md",
  "references/poster-qa-checklist.md",
  "references/design-reference-prompt.md",
]) {
  files[file] = await readFile(new URL(`academic-poster/${file}`, root), "utf8");
}
const snapshot = {
  id: "academic-poster",
  name: "Academic Poster",
  description:
    "Generate a visual poster reference from a paper, then rebuild it as an editable Inkwell .poster.json. Preserve verified claims and original figures, edit the native canvas, and export to PPTX, SVG, PDF or images.",
  source: "Inkwell built-in",
  local: true,
  revision: createHash("sha1").update(JSON.stringify(files)).digest("hex"),
  files,
};
const target = new URL("poster-bundle.json", root);
const output = `${JSON.stringify(snapshot, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== output)
    throw new Error("Poster skill bundle is stale. Run node scripts/bundle-poster-skill.mjs");
} else await writeFile(target, output);
