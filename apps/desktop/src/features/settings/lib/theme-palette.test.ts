import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editorChromeColors, editorDiffColors } from "../../editor/monaco/theme-chrome";
import { THEMES } from "./theme";
import { readThemePalette } from "./theme-palette";

vi.mock("@/features/settings", async () => import("./theme-palette"));

const stylesheet = readFileSync(new URL("../../../styles/themes.css", import.meta.url), "utf8");

afterEach(() => vi.unstubAllGlobals());

describe("embedded editor theme consistency", () => {
  it.each(THEMES)("uses $id tokens for embedded surfaces and widgets", ({ id }) => {
    const block = stylesheet.match(new RegExp(`\\.${id}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
    const tokens = new Map(
      [...block.matchAll(/(--[a-z-]+):\s*(#[a-f\d]{6})/g)].map((match) => [match[1], match[2]]),
    );
    const root = {};
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("getComputedStyle", (element: unknown) => {
      expect(element).toBe(root);
      return { getPropertyValue: (name: string) => tokens.get(name) ?? "" };
    });
    const palette = readThemePalette();
    expect(palette.background).toBe(tokens.get("--background"));
    expect(palette.foreground).toBe(tokens.get("--foreground"));
    for (const color of Object.values(palette)) expect(color).toMatch(/^#[a-f\d]{6}$/);
    const chrome = editorChromeColors();
    expect(chrome["editor.background"]).toBe(palette.background);
    expect(chrome["editorGutter.background"]).toBe(palette.background);
    expect(chrome["editorWidget.background"]).toBe(palette.surface);
    expect(chrome["editorSuggestWidget.border"]).toBe(palette.border);
    expect(chrome["diffEditor.border"]).toBe(palette.border);
    const diff = editorDiffColors();
    const added = diff["diffEditor.insertedLineBackground"];
    const removed = diff["diffEditor.removedLineBackground"];
    expect(added).not.toBe(removed);
    expect(added).not.toBe(palette.background);
    expect(removed).not.toBe(palette.background);
    expect(diff["diffEditor.insertedTextBorder"]).toBe(`${palette.success}bb`);
    expect(diff["diffEditor.removedTextBorder"]).toBe(`${palette.error}bb`);
    expect(diff["diffEditor.insertedTextBackground"]).toBe(`${palette.success}55`);
    for (const color of Object.values(diff)) expect(color).toMatch(/^#[a-f\d]{6}([a-f\d]{2})?$/);
  });

  it("leaves native editor defaults intact during server rendering", () => {
    vi.stubGlobal("document", undefined);
    expect(editorChromeColors()).toEqual({});
    expect(editorDiffColors()).toEqual({});
  });
});
