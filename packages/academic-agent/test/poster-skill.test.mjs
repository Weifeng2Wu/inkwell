import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bundledCatalog, installBundledSkill, syncGitHubSkills } from "../src/github-skills.mjs";
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
      await readFile(new URL(`../skills/academic-poster/${relative}`, import.meta.url), "utf8"),
      content,
    );
  }
  const catalog = await bundledCatalog(root);
  assert.equal(catalog[0].id, "academic-poster");
  const library = await installBundledSkill(root, "academic-poster");
  assert.equal(library.registry.skills[0].upstream, undefined);
  const selection = library.select(["academic-poster"]);
  assert.match((await selection.load("academic-poster")).instructions, /\.poster\.json/);
  assert.match(
    (await selection.resource("academic-poster", "references/format.md")).content,
    /millimetres/,
  );
  const acpContext = await sharedSkills(root, { type: "context", skillIds: ["academic-poster"] });
  assert.equal(acpContext.skills[0].name, "Academic Poster");
  assert.match(
    acpContext.skills[0].instructions,
    /Other Agents may use their available file-writing tools/,
  );
  assert.equal(acpContext.skills[0].resources.length, 2);
  assert.ok(
    acpContext.skills[0].resources.some(
      (resource) => resource.path === "references/format.md" && resource.content.includes("modern"),
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
