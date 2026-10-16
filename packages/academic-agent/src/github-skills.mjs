import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { digest, libraryDatabasePath, MAX_RESOURCE_BYTES, SkillLibrary } from "./library.mjs";
import { saveRegistry, withSkillStoreLock } from "./market.mjs";
import { AppDatabase } from "./storage.mjs";

export const WRITING_REPOSITORY = "Master-cai/Research-Paper-Writing-Skills";
export const WRITING_SKILL_ID = "research-paper-writing";
const SOURCE = `https://github.com/${WRITING_REPOSITORY}`;
const PREFIX = "research-paper-writing/";
const INTERVAL = 15 * 60 * 1000;
const TEXT_EXTENSION = /\.(md|txt|yaml|yml|json|bib|tex|csv)$/i;
const NATURE_MODULES = [
  "nature-writing",
  "nature-polishing",
  "nature-proposal-writer",
  "nature-citation",
  "nature-data",
  "nature-statistics",
  "nature-response",
  "nature-reviewer",
  "nature-ref-verifier",
  "nature-shared",
];

export function natureSuiteInstructions() {
  return `---\nname: nature-writing-suite\ndescription: Scientific manuscript writing, polishing, proposals, citations, availability statements, statistical reporting, peer review and revision responses.\n---\n\n# Nature Academic Writing Suite\n\nUse the module matching the user's task. Read its declared SKILL.md resource, then only its applicable references. Do not load every module by default.\n\n- Draft or restructure manuscripts: skills/nature-writing/SKILL.md\n- Polish, translate or fix manuscript LaTeX layout: skills/nature-polishing/SKILL.md\n- Research proposals and opening reports: skills/nature-proposal-writer/SKILL.md\n- Nature/CNS-scoped claim citations: skills/nature-citation/SKILL.md\n- Data/code availability statements: skills/nature-data/SKILL.md\n- Statistical reporting: skills/nature-statistics/SKILL.md\n- Reviewer responses and revision letters: skills/nature-response/SKILL.md\n- Mock peer review: skills/nature-reviewer/SKILL.md\n- Reference verification: skills/nature-ref-verifier/SKILL.md\n\nResource paths inside modules are relative to that module's directory. Resolve ../nature-shared references to skills/nature-shared, all within this suite's declared resources. Never execute upstream scripts. Some modules assume external search, browser, reference-manager or document tools; check available capabilities, disclose missing ones, and never invent verification or tool results. Do not request or reuse credentials embedded in examples. Follow Inkwell permissions and propose manuscript edits only through its review copy. Nature-style guidance is not official journal policy or an acceptance guarantee. Preserve upstream LICENSE.txt and attribution.\n`;
}

async function bundles(directory) {
  const legacy = await readJson(path.join(directory, "github-bundle.json"), null);
  const nature = await readJson(path.join(directory, "nature-bundle.json"), null);
  return [
    legacy && {
      ...legacy,
      id: legacy.id ?? WRITING_SKILL_ID,
      name: legacy.name ?? "Research Paper Writing",
      description: legacy.description ?? "Academic writing, revision, and paper review.",
      source: legacy.source ?? SOURCE,
    },
    nature,
  ].filter(Boolean);
}

export async function bundledCatalog(directory) {
  return (await bundles(directory)).map(({ id, name, description, source, revision, stars }) => ({
    id,
    name,
    description,
    source,
    version: revision.slice(0, 12),
    stars,
    installed: false,
    managed: true,
  }));
}

export async function installBundledSkill(directory, id) {
  const snapshot = (await bundles(directory)).find((entry) => entry.id === id);
  if (!snapshot) throw new Error("Unknown bundled skill.");
  return installSnapshot(directory, snapshot);
}

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function syncState(directory, value) {
  const database = new AppDatabase(libraryDatabasePath(directory));
  try {
    if (value !== undefined) {
      database.request({ type: "record_write", namespace: "skill-sync", key: directory, value });
      return value;
    }
    const saved = database.request({
      type: "record_read",
      namespace: "skill-sync",
      key: directory,
    }).value;
    if (saved !== null) return saved;
    const legacy = await readJson(path.join(directory, ".github-update-state.json"), {});
    database.request({
      type: "record_write",
      namespace: "skill-sync",
      key: directory,
      value: legacy,
    });
    return legacy;
  } finally {
    database.close();
  }
}

