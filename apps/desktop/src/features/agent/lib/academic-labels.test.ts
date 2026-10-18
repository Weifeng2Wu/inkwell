import { describe, expect, it } from "vitest";
import { academicLabels } from "./academic-labels";

describe("Agent product copy", () => {
  it.each([
    "en",
    "zh",
    "ko",
  ] as const)("keeps %s settings free of implementation terminology", (locale) => {
    const labels = academicLabels[locale];
    const settingsCopy = [
      labels.runtimeProtocol,
      labels.connectionFailed,
      labels.marketHint,
      labels.permissionsDefault,
      labels.settingsDescription,
      labels.connectForSkills,
      labels.connect,
      labels.connected,
      labels.keyHint,
      labels.personalPromptHint,
      labels.empty,
      labels.disclosure,
      labels.placeholder,
    ].join(" ");
    expect(settingsCopy).not.toMatch(
      /runtime|metadata|registry|registered|框架|运行时|元信息|注册表|레지스트리|런타임|메타데이터/i,
    );
    expect(Object.keys(labels).sort()).toEqual(Object.keys(academicLabels.en).sort());
    for (const text of Object.values(labels)) expect(text.trim().length).toBeGreaterThan(0);
  });

  it("keeps storage and permission boundaries clear", () => {
    expect(academicLabels.en.keySaveFailed).toContain("SQLite");
    expect(academicLabels.en.disclosure).toContain("permission mode");
    expect(academicLabels.en.permissionsDefault).toContain("Restricted mode allows reading only");
    expect(academicLabels.en.marketHint).toContain("Skill scripts are not run");
  });
});
