import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { useAcademicAgent } from "@/features/agent";
import { THEMES } from "../lib/theme";
import { SettingsPage } from "./settings-page";
import { ThemeGrid } from "./theme-grid";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }),
}));

vi.mock("@phosphor-icons/react", () => ({
  ArrowCounterClockwiseIcon: () => null,
  ArrowLeftIcon: () => null,
  ArrowSquareOutIcon: () => null,
  CircleNotchIcon: () => null,
  CaretDownIcon: () => null,
  CheckIcon: () => null,
  FileTextIcon: () => null,
  GearIcon: () => null,
  KeyboardIcon: () => null,
  MagnifyingGlassIcon: () => null,
  MinusIcon: () => null,
  PlusIcon: () => null,
  RobotIcon: () => null,
  SparkleIcon: () => null,
  TerminalIcon: () => null,
  XIcon: () => null,
}));

vi.mock("@/features/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/agent")>()),
  AcademicAgentSettings: () => null,
  DEFAULT_ACADEMIC_CONFIG: {},
  academicLabels: { en: { settings: "Agent settings" } },
}));

vi.mock("@/features/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: vi.fn(),
    locales: [{ id: "en", label: "English", nativeName: "English" }],
  }),
}));

describe("settings organization", () => {
  it("keeps one reset entry without duplicate settings headings", () => {
    const markup = renderToStaticMarkup(createElement(SettingsPage));
    expect(markup.match(/settings.resetDefaults/g)).toHaveLength(1);
    expect(markup).not.toContain("settings.resetAll");
    expect(markup).not.toContain("settings.title");
  });
  it("uses shared field styling for search, dropdowns, fonts, and numeric controls", () => {
    const markup = renderToStaticMarkup(createElement(SettingsPage));
    expect(markup).toMatch(/<input[^>]*class="settings-control settings-search-control w-full"/);
    expect(markup).toMatch(/<button[^>]*class="[^"]*settings-control settings-select/);
    expect(markup.match(/<select[^>]*class="settings-control settings-select"/g)).toHaveLength(3);
    expect(markup).toContain('class="settings-number-stepper"');
    expect(markup).toMatch(/<input[^>]*type="number"[^>]*aria-label="[^"]+"/);
  });

  it.each([
    { saved: true, error: null, color: "bg-success", text: "settings.autoSaved" },
    { saved: false, error: null, color: "bg-border", text: "Saving…" },
    { saved: false, error: "Storage full", color: "bg-error", text: "Auto-save failed" },
  ])("shows the correct auto-save indicator for $text", ({ saved, error, color, text }) => {
    function SettingsWithAgent() {
      const agent = useAcademicAgent({ directory: "/project" });
      return createElement(SettingsPage, {
        academicAgent: { ...agent, settingsSaved: saved, settingsSaveError: error },
      });
    }
    const markup = renderToStaticMarkup(createElement(SettingsWithAgent));
    expect(markup).toContain(`rounded-full ${color}`);
    expect(markup).toContain(text);
    if (error) expect(markup).toContain(`title="${error}"`);
  });

  it("shows general and editor controls in one category", () => {
    const markup = renderToStaticMarkup(createElement(SettingsPage));
    for (const key of [
      "settings.general.language",
      "settings.general.appearance",
      "settings.keybindings.vimMode",
      "settings.fonts.uiFontFamily",
      "settings.formatting.formatOnSave",
      "settings.display.fontSizeDesc",
      "settings.display.lineHeightDesc",
      "settings.editing.tabSizeDesc",
    ])
      expect(markup).toContain(key);
    expect(markup).not.toContain("settings.categories.editor");
    expect(markup).toContain("settings.categories.terminalGit");
  });

  it("routes old editor links to the merged category", () => {
    const markup = renderToStaticMarkup(createElement(SettingsPage, { initialTab: "editor" }));
    expect(markup).toContain("settings.general.language");
    expect(markup).toContain("settings.fonts.codeFontFamily");
    expect(markup).not.toContain("settings.categories.editor");
  });

  it("keeps every theme available in a three-row scroll area", () => {
    const markup = renderToStaticMarkup(
      createElement(ThemeGrid, {
        theme: "nord-light",
        onSelect: vi.fn(),
        label: "Appearance themes",
      }),
    );
    expect(markup).toContain('aria-label="Appearance themes"');
    expect(markup).toContain("max-h-[21.5rem]");
    expect(markup).toContain("auto-rows-[6.5rem]");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("grid-cols-2");
    expect(markup).toContain("sm:grid-cols-3");
    expect(markup.match(/<button /g)).toHaveLength(THEMES.length);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-label="Nord Light" aria-pressed="true"/);
    for (const theme of THEMES) expect(markup).toContain(theme.label);
  });
});
