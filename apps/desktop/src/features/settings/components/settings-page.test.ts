import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GitSyncController } from "@/features/git";
import { I18nProvider } from "@/features/i18n";
import { DEFAULT_EDITOR_SETTINGS } from "../lib/editor-settings";
import { SettingsPage } from "./settings-page";

describe("automatic backup settings", () => {
  const render = (settings: Partial<typeof DEFAULT_EDITOR_SETTINGS>, gitSync?: GitSyncController) =>
    renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(SettingsPage, {
          initialTab: "terminalGit",
          editorSettings: { ...DEFAULT_EDITOR_SETTINGS, ...settings },
          onUpdateEditorSettings: () => {},
          gitSync,
        }),
      ),
    );

  it("is off by default and hides its options until enabled", () => {
    const markup = render({});
    expect(markup).toContain("Automatic backup");
    expect(markup).not.toContain("Commits all changes to the current branch on a schedule.");
    expect(markup).not.toContain("Files over 50 MB are skipped");
    expect(markup).toMatch(/aria-checked="false"[^>]*data-git-auto-backup="true"/);
    expect(markup).not.toContain("Backup interval");
    expect(markup).not.toContain("data-git-auto-backup-push");
    expect(markup).not.toContain("Back up now");
  });

  it("shows the interval and push switch when enabled", () => {
    const markup = render({ gitAutoBackupEnabled: true, gitAutoBackupPush: false });
    expect(markup).toMatch(/aria-checked="true"[^>]*data-git-auto-backup="true"/);
    expect(markup).toContain('aria-label="Backup interval"');
    expect(markup).toContain("Push after each backup");
    expect(markup).toMatch(/aria-checked="false"[^>]*data-git-auto-backup-push="true"/);
  });

  it("offers a manual backup only when the shell provides one", () => {
    const markup = render(
      {},
      {
        projectPath: "/paper",
        status: {
          branch: "main",
          isRepo: true,
          hasCommits: true,
          hasUpstream: false,
          ahead: 0,
          behind: 0,
          changes: [],
        },
        isRefreshing: false,
        isPulling: false,
        isPushing: false,
        onRefresh: async () => ({ success: true }),
        onPull: async () => ({ success: true }),
        onBackupNow: async () => null,
        lastBackupAt: null,
      },
    );
    expect(markup).toContain("Back up now");
    expect(markup).toContain("No backup yet in this session.");
  });
});

describe("settings navigation", () => {
  it("groups Git and cloud backup without editor reset controls", () => {
    const markup = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(SettingsPage, { initialTab: "sync" })),
    );
    expect(markup).toContain("Sync and backup");
    expect(markup).toContain("R2 / S3 backup");
    expect(markup).toContain("GitHub");
    expect(markup).not.toContain("Restore defaults");
  });
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
    // The page-level restore button is hidden here; translation has its own.
    expect(markup).not.toMatch(/<button[^>]*aria-label="Restore defaults"/);
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
    expect(updates).not.toContain("Restore defaults");
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
    expect(markup).toContain("General and editor");
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
