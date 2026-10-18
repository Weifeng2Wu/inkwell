import type { I18nContextValue } from "@/features/i18n";
import type { SkillMetadata } from "./academic-client";

// Only localize app-owned metadata; imported skills retain their authors' wording.
export function localizeSkill<T extends SkillMetadata>(skill: T, t: I18nContextValue["t"]): T {
  if (
    skill.id === "nature-writing-suite" &&
    skill.source === "https://github.com/Yuan1z0825/nature-skills"
  )
    return {
      ...skill,
      name: t("skillCatalog.natureSuiteName"),
      description: t("skillCatalog.natureSuiteDescription"),
    };
  if (skill.id !== "academic-poster" || skill.source !== "Inkwell built-in") return skill;
  return {
    ...skill,
    description: t("skillCatalog.posterDescription"),
    source: t("skillCatalog.builtIn"),
  };
}
