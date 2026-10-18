import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildFormatReviewSkill } from "../src/format-review.mjs";
import { sharedSkills } from "../src/shared-skills.mjs";

function request() {
  return {
    name: "Example 2027 review",
    sources: [
      {
        id: "S1",
        name: "rules.txt",
        text: "Use anonymous review. Do not change example.sty. We recommend a checklist.",
      },
      { id: "S2", name: "kit/example.sty", text: "\\NeedsTeXFormat{LaTeX2e}\r\n" },
    ],
    rules: [
      {
        category: "anonymity",
        requirement: "Anonymous review",
        source: "S1",
        evidence: "Use anonymous review.",
        severity: "required",
        check: "Inspect author names.",
      },
      {
        category: "files",
        requirement: "Original style file",
        source: "S1",
        evidence: "Do not change example.sty.",
        severity: "required",
        check: "Compare hashes.",
      },
      {
        category: "structure",
        requirement: "Checklist recommended",
        source: "S1",
        evidence: "We recommend a checklist.",
        severity: "recommended",
        check: "Manually inspect checklist.",
      },
    ],
    checkerRules: {
      venue: "Example 2027",
      default_phase: "review",
      phases: { review: { anonymity: { required: true, _sources: { required: "R1" } } } },
      tex: { official_files: { "example.sty": {} }, _sources: { official_files: "R2" } },
      checklist: [
        {
          id: "checklist",
          title: "Checklist",
          description: "Check the checklist manually",
          severity: "warn",
          source: "R3",
          fix: "Consider adding the checklist.",
        },
      ],
    },
    kitNotes: "Review phase only.",
  };
}

test("ships the supplied factory workflow and schema offline with both desktop runtimes", async () => {
  const context = await sharedSkills("unused", { type: "format_factory_context" });
  assert.match(context.instructions, /Positive control/);
  assert.match(context.schema, /main_body_ends_at/);
  execFileSync(process.execPath, ["scripts/bundle-venue-factory.mjs", "--check"], {
    cwd: new URL("../../../", import.meta.url),
  });
  for (const module of ["academic_agent", "external_agent"]) {
    const rust = await readFile(
      new URL(`../../../apps/desktop/src-tauri/src/commands/${module}.rs`, import.meta.url),
      "utf8",
    );
    assert.match(rust, /venue-factory\.mjs/);
    assert.match(rust, /venue-factory-bundle\.json/);
  }
});

test("keeps phases, manual recommendations, original styles and calibration status", () => {
  const skill = buildFormatReviewSkill(request());
  assert.equal(skill.checkerRules.checklist[0].severity, "warn");
  assert.match(skill.checkerRules.phases.review.anonymity._sources.required, /R1: S1/);
  assert.equal(skill.resources["assets/official/example.sty"], request().sources[1].text);
  assert.match(skill.checkerRules.tex.official_files["example.sty"].sha256, /^[a-f0-9]{64}$/);
  assert.match(skill.instructions, /NOT been calibrated/);
  assert.match(skill.instructions, /use run_python/);
  assert.match(
    skill.resources["scripts/checks/check_tex.py"],
    /get\("forbid_layout_hacks", False\)/,
  );
});

test("rejects untraceable machine rules, unsafe styles, dropped rules and escalated recommendations", () => {
  for (const mutate of [
    (r) => {
      delete r.checkerRules.tex._sources;
    },
    (r) => {
      r.checkerRules.tex.official_files = { "../bad.sty": {} };
    },
    (r) => {
      r.checkerRules.tex.official_files = { "missing.sty": {} };
    },
    (r) => {
      r.checkerRules.tex._sources.official_files = "R99";
    },
    (r) => {
      r.checkerRules.checklist = [];
    },
    (r) => {
      r.checkerRules.checklist[0].severity = "error";
    },
    (r) => {
      r.checkerRules.pdf = { page_size: "A4", _sources: { page_size: "R3" } };
    },
    (r) => {
      r.checkerRules.pdf = { page_limit: { main_body: 8 }, _sources: { page_limit: "R1" } };
    },
  ]) {
    const input = request();
    mutate(input);
    assert.throws(() => buildFormatReviewSkill(input), /Invalid venue checker rules/);
  }
});

test("the bundled engine passes a clean source and detects an anonymity violation without inventing layout rules", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-venue-engine-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bundle = JSON.parse(
    await readFile(new URL("../skills/venue-factory-bundle.json", import.meta.url), "utf8"),
  );
  const { mkdir } = await import("node:fs/promises");
  for (const [relative, content] of Object.entries(bundle.files).filter(([name]) =>
    name.startsWith("scripts/"),
  )) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  await writeFile(
    path.join(root, "rules.json"),
    JSON.stringify({
      venue: "Synthetic",
      anonymity: { required: true, _sources: { required: "synthetic rule" } },
    }),
  );
  const paper = path.join(root, "paper.tex");
  const run = () =>
    execFileSync(
      process.platform === "win32" ? "python" : "python3",
      [
        path.join(root, "scripts/run_checks.py"),
        "--rules",
        path.join(root, "rules.json"),
        "--tex",
        paper,
        "--names",
        "Alice Example",
      ],
      { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    );
  await writeFile(
    paper,
    "\\documentclass{article}\n\\usepackage{geometry}\n\\begin{document}\nAnonymous manuscript.\\vspace{-1cm}\n\\end{document}\n",
  );
  assert.match(run(), /0 must fix/);
  await writeFile(
    paper,
    "\\documentclass{article}\n\\begin{document}\nAlice Example alice@example.org\n\\end{document}\n",
  );
  assert.throws(run, (error) => error.status === 1 && /must fix/.test(error.stdout));
});
