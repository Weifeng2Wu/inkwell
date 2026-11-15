import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  expandHex,
  isSyntaxPalette,
  type SyntaxPalette,
  syntaxColors,
  syntaxRules,
} from "./syntax-theme";

const light: SyntaxPalette = {
  background: "#ffffff",
  foreground: "#0f172a",
  muted: "#64748b",
  accent: "#4f46e5",
  success: "#16a34a",
  info: "#2563eb",
};
const dark: SyntaxPalette = {
  background: "#0b0f19",
  foreground: "#e6e8ec",
  muted: "#8b93a1",
  accent: "#818cf8",
  success: "#4ade80",
  info: "#60a5fa",
};

describe("expandHex", () => {
  it("expands the short forms a CSS minifier produces", () => {
    expect(expandHex("#fff")).toBe("#ffffff");
    expect(expandHex(" #0AF ")).toBe("#00aaff");
    expect(expandHex("#0af8")).toBe("#00aaff");
    expect(expandHex("#11223344")).toBe("#112233");
    expect(expandHex("#4f46e5")).toBe("#4f46e5");
  });

  it("leaves other notations alone", () => {
    expect(expandHex("red")).toBe("red");
    expect(expandHex("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
  });
});

describe("syntax palette", () => {
  it("rejects a palette that is not fully #rrggbb", () => {
    expect(isSyntaxPalette(light)).toBe(true);
    expect(isSyntaxPalette({ ...light, background: "#fff" })).toBe(false);
    expect(isSyntaxPalette({ ...light, info: undefined })).toBe(false);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("keeps every %s colour legible on the background", (_name, palette) => {
    const colors = syntaxColors(palette);
    for (const color of [colors.command, colors.reference, colors.math])
      expect(contrastRatio(color, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.comment, palette.background)).toBeGreaterThanOrEqual(3.5);
    expect(contrastRatio(colors.quiet, palette.background)).toBeGreaterThanOrEqual(3);
    // Braces recede behind the text; formulas differ from commands.
    expect(contrastRatio(colors.quiet, palette.background)).toBeLessThan(
      contrastRatio(palette.foreground, palette.background),
    );
    expect(colors.math).not.toBe(colors.command);
  });

  it("styles headings in the text colour and tints only structure", () => {
    const rules = syntaxRules(light);
    const rule = (token: string) => rules.find((candidate) => candidate.token === token);
    expect(rule("heading.latex")).toMatchObject({ foreground: "0f172a", fontStyle: "bold" });
    expect(rule("comment.latex")?.fontStyle).toBe("italic");
    expect(rule("reference.latex")?.foreground).toBe("4f46e5");
    expect(rule("keyword.latex")?.foreground).not.toBe("0f172a");
    // Scoped to the manuscript languages, so code keeps its own palette.
    expect(rules.every(({ token }) => /\.(latex|bib|md)$/.test(token))).toBe(true);
  });
});
