import { describe, expect, it } from "vitest";
import { fillLabel, posterLabels } from "./labels";

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe("poster labels", () => {
  const en = posterLabels("en");

  it.each(["zh", "ko"] as const)("%s has the same keys and placeholders as en", (locale) => {
    const labels = posterLabels(locale);
    expect(Object.keys(labels).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(labels)) {
      expect(text.trim(), key).not.toBe("");
      expect(placeholders(text), key).toEqual(placeholders(en[key as keyof typeof en]));
    }
  });

  it.each(["zh", "ko"] as const)("%s does not fall back to English", (locale) => {
    const labels = posterLabels(locale);
    const same = Object.keys(en).filter(
      (key) =>
        key !== "dimensions" && labels[key as keyof typeof en] === en[key as keyof typeof en],
    );
    expect(same).toEqual([]);
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    expect(fillLabel("{width} × {height} mm", { width: 841, height: "1,189" })).toBe(
      "841 × 1,189 mm",
    );
    expect(fillLabel("Failed: {error}", {})).toBe("Failed: {error}");
  });
});
