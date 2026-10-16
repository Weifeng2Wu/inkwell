import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { importGitHubSkill, syncGitHubSkills, WRITING_SKILL_ID } from "../src/github-skills.mjs";
import { SkillLibrary } from "../src/library.mjs";
import { changeMarketSkill, importSkill, marketCatalog } from "../src/market.mjs";

const firstRevision = "a".repeat(40);
const nextRevision = "b".repeat(40);
const bundledFiles = {
  "SKILL.md": "Initial instructions",
  "references/style.md": "Initial style",
  "LICENSE.txt": "MIT",
};
const now = 2_000_000_000_000;

async function fixture(context, install = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkwell-github-skills-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    path.join(root, "registry.json"),
    JSON.stringify({ schemaVersion: 1, skills: [] }),
  );
  await writeFile(
    path.join(root, "github-bundle.json"),
    JSON.stringify({ revision: firstRevision, stars: 7500, files: bundledFiles }),
  );
  if (install) await changeMarketSkill(root, WRITING_SKILL_ID, true);
  return root;
}

function upstream({
  revision = firstRevision,
  stars = 7523,
  files = bundledFiles,
  failFile,
  tree,
} = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith("Research-Paper-Writing-Skills"))
      return Response.json({ default_branch: "main", stargazers_count: stars });
    if (url.includes("/git/ref/")) return Response.json({ object: { sha: revision } });
    if (url.includes("/git/trees/"))
      return Response.json({
        sha: "c".repeat(40),
        truncated: false,
        tree:
          tree ??
          Object.keys(files)
            .filter((filename) => filename !== "LICENSE.txt")
            .map((filename) => ({
              path: `research-paper-writing/${filename}`,
              type: "blob",
              mode: "100644",
              size: Buffer.byteLength(files[filename]),
            })),
      });
    const filename = url.endsWith("/LICENSE")
      ? "LICENSE.txt"
      : url.split("/research-paper-writing/")[1];
    if (filename === failFile) return new Response("Unavailable", { status: 503 });
    assert.ok(Object.hasOwn(files, filename), `Unexpected download: ${url}`);
    return new Response(files[filename]);
  };
  return { fetcher, calls };
}

test("bundles a usable skill offline and preserves its source, references, license and stars", async (context) => {
  const root = await fixture(context);
  const library = await syncGitHubSkills(root, {
    fetcher: async () => {
      throw new Error("Offline");
    },
    now,
  });
  const skill = library.catalog()[0];
  assert.equal(skill.id, WRITING_SKILL_ID);
  assert.equal(skill.stars, 7500);
  assert.equal(skill.source, "https://github.com/Master-cai/Research-Paper-Writing-Skills");
  const selected = library.select([skill.id]);
  assert.equal((await selected.load(skill.id)).instructions, "Initial instructions");
  assert.equal((await selected.resource(skill.id, "LICENSE.txt")).content, "MIT");
  assert.match(library.updateError, /Offline/);
});

test("catalog entries stay uninstalled until explicitly selected, including after refresh and removal", async (context) => {
  const root = await fixture(context, false);
  await copyFile(
    fileURLToPath(new URL("../skills/nature-bundle.json", import.meta.url)),
    path.join(root, "nature-bundle.json"),
  );
  const fetcher = async () => {
    throw new Error("No network should be used before installation");
  };
  const empty = await syncGitHubSkills(root, { fetcher, now });
  assert.deepEqual(empty.catalog(), []);
  const market = await marketCatalog(empty);
  assert.equal(market.length, 2);
  assert.ok(market.every((skill) => !skill.installed));
  const installed = await changeMarketSkill(root, "nature-writing-suite", true);
  assert.equal(installed.catalog().length, 1);
  const selection = installed.select(["nature-writing-suite"]);
  const loaded = await selection.load("nature-writing-suite");
  assert.match(loaded.instructions, /skills\/nature-writing\/SKILL.md/);
  assert.ok(loaded.resources.includes("skills/nature-shared/core/main-text-discipline.md"));
  assert.ok(loaded.resources.length > 200);
  for (const resource of loaded.resources)
    await selection.resource("nature-writing-suite", resource);
  assert.match(
    (await selection.resource("nature-writing-suite", "LICENSE.txt")).content,
    /Apache License/,
  );
  assert.equal((await marketCatalog(installed)).filter((skill) => skill.installed).length, 1);
  const removed = await changeMarketSkill(root, "nature-writing-suite", false);
  assert.deepEqual(removed.catalog(), []);
  assert.deepEqual((await syncGitHubSkills(root, { fetcher, now: now + 900_001 })).catalog(), []);
  assert.equal(
    (await marketCatalog(removed)).find((skill) => skill.id === "nature-writing-suite").installed,
    false,
  );
});

