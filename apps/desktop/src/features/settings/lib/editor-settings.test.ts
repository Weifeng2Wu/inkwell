import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_MINIMAP_SETTINGS,
} from "@/features/settings/lib/editor-settings";

describe("DEFAULT_MINIMAP_SETTINGS", () => {
  it("is disabled by default", () => {
    expect(DEFAULT_MINIMAP_SETTINGS.enabled).toBe(false);
  });

  it("has side set to right", () => {
    expect(DEFAULT_MINIMAP_SETTINGS.side).toBe("right");
  });
});

describe("DEFAULT_EDITOR_SETTINGS", () => {
  it("enables word wrap by default", () => {
    expect(DEFAULT_EDITOR_SETTINGS.wordWrap).toBe("on");
  });

  it("has vim mode off by default", () => {
    expect(DEFAULT_EDITOR_SETTINGS.vimMode).toBe(false);
  });

  it("has font size 14", () => {
    expect(DEFAULT_EDITOR_SETTINGS.fontSize).toBe(14);
  });

  it("uses default font stacks by default", () => {
    expect(DEFAULT_EDITOR_SETTINGS.fontFamily).toBe("");
    expect(DEFAULT_EDITOR_SETTINGS.terminalFontFamily).toBe("");
  });

  it("has tab size 2", () => {
    expect(DEFAULT_EDITOR_SETTINGS.tabSize).toBe(2);
  });

  it("has git auto-fetch interval of 120 seconds", () => {
    expect(DEFAULT_EDITOR_SETTINGS.gitAutoFetchIntervalSeconds).toBe(120);
  });

  it("has terminal shell mode set to auto", () => {
    expect(DEFAULT_EDITOR_SETTINGS.terminalShellMode).toBe("auto");
  });

  it("has terminal font defaults", () => {
    expect(DEFAULT_EDITOR_SETTINGS.terminalFontSize).toBe(13);
    expect(DEFAULT_EDITOR_SETTINGS.terminalLineHeight).toBe(1.4);
  });
});