async function request(url, fetcher, json = false) {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
    headers: { "User-Agent": "Inkwell-Skills", Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub skill update failed (${response.status}).`);
  const limit = json ? 512 * 1024 : MAX_RESOURCE_BYTES;
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("GitHub skill response exceeds the size limit.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return json ? JSON.parse(text) : text;
}

function validateSnapshot(snapshot) {
  if (!/^[a-f0-9]{40}$/.test(snapshot.revision) || !snapshot.files?.["SKILL.md"])
    throw new Error("Invalid GitHub skill snapshot.");
  const entries = Object.entries(snapshot.files);
  if (entries.length > (snapshot.id === "nature-writing-suite" ? 513 : 51))
    throw new Error("Too many GitHub skill resources.");
  if (
    entries.reduce(
      (total, [, text]) => total + (typeof text === "string" ? Buffer.byteLength(text) : 0),
      0,
    ) >
    2 * 1024 * 1024
  )
    throw new Error("Skill snapshot exceeds the total size limit.");
  for (const [relative, content] of entries) {
    if (
      relative.length > 256 ||
      relative.includes(":") ||
      [...relative].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      relative.includes("\\") ||
      relative.split("/").some((part) => !part || part === ".." || part === ".") ||
      !TEXT_EXTENSION.test(relative) ||
      typeof content !== "string" ||
      content.includes("\0") ||
      Buffer.byteLength(content) > MAX_RESOURCE_BYTES
    )
      throw new Error("Invalid GitHub skill resource.");
  }
  return snapshot;
}

async function installSnapshot(directory, rawSnapshot, expectedRevision) {
  return withSkillStoreLock(directory, () =>
    writeSnapshot(directory, rawSnapshot, expectedRevision),
  );
}

async function writeSnapshot(directory, rawSnapshot, expectedRevision) {
  const snapshot = validateSnapshot(rawSnapshot);
  const id = snapshot.id ?? WRITING_SKILL_ID;
  const library = await SkillLibrary.open(directory);
  if (
    expectedRevision &&
    library.registry.skills.find((skill) => skill.id === id)?.revision !== expectedRevision
  )
    return library;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64)
    throw new Error("Invalid GitHub skill identifier.");
  const root = path.join(directory, id, snapshot.revision);
  for (const [relative, text] of Object.entries(snapshot.files)) {
    const filename = path.join(root, relative);
    let parent = directory;
    for (const segment of [id, snapshot.revision, ...relative.split("/").slice(0, -1)]) {
      parent = path.join(parent, segment);
      await mkdir(parent, { recursive: true });
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Linked skill destinations are not allowed.");
    }
    try {
      await writeFile(filename, text, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(filename);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      digest(await readFile(filename)) !== digest(text)
    )
      throw new Error("GitHub skill snapshot differs from its verified contents.");
  }
  const skill = {
    id,
    name: snapshot.name ?? "Research Paper Writing",
    description:
      snapshot.description ??
      "Academic writing, revision, and paper review for ML, CV, and NLP research.",
    source: snapshot.source ?? SOURCE,
    upstream: snapshot.upstream ?? {
      repository: WRITING_REPOSITORY,
      subdirectory: PREFIX.slice(0, -1),
      branch: "main",
    },
    version: snapshot.revision.slice(0, 12),
    revision: snapshot.revision,
    ...(Number.isSafeInteger(snapshot.stars) && snapshot.stars >= 0
      ? { stars: snapshot.stars }
      : {}),
    entrypoint: { path: "SKILL.md", sha256: digest(snapshot.files["SKILL.md"]) },
    resources: Object.entries(snapshot.files)
      .filter(([relative]) => relative !== "SKILL.md")
      .map(([relative, text]) => ({ path: relative, sha256: digest(text) })),
  };
  return saveRegistry(library, [
    ...library.registry.skills.filter((entry) => entry.id !== skill.id),
    skill,
  ]);
}

function parseGitHubLink(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new Error("Enter an HTTPS GitHub repository or skill folder link.");
  }
  const parts = url.pathname.replace(/\/$/, "").split("/").slice(1).map(decodeURIComponent);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length < 2 ||
    !parts
      .slice(0, 2)
      .every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== "." && part !== "..") ||
    (parts.length > 2 && (parts[2] !== "tree" || parts.length < 4))
  )
    throw new Error("Enter an HTTPS GitHub repository or /tree/branch/folder link.");
  const subdirectory = parts.slice(4).join("/");
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes("\\") ||
        [...part].some((character) => character.charCodeAt(0) < 32),
    ) ||
    subdirectory.length > 256
  )
    throw new Error("Invalid GitHub skill path.");
  return {
    repository: `${parts[0]}/${parts[1].replace(/\.git$/, "")}`,
    branch: parts[3],
    subdirectory,
  };
}

function boundedFetcher(fetcher) {
  const timeout = AbortSignal.timeout(20_000);
  return (url, options) =>
    fetcher(url, { ...options, signal: AbortSignal.any([timeout, options.signal]) });
}

async function repositoryState(upstream, fetcher) {
  const metadata = await request(
    `https://api.github.com/repos/${upstream.repository}`,
    fetcher,
    true,
  );
  const branch = upstream.branch ?? metadata.default_branch;
  if (
    typeof branch !== "string" ||
    !branch ||
    branch.length > 256 ||
    !Number.isSafeInteger(metadata.stargazers_count) ||
    metadata.stargazers_count < 0
  )
    throw new Error("Invalid GitHub repository metadata.");
  const reference = await request(
    `https://api.github.com/repos/${upstream.repository}/git/ref/heads/${branch.split("/").map(encodeURIComponent).join("/")}`,
    fetcher,
    true,
  );
  const revision = reference.object?.sha;
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Invalid GitHub revision.");
  return { revision, stars: metadata.stargazers_count, upstream: { ...upstream, branch } };
}

