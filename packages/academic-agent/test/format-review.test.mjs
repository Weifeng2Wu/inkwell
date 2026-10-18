import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildFormatReviewSkill } from "../src/format-review.mjs";
import { sharedSkills } from "../src/shared-skills.mjs";

const request = () => ({
  name: "Example 2027 initial submission",
  sources: [
    {
      id: "S1",
      name: "requirements.tex",
      text: "Main papers must be at most 8 pages, excluding references. Use anonymous submission.",
    },
  ],
  rules: [
    {
      category: "pages",
      severity: "required",
      requirement: "At most 8 pages excluding references",
      source: "S1",
      evidence: "at most 8 pages, excluding references",
      check: "Count compiled PDF content pages separately from references.",
    },
  ],
  checkerRules: {
    venue: "Example 2027",
    pdf: {
      page_limit: { main_body: 8, main_body_ends_at: ["References"] },
      _sources: { page_limit: "R1" },
    },
  },
  kitNotes: "Initial submission. Calibration has not been run.",
});

test("builds format-only instructions and source-traceable declared resources", () => {
  const skill = buildFormatReviewSkill(request());
  assert.match(skill.name, /^format-review-/);
  assert.match(skill.instructions, /Never review novelty/);
  assert.match(skill.instructions, /NOT VERIFIED/);
  assert.match(skill.instructions, /rules.json/);
  assert.equal(skill.rules[0].id, "R1");
  assert.equal(skill.sources[0].text, request().sources[0].text);
});

test("rejects fabricated citations, missing rules and invalid destinations", () => {
  assert.throws(() => buildFormatReviewSkill({ ...request(), name: "bad\nname" }), /name/);
  assert.throws(() => buildFormatReviewSkill({ ...request(), rules: [] }), /no rules/);
  const forged = request();
  forged.rules[0].evidence = "12 pages";
  assert.throws(() => buildFormatReviewSkill(forged), /evidence/);
  const unknown = request();
  unknown.rules[0].category = "scientific-merit";
  assert.throws(() => buildFormatReviewSkill(unknown), /rule/);
  const duplicate = request();
  duplicate.sources.push(duplicate.sources[0]);
  assert.throws(() => buildFormatReviewSkill(duplicate), /source/);
});

test("preview does not install; explicit creation imports a reusable skill with verified resources", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inkwell-format-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "registry.json"),
    JSON.stringify({ schemaVersion: 1, skills: [] }),
  );
  const preview = await sharedSkills(directory, { ...request(), type: "format_skill_preview" });
  assert.match(preview.instructions, /submission format check/);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(directory, "registry.json"), "utf8")).skills,
    [],
  );
  const result = await sharedSkills(directory, { ...request(), type: "format_skill_create" });
  assert.equal(result.skills.length, 1);
  const exported = await sharedSkills(directory, {
    type: "context",
    skillIds: [result.skills[0].id],
  });
  assert.ok(
    exported.skills[0].resources.some((resource) => resource.path === "scripts/run_checks.py"),
  );
  assert.ok(
    exported.skills[0].resources.some(
      (resource) => resource.path === "scripts/checks/check_project.py",
    ),
  );
  const engine = JSON.parse(
    exported.skills[0].resources.find((resource) => resource.path === "rules.json").content,
  );
  assert.equal(engine.pdf.page_limit.main_body, 8);
  assert.match(engine.pdf._sources.page_limit, /S1.*requirements.tex.*8 pages/);
  const rules = exported.skills[0].resources.find(
    (resource) => resource.path === "references/rules.json",
  );
  assert.equal(JSON.parse(rules.content)[0].evidence, request().rules[0].evidence);
  const repeated = await sharedSkills(directory, { ...request(), type: "format_skill_create" });
  assert.equal(repeated.skills.length, 1);
});
