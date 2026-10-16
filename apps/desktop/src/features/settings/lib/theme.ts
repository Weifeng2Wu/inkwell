import { useTheme } from "next-themes";

/**
 * Theme registry.
 *
 * Every theme is a class applied to `<html>` by next-themes, and every theme
 * defines the full token set in `src/styles/themes.css`. Components must never
 * branch on a theme id — they read tokens instead. The only legitimate branch
 * is light vs. dark, which is what `useThemeMode` exists for: it also covers
 * the dark palettes, which a bare `resolvedTheme === "dark"` check would miss.
 */

export type ThemeMode = "light" | "dark";

export interface ThemeDefinition {
  id: string;
  label: string;
  mode: ThemeMode;
  /** Preview swatch: [background, surface, accent]. Mirrors `themes.css`. */
  swatch: readonly [string, string, string];
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "light",
    label: "Light",
    mode: "light",
    swatch: ["#ffffff", "#f1f5f9", "#4f46e5"],
  },
  {
    id: "dark",
    label: "Dark",
    mode: "dark",
    swatch: ["#0b0f19", "#171c27", "#818cf8"],
  },
  {
    id: "caffeine-light",
    label: "Caffeine Light",
    mode: "light",
    swatch: ["#fbf7f2", "#eee3d6", "#8c4a20"],
  },
  {
    id: "caffeine",
    label: "Caffeine",
    mode: "dark",
    swatch: ["#1c1714", "#2a211c", "#d98b4a"],
  },
  {
    id: "tokyo-day",
    label: "Tokyo Day",
    mode: "light",
    swatch: ["#f3f4fa", "#e1e6f1", "#3456a0"],
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    mode: "dark",
    swatch: ["#1a1b26", "#24283b", "#7aa2f7"],
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    mode: "light",
    swatch: ["#eff1f5", "#dce0e8", "#8839ef"],
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    mode: "dark",
    swatch: ["#1e1e2e", "#313244", "#cba6f7"],
  },
  {
    id: "nord-light",
    label: "Nord Light",
    mode: "light",
    swatch: ["#f4f6f9", "#e5e9f0", "#326b7e"],
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    swatch: ["#2e3440", "#434c5e", "#88c0d0"],
  },
] as const;

export const THEME_IDS: string[] = THEMES.map((theme) => theme.id);

export const DEFAULT_THEME = "light";

const DARK_THEME_IDS = new Set(
  THEMES.filter((theme) => theme.mode === "dark").map((theme) => theme.id),
);

/** Whether a theme id renders a dark UI. */
export function isDarkTheme(themeId: string | undefined): boolean {
  return themeId !== undefined && DARK_THEME_IDS.has(themeId);
}

/**
 * Resolves the active theme to a light/dark mode.
 *
 * Returns "light" while `resolvedTheme` is still undefined, which is the case
 * during SSR and on the first client render — matching the `light` default so
 * hydration stays consistent.
 */
export function useThemeMode(): ThemeMode {
  const { resolvedTheme } = useTheme();
  return isDarkTheme(resolvedTheme) ? "dark" : "light";
}
