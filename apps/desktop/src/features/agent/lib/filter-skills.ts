import type { I18nContextValue } from "@/features/i18n";
import type { MarketSkill } from "./academic-client";
import { localizeSkill } from "./skill-presentation";

export type SkillFilter = "all" | "installed";

export function filterSkills(
  skills: MarketSkill[],
  query: string,
  filter: SkillFilter,
  t?: I18nContextValue["t"],
): MarketSkill[] {
  const search = query.trim().toLowerCase();
  return skills.filter(
    (skill) =>
      (filter !== "installed" || skill.installed) &&
      `${skill.name} ${skill.description} ${skill.id} ${t ? `${localizeSkill(skill, t).name} ${localizeSkill(skill, t).description}` : ""}`
        .toLowerCase()
        .includes(search),
  );
}