test("the combined Nature suite updates all modules without importing unrelated skills", async (context) => {
  const root = await fixture(context, false);
  await copyFile(
    fileURLToPath(new URL("../skills/nature-bundle.json", import.meta.url)),
    path.join(root, "nature-bundle.json"),
  );
  await changeMarketSkill(root, "nature-writing-suite", true);
  const files = {
    ...Object.fromEntries(
      [
        "nature-polishing",
        "nature-proposal-writer",
        "nature-citation",
        "nature-data",
        "nature-statistics",
        "nature-response",
        "nature-reviewer",
        "nature-ref-verifier",
        "nature-shared",
      ].map((name) => [`skills/${name}/SKILL.md`, `Updated ${name} instructions`]),
    ),
    "skills/nature-writing/SKILL.md": "Updated writing instructions",
    "skills/nature-shared/core/example.md": "Updated shared guidance",
    "skills/nature-figure/SKILL.md": "Unrelated module",
    LICENSE: "Apache License",
  };
  const fetcher = async (url) => {
    if (url.endsWith("/nature-skills"))
      return Response.json({ default_branch: "main", stargazers_count: 49000 });
    if (url.includes("/git/ref/")) return Response.json({ object: { sha: nextRevision } });
    if (url.includes("/git/trees/"))
      return Response.json({
        tree: Object.entries(files).map(([filename, text]) => ({
          path: filename,
          type: "blob",
          mode: "100644",
          size: Buffer.byteLength(text),
        })),
      });
    const filename = url.split(`/${nextRevision}/`)[1];
    assert.ok(Object.hasOwn(files, filename), `Unexpected resource ${url}`);
    assert.notEqual(filename, "skills/nature-figure/SKILL.md");
    return new Response(files[filename]);
  };
  const updated = await syncGitHubSkills(root, { fetcher, now });
  assert.equal(updated.registry.skills[0].revision, nextRevision);
  assert.equal(updated.registry.skills[0].name, "Nature 学术写作套件");
  const selected = updated.select(["nature-writing-suite"]);
  await selected.load("nature-writing-suite");
  assert.equal(
    (await selected.resource("nature-writing-suite", "skills/nature-writing/SKILL.md")).content,
    files["skills/nature-writing/SKILL.md"],
  );
  assert.ok(!updated.updateError);
});

test("unchanged commits update stars without downloading skill contents and checks are throttled", async (context) => {
  const root = await fixture(context);
  const remote = upstream();
  const library = await syncGitHubSkills(root, { fetcher: remote.fetcher, now });
  assert.equal(library.catalog()[0].stars, 7523);
  assert.equal(remote.calls.length, 2);
  await syncGitHubSkills(root, { fetcher: remote.fetcher, now: now + 1000 });
  assert.equal(remote.calls.length, 2);
});

test("new commits replace the selected manifest while existing sessions retain their immutable revision", async (context) => {
  const root = await fixture(context);
  const initial = await syncGitHubSkills(root, { fetcher: upstream().fetcher, now });
  const oldSession = initial.select([WRITING_SKILL_ID]);
  const remote = upstream({
    revision: nextRevision,
    files: {
      ...bundledFiles,
      "SKILL.md": "Updated instructions",
      "references/style.md": "Updated style",
    },
  });
  const updated = await syncGitHubSkills(root, { fetcher: remote.fetcher, now: now + 900_001 });
  assert.equal(updated.catalog()[0].id, WRITING_SKILL_ID);
  assert.equal(updated.registry.skills[0].revision, nextRevision);
  assert.equal(
    (await updated.select([WRITING_SKILL_ID]).load(WRITING_SKILL_ID)).instructions,
    "Updated instructions",
  );
  assert.equal((await oldSession.load(WRITING_SKILL_ID)).instructions, "Initial instructions");
  assert.equal(
    (await oldSession.resource(WRITING_SKILL_ID, "references/style.md")).content,
    "Initial style",
  );
  assert.notEqual(oldSession.fingerprint(), updated.select([WRITING_SKILL_ID]).fingerprint());
  assert.ok(remote.calls.some((url) => url.includes(`/${nextRevision}/research-paper-writing/`)));
});

