import { buildFormatReviewSkill, createFormatReviewSkill } from "./format-review.mjs";
import { importGitHubSkill, syncGitHubSkills } from "./github-skills.mjs";
import { SkillLibrary } from "./library.mjs";
import { changeMarketSkill, importSkill, marketCatalog } from "./market.mjs";
import { readRequirementZip } from "./zip-skills.mjs";

export async function sharedSkills(directory, request) {
  if (request.type === "format_requirements_zip") return readRequirementZip(request.data);
  if (request.type === "format_skill_preview") return buildFormatReviewSkill(request);
  if (request.type === "format_skill_create") {
    const { library, skillName } = await createFormatReviewSkill(directory, request);
    return { skills: library.catalog(), market: await marketCatalog(library), skillName };
  }
  let library =
    request.type === "catalog" || request.type === "context"
      ? await syncGitHubSkills(directory)
      : await SkillLibrary.open(directory);
  if (request.type === "skill_import") library = await importSkill(directory, request.sourcePath);
  else if (request.type === "skill_import_github")
    library = await importGitHubSkill(directory, request.url);
  else if (request.type === "skill_install")
    library = await changeMarketSkill(directory, request.skillId, request.install);
  else if (request.type === "skill_preview")
    return library.select([request.skillId]).load(request.skillId);
  else if (request.type === "context") {
    const selection = library.select(request.skillIds);
    const skills = [];
    let size = 0;
    for (const skill of selection.skills) {
      const loaded = await selection.load(skill.id);
      const resources = [];
      for (const resource of loaded.resources)
        resources.push(await selection.resource(skill.id, resource));
      size += Buffer.byteLength(JSON.stringify({ ...loaded, resources }));
      if (size > 2 * 1024 * 1024)
        throw new Error("Selected skill instructions exceed the ACP context limit.");
      skills.push({ name: skill.name, ...loaded, resources });
    }
    return { skills };
  } else if (request.type !== "catalog") throw new Error("Unsupported shared skill operation.");
  return {
    skills: library.catalog(),
    market: await marketCatalog(library),
    ...(library.updateError ? { updateError: library.updateError } : {}),
  };
}

if (process.argv[1]?.endsWith("shared-skills.mjs")) {
  try {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 17 * 1024 * 1024) throw new Error("Skill request too large.");
    }
    const request = JSON.parse(input);
    if (request.type !== "format_requirements_zip" && Buffer.byteLength(input) > 512 * 1024)
      throw new Error("Skill request too large.");
    process.stdout.write(JSON.stringify(await sharedSkills(process.argv[2], request)));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
