import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { GitSidebarPanel } from "./sidebar-git-panel";

const noop = vi.fn();
const props: ComponentProps<typeof GitSidebarPanel> = {
  projectPath: "/paper",
  gitStatus: {
    branch: "main",
    remote: "https://example.com/paper.git",
    isRepo: true,
    hasCommits: true,
    hasUpstream: true,
    ahead: 0,
    behind: 0,
    changes: [],
  },
  gitGraph: [],
  gitLogEntries: [],
  stagedChanges: [],
  unstagedChanges: [],
  showRemoteInput: false,
  remoteUrl: "",
  showCommitInput: false,
  commitMessage: "",
  isInitializingGit: false,
  isGeneratingCommitMessageAI: false,
  isPushing: false,
  isPulling: false,
  onRemoteUrlChange: noop,
  onShowRemoteInput: noop,
  onHideRemoteInput: noop,
  onSubmitRemote: noop,
  onInitGit: noop,
  onRefreshStatus: noop,
  onStageAll: noop,
  onDiscardAll: noop,
  onDiscardFile: noop,
  onStageFile: noop,
  onUnstageFile: noop,
  onUnstageAll: noop,
  onCommitMessageChange: noop,
  onShowCommitInput: noop,
  onHideCommitInput: noop,
  onCommit: noop,
  onPush: noop,
  onPull: noop,
  onPreviewDiff: noop,
  onGenerateCommitMessageAI: noop,
};

function render(overrides: Partial<typeof props> = {}) {
  return renderToStaticMarkup(
    createElement(I18nProvider, null, createElement(GitSidebarPanel, { ...props, ...overrides })),
  );
}

describe("Git sidebar remote actions", () => {
  it("allows pull when the cached remote update count is zero", () => {
    const markup = render();
    const button = markup.match(/<button[^>]*aria-label="Pull"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled=""');
    expect(markup.match(/<button[^>]*aria-label="Refresh git status"[^>]*>/)?.[0]).not.toContain(
      "disabled",
    );
  });
  it("shows fetch progress and prevents a repeated manual refresh", () => {
    const markup = render({ isRefreshing: true });
    expect(markup.match(/<button[^>]*aria-label="Refresh git status"[^>]*>/)?.[0]).toContain(
      "disabled",
    );
    expect(markup).toContain("animate-spin");
  });
  it("keeps refresh available when repository status failed to load", () => {
    const markup = render({ gitStatus: null, remoteError: "Git unavailable" });
    expect(markup).toContain("Refresh git status");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Git unavailable");
  });
});
