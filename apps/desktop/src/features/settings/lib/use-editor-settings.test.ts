import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_SETTINGS } from "./editor-settings";
import { migrateSettings } from "./use-editor-settings";

describe("font settings migration", () => {
  it("fills new preferences when saved settings predate font selection", () => {
    const migrated = migrateSettings({ fontFamily: "" });
    expect(migrated.uiFontFamily).toBe(DEFAULT_EDITOR_SETTINGS.uiFontFamily);
    expect(migrated.textFontFamily).toBe(DEFAULT_EDITOR_SETTINGS.textFontFamily);
    expect(migrated.codeFontFamily).toBe(DEFAULT_EDITOR_SETTINGS.codeFontFamily);
  });

  it("migrates a custom editor stack without affecting UI or terminal fonts", () => {
    const migrated = migrateSettings({
      fontFamily: "Custom Mono",
      terminalFontFamily: "Terminal Mono",
    });
    expect(migrated.textFontFamily).toBe("Custom Mono");
    expect(migrated.codeFontFamily).toBe("Custom Mono");
    expect(migrated.uiFontFamily).toBe("system-ui");
    expect(migrated.terminalFontFamily).toBe("Terminal Mono");
  });

  it("preserves independent choices over the legacy preference", () => {
    const migrated = migrateSettings({
      fontFamily: "Old Font",
      uiFontFamily: "geist",
      textFontFamily: "serif",
      codeFontFamily: "Consolas",
    });
    expect(migrated.uiFontFamily).toBe("geist");
    expect(migrated.textFontFamily).toBe("serif");
    expect(migrated.codeFontFamily).toBe("Consolas");
  });

  it("sanitizes invalid saved font choices", () => {
    const migrated = migrateSettings({
      uiFontFamily: 5,
      textFontFamily: null,
      codeFontFamily: "  ",
    });
    expect(migrated.uiFontFamily).toBe(DEFAULT_EDITOR_SETTINGS.uiFontFamily);
    expect(migrated.textFontFamily).toBe(DEFAULT_EDITOR_SETTINGS.textFontFamily);
    expect(migrated.codeFontFamily).toBe(DEFAULT_EDITOR_SETTINGS.codeFontFamily);
  });

  it("round trips preferences", () => {
    const choices = {
      ...DEFAULT_EDITOR_SETTINGS,
      uiFontFamily: "Arial",
      textFontFamily: "宋体",
      codeFontFamily: "Consolas",
    };
    expect(migrateSettings(JSON.parse(JSON.stringify(choices)))).toEqual(choices);
  });
});
