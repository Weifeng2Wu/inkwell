import { describe, expect, it, vi } from "vitest";
import { preferredLocale, resolveInitialLocale, supportedLocale } from "./locale-detection";

describe("first-launch language selection", () => {
  it.each([
    ["zh-CN", "zh"],
    ["zh-TW", "zh"],
    ["zh-Hant-HK", "zh"],
    ["ko-KR", "ko"],
    ["ko_KR.UTF-8", "ko"],
    ["en-US", "en"],
    [" ZH_cn ", "zh"],
    ["ja-JP", undefined],
    [null, undefined],
  ])("maps %s to %s", (input, expected) => {
    expect(supportedLocale(input)).toBe(expected);
  });
  it("uses the first supported language in preference order", () => {
    expect(preferredLocale(["fr-FR", "ko-KR", "en-US"])).toBe("ko");
    expect(preferredLocale(["en-US", "zh-CN"])).toBe("en");
    expect(preferredLocale([])).toBe("en");
    expect(preferredLocale(["ja-JP", "fr-FR"])).toBe("en");
  });
  it.each([
    "en",
    "zh",
    "ko",
  ])("preserves manually saved %s without requesting system language", async (saved) => {
    const readSystemLocale = vi.fn(async () => "ko-KR");
    expect(await resolveInitialLocale({ saved, languages: ["zh-CN"], readSystemLocale })).toBe(
      saved,
    );
    expect(readSystemLocale).not.toHaveBeenCalled();
  });
  it("uses native system locale ahead of WebView language", async () => {
    expect(
      await resolveInitialLocale({
        saved: null,
        languages: ["en-US"],
        readSystemLocale: async () => "zh-CN",
      }),
    ).toBe("zh");
  });
  it("falls back to browser preferences when native locale is unavailable", async () => {
    for (const readSystemLocale of [
      async () => null,
      async () => "ja-JP",
      async () => {
        throw new Error("IPC unavailable");
      },
    ]) {
      expect(
        await resolveInitialLocale({ saved: null, languages: ["ko-KR"], readSystemLocale }),
      ).toBe("ko");
    }
  });
  it("ignores invalid stored values and works without native APIs", async () => {
    expect(await resolveInitialLocale({ saved: "invalid", languages: ["zh-TW"] })).toBe("zh");
    expect(await resolveInitialLocale({ saved: null, languages: [] })).toBe("en");
  });
});
