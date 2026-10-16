import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";
import { importSkill } from "../src/market.mjs";
import { sharedSkills } from "../src/shared-skills.mjs";
import { readRequirementZip, readSkillZip } from "../src/zip-skills.mjs";

function archive(entries) {
  const locals = [];
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const content = Buffer.from(entry.content ?? "Instructions");
    const packed = entry.stored ? content : deflateRawSync(content);
    let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(entry.encrypted ? 1 : 0, 6);
    header.writeUInt16LE(entry.stored ? 0 : 8, 8);
    header.writeUInt32LE(entry.corrupt ? 0 : (crc ^ 0xffffffff) >>> 0, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(content.length, 22);
    header.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    header.copy(central, 8, 6, 28);
    central.writeUInt32LE(entry.symlink ? 0xa0000000 : 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(header, name, packed);
    directory.push(central, name);
    offset += header.length + name.length + packed.length;
  }
  const tail = Buffer.alloc(22);
  tail.writeUInt32LE(0x06054b50);
  tail.writeUInt16LE(entries.length, 8);
  tail.writeUInt16LE(entries.length, 10);
  tail.writeUInt32LE(Buffer.concat(directory).length, 12);
  tail.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, tail]);
}

test("ZIP imports nested skills and declared text resources without executable files", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-zip-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "registry.json"),
    JSON.stringify({ schemaVersion: 1, skills: [] }),
  );
  const filename = path.join(root, "writing.zip");
  await writeFile(
    filename,
    archive([
      { name: "repo-main/writing/SKILL.md", content: "---\nname: Writing\n---\nWrite carefully." },
      { name: "repo-main/writing/references/style.md", content: "Use evidence.", stored: true },
      { name: "repo-main/writing/script.js", content: "throw new Error('do not execute')" },
    ]),
  );
  const library = await importSkill(root, filename);
  const skill = library.registry.skills[0];
  assert.equal(skill.name, "Writing");
  const selected = library.select([skill.id]);
  const loaded = await selected.load(skill.id);
  assert.deepEqual(loaded.resources, ["references/style.md"]);
  assert.equal((await selected.resource(skill.id, "references/style.md")).content, "Use evidence.");
});

test("ZIP rejects traversal, Windows paths, links, encryption, corruption and oversized resources", () => {
  for (const entry of [
    { name: "../SKILL.md" },
    { name: "/SKILL.md" },
    { name: "C:/SKILL.md" },
    { name: "folder\\SKILL.md" },
    { name: "SKILL.md", symlink: true },
    { name: "SKILL.md", encrypted: true },
    { name: "SKILL.md", corrupt: true },
    { name: "SKILL.md", content: "x".repeat(128 * 1024 + 1) },
  ])
    assert.throws(() => readSkillZip(archive([entry])));
  assert.throws(
    () => readSkillZip(archive([{ name: "a/SKILL.md" }, { name: "b/SKILL.md" }])),
    /one skill/,
  );
  assert.throws(
    () => readSkillZip(archive([{ name: "SKILL.md" }, { name: "SKILL.md" }])),
    /duplicate/,
  );
  assert.throws(() => readSkillZip(Buffer.from("not a zip")), /Invalid ZIP/);
});

test("author kits read nested templates and binary PDFs without requiring SKILL.md", async () => {
  const data = archive([
    { name: "AAAI-kit/instructions.pdf", content: "%PDF-1.7\0binary", stored: true },
    { name: "AAAI-kit/latex/aaai.sty", content: "\\setlength{\\textwidth}{6.5in}" },
    { name: "AAAI-kit/latex/aaai.bst", content: "ENTRY { title } {} {}" },
    { name: "AAAI-kit/images/logo.png", content: "image" },
    { name: "AAAI-kit/tools/build.sh", content: "do not execute" },
    { name: "AAAI-kit/other.zip", content: "nested" },
    { name: "__MACOSX/._instructions.pdf", content: "metadata" },
  ]).toString("base64");
  const result = await sharedSkills("unused", { type: "format_requirements_zip", data });
  assert.deepEqual(
    result.files.map((file) => file.name),
    ["AAAI-kit/instructions.pdf", "AAAI-kit/latex/aaai.sty", "AAAI-kit/latex/aaai.bst"],
  );
  assert.equal(Buffer.from(result.files[0].data, "base64").toString(), "%PDF-1.7\0binary");
  assert.equal(result.skipped.length, 4);
});

test("author kit ZIPs reject unsafe paths, links, encryption, corruption and decompression bombs", () => {
  for (const entry of [
    { name: "../rules.tex" },
    { name: "C:/rules.tex" },
    { name: "rules.tex", symlink: true },
    { name: "rules.tex", encrypted: true },
    { name: "rules.tex", corrupt: true },
    { name: "rules.tex", content: "x".repeat(12 * 1024 * 1024 + 1) },
  ])
    assert.throws(() => readRequirementZip(archive([entry]).toString("base64")));
  assert.throws(() => readRequirementZip("not a zip"));
  assert.throws(() =>
    readRequirementZip(
      archive(Array.from({ length: 81 }, (_, index) => ({ name: `${index}.txt` }))).toString(
        "base64",
      ),
    ),
  );
});
