import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACADEMIC_CONFIG, readConfig } from "./academic-config";

afterEach(() => vi.unstubAllGlobals());

describe("Agent configuration defaults and migration", () => {
  it("uses ask permissions by default", () => {
    expect(DEFAULT_ACADEMIC_CONFIG.permissionMode).toBe("ask");
    expect(DEFAULT_ACADEMIC_CONFIG.protocol).toBe("openai");
    expect(DEFAULT_ACADEMIC_CONFIG.personalPrompt).toBe("");
    expect(DEFAULT_ACADEMIC_CONFIG.answerLanguage).toBe("zh");
  });
  it("preserves explicit permission choices in old configurations", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          provider: "fixture",
          model: "fixture",
          skillIds: [],
          allowRead: false,
          allowEdits: false,
        }),
    });
    const config = readConfig("project");
    expect(config.protocol).toBe("");
    expect(config.personalPrompt).toBe("");
    expect(config.answerLanguage).toBe("zh");
    expect(config.permissionMode).toBe("restricted");
  });
  it("never enables edits when reading was explicitly disabled", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({ ...DEFAULT_ACADEMIC_CONFIG, permissionMode: undefined, allowRead: false, allowEdits: true }),
    });
    expect(readConfig("project").permissionMode).toBe("restricted");
  });
  it("migrates legacy approval-gated editing without auto approving", () => {
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify({
          provider: "fixture",
          model: "fixture",
          skillIds: [],
          allowRead: true,
          allowEdits: true,
        }),
    });
    expect(readConfig("project").permissionMode).toBe("ask");
  });
  it.each(["restricted", "ask", "auto"] as const)("restores %s mode", (permissionMode) => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ ...DEFAULT_ACADEMIC_CONFIG, permissionMode }),
    });
    expect(readConfig("project").permissionMode).toBe(permissionMode);
  });
  it("falls back to restricted for invalid modes", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ ...DEFAULT_ACADEMIC_CONFIG, permissionMode: "invalid" }),
    });
    expect(readConfig("project").permissionMode).toBe("restricted");
  });
  it("restores protocol, endpoint, and preferences", () => {
    const config = {
      ...DEFAULT_ACADEMIC_CONFIG,
      protocol: "gemini",
      baseUrl: "https://example.com/v1beta",
      personalPrompt: "Reply concisely.",
      answerLanguage: "ko",
    };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(config) });
    expect(readConfig("project")).toEqual(config);
  });
});
