import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { type GitSyncController, GitSyncSettings } from "./git-sync-settings";

const controller: GitSyncController = {
  projectPath: "/paper",
  status: {
    branch: "main",
    remote: "https://example.com/paper.git",
    isRepo: true,
    hasCommits: true,
    hasUpstream: true,
    ahead: 0,
    behind: 0,
    changes: [],
  },
  isRefreshing: false,
  isPulling: false,
  isPushing: false,
  onRefresh: vi.fn(),
  onPull: vi.fn(),
};

function render(value?: GitSyncController) {
  return renderToStaticMarkup(
    createElement(I18nProvider, null, createElement(GitSyncSettings, { controller: value })),
  );
}

describe("manual Git sync settings", () => {
  it("allows checking and pulling even when cached behind count is zero", () => {
    const markup = render(controller);
    expect(markup).toContain("Check remote updates");
    expect(markup).toContain("Pull updates");
    expect(markup).not.toContain('disabled=""');
  });
  it("explains why sync is unavailable without an open project", () => {
    const markup = render();
    expect(markup).toContain("Open a project");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
  it("keeps actions disabled during a push or pull and displays remote failures", () => {
    const markup = render({ ...controller, isPushing: true, error: "Authentication failed" });
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Authentication failed");
  });
  it("hides backup controls unless the caller provides them", () => {
    const markup = render(controller);
    expect(markup).not.toContain("Back up now");
    expect(markup).not.toContain("data-git-last-backup");
  });
  it("offers a manual backup with the time of the last one", () => {
    const never = render({ ...controller, onBackupNow: vi.fn(), lastBackupAt: null });
    expect(never).toContain("Back up now");
    expect(never).toContain("No backup yet in this session.");
    expect(never).not.toContain('disabled=""');

    const at = new Date(2026, 10, 14, 23, 5).getTime();
    const markup = render({ ...controller, onBackupNow: vi.fn(), lastBackupAt: at });
    expect(markup).toContain("Last backup:");
    expect(markup).toContain(`<time dateTime="${new Date(at).toISOString()}">`);
    expect(markup).toContain("2026");
  });
  it("backs up projects without a remote, but not outside a repository", () => {
    const local = render({
      ...controller,
      status: {
        ...controller.status,
        isRepo: true,
        remote: undefined,
      } as GitSyncController["status"],
      onBackupNow: vi.fn(),
    });
    expect(local).toMatch(/<button type="button" class="btn btn-sm" data-git-backup-now="true">/);
    const plain = render({ ...controller, status: null, onBackupNow: vi.fn() });
    expect(plain).toMatch(/data-git-backup-now="true" disabled=""/);
  });
  it("disables every action while a backup is running", () => {
    const markup = render({ ...controller, onBackupNow: vi.fn(), isBackingUp: true });
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(markup).toContain("Backing up…");
  });
});
