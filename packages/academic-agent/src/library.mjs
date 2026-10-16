import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { AppDatabase, databasePath } from "./storage.mjs";

export const MAX_RESOURCE_BYTES = 128 * 1024;
export function libraryDatabasePath(directory) {
  return databasePath(path.basename(directory) === "skills" ? path.dirname(directory) : directory);
}
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function onlyKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

export function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function isWithin(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function validResource(resource) {
  return (
    onlyKeys(resource, ["path", "sha256"]) &&
    typeof resource.path === "string" &&
    resource.path.length > 0 &&
    resource.path.length <= 256 &&
    !path.isAbsolute(resource.path) &&
    !resource.path.split(/[\\/]/).some((part) => part === ".." || part === "") &&
    typeof resource.sha256 === "string" &&
    DIGEST_PATTERN.test(resource.sha256)
  );
}

export function validateRegistry(registry) {
  if (
    !onlyKeys(registry, ["schemaVersion", "skills"]) ||
    registry.schemaVersion !== 1 ||
    !Array.isArray(registry.skills) ||
    registry.skills.length > 100
  ) {
    throw new Error("Invalid skill registry. Expected schemaVersion 1 and at most 100 skills.");
  }
  const identifiers = new Set();
  for (const skill of registry.skills) {
    if (
      !onlyKeys(skill, [
        "id",
        "name",
        "description",
        "version",
        "source",
        "entrypoint",
        "resources",
        "revision",
        "stars",
        "upstream",
      ]) ||
      typeof skill.id !== "string" ||
      skill.id.length > 64 ||
      !ID_PATTERN.test(skill.id) ||
      identifiers.has(skill.id) ||
      typeof skill.name !== "string" ||
      !skill.name.trim() ||
      skill.name.length > 100 ||
      typeof skill.description !== "string" ||
      !skill.description.trim() ||
      skill.description.length > 500 ||
      typeof skill.version !== "string" ||
      !skill.version.trim() ||
      skill.version.length > 64 ||
      typeof skill.source !== "string" ||
      !skill.source.trim() ||
      skill.source.length > 500 ||
      (skill.revision !== undefined && !/^[a-f0-9]{40}$/.test(skill.revision)) ||
      (skill.stars !== undefined && (!Number.isSafeInteger(skill.stars) || skill.stars < 0)) ||
      (skill.upstream !== undefined &&
        (!onlyKeys(skill.upstream, ["repository", "subdirectory", "branch"]) ||
          typeof skill.upstream.repository !== "string" ||
          !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(skill.upstream.repository) ||
          typeof skill.upstream.branch !== "string" ||
          !skill.upstream.branch ||
          skill.upstream.branch.length > 256 ||
          typeof skill.upstream.subdirectory !== "string" ||
          skill.upstream.subdirectory.length > 256 ||
          (skill.upstream.subdirectory !== "" &&
            skill.upstream.subdirectory
              .split("/")
              .some(
                (segment) =>
                  !segment ||
                  segment === "." ||
                  segment === ".." ||
                  segment.includes("\\") ||
                  [...segment].some((character) => character.charCodeAt(0) < 32),
              )))) ||
      !validResource(skill.entrypoint) ||
      !Array.isArray(skill.resources) ||
      skill.resources.length > (skill.id === "nature-writing-suite" ? 512 : 50) ||
      !skill.resources.every(validResource) ||
      new Set(skill.resources.map((resource) => resource.path)).size !== skill.resources.length
    ) {
      throw new Error("Invalid, duplicate or oversized skill manifest.");
    }
    identifiers.add(skill.id);
  }
  return registry;
}

export class SkillLibrary {
  constructor(directory, registry) {
    this.directory = directory;
    this.registry = validateRegistry(registry);
  }

  static async open(directory) {
    const scope = await realpath(directory);
    const database = new AppDatabase(libraryDatabasePath(scope));
    try {
      const saved = database.db
        .prepare("SELECT value FROM skill_registry WHERE scope=?")
        .get(scope);
      if (saved) return new SkillLibrary(scope, JSON.parse(saved.value));
      const filename = path.join(scope, "registry.json");
      if ((await stat(filename)).size > MAX_RESOURCE_BYTES)
        throw new Error("Skill registry is too large.");
      const value = await readFile(filename, "utf8");
      const library = new SkillLibrary(scope, JSON.parse(value));
      database.transaction(() => {
        database.db
          .prepare("INSERT INTO skill_registry VALUES (?,?) ON CONFLICT(scope) DO NOTHING")
          .run(scope, JSON.stringify(library.registry));
      });
      const current = database.db
        .prepare("SELECT value FROM skill_registry WHERE scope=?")
        .get(scope);
      return new SkillLibrary(scope, JSON.parse(current.value));
    } finally {
      database.close();
    }
  }

  catalog() {
    return this.registry.skills.map(({ id, name, description, version, source, stars }) => ({
      id,
      name,
      description,
      version,
      source,
      ...(stars !== undefined ? { stars } : {}),
    }));
  }

  select(identifiers) {
    if (
      !Array.isArray(identifiers) ||
      identifiers.length > 20 ||
      !identifiers.every((identifier) => typeof identifier === "string") ||
      new Set(identifiers).size !== identifiers.length
    )
      throw new Error("Invalid skill selection.");
    const selected = identifiers
      .map((identifier) => {
        const skill = this.registry.skills.find((entry) => entry.id === identifier);
        if (!skill) throw new Error(`Unknown skill: ${identifier}`);
        return skill;
      })
      .sort((first, second) => first.id.localeCompare(second.id));
    return new SkillSelection(this.directory, selected);
  }
}

export class SkillSelection {
  constructor(directory, skills) {
    this.directory = directory;
    this.skills = structuredClone(skills);
    this.loaded = new Set();
    this.cache = new Map();
  }

  metadata() {
    return this.skills.map(({ id, name, description, version }) => ({
      id,
      name,
      description,
      version,
    }));
  }

  fingerprint() {
    return digest(JSON.stringify(this.skills.map(({ stars: _stars, ...skill }) => skill)));
  }

  async readResource(skill, resource) {
    const root = await realpath(path.join(this.directory, skill.id, skill.revision ?? ""));
    if (!isWithin(this.directory, root)) throw new Error("Skill root escapes the library.");
    const filename = await realpath(path.resolve(root, resource.path));
    if (!isWithin(root, filename)) throw new Error("Skill resource escapes its root.");
    const metadata = await stat(filename);
    if (!metadata.isFile() || metadata.size > MAX_RESOURCE_BYTES)
      throw new Error("Invalid or oversized skill resource.");
    const content = await readFile(filename);
    if (content.length > MAX_RESOURCE_BYTES || digest(content) !== resource.sha256) {
      throw new Error("Skill resource changed. Review its manifest and start a new session.");
    }
    const key = `${skill.id}:${resource.path}:${resource.sha256}`;
    if (!this.cache.has(key)) this.cache.set(key, content.toString("utf8"));
    return this.cache.get(key);
  }

  find(identifier) {
    const skill = this.skills.find((entry) => entry.id === identifier);
    if (!skill) throw new Error("Skill is not enabled in this session.");
    return skill;
  }

  async load(identifier) {
    const skill = this.find(identifier);
    const instructions = await this.readResource(skill, skill.entrypoint);
    this.loaded.add(identifier);
    return {
      id: skill.id,
      version: skill.version,
      source: skill.source,
      sha256: skill.entrypoint.sha256,
      instructions,
      resources: skill.resources.map(({ path: resourcePath }) => resourcePath),
    };
  }

  async resource(identifier, resourcePath) {
    const skill = this.find(identifier);
    if (!this.loaded.has(identifier))
      throw new Error("Load the skill instructions before its resources.");
    const resource = skill.resources.find((entry) => entry.path === resourcePath);
    if (!resource) throw new Error("Resource is not declared by this skill.");
    return {
      id: identifier,
      path: resource.path,
      sha256: resource.sha256,
      content: await this.readResource(skill, resource),
    };
  }
}
