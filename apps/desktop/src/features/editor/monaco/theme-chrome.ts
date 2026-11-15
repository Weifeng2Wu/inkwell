import type { editor } from "monaco-editor";
import { readThemePalette as readRawPalette } from "@/features/settings";
import { expandHex, isSyntaxPalette, syntaxRules } from "./syntax-theme";

type Palette = ReturnType<typeof readRawPalette>;

/**
 * A colour as `#rrggbb`. Minified CSS hands back `#fff` or a colour name where the source
 * said `#ffffff`; a canvas resolves whatever the short-hex expansion does not cover.
 */
export function normalizeColor(color: string): string {
  const hex = expandHex(color);
  if (/^#[\da-f]{6}$/.test(hex) || !hex) return hex;
  try {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return hex;
    context.fillStyle = "#000000";
    context.fillStyle = hex;
    const resolved = String(context.fillStyle);
    return /^#[\da-f]{6}$/.test(resolved) && (resolved !== "#000000" || hex === "black")
      ? resolved
      : hex;
  } catch {
    return hex;
  }
}

/** The active theme's tokens, every colour normalised to `#rrggbb` where possible. */
function readThemePalette(): Palette {
  const palette = readRawPalette();
  for (const key of Object.keys(palette) as (keyof Palette)[])
    palette[key] = normalizeColor(palette[key]);
  return palette;
}

function blendColor(base: string, tint: string, amount: number) {
  const channels = [1, 3, 5].map((offset) => {
    const background = Number.parseInt(base.slice(offset, offset + 2), 16);
    const foreground = Number.parseInt(tint.slice(offset, offset + 2), 16);
    return Math.round(background * (1 - amount) + foreground * amount)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

export function editorDiffColors(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const palette = readThemePalette();
  if (
    ![palette.background, palette.success, palette.error].every((color) =>
      /^#[\da-f]{6}$/i.test(color),
    )
  )
    return {};
  const colors: Record<string, string> = {};
  for (const [kind, tint] of [
    ["inserted", palette.success],
    ["removed", palette.error],
  ]) {
    if (!tint) continue;
    colors[`diffEditor.${kind}LineBackground`] = blendColor(palette.background, tint, 0.24);
    colors[`diffEditor.${kind}TextBackground`] = `${tint}55`;
    colors[`diffEditor.${kind}TextBorder`] = `${tint}bb`;
    colors[`diffEditorGutter.${kind}LineBackground`] = blendColor(palette.background, tint, 0.48);
    colors[`diffEditorOverview.${kind}Foreground`] = tint;
  }
  return colors;
}

/** Token rules for LaTeX, BibTeX and Markdown in the active theme's colours. */
export function editorSyntaxRules(): editor.ITokenThemeRule[] {
  if (typeof document === "undefined") return [];
  const palette = readThemePalette();
  return isSyntaxPalette(palette) ? syntaxRules(palette) : [];
}

export function editorChromeColors(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const palette = readThemePalette();
  if (!palette.background || !palette.foreground) return {};
  // Alpha suffixes need `#rrggbb`; every bundled theme defines its tokens that way.
  const tint = (color: string, alpha: string) =>
    /^#[\da-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
  return {
    "editor.background": palette.background,
    "editor.foreground": palette.foreground,
    "editorGutter.background": palette.background,
    "editorLineNumber.foreground": palette.muted,
    "editorLineNumber.activeForeground": palette.foreground,
    "editorCursor.foreground": palette.accent,
    "editorCursor.background": palette.background,
    "editor.lineHighlightBackground": palette.surface,
    "editor.selectionBackground": palette.selection,
    "editor.inactiveSelectionBackground": palette.surface,
    "editorBracketMatch.background": tint(palette.accent, "1f"),
    "editorBracketMatch.border": tint(palette.accent, "66"),
    "editorIndentGuide.background1": palette.border,
    "editorIndentGuide.activeBackground1": palette.muted,
    "editorWhitespace.foreground": palette.border,
    "editorError.foreground": palette.error,
    "editorWarning.foreground": palette.warning,
    "editorInfo.foreground": palette.info,
    "editorLink.activeForeground": palette.accent,
    "editorOverviewRuler.border": palette.border,
    "editorWidget.background": palette.surface,
    "editorWidget.foreground": palette.foreground,
    "editorWidget.border": palette.border,
    "editorSuggestWidget.background": palette.surface,
    "editorSuggestWidget.foreground": palette.foreground,
    "editorSuggestWidget.border": palette.border,
    "editorSuggestWidget.selectedBackground": palette.selection,
    "editorSuggestWidget.highlightForeground": palette.accent,
    "editorHoverWidget.background": palette.surface,
    "editorHoverWidget.foreground": palette.foreground,
    "editorHoverWidget.border": palette.border,
    "minimap.background": palette.background,
    "diffEditor.border": palette.border,
    "diffEditor.diagonalFill": palette.surface,
  };
}
