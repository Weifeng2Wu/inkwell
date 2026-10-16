import type { EditorSettings } from "./editor-settings";

const CJK_MONO_FONTS = [
  '"Maple Mono NF CN"',
  '"Maple Mono SC NF"',
  '"Sarasa Mono SC"',
  '"LXGW WenKai Mono"',
  '"Noto Sans Mono CJK SC"',
  '"Source Han Mono SC"',
  '"WenQuanYi Zen Hei Mono"',
];

const CJK_SANS_FALLBACK_FONTS = [
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei UI"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
];

const APPLE_GOOGLE_MONO_FONTS = [
  '"SF Mono"',
  "SFMono-Regular",
  '"SF Pro Mono"',
  '"Google Sans Code"',
  '"Roboto Mono"',
  "var(--font-geist-mono)",
  "ui-monospace",
  "Menlo",
  "Consolas",
  '"Liberation Mono"',
  '"Courier New"',
];

const TERMINAL_NERD_MONO_FONTS = [
  '"FiraCode Nerd Font Mono"',
  '"FiraCode Nerd Font"',
  '"Fira Code Nerd Font Mono"',
  '"Fira Code Nerd Font"',
  '"JetBrainsMono Nerd Font Mono"',
  '"JetBrainsMono Nerd Font"',
  '"MesloLGS NF"',
  '"Hack Nerd Font Mono"',
  '"CaskaydiaCove Nerd Font Mono"',
  '"Symbols Nerd Font Mono"',
];

export const EDITOR_MONO_FONT_FAMILY = [
  ...APPLE_GOOGLE_MONO_FONTS,
  ...CJK_MONO_FONTS,
  ...CJK_SANS_FALLBACK_FONTS,
  "monospace",
].join(", ");

export const TERMINAL_MONO_FONT_FAMILY = [
  ...TERMINAL_NERD_MONO_FONTS,
  ...APPLE_GOOGLE_MONO_FONTS,
  ...CJK_MONO_FONTS,
  ...CJK_SANS_FALLBACK_FONTS,
  "monospace",
].join(", ");

export function resolveMonoFontFamily(customFontFamily?: string | null): string {
  const trimmedFontFamily = customFontFamily?.trim();
  if (!trimmedFontFamily) {
    return EDITOR_MONO_FONT_FAMILY;
  }

  return `${trimmedFontFamily}, ${EDITOR_MONO_FONT_FAMILY}`;
}

export const FONT_PRESETS = ["system-ui", "geist", "serif", "monospace"] as const;

export function resolveFontFamily(value: string): string {
  switch (value) {
    case "system-ui":
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    case "geist":
      return "var(--font-geist-sans), system-ui, sans-serif";
    case "serif":
      return 'ui-serif, Georgia, "Noto Serif CJK SC", "Songti SC", SimSun, serif';
    case "monospace":
      return EDITOR_MONO_FONT_FAMILY;
    default:
      return value.trim()
        ? `${quoteFontFamilyName(value)}, system-ui, sans-serif`
        : EDITOR_MONO_FONT_FAMILY;
  }
}

export function resolveEditorFontFamily(
  settings: Partial<EditorSettings> | undefined,
  language: string,
): string {
  const isText = ["latex", "tex", "markdown", "md", "plaintext", "text", "txt"].includes(
    language.toLowerCase(),
  );
  const selected = isText ? settings?.textFontFamily : settings?.codeFontFamily;
  return resolveFontFamily(
    selected ?? settings?.fontFamily ?? (isText ? "system-ui" : "monospace"),
  );
}

function normalizeFontFamilyName(fontFamily: string): string {
  return fontFamily.replaceAll('"', "").replaceAll("'", "").trim().toLowerCase();
}

function quoteFontFamilyName(fontFamily: string): string {
  const trimmedFontFamily = fontFamily.trim();
  if (
    !trimmedFontFamily ||
    trimmedFontFamily.includes(",") ||
    trimmedFontFamily.startsWith("var(")
  ) {
    return trimmedFontFamily;
  }

  if (
    (trimmedFontFamily.startsWith('"') && trimmedFontFamily.endsWith('"')) ||
    (trimmedFontFamily.startsWith("'") && trimmedFontFamily.endsWith("'"))
  ) {
    return trimmedFontFamily;
  }

  return `"${trimmedFontFamily.replaceAll('"', '\\"')}"`;
}

export function resolveTerminalFontFamily(
  customFontFamily?: string | null,
  geistMonoFamily = '"Geist Mono"',
): string {
  const fallback = TERMINAL_MONO_FONT_FAMILY.replace("var(--font-geist-mono)", geistMonoFamily);
  const trimmedFontFamily = customFontFamily?.trim();
  if (!trimmedFontFamily) {
    return fallback;
  }
  if (trimmedFontFamily === "geist-mono") {
    return `${geistMonoFamily}, ${fallback}`;
  }
  if (trimmedFontFamily === "monospace") {
    return `ui-monospace, ${EDITOR_MONO_FONT_FAMILY.replace("var(--font-geist-mono)", geistMonoFamily)}`;
  }

  const normalizedName = normalizeFontFamilyName(trimmedFontFamily);
  const isFiraCodeNerdFont =
    normalizedName === "firacode nerd font" ||
    normalizedName === "firacode nerd font mono" ||
    normalizedName === "firacode nerd font propo" ||
    normalizedName === "fira code nerd font" ||
    normalizedName === "fira code nerd font mono" ||
    normalizedName === "fira code nerd font propo";

  if (isFiraCodeNerdFont) {
    return `"FiraCode Nerd Font Mono", "FiraCode Nerd Font", ${fallback}`;
  }

  return `${quoteFontFamilyName(trimmedFontFamily)}, ${fallback}`;
}
