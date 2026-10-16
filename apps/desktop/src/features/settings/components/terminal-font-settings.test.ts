import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { DEFAULT_EDITOR_SETTINGS } from "../lib/editor-settings";
import { useSystemFonts } from "../lib/use-system-fonts";
import { FontSettings } from "./font-settings";
import { TerminalFontSettings } from "./terminal-font-settings";

vi.mock("../lib/use-system-fonts", () => ({ useSystemFonts: vi.fn() }));

function renderTerminalFont(value = "") {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(TerminalFontSettings, { value, onChange: vi.fn() }),
    ),
  );
}

describe("terminal font selector", () => {
  beforeEach(() => {
    vi.mocked(useSystemFonts).mockReturnValue({
      fonts: ["Consolas", "FiraCode Nerd Font Mono", "Microsoft YaHei"],
      status: "ready",
      retry: vi.fn(),
    });
  });

  it("offers terminal-appropriate presets and installed system fonts", () => {
    const markup = renderTerminalFont();
    expect(markup).toContain('<option value="" selected="">Auto monospace (recommended)</option>');
    expect(markup).toContain('<option value="geist-mono">Geist Mono</option>');
    expect(markup).toContain('<option value="monospace">System monospace</option>');
    expect(markup).toContain('<option value="Consolas">Consolas</option>');
    expect(markup).toContain("Installed system fonts");
    expect(markup).not.toContain('value="serif"');
    expect(markup).not.toContain('type="text"');
    expect(markup).not.toContain("The quick brown fox");
  });

  it("selects an installed font without changing the editor font preferences", () => {
    expect(renderTerminalFont("Consolas")).toContain('<option value="Consolas" selected="">');
    expect(DEFAULT_EDITOR_SETTINGS.codeFontFamily).toBe("monospace");
  });

  it("preserves a saved custom font even when it is not installed on the current system", () => {
    expect(renderTerminalFont("Legacy Terminal Font")).toContain(
      '<option value="Legacy Terminal Font" selected="">Legacy Terminal Font</option>',
    );
  });

  it("retains presets and shows a retry action when discovery fails", () => {
    vi.mocked(useSystemFonts).mockReturnValue({ fonts: [], status: "error", retry: vi.fn() });
    const markup = renderTerminalFont();
    expect(markup).toContain("Geist Mono");
    expect(markup).toContain("Could not load system fonts");
    expect(markup).toContain(">Retry</button>");
  });

  it("keeps the three editor font selectors and their shared system-font list", () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(FontSettings, { settings: DEFAULT_EDITOR_SETTINGS, onChange: vi.fn() }),
      ),
    );
    expect(markup.match(/<select /g)).toHaveLength(3);
    expect(markup).toContain("Interface font");
    expect(markup).toContain("Body text font");
    expect(markup).toContain("Code font");
    expect(markup).toContain("Consolas");
  });
});
