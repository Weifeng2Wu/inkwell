export function readThemePalette() {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(`--${name}`).trim();
  return {
    background: color("background"),
    foreground: color("foreground"),
    surface: color("surface"),
    selection: color("surface-tertiary"),
    muted: color("muted"),
    border: color("border"),
    accent: color("accent"),
    success: color("success"),
    error: color("error"),
    warning: color("warning"),
    info: color("info"),
  };
}
