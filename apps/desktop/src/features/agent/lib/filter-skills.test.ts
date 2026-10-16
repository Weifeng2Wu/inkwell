import { describe, expect, it } from "vitest";
import type { MarketSkill } from "./academic-client";
import { filterSkills } from "./filter-skills";

const skills: MarketSkill[] = [
  {
    id: "paper-review",
    name: "Paper review",
    description: "Review evidence",
    version: "1",
    source: "Local upload",
    installed: true,
    managed: true,
  },
  {
    id: "writing",
    name: "Writing",
    description: "Draft papers",
    version: "1",
    source: "GitHub",
    installed: false,
    managed: true,
  },
  {
    id: "citations",
    name: "Citations",
    description: "Review references",
    version: "1",
    source: "Local upload",
    installed: true,
    managed: true,
  },
];

describe("filterSkills", () => {
  it("shows all skills by default", () => {
    expect(filterSkills(skills, "", "all")).toEqual(skills);
  });
  it("filters on installation, not project activation", () => {
    expect(filterSkills(skills, "", "installed").map((skill) => skill.id)).toEqual([
      "paper-review",
      "citations",
    ]);
  });
  it("combines search with installation status", () => {
    expect(filterSkills(skills, "  PAPER  ", "installed").map((skill) => skill.id)).toEqual([
      "paper-review",
    ]);
    expect(filterSkills(skills, "writing", "installed")).toEqual([]);
    expect(filterSkills(skills, "references", "installed").map((skill) => skill.id)).toEqual([
      "citations",
    ]);
  });
  it("preserves the source list and handles empty results", () => {
    expect(filterSkills([], "", "installed")).toEqual([]);
    expect(filterSkills(skills, "missing", "all")).toEqual([]);
    expect(skills).toHaveLength(3);
  });
});
