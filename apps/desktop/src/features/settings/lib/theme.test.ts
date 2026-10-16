import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isDarkTheme, THEME_IDS, THEMES } from "./theme";

const stylesheet = readFileSync(new URL("../../../styles/themes.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");
const lightCounterparts = ["caffeine-light", "tokyo-day", "catppuccin-latte", "nord-light"];

function themeTokens(identifier: string) {
  const block = stylesheet.match(new RegExp(`\\.${identifier}\\s*\\{([^}]+)\\}`))?.[1];
  if (!block) throw new Error(`Missing theme: ${identifier}`);
  return {
    block,
    tokens: Object.fromEntries(
      [...block.matchAll(/--([a-z-]+):\s*(#[a-f\d]{6})/g)].map((match) => [match[1], match[2]]),
    ) as Record<string, string>,
  };
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function contrast(first: string, second: string) {
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

describe("theme palettes", () => {
  it("keeps existing selections and adds four light counterparts", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(new Set(THEME_IDS).size).toBe(THEMES.length);
    expect(THEMES.filter((theme) => theme.mode === "light")).toHaveLength(5);
    expect(THEMES.filter((theme) => theme.mode === "dark")).toHaveLength(5);
    for (const identifier of [
      "light",
      "dark",
      "caffeine",
      "tokyo-night",
      "catppuccin",
      "nord",
      ...lightCounterparts,
    ])
      expect(THEME_IDS).toContain(identifier);
    expect(isDarkTheme(undefined)).toBe(false);
  });

  it("defines a complete token set, matching color scheme and preview swatches for every palette", () => {
    const requiredTokens = Object.keys(themeTokens("light").tokens).sort();
    for (const theme of THEMES) {
      const { block, tokens } = themeTokens(theme.id);
      expect(Object.keys(tokens).sort(), theme.id).toEqual(requiredTokens);
      expect(block).toContain(`color-scheme: ${theme.mode};`);
      expect(tokens.background, theme.id).toBe(theme.swatch[0]);
      expect(
        [tokens.surface, tokens["surface-secondary"], tokens["surface-tertiary"]],
        theme.id,
      ).toContain(theme.swatch[1]);
      expect(tokens.accent, theme.id).toBe(theme.swatch[2]);
      expect(isDarkTheme(theme.id), theme.id).toBe(theme.mode === "dark");
    }
  });

  it("activates Tailwind dark utilities for dark palettes only", () => {
    const variant = globals.match(/@custom-variant dark\s*\([\s\S]*?\);/)?.[0] ?? "";
    for (const theme of THEMES)
      expect(new RegExp(`\\.${theme.id}(?=[\\s,])`).test(variant), theme.id).toBe(
        theme.mode === "dark",
      );
  });

  it("keeps text and action labels readable in each new light palette", () => {
    for (const identifier of lightCounterparts) {
      const { tokens } = themeTokens(identifier);
      for (const surface of ["background", "surface", "surface-secondary"])
        for (const text of ["foreground", "foreground-secondary", "muted", "muted-foreground"])
          expect(
            contrast(tokens[text] ?? "", tokens[surface] ?? ""),
            `${identifier}: ${text} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
      for (const action of ["accent", "success", "warning", "info"])
        expect(
          contrast(tokens[action] ?? "", tokens[`${action}-foreground`] ?? ""),
          `${identifier}: ${action}`,
        ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
