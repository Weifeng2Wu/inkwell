import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Rebuild after changing the skill. The packaged snapshot is used offline by both runtimes.
const root = new URL("../packages/academic-agent/skills/", import.meta.url);
const files = {};
for (const file of [
  "SKILL.md",
  "references/paper-summary.md",
  "references/literature-matrix.md",
  "references/related-work-checklist.md",
]) {
  // Git may check out these text files with CRLF on Windows; keep snapshot hashes portable.
  files[file] = (await readFile(new URL(`literature-review/${file}`, root), "utf8")).replaceAll(
    "\r\n",
    "\n",
  );
}
const snapshot = {
  id: "literature-review",
  name: "Literature Review",
  description:
    "Summarize papers from your reading notes, compare them in a literature matrix, draft related-work sections that cite only entries in your .bib library, audit citations, and plan what to read next. Never invents sources, quotes or page numbers.",
  source: "Inkwell built-in",
  local: true,
  revision: createHash("sha1").update(JSON.stringify(files)).digest("hex"),
  files,
};
const target = new URL("literature-bundle.json", root);
const output = `${JSON.stringify(snapshot, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")).replaceAll("\r\n", "\n") !== output)
    throw new Error(
      "Literature skill bundle is stale. Run node scripts/bundle-literature-skill.mjs",
    );
} else await writeFile(target, output);
