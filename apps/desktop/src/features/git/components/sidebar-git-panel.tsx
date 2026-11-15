"use client";

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  GitBranchIcon,
  GithubLogoIcon,
  MinusIcon,
  PlusIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Collapse } from "@/components/ui/collapse";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { PanelAction, PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { formatRelativeTime, useI18n } from "@/features/i18n";
import { shortcutLabel } from "@/features/settings";
import { moveRowFocus } from "@/lib/list-navigation";
import type { GitFileChange, GitLogEntry, GitStatus } from "@/types/git";
import { ChangeRow, CommitRow } from "./git-rows";

type SelectedChange = { path: string; staged: boolean };

/** Commits shown before "Show more". */
const RECENT_COMMITS = 5;
const COMMIT_KEYS = "Mod+Enter";

function Count({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-surface-tertiary px-1.5 text-[11px] leading-4 tabular-nums text-foreground-secondary">
      {children}
    </span>
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
  const { t, locale } = useI18n();
  const [selectedChange, setSelectedChange] = useState<SelectedChange | null>(null);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [confirmDiscardAll, setConfirmDiscardAll] = useState(false);
  const [discarding, setDiscarding] = useState<string | null>(null);
  const title = t("workbench.views.git");

  const refresh = (
    <PanelAction label={t("git.refreshStatus")} disabled={isRefreshing} onClick={onRefreshStatus}>
      <ArrowClockwiseIcon
        className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
    </PanelAction>
  );

  if (!projectPath) {
    return (
      <>
        <PanelHeader title={title} />
        <PanelEmpty icon={<GitBranchIcon className="size-7" />} title={t("git.noProject")} />
      </>
    );
  }

  if (!gitStatus?.isRepo) {
    return (
      <>
        <PanelHeader title={title}>{refresh}</PanelHeader>
        <PanelEmpty
          icon={<GitBranchIcon className="size-7" />}
          title={t("git.notRepo")}
          description={t("git.notRepoHint")}
        >
          {remoteError && (
            <p role="alert" className="max-w-full break-words text-xs text-error">
              {remoteError}
            </p>
          )}
          <button
            type="button"
            onClick={onInitGit}
            disabled={isInitializingGit}
            className="btn btn-sm btn-primary mt-2 whitespace-nowrap"
          >
            {isInitializingGit ? t("git.initializing") : t("git.initRepo")}
          </button>
        </PanelEmpty>
      </>
    );
  }

  const hasRemote = Boolean(gitStatus.remote);
  const canPush = gitStatus.hasUpstream ? gitStatus.ahead > 0 : gitStatus.hasCommits;
  const canCommit = Boolean(commitMessage.trim()) && stagedChanges.length > 0;
  const visibleCommits = showAllCommits ? gitLogEntries : gitLogEntries.slice(0, RECENT_COMMITS);
  const hiddenCommits = gitLogEntries.length - RECENT_COMMITS;
  const sync = !hasRemote
    ? [t("git.localOnly")]
    : !gitStatus.hasUpstream
      ? [t("git.unpublished")]
      : [
          gitStatus.ahead > 0 ? t("git.toPush", { count: gitStatus.ahead }) : "",
          gitStatus.behind > 0 ? t("git.toPull", { count: gitStatus.behind }) : "",
        ].filter(Boolean);
  const syncText = sync.length ? sync.join(" · ") : t("git.upToDate");

  const select = (path: string, staged: boolean) => {
    setSelectedChange({ path, staged });
    void onPreviewDiff(path, staged);
  };
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    moveRowFocus(event);
  };
  const changeList = (changes: GitFileChange[], staged: boolean) => (
    <ul>
      {changes.map((change, index) => (
        <ChangeRow
          key={change.path}
          change={change}
          staged={staged}
          index={index}
          selected={selectedChange?.path === change.path && selectedChange.staged === staged}
          onSelect={select}
          onStage={onStageFile}
          onUnstage={onUnstageFile}
          onDiscard={setDiscarding}
        />
      ))}
    </ul>
  );

  return (
    <>
      {confirmDiscardAll && (
        <ConfirmDialog
          title={t("git.discardAllConfirmTitle")}
          message={t("git.discardAllConfirmMessage")}
          confirmLabel={t("git.discardAll")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            void onDiscardAll();
            setConfirmDiscardAll(false);
          }}
          onCancel={() => setConfirmDiscardAll(false)}
        />
      )}
      {discarding && (
        <ConfirmDialog
          title={t("git.discardFileConfirmTitle", { path: discarding })}
          message={t("git.discardFileConfirmMessage")}
          confirmLabel={t("git.discardFile")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            void onDiscardFile(discarding);
            setDiscarding(null);
          }}
          onCancel={() => setDiscarding(null)}
        />
      )}
      <PanelHeader title={title}>
        {hasRemote && (
          <>
            <PanelAction
              label={t("git.pull")}
              disabled={isPulling || isPushing || isRefreshing}
              onClick={() => void onPull()}
            >
              {isPulling ? (
                <Spinner className="size-4" />
              ) : (
                <ArrowDownIcon className="size-4" aria-hidden="true" />
              )}
            </PanelAction>
            <PanelAction
              label={t("git.push")}
              disabled={isPushing || !canPush}
              onClick={() => void onPush()}
            >
              {isPushing ? (
                <Spinner className="size-4" />
              ) : (
                <ArrowUpIcon className="size-4" aria-hidden="true" />
              )}
            </PanelAction>
          </>
        )}
        {refresh}
      </PanelHeader>

      <div className="flex h-8 flex-shrink-0 items-center gap-1.5 border-b border-border px-3 text-xs">
        <GitBranchIcon className="size-3.5 flex-shrink-0 text-muted" aria-hidden="true" />
        <span
          className="min-w-0 truncate font-mono text-foreground"
          title={t("git.branch", { branch: gitStatus.branch })}
        >
          {gitStatus.branch}
        </span>
        <span
          className={`ml-auto flex flex-shrink-0 items-center gap-1 tabular-nums ${
            hasRemote && gitStatus.hasUpstream && sync.length ? "text-accent" : "text-muted"
          }`}
          title={syncText}
        >
          {hasRemote && gitStatus.hasUpstream && sync.length > 0 ? (
            <>
              <span className="sr-only">{syncText}</span>
              {gitStatus.ahead > 0 && <span aria-hidden="true">↑{gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span aria-hidden="true">↓{gitStatus.behind}</span>}
            </>
          ) : (
            syncText
          )}
        </span>
      </div>

      {remoteError && (
        <div role="alert" className="border-b border-border px-3 py-2 text-xs leading-relaxed">
          <p className="font-medium text-error">{t("git.fetchFailed")}</p>
          <p className="mt-0.5 line-clamp-3 break-words text-muted" title={remoteError}>
            {remoteError}
          </p>
        </div>
      )}

      {!hasRemote && (
        <div className="motion-rise space-y-2 border-b border-border bg-surface-secondary/40 px-3 py-2.5">
          <div>
            <p className="text-xs font-medium text-foreground">{t("git.noRemoteTitle")}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{t("git.noRemoteHint")}</p>
          </div>
          {showRemoteInput ? (
            <div className="flex items-center gap-1.5">
              <input
                type="url"
                value={remoteUrl}
                // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked for it.
                autoFocus
                aria-label={t("git.remoteUrl")}
                onChange={(event) => onRemoteUrlChange(event.target.value)}
                placeholder={t("git.remoteUrlPlaceholder")}
                spellCheck={false}
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs transition-colors duration-150 placeholder:text-muted-foreground focus:border-accent focus:outline-none"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && remoteUrl.trim()) onSubmitRemote();
                  if (event.key === "Escape") onHideRemoteInput();
                }}
              />
              <button
                type="button"
                disabled={!remoteUrl.trim()}
                onClick={onSubmitRemote}
                className="btn btn-sm btn-secondary flex-shrink-0 whitespace-nowrap"
              >
                {t("git.addRemote")}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {onPublishToGitHub && (
                <button
                  type="button"
                  onClick={onPublishToGitHub}
                  disabled={isAuthenticatingGh}
                  className="btn btn-sm btn-primary inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <GithubLogoIcon className="size-3.5" aria-hidden="true" />
                  {isAuthenticatingGh ? t("git.authenticating") : t("git.publishGithub")}
                </button>
              )}
              <button
                type="button"
                onClick={onShowRemoteInput}
                className="text-xs text-muted transition-colors duration-150 hover:text-foreground hover:underline"
              >
                {t("git.orAddRemote")}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 border-b border-border px-3 py-2.5">
        <textarea
          value={commitMessage}
          onChange={(event) => onCommitMessageChange(event.target.value)}
          aria-label={t("git.commitMessage")}
          placeholder={t("git.commitMessagePlaceholder", { keys: shortcutLabel(COMMIT_KEYS) })}
          rows={2}
          className="block w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] leading-snug transition-colors duration-150 placeholder:text-muted-foreground focus:border-accent focus:outline-none"
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
            event.preventDefault();
            if (canCommit) onCommit();
          }}
        />
        <div className="flex items-center gap-1.5">
          <Tooltip
            label={t("git.commit")}
            keys={shortcutLabel(COMMIT_KEYS)}
            className="flex min-w-0 flex-1"
          >
            <button
              type="button"
              onClick={onCommit}
              disabled={!canCommit}
              className="btn btn-sm btn-primary inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <CheckIcon className="size-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{t("git.commit")}</span>
              {stagedChanges.length > 0 && (
                <span className="tabular-nums opacity-70">{stagedChanges.length}</span>
              )}
            </button>
          </Tooltip>
          <Tooltip label={t("git.aiDraftHint")} className="flex flex-shrink-0">
            <button
              type="button"
              onClick={() => void onGenerateCommitMessageAI()}
              disabled={isGeneratingCommitMessageAI || stagedChanges.length === 0}
              className="btn btn-sm btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              {isGeneratingCommitMessageAI ? (
                <Spinner className="size-3.5 flex-shrink-0" />
              ) : (
                <SparkleIcon className="size-3.5 flex-shrink-0" aria-hidden="true" />
              )}
              {isGeneratingCommitMessageAI ? t("git.aiDraftLoading") : t("git.aiDraft")}
            </button>
          </Tooltip>
        </div>
        {stagedChanges.length === 0 && unstagedChanges.length > 0 && (
          <p className="motion-fade text-[11px] leading-relaxed text-muted-foreground">
            {t("git.stageHint")}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <ScrollArea className="min-h-0 flex-1" autoHide="leave">
          {/* biome-ignore lint/a11y/noStaticElementInteractions: keys bubble up from the rows, which are buttons. */}
          <div className="motion-rise" onKeyDown={onListKeyDown}>
            {stagedChanges.length > 0 && (
              <section className="border-b border-border pb-1">
                <div className="flex h-7 items-center gap-1.5 pl-3 pr-1.5">
                  <h3 className="section-label">{t("git.stagedChanges")}</h3>
                  <Count>{stagedChanges.length}</Count>
                  <span className="ml-auto flex">
                    <PanelAction label={t("git.unstageAll")} onClick={onUnstageAll}>
                      <MinusIcon className="size-4" aria-hidden="true" />
                    </PanelAction>
                  </span>
                </div>
                {changeList(stagedChanges, true)}
              </section>
            )}
            {unstagedChanges.length > 0 && (
              <section className="border-b border-border pb-1">
                <div className="flex h-7 items-center gap-1.5 pl-3 pr-1.5">
                  <h3 className="section-label">{t("git.changes")}</h3>
                  <Count>{unstagedChanges.length}</Count>
                  <span className="ml-auto flex gap-0.5">
                    <PanelAction
                      label={t("git.discardAll")}
                      onClick={() => setConfirmDiscardAll(true)}
                    >
                      <ArrowCounterClockwiseIcon className="size-4" aria-hidden="true" />
                    </PanelAction>
                    <PanelAction label={t("git.stageAll")} onClick={onStageAll}>
                      <PlusIcon className="size-4" aria-hidden="true" />
                    </PanelAction>
                  </span>
                </div>
                {changeList(unstagedChanges, false)}
              </section>
            )}
            {gitStatus.changes.length === 0 && (
              <div className="border-b border-border px-5 py-6 text-center">
                <CheckCircleIcon
                  className="mx-auto mb-2 size-6 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-[13px] font-medium text-foreground">{t("git.noChanges")}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t("git.cleanHint")}</p>
              </div>
            )}

            <section>
              <button
                type="button"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((open) => !open)}
                className="list-row flex h-7 w-full items-center gap-1.5 px-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <CaretRightIcon
                  aria-hidden="true"
                  className={`size-3 flex-shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none ${
                    historyOpen ? "rotate-90" : ""
                  }`}
                />
                <span className="section-label">{t("git.commitHistory")}</span>
                {gitLogEntries.length > 0 && <Count>{gitLogEntries.length}</Count>}
              </button>
              <Collapse open={historyOpen}>
                {gitLogEntries.length > 0 ? (
                  <>
                    <ul className="pb-1">
                      {visibleCommits.map((entry) => (
                        <CommitRow
                          key={entry.hash}
                          entry={entry}
                          age={formatRelativeTime(entry.date, locale, { style: "narrow" })}
                        />
                      ))}
                    </ul>
                    {hiddenCommits > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllCommits((all) => !all)}
                        className="mb-2 px-3 text-xs text-accent hover:underline"
                      >
                        {showAllCommits
                          ? t("git.showFewerCommits")
                          : t("git.showMoreCommits", { count: hiddenCommits })}
                      </button>
                    )}
                  </>
                ) : gitGraph.length > 0 ? (
                  <pre className="overflow-x-auto whitespace-pre px-3 py-2 font-mono text-[11px] leading-[18px] text-muted">
                    {gitGraph.join("\n")}
                  </pre>
                ) : (
                  <p className="px-3 pb-3 pt-1 text-xs leading-relaxed text-muted">
                    {t("git.noCommits")}
                  </p>
                )}
              </Collapse>
            </section>
          </div>
        </ScrollArea>

        {selectedChange && (
          <div className="motion-rise flex flex-shrink-0 items-center gap-2 border-t border-border bg-surface-secondary/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p
                className="truncate font-mono text-[11px] text-foreground"
                title={selectedChange.path}
              >
                {selectedChange.path}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted">{t("git.diffShown")}</p>
            </div>
            {onOpenFile && (
              <button
                type="button"
                onClick={() => void onOpenFile(selectedChange.path)}
                className="btn btn-sm btn-secondary flex-shrink-0 whitespace-nowrap"
              >
                {t("git.openFile")}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
