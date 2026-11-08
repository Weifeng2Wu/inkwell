import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { SettingsPage } from "./settings-page";

describe("settings navigation", () => {
  it("offers Google as the default in a dedicated translation category, without resetting editor preferences", () => {
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SettingsPage, { initialTab: "translation" })),
    );
    expect(markup).toContain(">Google<");
    expect(markup).not.toContain("Basic translation needs no API key");
    expect(markup).not.toContain("keyless");
    expect(markup).not.toContain("Only explicit Translate");
    expect(markup).not.toContain("Channel lights reflect");
    expect(markup).not.toContain("translation.description");
    expect(markup).toContain("data-translation-provider");
    expect(markup).toContain('data-translation-status="idle"');
    expect(markup).not.toContain('type="password"');
    expect(markup).not.toContain("Reset defaults");
    expect(markup).not.toContain("Optional official Google Cloud");
  });
  it("keeps software updates in a separate category without editor reset controls", () => {
    const general = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SettingsPage)),
    );
    const updates = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SettingsPage, { initialTab: "updates" })),
    );
    expect(general).toContain("Software updates");
    expect(general).not.toContain('id="app-updates-title"');
    expect(updates).toContain('id="app-updates-title"');
    expect(updates).toContain("Check for updates");
    expect(updates).not.toContain("Reset defaults");
    expect(updates).not.toContain(
      'id="automatic-updates" aria-describedby="automatic-updates-description"',
    );
    expect(updates).toContain("app-updates-unavailable");
  });
  it.each([
    { step: 4, section: 'data-tour-step="ai"' },
    { step: 5, section: 'data-settings-section="layout"' },
    { step: 6, section: 'data-tour-step="search"' },
    { step: 7, section: 'data-tour-step="skills"' },
    { step: 8, section: 'data-settings-section="github"' },
  ])("opens the actual settings category for guide step $step", ({ step, section }) => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(SettingsPage, {
          quickStart: {
            step,
            saveError: false,
            onNext: () => {},
            onBack: () => {},
            onClose: () => {},
          },
        }),
      ),
    );
    expect(markup).toContain("data-settings-page");
    expect(markup).toContain(section);
    expect(markup).toContain('id="settings-guide-heading"');
    expect(markup).not.toContain('role="dialog"');
  });

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