test("failed downloads leave the previous registry and resources usable", async (context) => {
  const root = await fixture(context);
  await syncGitHubSkills(root, { fetcher: upstream().fetcher, now });
  const remote = upstream({ revision: nextRevision, failFile: "references/style.md" });
  const result = await syncGitHubSkills(root, { fetcher: remote.fetcher, now: now + 900_001 });
  assert.equal(result.registry.skills[0].revision, firstRevision);
  assert.match(result.updateError, /503/);
  assert.equal(
    (await result.select([WRITING_SKILL_ID]).load(WRITING_SKILL_ID)).instructions,
    "Initial instructions",
  );
});

test("removed skills are not silently reinstalled by automatic updates", async (context) => {
  const root = await fixture(context);
  await syncGitHubSkills(root, { fetcher: upstream().fetcher, now });
  await changeMarketSkill(root, WRITING_SKILL_ID, false);
  const remote = upstream({ revision: nextRevision });
  const library = await syncGitHubSkills(root, { fetcher: remote.fetcher, now: now + 900_001 });
  assert.deepEqual(library.catalog(), []);
  assert.equal(remote.calls.length, 0);
});

test("updates preserve local imports made while downloads are in progress", async (context) => {
  const root = await fixture(context);
  await syncGitHubSkills(root, { fetcher: upstream().fetcher, now });
  const localFolder = await mkdtemp(path.join(os.tmpdir(), "inkwell-local-skill-"));
  context.after(() => rm(localFolder, { recursive: true, force: true }));
  await writeFile(
    path.join(localFolder, "SKILL.md"),
    "---\nname: Local skill\n---\nLocal instructions",
  );
  const remote = upstream({ revision: nextRevision });
  const library = await syncGitHubSkills(root, {
    now: now + 900_001,
    fetcher: async (url, options) => {
      if (url.includes("/git/trees/")) await importSkill(root, localFolder);
      return remote.fetcher(url, options);
    },
  });
  assert.equal(library.catalog().length, 2);
  assert.ok(library.catalog().some((skill) => skill.name === "Local skill"));
  assert.equal(
    library.registry.skills.find((skill) => skill.id === WRITING_SKILL_ID).revision,
    nextRevision,
  );
});

test("unsafe upstream paths, linked files and incomplete snapshots do not replace the installed revision", async (context) => {
  const root = await fixture(context);
  await syncGitHubSkills(root, { fetcher: upstream().fetcher, now });
  const remote = upstream({
    revision: nextRevision,
    tree: [{ type: "blob", mode: "120000", path: "research-paper-writing/../escape.md", size: 10 }],
  });
  const result = await syncGitHubSkills(root, { fetcher: remote.fetcher, now: now + 900_001 });
  assert.equal(result.registry.skills[0].revision, firstRevision);
  assert.match(result.updateError, /resource limits/);
  assert.equal(remote.calls.length, 3);
});

test("the actual bundled snapshot passes resource integrity checks without network access", async (context) => {
  const root = await fixture(context, false);
  await copyFile(
    fileURLToPath(new URL("../skills/github-bundle.json", import.meta.url)),
    path.join(root, "github-bundle.json"),
  );
  await changeMarketSkill(root, WRITING_SKILL_ID, true);
  const library = await syncGitHubSkills(root, {
    fetcher: async () => {
      throw new Error("Offline");
    },
    now,
  });
  const selected = library.select([WRITING_SKILL_ID]);
  const loaded = await selected.load(WRITING_SKILL_ID);
  assert.match(loaded.instructions, /Research Paper Writing/);
  assert.equal(loaded.resources.length, 39);
  for (const filename of loaded.resources) await selected.resource(WRITING_SKILL_ID, filename);
  assert.match(
    (await selected.resource(WRITING_SKILL_ID, "LICENSE.txt")).content,
    /Copyright \(c\) 2026 Master-cai/,
  );
  const disk = await SkillLibrary.open(root);
  assert.equal(disk.catalog()[0].id, WRITING_SKILL_ID);
});

