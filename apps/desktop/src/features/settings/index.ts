// Settings feature — editor preferences, fonts, and the settings dialog.

export { SettingsDialog } from "./components/settings-dialog";
export { SettingsPage } from "./components/settings-page";
export * from "./lib/editor-settings";
export * from "./lib/font-stacks";
export * from "./lib/keyboard-shortcuts";
export { parseLayoutImage, parseLayoutPdf, requireLayoutConfig } from "./lib/layout-parser";
export * from "./lib/theme";
export { readThemePalette } from "./lib/theme-palette";
export * from "./lib/use-editor-settings";
export { useKeyboardShortcuts } from "./lib/use-keyboard-shortcuts";
