import type { MarketSkill } from "./academic-client";

export type SkillFilter = "all" | "installed";

export function filterSkills(
  skills: MarketSkill[],
  query: string,
  filter: SkillFilter,
): MarketSkill[] {
  const search = query.trim().toLowerCase();
  return skills.filter(
    (skill) =>
      (filter !== "installed" || skill.installed) &&
      `${skill.name} ${skill.description} ${skill.id}`.toLowerCase().includes(search),
  );
}
