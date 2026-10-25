import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { GitSyncSettings, type GitSyncController } from "./git-sync-settings";

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
});
