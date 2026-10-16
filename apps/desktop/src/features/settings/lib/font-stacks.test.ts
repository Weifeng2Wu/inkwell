import { describe, expect, it } from "vitest";
import {
  FONT_PRESETS,
  resolveEditorFontFamily,
  resolveFontFamily,
  resolveTerminalFontFamily,
} from "@/features/settings/lib/font-stacks";

describe("font preferences", () => {
  it("resolves all four presets", () => {
    for (const preset of FONT_PRESETS) {
      expect(resolveFontFamily(preset)).not.toBe("");
    }
    expect(resolveFontFamily("system-ui")).toContain("system-ui");
    expect(resolveFontFamily("geist")).toContain("var(--font-geist-sans)");
    expect(resolveFontFamily("serif")).toContain("serif");
    expect(resolveFontFamily("monospace")).toContain("monospace");
  });

  it("quotes installed font family names and retains fallbacks", () => {
    expect(resolveFontFamily("Microsoft YaHei")).toBe('"Microsoft YaHei", system-ui, sans-serif');
    expect(resolveFontFamily("宋体")).toBe('"宋体", system-ui, sans-serif');
  });

  it("retains legacy custom font stacks", () => {
    expect(resolveFontFamily('"Custom Font", monospace')).toContain('"Custom Font", monospace');
  });

  it("selects text fonts only for document languages", () => {
    const settings = {
      uiFontFamily: "geist",
      textFontFamily: "serif",
      codeFontFamily: "monospace",
    };
    for (const language of ["latex", "tex", "markdown", "md", "plaintext", "txt"]) {
      expect(resolveEditorFontFamily(settings, language)).toBe(resolveFontFamily("serif"));
    }
    for (const language of ["python", "typescript", "json", "bibtex", "rust"]) {
      expect(resolveEditorFontFamily(settings, language)).toBe(resolveFontFamily("monospace"));
    }
  });

  it("keeps interface, text and code choices independent", () => {
    const settings = { uiFontFamily: "geist", textFontFamily: "宋体", codeFontFamily: "Consolas" };
    expect(resolveEditorFontFamily(settings, "latex")).toContain('"宋体"');
    expect(resolveEditorFontFamily(settings, "python")).toContain('"Consolas"');
    expect(resolveEditorFontFamily(settings, "python")).not.toContain("宋体");
  });

  it("handles legacy settings and missing preferences", () => {
    expect(resolveEditorFontFamily({ fontFamily: "Custom Font" }, "latex")).toContain(
      '"Custom Font"',
    );
    expect(resolveEditorFontFamily(undefined, "latex")).toBe(resolveFontFamily("system-ui"));
    expect(resolveEditorFontFamily(undefined, "javascript")).toBe(resolveFontFamily("monospace"));
  });
});

describe("resolveTerminalFontFamily", () => {
  it("keeps auto mode's Nerd Font fallbacks without passing CSS variables to canvas", () => {
    const resolved = resolveTerminalFontFamily("");
    expect(resolved).toContain('"FiraCode Nerd Font Mono"');
    expect(resolved).not.toContain("var(");
  });

  it("resolves the Geist Mono preset to its actual bundled font family", () => {
    expect(resolveTerminalFontFamily("geist-mono", '"Bundled Geist Mono"')).toMatch(
      /^"Bundled Geist Mono",/,
    );
  });

  it("uses a generic system monospace family instead of quoting it as a font name", () => {
    expect(resolveTerminalFontFamily("monospace")).toMatch(/^ui-monospace,/);
    expect(resolveTerminalFontFamily("monospace")).not.toContain('"monospace"');
  });

  it("retains legacy font stacks", () => {
    expect(resolveTerminalFontFamily('"Custom Mono", Consolas')).toMatch(
      /^"Custom Mono", Consolas,/,
    );
  });

  it("prefers the FiraCode Nerd Font Mono face for FiraCode Nerd Font input", () => {
    expect(
      resolveTerminalFontFamily("FiraCode Nerd Font").startsWith('"FiraCode Nerd Font Mono"'),
    ).toBe(true);
  });

  it("normalizes FiraCode Nerd Font Mono input to a quoted mono face", () => {
    expect(
      resolveTerminalFontFamily("FiraCode Nerd Font Mono").startsWith('"FiraCode Nerd Font Mono"'),
    ).toBe(true);
  });

  it("maps the proportional FiraCode Nerd Font face back to mono for terminal use", () => {
    expect(
      resolveTerminalFontFamily("FiraCode Nerd Font Propo").startsWith('"FiraCode Nerd Font Mono"'),
    ).toBe(true);
  });

  it("quotes simple custom font family names with spaces", () => {
    expect(resolveTerminalFontFamily("JetBrains Mono").startsWith('"JetBrains Mono"')).toBe(true);
  });
});
