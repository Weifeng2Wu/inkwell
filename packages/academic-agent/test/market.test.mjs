import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SkillLibrary } from "../src/library.mjs";
import { changeMarketSkill, importSkill, marketCatalog } from "../src/market.mjs";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-market-"));
  const source = await mkdtemp(path.join(os.tmpdir(), "inkwell-upload-"));
  context.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(source, { recursive: true, force: true }),
    ]),
  );
  await writeFile(
    path.join(root, "registry.json"),
    JSON.stringify({ schemaVersion: 1, skills: [] }),
  );
  await writeFile(
    path.join(source, "SKILL.md"),
    "---\nname: My skill\ndescription: My local skill\n---\nPolish the supplied text without inventing evidence.",
  );
  return { root, source };
}

test("market starts empty and supports explicit upload, loading, removal, and reimport", async (context) => {
  const { root, source } = await fixture(context);
  assert.deepEqual(await marketCatalog(await SkillLibrary.open(root)), []);
  await mkdir(path.join(source, "references"));
  await writeFile(path.join(source, "references/style.md"), "Use concise prose.");
  await writeFile(path.join(source, "script.js"), "throw new Error('must not run')");
  let library = await importSkill(root, source);
  const entry = (await marketCatalog(library))[0];
  assert.equal(entry.name, "My skill");
  const selection = library.select([entry.id]);
  const loaded = await selection.load(entry.id);
  assert.match(loaded.instructions, /without inventing evidence/);
  assert.deepEqual(loaded.resources, ["references/style.md"]);
  assert.equal(
    (await selection.resource(entry.id, "references/style.md")).content,
    "Use concise prose.",
  );
  library = await changeMarketSkill(root, entry.id, false);
  assert.deepEqual(library.catalog(), []);
  library = await importSkill(root, source);
  assert.equal(library.catalog().length, 1);
  assert.equal(
    JSON.parse(await readFile(path.join(root, "registry.json"), "utf8")).skills.length,
    1,
  );
  await assert.rejects(changeMarketSkill(root, "../escape", false), /Upload a skill/);
});

test("uploading just SKILL.md does not import neighboring resources", async (context) => {
  const { root, source } = await fixture(context);
  await writeFile(path.join(source, "private.txt"), "not selected");
  const library = await importSkill(root, path.join(source, "SKILL.md"));
  assert.deepEqual(library.registry.skills[0].resources, []);
});

test("uploads reject symlinks and oversized resources", async (context) => {
  const { root, source } = await fixture(context);
  await symlink(path.join(source, "SKILL.md"), path.join(source, "linked.md"));
  await assert.rejects(importSkill(root, source), /Linked/);
  await rm(path.join(source, "linked.md"));
  await writeFile(path.join(source, "large.txt"), "x".repeat(128 * 1024 + 1));
  await assert.rejects(importSkill(root, source), /resource limits/);
  assert.deepEqual((await SkillLibrary.open(root)).catalog(), []);
});
