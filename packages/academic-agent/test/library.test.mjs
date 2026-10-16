import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { digest, SkillLibrary, validateRegistry } from "../src/library.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-skills-"));
  directories.push(directory);
  await mkdir(path.join(directory, "fixture"));
  const instruction = "Fixture instructions; not a bundled product skill.";
  const resource = "Fixture reference.";
  const manifest = {
    id: "fixture",
    name: "Fixture",
    description: "Test-only skill",
    version: "1.0",
    source: "local test fixture",
    entrypoint: { path: "SKILL.md", sha256: digest(instruction) },
    resources: [{ path: "reference.md", sha256: digest(resource) }],
  };
  const registry = { schemaVersion: 1, skills: [manifest] };
  await writeFile(path.join(directory, "registry.json"), JSON.stringify(registry));
  return {
    directory,
    registry,
    instruction,
    resource,
    library: await SkillLibrary.open(directory),
  };
}

test("ships an empty library, not built-in skills", async () => {
  const library = await SkillLibrary.open(fileURLToPath(new URL("../skills/", import.meta.url)));
  assert.deepEqual(library.catalog(), []);
});

test("metadata and selection never read the skill body", async () => {
  const { library } = await fixture();
  assert.equal(library.catalog().length, 1);
  const selection = library.select(["fixture"]);
  assert.deepEqual(selection.metadata(), [
    { id: "fixture", name: "Fixture", description: "Test-only skill", version: "1.0" },
  ]);
  assert.equal(selection.loaded.size, 0);
  assert.equal(selection.cache.size, 0);
});

test("only enabled metadata is disclosed", async () => {
  const { library } = await fixture();
  assert.deepEqual(library.select([]).metadata(), []);
  await assert.rejects(library.select([]).load("fixture"), /not enabled/);
  assert.throws(() => library.select(["unknown"]), /Unknown/);
  assert.throws(() => library.select(["fixture", "fixture"]), /selection/);
});

test("resources require instructions first, then an explicit declared resource", async () => {
  const { directory, library, instruction, resource } = await fixture();
  await writeFile(path.join(directory, "fixture/SKILL.md"), instruction);
  await writeFile(path.join(directory, "fixture/reference.md"), resource);
  const selection = library.select(["fixture"]);
  await assert.rejects(selection.resource("fixture", "reference.md"), /before/);
  assert.equal((await selection.load("fixture")).instructions, instruction);
  assert.equal(selection.cache.size, 1);
  assert.equal((await selection.resource("fixture", "reference.md")).content, resource);
  await assert.rejects(selection.resource("fixture", "undeclared.md"), /not declared/);
});

test("changed content is rejected even after a cache hit", async () => {
  const { directory, library, instruction } = await fixture();
  await writeFile(path.join(directory, "fixture/SKILL.md"), instruction);
  const selection = library.select(["fixture"]);
  await selection.load("fixture");
  await writeFile(path.join(directory, "fixture/SKILL.md"), "Changed without review");
  await assert.rejects(selection.load("fixture"), /changed/);
});

test("selection and declared resource changes alter the session fingerprint", async () => {
  const { library, registry, directory } = await fixture();
  const selected = library.select(["fixture"]).fingerprint();
  assert.notEqual(selected, library.select([]).fingerprint());
  registry.skills[0].resources[0].sha256 = digest("new");
  assert.notEqual(
    selected,
    new SkillLibrary(directory, registry).select(["fixture"]).fingerprint(),
  );
});

test("manifest traversal and duplicates fail closed", async () => {
  const { registry } = await fixture();
  const traversal = structuredClone(registry);
  traversal.skills[0].entrypoint.path = "../secret.md";
  assert.throws(() => validateRegistry(traversal), /manifest/);
  registry.skills.push(structuredClone(registry.skills[0]));
  assert.throws(() => validateRegistry(registry), /duplicate/);
});

test("unrecognized manifest permissions or executable hooks cannot be registered", async () => {
  const { registry } = await fixture();
  registry.skills[0].permissions = ["shell"];
  assert.throws(() => validateRegistry(registry), /manifest/);
});

test("a symlink cannot expose a resource outside the skill", async () => {
  const { directory, library, instruction } = await fixture();
  await writeFile(path.join(directory, "outside.md"), instruction);
  await symlink(path.join(directory, "outside.md"), path.join(directory, "fixture/SKILL.md"));
  await assert.rejects(library.select(["fixture"]).load("fixture"), /escapes/);
});
