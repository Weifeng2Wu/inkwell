"use client";

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  FileIcon,
  GitBranchIcon,
  GitCommitIcon,
  GithubLogoIcon,
  GlobeIcon,
  MinusIcon,
  PlusIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/features/i18n";
import type { GitFileChange, GitLogEntry, GitStatus } from "@/types/git";

type SelectedChange = {
  path: string;
  staged: boolean;
};

const STATUS_SHORT: Record<GitFileChange["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

const STATUS_STYLE: Record<GitFileChange["status"], string> = {
  modified: "bg-accent/15 text-accent",
  added: "bg-success/15 text-success",
  deleted: "bg-error/15 text-error",
  renamed: "bg-info/15 text-info",
  untracked: "bg-surface-tertiary text-muted",
};

function formatRelativeDate(
  dateStr: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  const diffWeek = Math.floor(diffDay / 7);
  const diffMonth = Math.floor(diffDay / 30);

  if (diffSec < 60) return t("git.justNow");
  if (diffMin < 60) return t("git.minAgo", { count: diffMin });
  if (diffHour < 24) return t("git.hoursAgo", { count: diffHour });
  if (diffDay < 7) return t("git.daysAgo", { count: diffDay });
  if (diffWeek < 5) return t("git.weeksAgo", { count: diffWeek });
  if (diffMonth < 12) return t("git.monthsAgo", { count: diffMonth });
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
}

function CommitEntry({
  entry,
  isFirst,
  isLast,
}: {
  entry: GitLogEntry;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopyHash = useCallback(() => {
    void navigator.clipboard.writeText(entry.shortHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [entry.shortHash]);

  return (
    <div className="group flex gap-2.5 px-3 hover:bg-accent-hover transition-colors">
      {/* Timeline */}
      <div className="flex flex-col items-center w-3 flex-shrink-0">
        {!isFirst && <div className="w-px flex-1 bg-surface-tertiary" />}
        <div className="w-[7px] h-[7px] rounded-full bg-accent border-2 border-background ring-1 ring-border flex-shrink-0 my-0.5" />
        {!isLast && <div className="w-px flex-1 bg-surface-tertiary" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 py-2">
        <p className="text-xs leading-relaxed truncate text-foreground">{entry.message}</p>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={handleCopyHash}
            className="flex items-center gap-1 text-[10px] font-mono text-muted hover:text-foreground transition-colors group/hash"
            title={t("git.copyHash", { hash: entry.hash })}
          >
            <span className="bg-surface-secondary px-1 py-px group-hover/hash:bg-surface-tertiary transition-colors">
              {entry.shortHash}
            </span>
            {copied ? (
              <CheckIcon className="w-2.5 h-2.5 text-foreground" />
            ) : (
              <CopyIcon className="w-2.5 h-2.5 opacity-0 group-hover/hash:opacity-100 transition-opacity" />
            )}
          </button>
          <span className="text-[10px] text-muted-foreground">{entry.author}</span>
          <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">
            {formatRelativeDate(entry.date, t)}
          </span>
        </div>
      </div>
    </div>
  );
}

type GitSidebarPanelProps = {
  projectPath: string | null;
  gitStatus: GitStatus | null;
  gitGraph: string[];
  gitLogEntries: GitLogEntry[];
  stagedChanges: GitFileChange[];
  unstagedChanges: GitFileChange[];
  showRemoteInput: boolean;
  remoteUrl: string;
  onRemoteUrlChange: (value: string) => void;
  onShowRemoteInput: () => void;
  onHideRemoteInput: () => void;
  onSubmitRemote: () => void;
  onInitGit: () => void;
  isInitializingGit: boolean;
  onRefreshStatus: () => void;
  onStageAll: () => void;
  onDiscardAll: () => void | Promise<void>;
  onDiscardFile: (path: string) => void | Promise<void>;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onUnstageAll: () => void;
  showCommitInput: boolean;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onShowCommitInput: () => void;
  onHideCommitInput: () => void;
  onCommit: () => void;
  onPush: () => void | Promise<void>;
  onPull: () => void | Promise<void>;
  onPreviewDiff: (path: string, staged: boolean) => void | Promise<void>;
  onGenerateCommitMessageAI: () => void | Promise<void>;
  onOpenFile?: (path: string) => void | Promise<void>;
  onPublishToGitHub?: () => void;
  isGeneratingCommitMessageAI: boolean;
  isPushing: boolean;
  isPulling: boolean;
  isRefreshing?: boolean;
  remoteError?: string | null;
  isAuthenticatingGh?: boolean;
};

export function GitSidebarPanel({
  projectPath,
  gitStatus,
  gitGraph,
  gitLogEntries,
  stagedChanges,
  unstagedChanges,
  showRemoteInput,
  remoteUrl,
  onRemoteUrlChange,
  onShowRemoteInput,
  onHideRemoteInput,
  onSubmitRemote,
  onInitGit,
  isInitializingGit,
  onRefreshStatus,
  onStageAll,
  onDiscardAll,
  onDiscardFile,
  onStageFile,
  onUnstageFile,
  onUnstageAll,
  commitMessage,
  onCommitMessageChange,
  onCommit,
  onPush,
  onPull,
  onPreviewDiff,
  onGenerateCommitMessageAI,
  onOpenFile,
  onPublishToGitHub,
  isGeneratingCommitMessageAI,
  isPushing,
  isPulling,
  isRefreshing = false,
  remoteError,
  isAuthenticatingGh = false,
}: GitSidebarPanelProps) {
  const { t } = useI18n();
  const [selectedChange, setSelectedChange] = useState<SelectedChange | null>(null);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [showDiscardAllConfirm, setShowDiscardAllConfirm] = useState(false);

  const visibleCommits = useMemo(() => {
    if (showAllCommits) return gitLogEntries;
    return gitLogEntries.slice(0, 5);
  }, [gitLogEntries, showAllCommits]);

  const hasMoreCommits = gitLogEntries.length > 5;

  const handleSelectChange = useCallback(
    (path: string, staged: boolean) => {
      setSelectedChange({ path, staged });
      void onPreviewDiff(path, staged);
    },
    [onPreviewDiff],
  );

  const handleOpenSelectedFile = useCallback(() => {
    if (!selectedChange || !onOpenFile) return;
    void onOpenFile(selectedChange.path);
  }, [onOpenFile, selectedChange]);

  const renderChangeRow = useCallback(
    (change: GitFileChange, staged: boolean) => {
      const isSelected = selectedChange?.path === change.path && selectedChange.staged === staged;
      return (
        <div
          key={`${staged ? "staged" : "unstaged"}:${change.path}`}
          className={`group flex items-stretch transition-colors duration-100 ${
            isSelected
              ? "bg-surface-secondary border-l-2 border-l-foreground"
              : "border-l-2 border-l-transparent hover:bg-accent-hover"
          }`}
        >
          <button
            type="button"
            onClick={() => handleSelectChange(change.path, staged)}
            className="flex-1 min-w-0 px-3 py-1.5 text-left"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`w-[18px] h-[18px] text-[10px] font-mono font-bold flex items-center justify-center flex-shrink-0 ${STATUS_STYLE[change.status]}`}
              >
                {STATUS_SHORT[change.status]}
              </span>
              <span
                className={`truncate text-xs ${
                  change.status === "deleted" ? "line-through text-muted" : "text-foreground"
                }`}
              >
                {change.path}
              </span>
            </div>
          </button>
          <div className="flex items-stretch opacity-0 group-hover:opacity-100 transition-opacity duration-100">
            {!staged && (
              <button
                type="button"
                onClick={() => {
                  void onDiscardFile(change.path);
                }}
                className="w-7 flex items-center justify-center hover:bg-surface-tertiary"
                aria-label={t("git.discardFile")}
                title={t("git.discardFile")}
              >
                <ArrowCounterClockwiseIcon className="w-3 h-3" />
              </button>
            )}
            {staged ? (
              <button
                type="button"
                onClick={() => onUnstageFile(change.path)}
                className="w-7 flex items-center justify-center hover:bg-surface-tertiary"
                aria-label={t("git.unstageFile")}
                title={t("git.unstageFile")}
              >
                <MinusIcon className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onStageFile(change.path)}
                className="w-7 flex items-center justify-center hover:bg-surface-tertiary"
                aria-label={t("git.stageFile")}
                title={t("git.stageFile")}
              >
                <PlusIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      );
    },
    [handleSelectChange, onStageFile, onUnstageFile, onDiscardFile, selectedChange, t],
  );

  if (!projectPath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted">
        <div className="w-12 h-12 border-2 border-border flex items-center justify-center mb-3">
          <GitBranchIcon className="w-6 h-6 opacity-30" />
        </div>
        <p className="text-xs uppercase tracking-wider">{t("git.noFolderOpen")}</p>
      </div>
    );
  }

  if (!gitStatus?.isRepo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted">
        <div className="w-12 h-12 border-2 border-border flex items-center justify-center mb-3">
          <GitBranchIcon className="w-6 h-6 opacity-30" />
        </div>
        <p className="text-xs uppercase tracking-wider mb-4">{t("git.notRepo")}</p>
        {remoteError && <p role="alert" className="mb-3 text-xs text-error break-words">{remoteError}</p>}
        <button
          type="button"
          onClick={onRefreshStatus}
          disabled={isRefreshing}
          className="btn btn-sm mb-2"
        >
          {t("interface.refreshGit")}
        </button>
        <button
          type="button"
          onClick={onInitGit}
          disabled={isInitializingGit}
          className="btn btn-sm btn-primary"
        >
          {isInitializingGit ? t("git.initializing") : t("git.initRepo")}
        </button>
      </div>
    );
  }

  const changeCount = gitStatus.changes.length;
  const showPushButton = Boolean(gitStatus.remote);
  const showPullButton = Boolean(gitStatus.remote);
  const canPush = gitStatus.hasUpstream ? gitStatus.ahead > 0 : gitStatus.hasCommits;
  const pushTitle = !canPush
    ? t("git.noChanges")
    : gitStatus.hasUpstream
      ? t("git.pushTitle")
      : t("git.pushTitle");
  const pullTitle = t("git.pullTitle");

  return (
    <>
      {/* Discard all confirm dialog */}
      {showDiscardAllConfirm && (
        <ConfirmDialog
          title={t("git.discardAllConfirmTitle")}
          message={t("git.discardAllConfirmMessage")}
          confirmLabel={t("git.discardAll")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            void onDiscardAll();
            setShowDiscardAllConfirm(false);
          }}
          onCancel={() => setShowDiscardAllConfirm(false)}
        />
      )}

      {/* Header: branch + status */}
      <div className="px-3 py-2.5 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranchIcon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-xs font-medium truncate">{gitStatus.branch}</span>
          </div>
          <button
            type="button"
            onClick={onRefreshStatus}
            disabled={isRefreshing}
            title={t("interface.refreshGit")}
            className="p-1 text-muted hover:text-foreground hover:bg-accent/5 transition-colors"
            aria-label={t("interface.refreshGit")}
          >
            <ArrowClockwiseIcon className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        {remoteError && <p role="alert" className="mt-2 text-xs text-error break-words">{t("git.fetchFailed")}: {remoteError}</p>}

        {!gitStatus.remote && (
          <div className="mt-2 space-y-1.5">
            {showRemoteInput ? (
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => onRemoteUrlChange(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full rounded-md px-2 py-1.5 text-xs border border-border focus:border-accent focus:outline-none bg-background"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && remoteUrl.trim()) {
                    onSubmitRemote();
                  }
                  if (e.key === "Escape") {
                    onHideRemoteInput();
                  }
                }}
              />
            ) : (
              <>
                {onPublishToGitHub && (
                  <button
                    type="button"
                    onClick={onPublishToGitHub}
                    disabled={isAuthenticatingGh}
                    className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[11px] bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    <GithubLogoIcon className="w-3.5 h-3.5" />
                    <span>
                      {isAuthenticatingGh ? t("git.authenticating") : t("git.publishGithub")}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onShowRemoteInput}
                  className="flex items-center gap-1.5 text-[11px] text-muted hover:text-foreground transition-colors"
                >
                  <GlobeIcon className="w-3 h-3" />
                  <span>{t("git.orAddRemote")}</span>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Commit input area (always visible, like VS Code) */}
      <div className="px-3 py-2.5 border-b border-border space-y-2">
        <div className="relative">
          <textarea
            value={commitMessage}
            onChange={(e) => onCommitMessageChange(e.target.value)}
            placeholder={t("git.commitPlaceholder")}
            className="w-full px-2.5 py-2 text-xs border border-border resize-none focus:outline-none focus:border-accent bg-background placeholder:text-muted-foreground transition-colors"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                onCommit();
              }
            }}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCommit}
            disabled={!commitMessage.trim() || stagedChanges.length === 0}
            className="flex-1 text-xs font-medium py-1.5 bg-accent text-accent-foreground border border-accent hover:bg-accent/90 disabled:opacity-50 disabled:hover:bg-accent transition-colors flex items-center justify-center gap-1.5"
          >
            <CheckIcon className="size-3.5 shrink-0" />
            {t("git.commit")}
            {stagedChanges.length > 0 && (
              <span className="opacity-60">({stagedChanges.length})</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              void onGenerateCommitMessageAI();
            }}
            disabled={isGeneratingCommitMessageAI || stagedChanges.length === 0}
            className="text-xs font-medium px-2.5 py-1.5 border border-border hover:border-accent hover:bg-accent-hover disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-background transition-colors flex items-center gap-1"
            title={t("git.aiDraft")}
          >
            <SparkleIcon className="size-3.5 shrink-0" />
            {isGeneratingCommitMessageAI ? "..." : t("git.aiDraft")}
          </button>
          {showPushButton && (
            <button
              type="button"
              onClick={() => {
                void onPush();
              }}
              disabled={isPushing || !canPush}
              className="text-xs font-medium px-2.5 py-1.5 border border-border hover:border-accent hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center gap-1"
              title={pushTitle}
            >
              {isPushing ? (
                <Spinner className="size-3" />
              ) : (
                <>
                  <ArrowUpIcon className="size-3.5 shrink-0" />
                  {gitStatus.hasUpstream ? gitStatus.ahead : t("git.push")}
                </>
              )}
            </button>
          )}
          {showPullButton && (
            <button
              type="button"
              onClick={() => {
                void onPull();
              }}
              aria-label={t("git.pull")}
              disabled={isPulling || isPushing || isRefreshing}
              className="text-xs font-medium px-2.5 py-1.5 border border-border hover:border-accent hover:bg-accent-hover disabled:opacity-50 transition-colors flex items-center gap-1"
              title={pullTitle}
            >
              {isPulling ? (
                <Spinner className="size-3" />
              ) : (
                <>
                  <ArrowDownIcon className="size-3.5 shrink-0" />
                  {gitStatus.hasUpstream ? gitStatus.behind : t("git.pull")}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content: Staged → Changes → History */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ScrollArea className="flex-1 min-h-0">
          {/* Staged Changes */}
          {stagedChanges.length > 0 && (
            <div className="border-b border-border">
              <div className="px-3 py-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted">
                <span className="flex items-center gap-1.5">
                  <CheckIcon className="w-3 h-3" />
                  {t("git.stagedChanges")}
                  <span className="inline-flex items-center justify-center w-4 h-4 bg-accent text-accent-foreground text-[9px] font-bold">
                    {stagedChanges.length}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={onUnstageAll}
                  className="normal-case tracking-normal text-muted hover:text-foreground transition-colors p-0.5"
                  title={t("git.unstageAll")}
                >
                  <MinusIcon className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="border-t border-surface-secondary">
                {stagedChanges.map((change) => renderChangeRow(change, true))}
              </div>
            </div>
          )}

          {/* Unstaged Changes */}
          {unstagedChanges.length > 0 && (
            <div className="border-b border-border">
              <div className="px-3 py-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted">
                <span className="flex items-center gap-1.5">
                  {t("git.changes")}
                  <span className="inline-flex items-center justify-center w-4 h-4 bg-accent text-accent-foreground text-[9px] font-bold">
                    {unstagedChanges.length}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowDiscardAllConfirm(true)}
                    className="normal-case tracking-normal text-muted hover:text-foreground transition-colors p-0.5"
                    title={t("git.discardAll")}
                  >
                    <ArrowCounterClockwiseIcon className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onStageAll}
                    className="normal-case tracking-normal text-muted hover:text-foreground transition-colors p-0.5"
                    title={t("git.stageAll")}
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
              <div className="border-t border-surface-secondary">
                {unstagedChanges.map((change) => renderChangeRow(change, false))}
              </div>
            </div>
          )}

          {/* Clean state */}
          {changeCount === 0 && (
            <div className="px-3 py-8 text-center border-b border-border">
              <CheckIcon className="w-5 h-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-[11px] text-muted uppercase tracking-wider">
                {t("git.noChanges")}
              </p>
            </div>
          )}

          {/* History section */}
          <div>
            <button
              type="button"
              onClick={() => setHistoryCollapsed(!historyCollapsed)}
              className="w-full px-3 py-1.5 flex items-center justify-between text-[11px] uppercase tracking-wider text-muted hover:bg-accent-hover transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <ClockCounterClockwiseIcon className="w-3 h-3" />
                {t("git.commitHistory")}
                {gitLogEntries.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-0.5 bg-surface-tertiary text-muted text-[9px] font-bold">
                    {gitLogEntries.length}
                  </span>
                )}
              </span>
              <span className="text-[10px]">{historyCollapsed ? "+" : "\u2212"}</span>
            </button>
            {!historyCollapsed &&
              (gitLogEntries.length > 0 ? (
                <div className="border-t border-surface-secondary">
                  {visibleCommits.map((entry, i) => (
                    <CommitEntry
                      key={entry.hash}
                      entry={entry}
                      isFirst={i === 0}
                      isLast={i === visibleCommits.length - 1 && !hasMoreCommits}
                    />
                  ))}
                  {hasMoreCommits && (
                    <button
                      type="button"
                      onClick={() => setShowAllCommits(!showAllCommits)}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-muted hover:text-foreground hover:bg-accent-hover transition-colors"
                    >
                      <div className="flex flex-col items-center w-3 flex-shrink-0">
                        <div className="w-px flex-1 bg-surface-tertiary" />
                        <GitCommitIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      </div>
                      <span>
                        {showAllCommits
                          ? "Show less"
                          : `${gitLogEntries.length - 5} more commits...`}
                      </span>
                    </button>
                  )}
                </div>
              ) : gitGraph.length > 0 ? (
                <div className="px-3 py-2 overflow-x-auto border-t border-surface-secondary">
                  <pre className="text-[11px] leading-[18px] font-mono whitespace-pre text-muted">
                    {gitGraph.join("\n")}
                  </pre>
                </div>
              ) : (
                <div className="px-3 py-4 text-center">
                  <p className="text-[11px] text-muted">{t("git.noChanges")}</p>
                </div>
              ))}
          </div>
        </ScrollArea>

        {/* Selected file info */}
        {selectedChange && (
          <div className="border-t border-border px-3 py-2 bg-accent-hover flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-medium truncate flex items-center gap-1.5">
                <FileIcon className="w-3 h-3 flex-shrink-0" />
                {selectedChange.path}
              </div>
              <div className="text-[10px] text-muted mt-0.5">Diff shown in editor</div>
            </div>
            {onOpenFile && (
              <button
                type="button"
                onClick={handleOpenSelectedFile}
                className="text-[11px] px-2 py-1 border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                Open
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
