import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { SettingsPage } from "./settings-page";

describe("settings navigation", () => {
  it("no longer offers LaTeX and build settings", () => {
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SettingsPage)),
    );
    expect(markup).not.toContain("LaTeX &amp; Build");
    expect(markup).not.toContain("Main File");
    expect(markup).toContain("General");
    expect(markup).toContain("Editor");
  });

  it("offers GitHub authentication controls in Terminal and Git settings", () => {
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SettingsPage, { initialTab: "terminalGit" })),
    );
    expect(markup).toContain("GitHub");
    expect(markup).toContain("Checking authentication");
    expect(markup).not.toContain("Refresh status");
    expect(markup).not.toContain("Sign in to GitHub");
    expect(markup).not.toContain("Local version control works without signing in");
  });
});
