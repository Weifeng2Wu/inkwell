import { type ComponentProps, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import type { GitFileChange, GitStatus } from "@/types/git";
import { GitSidebarPanel } from "./sidebar-git-panel";

const noop = vi.fn();
const status: GitStatus = {
  branch: "main",
  remote: "https://example.com/paper.git",
  isRepo: true,
  hasCommits: true,
  hasUpstream: true,
  ahead: 0,
  behind: 0,
  changes: [],
};
const props: ComponentProps<typeof GitSidebarPanel> = {
  projectPath: "/paper",
  gitStatus: status,
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
    expect(markup.match(/<button[^>]*aria-label="Refresh Git status"[^>]*>/)?.[0]).not.toContain(
      'disabled=""',
    );
  });
  it("shows fetch progress and prevents a repeated manual refresh", () => {
    const markup = render({ isRefreshing: true });
    expect(markup.match(/<button[^>]*aria-label="Refresh Git status"[^>]*>/)?.[0]).toContain(
      'disabled=""',
    );
    expect(markup).toContain("animate-spin");
  });
  it("keeps refresh available when repository status failed to load", () => {
    const markup = render({ gitStatus: null, remoteError: "Git unavailable" });
    expect(markup).toContain("Refresh Git status");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Git unavailable");
  });
});

describe("Git sidebar layout", () => {
  const change = (path: string, status: GitFileChange["status"], staged = false) => ({
    path,
    status,
    staged,
  });
  const changes = [
    change("main.tex", "modified"),
    change("figures/new.pdf", "untracked"),
    change("old.tex", "deleted"),
    change("renamed.tex", "renamed"),
  ];

  it("keeps the commit buttons on one line and labels in sentence case", () => {
    const markup = render({ stagedChanges: [change("a.tex", "added", true)], commitMessage: "x" });
    for (const label of ["Commit", "AI draft"]) {
      const button = markup.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}`))?.[0];
      expect(button).toContain("whitespace-nowrap");
    }
    expect(markup).not.toContain("uppercase");
    expect(markup).not.toContain("tracking-");
    expect(markup).toContain("Ctrl+Enter to commit");
  });

  it("shows a rounded, tinted status letter for each kind of change", () => {
    const markup = render({
      gitStatus: { ...status, changes },
      unstagedChanges: changes,
    });
    const badge = (name: string) =>
      markup.match(new RegExp(`<span title="${name}" class="([^"]*)">.*?>(.)</span>`))?.slice(1);
    expect(badge("Modified")).toEqual([expect.stringContaining("bg-warning/15 text-warning"), "M"]);
    expect(badge("New file")).toEqual([expect.stringContaining("bg-success/15 text-success"), "?"]);
    expect(badge("Deleted")).toEqual([expect.stringContaining("bg-error/15 text-error"), "D"]);
    expect(badge("Renamed")).toEqual([expect.stringContaining("bg-info/15 text-info"), "R"]);
    expect(badge("Modified")?.[0]).toContain("rounded-full");
    expect(markup).toContain("Stage files with + to include them in the commit.");
  });

  it("summarises what is waiting to sync next to the branch", () => {
    expect(render()).toContain("Up to date");
    const markup = render({ gitStatus: { ...status, ahead: 2, behind: 1 } });
    expect(markup).toContain("2 to push · 1 to pull");
    expect(markup).toContain("↑2");
    expect(markup).toContain("↓1");
  });

  it("teaches what to do without a project, a repository, changes or a remote", () => {
    expect(render({ projectPath: null })).toContain("Open a project to see its changes.");
    const noRepo = render({ gitStatus: { ...status, isRepo: false } });
    expect(noRepo).toContain("Initialize a repository to keep a history");
    expect(noRepo).toContain("Initialize repository");
    const clean = render();
    expect(clean).toContain("Nothing to commit");
    expect(clean).toContain("Changes you save show up here");
    expect(clean).toContain("No commits yet.");
    const local = render({ gitStatus: { ...status, remote: "" }, onPublishToGitHub: noop });
    expect(local).toContain("This repository exists only on this computer");
    expect(local).toContain("Publish to GitHub");
    expect(local).not.toContain('aria-label="Pull"');
  });
});