test("GitHub imports work without a bundle and automatically update their tracked source", async (context) => {
  const root = await fixture(context, false);
  await rm(path.join(root, "github-bundle.json"));
  const mock = (revision, text) => async (url) => {
    if (url.endsWith("/example/writing"))
      return Response.json({ default_branch: "main", stargazers_count: 7523 });
    if (url.includes("/git/ref/")) return Response.json({ object: { sha: revision } });
    if (url.includes("/git/trees/"))
      return Response.json({
        tree: [
          { type: "blob", mode: "100644", path: "writing/SKILL.md", size: text.length },
          { type: "blob", mode: "100644", path: "LICENSE", size: 3 },
        ],
      });
    if (url.endsWith("/LICENSE")) return new Response("MIT");
    return new Response(text);
  };
  const first = await importGitHubSkill(root, "https://github.com/example/writing", {
    fetcher: mock(firstRevision, "First"),
  });
  const skill = first.registry.skills[0];
  assert.deepEqual(skill.upstream, {
    repository: "example/writing",
    branch: "main",
    subdirectory: "writing",
  });
  assert.equal(skill.source, "https://github.com/example/writing/tree/main/writing");
  assert.equal(skill.stars, 7523);
  const updated = await syncGitHubSkills(root, { fetcher: mock(nextRevision, "Second"), now });
  assert.equal(updated.registry.skills[0].revision, nextRevision);
  assert.equal((await updated.select([skill.id]).load(skill.id)).instructions, "Second");
});

test("GitHub imports reject invalid hosts, ambiguous folders and unsafe paths", async (context) => {
  const root = await fixture(context);
  for (const url of [
    "http://github.com/example/repo",
    "https://example.com/a/b",
    "https://github.com/a/b/issues",
    "https://user:pass@github.com/a/b",
  ])
    await assert.rejects(importGitHubSkill(root, url), /HTTPS GitHub/);
  const remote = upstream({
    tree: [
      { type: "blob", path: "first/SKILL.md" },
      { type: "blob", path: "second/SKILL.md" },
    ],
  });
  await assert.rejects(
    importGitHubSkill(root, "https://github.com/Master-cai/Research-Paper-Writing-Skills", {
      fetcher: remote.fetcher,
    }),
    /specific skill folder/,
  );
});

test("star count changes do not invalidate active session fingerprints", async (context) => {
  const root = await fixture(context);
  const first = await syncGitHubSkills(root, { fetcher: upstream({ stars: 7500 }).fetcher, now });
  const second = await syncGitHubSkills(root, {
    fetcher: upstream({ stars: 7600 }).fetcher,
    now: now + 900_001,
  });
  assert.equal(
    first.select([WRITING_SKILL_ID]).fingerprint(),
    second.select([WRITING_SKILL_ID]).fingerprint(),
  );
});

test("specific GitHub folder imports do not include neighboring skills", async (context) => {
  const root = await fixture(context);
  const remote = upstream({
    tree: [
      { path: "research-paper-writing/SKILL.md", type: "blob", mode: "100644", size: 20 },
      { path: "other/SKILL.md", type: "blob", mode: "100644", size: 20 },
    ],
  });
  const library = await importGitHubSkill(
    root,
    "https://github.com/Master-cai/Research-Paper-Writing-Skills/tree/main/research-paper-writing",
    { fetcher: remote.fetcher },
  );
  assert.equal(library.registry.skills[0].id, WRITING_SKILL_ID);
  assert.deepEqual(
    library.registry.skills[0].resources.map((resource) => resource.path),
    ["LICENSE.txt"],
  );
});
