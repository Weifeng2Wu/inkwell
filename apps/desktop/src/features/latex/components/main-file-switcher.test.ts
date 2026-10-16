import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { MainFileSwitcher } from "./main-file-switcher";

function renderSwitcher(
  overrides: { mainFile?: string | null; texFiles?: string[]; disabled?: boolean } = {},
) {
  const onSelect = vi.fn();
  const markup = renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(MainFileSwitcher, {
        mainFile: "main.tex",
        texFiles: ["main.tex", "chapters/appendix.tex"],
        onSelect,
        ...overrides,
      }),
    ),
  );
  return { markup, onSelect };
}

describe("main file toolbar switcher", () => {
  it("provides an accessible main-file switch button with the current project path", () => {
    const { markup, onSelect } = renderSwitcher();
    expect(markup).toContain('aria-label="Switch main file"');
    expect(markup).toContain('title="Main file: main.tex"');
    expect(markup).not.toContain('disabled=""');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the relative subdirectory path for the selected file", () => {
    const { markup } = renderSwitcher({ mainFile: "chapters/appendix.tex" });
    expect(markup).toContain('title="Main file: chapters/appendix.tex"');
  });

  it("disables switching when the project has no TeX files", () => {
    const { markup } = renderSwitcher({ texFiles: [], mainFile: null });
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('title="No .tex files found in the project."');
  });

  it("can disable switching while compilation is running", () => {
    const { markup } = renderSwitcher({ disabled: true });
    expect(markup).toContain('disabled=""');
  });

  it("does not present a stale main file as an available selection", () => {
    const { markup } = renderSwitcher({ mainFile: "deleted.tex" });
    expect(markup).toContain('title="Switch main file"');
    expect(markup).not.toContain("deleted.tex");
  });
});
