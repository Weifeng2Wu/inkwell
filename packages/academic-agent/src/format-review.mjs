import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importSkill } from "./market.mjs";
import { buildVenueResources } from "./venue-factory.mjs";

const categories = new Set([
  "pages",
  "layout",
  "typography",
  "structure",
  "references",
  "figures",
  "tables",
  "anonymity",
  "files",
]);
const normalize = (text) => text.replace(/\s+/g, " ").trim();

export function buildFormatReviewSkill(request) {
  if (
    typeof request.name !== "string" ||
    !request.name.trim() ||
    request.name.length > 80 ||
    Array.from(request.name).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error("Invalid format review skill name.");
  if (!Array.isArray(request.sources) || !request.sources.length || request.sources.length > 82)
    throw new Error("Provide submission requirements first.");
  const ids = new Set();
  let bytes = 0;
  for (const source of request.sources) {
    if (
      !source ||
      typeof source.id !== "string" ||
      !/^S[1-9]\d?$/.test(source.id) ||
      ids.has(source.id) ||
      typeof source.name !== "string" ||
      source.name.length > 512 ||
      typeof source.text !== "string" ||
      !source.text.trim() ||
      source.text.includes("\0")
    )
      throw new Error("Invalid requirement source.");
    ids.add(source.id);
    bytes += Buffer.byteLength(source.text);
  }
  if (
    bytes > 80000 ||
    !Array.isArray(request.rules) ||
    !request.rules.length ||
    request.rules.length > 60
  )
    throw new Error("Format requirements exceed limits or contain no rules.");
  const rules = request.rules.map((rule, index) => {
    if (
      !rule ||
      !categories.has(rule.category) ||
      !["required", "recommended"].includes(rule.severity)
    )
      throw new Error("Invalid format rule.");
    for (const key of ["requirement", "source", "evidence", "check"])
      if (typeof rule[key] !== "string" || !rule[key].trim() || rule[key].length > 2000)
        throw new Error("Invalid format rule field.");
    const source = request.sources.find((entry) => entry.id === rule.source);
    if (!source || !normalize(source.text).includes(normalize(rule.evidence)))
      throw new Error("Format rule lacks verifiable source evidence.");
    return {
      id: `R${index + 1}`,
      category: rule.category,
      severity: rule.severity,
      requirement: rule.requirement,
      source: rule.source,
      evidence: rule.evidence,
      check: rule.check,
    };
  });
  const slug =
    request.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42)
      .replace(/-$/, "") || "submission";
  const name = `format-review-${slug}`;
  const description = `Check submission format compliance for ${request.name.trim()}. Use for pre-submission format and administrative checks only, not scientific review or writing advice.`;
  const skill = {
    name,
    description,
    rules,
    sources: request.sources.map(({ id, name: sourceName, text }) => ({
      id,
      name: sourceName,
      text,
    })),
  };
  if (request.checkerRules === undefined)
    throw new Error(
      "Venue checker rules are required. Regenerate the skill with the venue factory.",
    );
  return { ...skill, ...buildVenueResources(skill, request.checkerRules, request.kitNotes) };
}

export async function createFormatReviewSkill(directory, request) {
  const skill = buildFormatReviewSkill(request);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "inkwell-format-skill-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(temporary, "references"));
    await writeFile(path.join(temporary, "SKILL.md"), skill.instructions);
    for (const [relative, content] of Object.entries(skill.resources)) {
      const destination = path.join(temporary, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    await writeFile(
      path.join(temporary, "references/rules.json"),
      JSON.stringify(skill.rules, null, 2),
    );
    await writeFile(
      path.join(temporary, "references/requirements.json"),
      JSON.stringify(skill.sources),
    );
    const library = await importSkill(directory, temporary);
    return { library, skillName: skill.name };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
