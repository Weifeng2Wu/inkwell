import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { ko } from "./locales/ko";
import { zh } from "./locales/zh";

describe("concise translation labels", () => {
  it.each([
    { locale: "en", dictionary: en },
    { locale: "zh", dictionary: zh },
    { locale: "ko", dictionary: ko },
  ])("keeps $locale service names and status labels free of explanatory suffixes", ({
    dictionary,
  }) => {
    for (const name of Object.values(dictionary.translation.providers)) {
      expect(name).not.toMatch(/[()（）]/);
      expect(name).not.toMatch(/keyless|免\s?key|兼容|网页|self-hosted|default/i);
    }
    expect(dictionary.translation.providers["google-free"]).toBe("Google");
    for (const label of Object.values(dictionary.translation.status))
      expect(label).not.toContain(" · ");
    expect(dictionary.translation.endpoint).not.toMatch(/[()（）]/);
  });
  it("uses 接口地址 consistently for translation endpoint fields", () => {
    expect(zh.translation.serviceUrl).toBe("接口地址");
    expect(zh.translation.endpoint).toBe("接口地址");
  });
});