async function downloadSnapshot(state, fetcher, current) {
  const { repository } = state.upstream;
  const tree = await request(
    `https://api.github.com/repos/${repository}/git/trees/${state.revision}?recursive=1`,
    fetcher,
    true,
  );
  if (tree.truncated || !Array.isArray(tree.tree))
    throw new Error("Invalid or truncated GitHub skill tree.");
  let subdirectory = state.upstream.subdirectory;
  if (
    !current &&
    !subdirectory &&
    !tree.tree.some((entry) => entry.path === "SKILL.md" && entry.type === "blob")
  ) {
    const candidates = tree.tree.filter(
      (entry) => entry.type === "blob" && entry.path.endsWith("/SKILL.md"),
    );
    if (candidates.length !== 1)
      throw new Error(
        "This repository contains multiple or no skills. Paste a specific skill folder link.",
      );
    subdirectory = candidates[0].path.slice(0, -"/SKILL.md".length);
  }
  const prefix = subdirectory ? `${subdirectory}/` : "";
  const suite = current?.id === "nature-writing-suite";
  const entries = tree.tree.filter(
    (entry) =>
      entry.type === "blob" &&
      typeof entry.path === "string" &&
      entry.path.startsWith(prefix) &&
      (!suite || NATURE_MODULES.some((name) => entry.path.startsWith(`skills/${name}/`))) &&
      TEXT_EXTENSION.test(entry.path),
  );
  if (
    entries.length > (suite ? 510 : 50) ||
    entries.some(
      (entry) =>
        !["100644", "100755"].includes(entry.mode) ||
        !Number.isSafeInteger(entry.size) ||
        entry.size > MAX_RESOURCE_BYTES ||
        entry.size < 0 ||
        entry.path.includes("\\") ||
        entry.path.split("/").some((segment) => !segment || segment === "." || segment === ".."),
    )
  )
    throw new Error("GitHub skill exceeds the text resource limits.");
  const files = Object.create(null);
  const download = (filename) =>
    request(
      `https://raw.githubusercontent.com/${repository}/${state.revision}/${filename.split("/").map(encodeURIComponent).join("/")}`,
      fetcher,
    );
  for (let index = 0; index < entries.length; index += 8) {
    await Promise.all(
      entries.slice(index, index + 8).map(async (entry) => {
        files[entry.path.slice(prefix.length)] = await download(entry.path);
      }),
    );
  }
  const license = tree.tree.find(
    (entry) => entry.type === "blob" && /^licen[sc]e(?:\.md|\.txt)?$/i.test(entry.path),
  );
  if (license && ["100644", "100755"].includes(license.mode) && license.size <= MAX_RESOURCE_BYTES)
    files["LICENSE.txt"] = await download(license.path);
  else if (repository === WRITING_REPOSITORY) files["LICENSE.txt"] = await download("LICENSE");
  if (suite) {
    if (NATURE_MODULES.some((name) => !files[`skills/${name}/SKILL.md`]))
      throw new Error("Nature writing suite update is missing required modules.");
    files["SKILL.md"] = natureSuiteInstructions();
    files["INKWELL-NOTICE.txt"] =
      `Inkwell combines nine writing modules and nature-shared from Yuan1z0825/nature-skills at ${state.revision}. Upstream text is preserved unmodified. Inkwell adds the routing entrypoint and this notice. Apache-2.0, see LICENSE.txt. Executable resources are not bundled.\n`;
  }
  const upstream = { ...state.upstream, subdirectory };
  const id =
    current?.id ??
    (repository.toLowerCase() === WRITING_REPOSITORY.toLowerCase() &&
    subdirectory === PREFIX.slice(0, -1)
      ? WRITING_SKILL_ID
      : `github-${digest(JSON.stringify(upstream)).slice(0, 24)}`);
  const instructions = files["SKILL.md"] ?? "";
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(instructions)?.[1] ?? "";
  const field = (key) =>
    new RegExp(`^${key}:\\s*(.+)$`, "m")
      .exec(frontmatter)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
  return {
    ...state,
    upstream,
    id,
    files,
    name: (
      (suite && current.name) ||
      field("name") ||
      current?.name ||
      subdirectory.split("/").pop() ||
      repository.split("/")[1]
    ).slice(0, 100),
    description: (
      (suite && current.description) ||
      field("description") ||
      current?.description ||
      "Skill instructions and text resources imported from GitHub."
    ).slice(0, 500),
    source: `https://github.com/${repository}${subdirectory ? `/tree/${encodeURIComponent(upstream.branch)}/${subdirectory.split("/").map(encodeURIComponent).join("/")}` : ""}`,
  };
}

