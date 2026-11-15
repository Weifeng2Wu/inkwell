import type { editor } from "monaco-editor";

/**
 * Syntax colours for manuscripts (LaTeX, BibTeX, Markdown), derived from the active theme's
 * tokens so the editor reads as a page of prose in every palette: body text stays the
 * foreground colour and only structure is tinted.
 */

/** The theme tokens the syntax colours are derived from, as `#rrggbb`. */
export type SyntaxPalette = {
  background: string;
  foreground: string;
  muted: string;
  accent: string;
  success: string;
  info: string;
};

export type SyntaxColors = {
  /** Commands and structure: the accent, toned down towards the text colour. */
  command: string;
  /** Citation keys, labels and links. */
  reference: string;
  /** Formulas. */
  math: string;
  /** Comments. */
  comment: string;
  /** Braces, brackets and separators. */
  quiet: string;
  /** Optional arguments and literal text. */
  secondary: string;
};

type Rgb = [number, number, number];

const HEX = /^#[\da-f]{6}$/i;

/**
 * Expands the short hex forms to `#rrggbb`, dropping any alpha. The production CSS build
 * minifies `#ffffff` to `#fff`, so a token read back from the page is not always six digits.
 * Anything that is not hex is returned unchanged.
 */
export function expandHex(color: string): string {
  const value = color.trim().toLowerCase();
  if (/^#[\da-f]{3,4}$/.test(value))
    return `#${[1, 2, 3].map((index) => value.charAt(index).repeat(2)).join("")}`;
  if (/^#[\da-f]{8}$/.test(value)) return value.slice(0, 7);
  return value;
}

function channels(color: string): Rgb {
  const channel = (offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16);
  return [channel(1), channel(3), channel(5)];
}

/** Blends `tint` into `base`; `amount` is the share of `tint`, from 0 to 1. */
export function mixColors(base: string, tint: string, amount: number): string {
  const from = channels(base);
  const to = channels(tint);
  const blend = (index: 0 | 1 | 2) =>
    Math.round(from[index] * (1 - amount) + to[index] * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${blend(0)}${blend(1)}${blend(2)}`;
}

function luminance(color: string): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = channels(color);
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Hue in degrees, or null for greys. */
function hue(color: string): number | null {
  const [red, green, blue] = channels(color);
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  if (delta < 8) return null;
  const sector =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return (sector * 60 + 360) % 360;
}

function hueDistance(first: string, second: string): number {
  const a = hue(first);
  const b = hue(second);
  if (a === null || b === null) return 180;
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

/** Moves a colour towards the text colour until it is legible on the background. */
function legible(color: string, palette: SyntaxPalette, minimum: number): string {
  let result = color;
  for (let step = 1; step <= 10 && contrastRatio(result, palette.background) < minimum; step++)
    result = mixColors(color, palette.foreground, step / 10);
  return result;
}

/** Whether every token needed for the syntax colours is a `#rrggbb` value. */
export function isSyntaxPalette(palette: Partial<SyntaxPalette>): palette is SyntaxPalette {
  return [
    palette.background,
    palette.foreground,
    palette.muted,
    palette.accent,
    palette.success,
    palette.info,
  ].every((color) => typeof color === "string" && HEX.test(color));
}

export function syntaxColors(palette: SyntaxPalette): SyntaxColors {
  const { background, foreground, muted, accent, success, info } = palette;
  // Formulas take the hue that is easier to tell apart from the accent.
  const formula = hueDistance(accent, success) >= 40 ? success : info;
  return {
    command: legible(mixColors(foreground, accent, 0.6), palette, 4.5),
    reference: legible(accent, palette, 4.5),
    math: legible(mixColors(foreground, formula, 0.7), palette, 4.5),
    comment: legible(muted, palette, 3.5),
    quiet: legible(mixColors(background, muted, 0.8), palette, 3),
    secondary: mixColors(foreground, muted, 0.55),
  };
}

type Rule = editor.ITokenThemeRule;

/**
 * Token rules for the manuscript languages. Token names end in the language (`.latex`,
 * `.bib`, `.md`), so these never recolour code in other languages.
 */
export function syntaxRules(palette: SyntaxPalette): Rule[] {
  const colors = syntaxColors(palette);
  const hex = (color: string) => color.slice(1);
  const rule = (token: string, color: string, fontStyle = ""): Rule => ({
    token,
    foreground: hex(color),
    fontStyle,
  });
  const text = (token: string, fontStyle: string) => rule(token, palette.foreground, fontStyle);
  return [
    // LaTeX (`latex-grammar.ts`)
    rule("comment.latex", colors.comment, "italic"),
    rule("keyword.latex", colors.command),
    rule("name.latex", colors.command),
    rule("reference.latex", colors.reference),
    rule("math.latex", colors.math),
    rule("delimiter.latex", colors.quiet),
    rule("attribute.latex", colors.secondary),
    rule("verbatim.latex", colors.secondary),
    rule("escape.latex", colors.secondary),
    text("heading.latex", "bold"),
    text("strong.latex", "bold"),
    text("emphasis.latex", "italic"),

    // BibTeX (`bibtex-grammar.ts`)
    rule("comment.bib", colors.comment, "italic"),
    rule("keyword.bib", colors.command, "bold"),
    rule("reference.bib", colors.reference),
    rule("attribute.bib", colors.command),
    rule("delimiter.bib", colors.quiet),
    rule("variable.bib", colors.secondary),
    rule("escape.bib", colors.secondary),

    // Markdown (Monaco's own grammar): headings and list markers are `keyword`, inline code
    // is `variable`, fenced code is `string` around `variable.source`.
    text("keyword.md", "bold"),
    text("keyword.table.header.md", "bold"),
    rule("keyword.table.left.md", colors.quiet),
    rule("keyword.table.middle.md", colors.quiet),
    rule("keyword.table.right.md", colors.quiet),
    rule("meta.separator.md", colors.quiet),
    rule("comment.md", colors.comment, "italic"),
    rule("comment.content.md", colors.comment, "italic"),
    rule("string.md", colors.secondary),
    rule("string.link.md", colors.reference),
    rule("string.target.md", colors.secondary),
    rule("string.escape.md", colors.secondary),
    rule("escape.md", colors.secondary),
    rule("variable.md", colors.command),
    rule("variable.source.md", colors.secondary),
    rule("tag.md", colors.command),
    rule("attribute.name.html.md", colors.secondary),
    rule("string.html.md", colors.secondary),
    rule("delimiter.html.md", colors.quiet),
    text("strong.md", "bold"),
    text("emphasis.md", "italic"),
  ];
}
