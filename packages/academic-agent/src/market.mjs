import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { digest, MAX_RESOURCE_BYTES, SkillLibrary, validateRegistry } from "./library.mjs";
import { importSkillZip } from "./zip-skills.mjs";

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".bib", ".tex"]);

export async function withSkillStoreLock(directory, operation) {
  const lock = path.join(directory, ".skill-store-lock");
  for (let attempt = 0; ; attempt += 1) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt >= 200) throw error;
      const info = await lstat(lock).catch((failure) => {
        if (failure.code === "ENOENT") return null;
        throw failure;
      });
      if (!info) continue;
      if (Date.now() - info.mtimeMs > 120_000) {
        await rm(lock, { recursive: true, force: true });
      } else await delay(100);
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function marketCatalog(library) {
  const { bundledCatalog } = await import("./github-skills.mjs");
  const installed = library
    .catalog()
    .map((skill) => ({ ...skill, installed: true, managed: true }));
  return [
    ...installed,
    ...(await bundledCatalog(library.directory)).filter(
      (skill) => !installed.some((entry) => entry.id === skill.id),
    ),
  ];
}

export async function saveRegistry(library, skills) {
  const registry = validateRegistry({ schemaVersion: 1, skills });
  const temporary = path.join(library.directory, `.registry-${randomUUID()}.json`);
  await writeFile(temporary, JSON.stringify(registry, null, 2), { flag: "wx" });
  await rename(temporary, path.join(library.directory, "registry.json"));
  return SkillLibrary.open(library.directory);
}

export async function changeMarketSkill(directory, id, install) {
  if (install === true) {
    const { installBundledSkill } = await import("./github-skills.mjs");
    return installBundledSkill(directory, id);
  }
  return withSkillStoreLock(directory, () => changeSkill(directory, id, install));
}

async function changeSkill(directory, id, install) {
  const library = await SkillLibrary.open(directory);
  if (install !== false || !library.registry.skills.some((skill) => skill.id === id))
    throw new Error("Upload a skill to install it, or choose an installed skill to remove.");
  return saveRegistry(
    library,
    library.registry.skills.filter((skill) => skill.id !== id),
  );
}

export async function importSkill(directory, sourcePath) {
  return withSkillStoreLock(directory, () => importSkillContents(directory, sourcePath));
}

async function importSkillContents(directory, sourcePath) {
  if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath) || sourcePath.length > 4096)
    throw new Error("Choose a local SKILL.md file or skill folder.");
  const sourceInfo = await lstat(sourcePath);
  if (sourceInfo.isSymbolicLink()) throw new Error("Symlinked uploads are not allowed.");
  if (sourceInfo.isFile() && path.extname(sourcePath).toLowerCase() === ".zip") {
    if (sourceInfo.size > 8 * 1024 * 1024) throw new Error("ZIP exceeds the 8 MiB limit.");
    return importSkillZip(sourcePath, (folder) => importSkillContents(directory, folder));
  }
  const source = await realpath(sourcePath);
  const files = new Map();
  let inspected = 0;
  async function collect(filename, relative, depth) {
    if (++inspected > 500 || depth > 8)
      throw new Error("Skill folder is too large or deeply nested.");
    const info = await lstat(filename);
    if (info.isSymbolicLink() || (info.nlink > 1 && info.isFile()))
      throw new Error("Linked skill files are not allowed.");
    if (info.isDirectory()) {
      for (const entry of await readdir(filename)) {
        if (entry.startsWith(".")) continue;
        await collect(
          path.join(filename, entry),
          relative ? `${relative}/${entry}` : entry,
          depth + 1,
        );
      }
      return;
    }
    if (!info.isFile() || !TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase())) return;
    if (
      relative.length > 256 ||
      relative.includes("\\") ||
      info.size > MAX_RESOURCE_BYTES ||
      files.size >= 51
    )
      throw new Error("Skill exceeds the text resource limits (128 KiB per file, 50 resources).");
    const content = await readFile(filename);
    if (content.length > MAX_RESOURCE_BYTES || content.includes(0))
      throw new Error("Only bounded text resources can be uploaded.");
    files.set(relative, content);
  }
  if (sourceInfo.isDirectory()) await collect(source, "", 0);
  else {
    if (path.basename(source).toLowerCase() !== "skill.md")
      throw new Error("Choose a SKILL.md file.");
    await collect(source, "SKILL.md", 0);
  }
  const instructions = files.get("SKILL.md");
  if (!instructions) throw new Error("The selected folder must contain SKILL.md at its root.");
  const content = instructions.toString("utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? "";
  const field = (key) =>
    new RegExp(`^${key}:\\s*(.+)$`, "m")
      .exec(frontmatter)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
  const name = (
    field("name") || path.basename(sourceInfo.isDirectory() ? source : path.dirname(source))
  ).slice(0, 100);
  const description = (
    field("description") || "User-uploaded skill instructions and declared text resources."
  ).slice(0, 500);
  const resources = [...files]
    .filter(([relative]) => relative !== "SKILL.md")
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([relative, bytes]) => ({ path: relative, sha256: digest(bytes) }));
  const entrypoint = { path: "SKILL.md", sha256: digest(instructions) };
  const suffix = digest(JSON.stringify({ entrypoint, resources })).slice(0, 16);
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32)
      .replace(/-$/, "") || "skill";
  const id = `upload-${slug}-${suffix}`;
  const skill = {
    id,
    name,
    description,
    version: "1.0.0",
    source: "Local upload",
    entrypoint,
    resources,
  };
  const library = await SkillLibrary.open(directory);
  const skills = [...library.registry.skills.filter((entry) => entry.id !== id), skill];
  validateRegistry({ schemaVersion: 1, skills });
  const root = path.join(library.directory, id);
  await mkdir(root, { recursive: true });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
    throw new Error("Invalid destination skill directory.");
  for (const [relative, bytes] of files) {
    let parent = root;
    for (const segment of relative.split("/").slice(0, -1)) {
      parent = path.join(parent, segment);
      await mkdir(parent, { recursive: true });
      const parentInfo = await lstat(parent);
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
        throw new Error("Invalid destination resource directory.");
    }
    const filename = path.join(root, relative);
    try {
      await writeFile(filename, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(filename);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > MAX_RESOURCE_BYTES ||
      digest(await readFile(filename)) !== digest(bytes)
    )
      throw new Error(
        "Existing upload differs. Review the local skill store before importing again.",
      );
  }
  return saveRegistry(library, skills);
}