export async function importGitHubSkill(directory, link, { fetcher = fetch } = {}) {
  const upstream = parseGitHubLink(link);
  const fetchUpdate = boundedFetcher(fetcher);
  const state = await repositoryState(upstream, fetchUpdate);
  return installSnapshot(directory, await downloadSnapshot(state, fetchUpdate));
}

export async function syncGitHubSkills(directory, { fetcher = fetch, now = Date.now() } = {}) {
  const lock = path.join(directory, ".github-update-lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const info = await lstat(lock).catch((failure) => {
      if (failure.code === "ENOENT") return null;
      throw failure;
    });
    if (info && now - info.mtimeMs < 120_000) return SkillLibrary.open(directory);
    await rm(lock, { recursive: true, force: true });
    return syncGitHubSkills(directory, { fetcher, now });
  }
  try {
    const state = await syncState(directory);
    let library = await SkillLibrary.open(directory);
    if (!state.initialized) {
      state.initialized = true;
      await syncState(directory, state);
    }
    if (now - (state.checkedAt ?? 0) < INTERVAL) {
      if (state.error) library.updateError = state.error;
      return library;
    }
    const fetchUpdate = boundedFetcher(fetcher);
    const errors = [];
    for (const current of library.registry.skills.filter((skill) => skill.upstream)) {
      try {
        const remote = await repositoryState(current.upstream, fetchUpdate);
        if (remote.revision !== current.revision)
          library = await installSnapshot(
            directory,
            await downloadSnapshot(remote, fetchUpdate, current),
            current.revision,
          );
        else if (remote.stars !== current.stars) {
          library = await withSkillStoreLock(directory, async () => {
            const latest = await SkillLibrary.open(directory);
            return saveRegistry(
              latest,
              latest.registry.skills.map((skill) =>
                skill.id === current.id ? { ...skill, stars: remote.stars } : skill,
              ),
            );
          });
        }
      } catch (error) {
        errors.push(`${current.name}: ${String(error)}`);
      }
    }
    const error = errors.join("\n");
    await syncState(directory, { initialized: true, checkedAt: now, ...(error ? { error } : {}) });
    if (error) library.updateError = error;
    return library;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}
