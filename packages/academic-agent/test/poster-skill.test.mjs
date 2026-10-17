import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  bundledCatalog,
  installBundledSkill,
  syncBundledSkills,
  syncGitHubSkills,
} from "../src/github-skills.mjs";
import { sharedSkills } from "../src/shared-skills.mjs";

test("poster skill installs offline, loads declared resources, avoids upstream sync and can be removed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-poster-skill-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "registry.json"), '{"schemaVersion":1,"skills":[]}');
  const bundle = new URL("../skills/poster-bundle.json", import.meta.url);
  await copyFile(bundle, path.join(root, "poster-bundle.json"));
  const snapshot = JSON.parse(await readFile(bundle, "utf8"));
  assert.equal(
    snapshot.revision,
    createHash("sha1").update(JSON.stringify(snapshot.files)).digest("hex"),
  );
  for (const [relative, content] of Object.entries(snapshot.files)) {
    assert.equal(
      (
        await readFile(new URL(`../skills/academic-poster/${relative}`, import.meta.url), "utf8")
      ).replaceAll("\r\n", "\n"),
      content,
    );
  }
  const catalog = await bundledCatalog(root);
  assert.equal(catalog[0].id, "academic-poster");
  let library = await installBundledSkill(root, "academic-poster");
  assert.equal(library.registry.skills[0].upstream, undefined);
  const stale = await import("../src/market.mjs").then(({ saveRegistry }) =>
    saveRegistry(library, [
      { ...library.registry.skills[0], revision: "0".repeat(40), version: "stale" },
    ]),
  );
  library = await syncBundledSkills(stale);
  assert.equal(library.registry.skills[0].revision, snapshot.revision);
  assert.equal(library.registry.skills[0].source, "Inkwell built-in");
  const selection = library.select(["academic-poster"]);
  assert.match((await selection.load("academic-poster")).instructions, /\.poster\.json/);
  assert.match((await selection.load("academic-poster")).instructions, /project-root `posters\//);
  assert.match((await selection.load("academic-poster")).instructions, /Do not use the paper title as the filename/);
  assert.match(
    (await selection.load("academic-poster")).instructions,
    /required workflow step, not dependent on the user separately requesting an image/i,
  );
  assert.match(
    (await selection.load("academic-poster")).instructions,
    /do not describe it as optional/i,
  );
  assert.doesNotMatch((await selection.load("academic-poster")).instructions, /style.*format enum/i);
  assert.match(
    (await selection.load("academic-poster")).instructions,
    /three body columns with a wider center.*required default/i,
  );
  assert.match(
    (await selection.resource("academic-poster", "references/format.md")).content,
    /millimetres/,
  );
  assert.match(
    (await selection.resource("academic-poster", "references/format.md")).content,
    /at most three lowercase English topic words plus a two-digit sequence/,
  );
  const design = (await selection.resource("academic-poster", "references/design.md")).content;
  assert.match(design, /generating and reviewing one visual reference.*is required/i);
  assert.doesNotMatch(design, /Keep visual references optional/);
  assert.match(design, /rebuild it as editable `\.poster\.json` elements/);
  assert.match(design, /four metric cards with parallel title\/value\/comparison structure/);
  assert.match(design, /three body columns with a wider center/);
  const imagePrompt = (await selection.resource("academic-poster", "references/design-reference-prompt.md")).content;
  assert.match(imagePrompt, /visual reference/);
  assert.match(imagePrompt, /A text-only model may prepare and refine the prompt/);
  assert.match(imagePrompt, /Review and iterate/);
  assert.match(imagePrompt, /four genuinely distinct, source-verified metrics/);
  assert.match(imagePrompt, /three columns with a wider center in roughly 0\.9:1\.3:0\.9 proportions/);
  assert.match(imagePrompt, /one verified central-claim sentence/);
  assert.match(imagePrompt, /Avoid tiny unreadable paragraphs/);
  assert.match(
    (await selection.resource("academic-poster", "references/poster-qa-checklist.md")).content,
    /Visual-reference QA/,
  );
  const acpContext = await sharedSkills(root, { type: "context", skillIds: ["academic-poster"] });
  assert.equal(acpContext.skills[0].name, "Academic Poster");
  assert.match(
    acpContext.skills[0].instructions,
    /For other Agents, write inside their review copy with the available file tools/,
  );
  assert.equal(acpContext.skills[0].resources.length, 4);
  assert.ok(
    acpContext.skills[0].resources.some(
      (resource) => resource.path === "references/format.md" && /legacy `style` fields/i.test(resource.content),
    ),
  );
  const synced = await syncGitHubSkills(root, {
    fetcher: () => {
      throw new Error("Unexpected network");
    },
  });
  assert.equal(synced.catalog().length, 1);
  const { changeMarketSkill } = await import("../src/market.mjs");
  assert.equal((await changeMarketSkill(root, "academic-poster", false)).catalog().length, 0);
});

test("poster bundle checks and rebuilds identically from a Windows CRLF checkout", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-poster-crlf-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = path.join(root, "scripts/bundle-poster-skill.mjs");
  await mkdir(path.dirname(script), { recursive: true });
  await copyFile(new URL("../../../scripts/bundle-poster-skill.mjs", import.meta.url), script);
  const bundled = (
    await readFile(new URL("../skills/poster-bundle.json", import.meta.url), "utf8")
  ).replaceAll("\r\n", "\n");
  const snapshot = JSON.parse(bundled);
  const skills = path.join(root, "packages/academic-agent/skills");
  for (const [relative, content] of Object.entries(snapshot.files)) {
    const target = path.join(skills, "academic-poster", relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content.replaceAll("\n", "\r\n"));
  }
  const target = path.join(skills, "poster-bundle.json");
  await writeFile(target, bundled.replaceAll("\n", "\r\n"));
  const run = promisify(execFile);
  await run(process.execPath, [script, "--check"]);
  await run(process.execPath, [script]);
  assert.equal(await readFile(target, "utf8"), bundled);

  await writeFile(path.join(skills, "academic-poster/SKILL.md"), "Changed instructions\r\n");
  await assert.rejects(run(process.execPath, [script, "--check"]), /Poster skill bundle is stale/);
});
