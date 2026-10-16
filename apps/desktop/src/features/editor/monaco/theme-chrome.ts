import { readThemePalette } from "@/features/settings";

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

export function editorChromeColors(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const palette = readThemePalette();
  if (!palette.background || !palette.foreground) return {};
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
