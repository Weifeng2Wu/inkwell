import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sharedSkills } from "../src/shared-skills.mjs";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-shared-"));
  const source = await mkdtemp(path.join(os.tmpdir(), "inkwell-source-"));
  context.after(() =>
    Promise.all([root, source].map((directory) => rm(directory, { recursive: true, force: true }))),
  );
  await writeFile(
    path.join(root, "registry.json"),
    JSON.stringify({ schemaVersion: 1, skills: [] }),
  );
  await writeFile(
    path.join(source, "SKILL.md"),
    "---\nname: Shared writing\ndescription: Test skill\n---\nPreserve LaTeX and never fabricate citations.",
  );
  await writeFile(path.join(source, "reference.md"), "A declared resource.");
  return { root, source };
}

test("shared skills import, preview and context use the same verified library without loading a model", async (context) => {
  const { root, source } = await fixture(context);
  const imported = await sharedSkills(root, { type: "skill_import", sourcePath: source });
  const id = imported.skills[0].id;
  const preview = await sharedSkills(root, { type: "skill_preview", skillId: id });
  const exported = await sharedSkills(root, { type: "context", skillIds: [id] });
  assert.equal(exported.skills[0].instructions, preview.instructions);
  assert.equal(exported.skills[0].resources[0].content, "A declared resource.");
  assert.equal((await sharedSkills(root, { type: "catalog" })).skills[0].id, id);
  assert.deepEqual(await sharedSkills(root, { type: "context", skillIds: [] }), { skills: [] });
  await assert.rejects(sharedSkills(root, { type: "context", skillIds: ["missing"] }), /Unknown/);
  await sharedSkills(root, { type: "skill_install", skillId: id, install: false });
  assert.deepEqual((await sharedSkills(root, { type: "catalog" })).skills, []);
});

test("shared skill context rejects modified resources instead of forwarding unreviewed content", async (context) => {
  const { root, source } = await fixture(context);
  const imported = await sharedSkills(root, { type: "skill_import", sourcePath: source });
  const id = imported.skills[0].id;
  await writeFile(path.join(root, id, "reference.md"), "Changed resource");
  await assert.rejects(sharedSkills(root, { type: "context", skillIds: [id] }), /changed/);
});

test("the standalone skill service accepts stdin JSON with no model SDK", async (context) => {
  const { root } = await fixture(context);
  const filename = fileURLToPath(new URL("../src/shared-skills.mjs", import.meta.url));
  const child = spawn(process.execPath, [filename, root], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stdin.end(JSON.stringify({ type: "catalog" }));
  const status = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(output), { skills: [], market: [] });
});
