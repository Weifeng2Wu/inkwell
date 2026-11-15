"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/features/i18n";
import type { useTauriDaemon } from "@/lib/tauri";
import {
  AI_COMMIT_DIFF_LIMIT,
  buildAiCommitPrompt,
  sanitizeAiCommitMessage,
} from "../lib/ai-commit";
import { GitHubPublishDialog } from "./github-publish-dialog";
import { GitSidebarPanel } from "./sidebar-git-panel";

type Props = {
  daemon: ReturnType<typeof useTauriDaemon>;
  /** Drafts a commit message with the selected agent. */
  generateCommitMessage: (prompt: string) => Promise<string>;
  onPreviewDiff: (path: string, staged: boolean) => void | Promise<void>;
  onOpenFile: (path: string) => void;
};

/** Unsent commit messages by project, kept while the sidebar is closed. */
const drafts = new Map<string, string>();

/** The Git sidebar: owns commit, remote and publish state and reports outcomes as toasts. */
export function GitSidebar({ daemon, generateCommitMessage, onPreviewDiff, onOpenFile }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const draftKey = daemon.projectPath ?? "";
  const [commitMessage, setMessage] = useState(() => drafts.get(draftKey) ?? "");
  const setCommitMessage = useCallback(
    (message: string) => {
      drafts.set(draftKey, message);
      setMessage(message);
    },
    [draftKey],
  );
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const project = useRef(daemon.projectPath);
  project.current = daemon.projectPath;

  const changes = daemon.gitStatus?.changes;
  const staged = useMemo(() => (changes ?? []).filter((change) => change.staged), [changes]);
  const unstaged = useMemo(() => (changes ?? []).filter((change) => !change.staged), [changes]);

  /** Reports a git operation's outcome; `failure` is the fallback error message. */
  const report = useCallback(
    (result: { success: boolean; error?: string }, success: string, failure: string) =>
      toast(
        result.success ? success : result.error || failure,
        result.success ? "success" : "error",
      ),
    [toast],
  );

  const commit = useCallback(async () => {
    const message = commitMessage.trim();
    if (!message) return;
    const result = await daemon.gitCommit(message);
    report(result, t("git.commitSuccess"), t("git.commitFailed"));
    if (result.success) {
      setCommitMessage("");
      setShowCommitInput(false);
    }
  }, [commitMessage, setCommitMessage, daemon, report, t]);

  const draftCommitMessage = useCallback(async () => {
    if (staged.length === 0) return toast(t("git.stageBeforeAi"), "error");
    const projectPath = daemon.projectPath;
    setShowCommitInput(true);
    setGenerating(true);
    try {
      const chunks = await Promise.all(staged.map((change) => daemon.gitDiff(change.path, true)));
      const diff = chunks
        .filter((chunk) => chunk.trim())
        .join("\n\n")
        .slice(0, AI_COMMIT_DIFF_LIMIT)
        .trim();
      if (!diff) return toast(t("git.noDiffAvailable"), "error");
      const message = sanitizeAiCommitMessage(
        await generateCommitMessage(buildAiCommitPrompt(diff, "staged")),
      );
      if (!message) return toast(t("git.emptyAiCommit"), "error");
      if (project.current !== projectPath) return;
      setCommitMessage(message);
      toast(t("git.aiCommitGenerated"), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast(t("git.aiDraftFailed", { error: message }), "error");
    } finally {
      setGenerating(false);
    }
  }, [daemon, staged, generateCommitMessage, setCommitMessage, toast, t]);

  const startPublishing = useCallback(async () => {
    setPublishError(null);
    const status = await daemon.ghCheck();
    if (!status.installed) return toast(t("git.ghNotInstalled"), "error");
    if (!status.authenticated) {
      if (daemon.isAuthenticatingGh) return toast(t("git.authInProgress"), "info");
      toast(t("git.ghLoginTerminal"), "info");
      const login = await daemon.ghAuthLogin();
      if (!login.success || !login.authenticated)
        return toast(login.error || t("git.authFailed"), "error");
      toast(t("git.authenticatedSuccess"), "success");
    }
    setPublishing(true);
  }, [daemon, toast, t]);

  return (
    <>
      <GitSidebarPanel
        projectPath={daemon.projectPath}
        gitStatus={daemon.gitStatus}
        gitGraph={daemon.gitGraph}
        gitLogEntries={daemon.gitLogEntries}
        stagedChanges={staged}
        unstagedChanges={unstaged}
        showRemoteInput={showRemoteInput}
        remoteUrl={remoteUrl}
        onRemoteUrlChange={setRemoteUrl}
        onShowRemoteInput={() => setShowRemoteInput(true)}
        onHideRemoteInput={() => setShowRemoteInput(false)}
        onSubmitRemote={() => {
          const url = remoteUrl.trim();
          if (!url) return;
          daemon.gitAddRemote(url);
          setRemoteUrl("");
          setShowRemoteInput(false);
        }}
        onInitGit={daemon.gitInit}
        isInitializingGit={daemon.isInitializingGit}
        onRefreshStatus={async () =>
          report(await daemon.refreshGitStatus(true), t("git.fetchSuccess"), t("git.fetchFailed"))
        }
        isRefreshing={daemon.isRefreshingGit}
        remoteError={daemon.gitRemoteError}
        onStageAll={() => unstaged.length && daemon.gitAdd(unstaged.map((change) => change.path))}
        onStageFile={(path) => daemon.gitAdd([path])}
        onUnstageAll={() => staged.length && daemon.gitUnstage(staged.map((change) => change.path))}
        onUnstageFile={(path) => daemon.gitUnstage([path])}
        onDiscardAll={async () =>
          report(
            await daemon.gitDiscardAll(),
            t("git.discardAllSuccess"),
            t("git.discardAllFailed"),
          )
        }
        onDiscardFile={async (path) =>
          report(
            await daemon.gitDiscardFile(path),
            t("git.discardFileSuccess", { path }),
            t("git.discardFileFailed"),
          )
        }
        showCommitInput={showCommitInput}
        commitMessage={commitMessage}
        onCommitMessageChange={setCommitMessage}
        onShowCommitInput={() => setShowCommitInput(true)}
        onHideCommitInput={() => setShowCommitInput(false)}
        onCommit={commit}
        onPush={async () =>
          report(await daemon.gitPush(), t("git.pushSuccess"), t("git.pushFailed"))
        }
        onPull={async () =>
          report(await daemon.gitPull(), t("git.pullSuccess"), t("git.pullFailed"))
        }
        onPreviewDiff={onPreviewDiff}
        onGenerateCommitMessageAI={draftCommitMessage}
        onOpenFile={onOpenFile}
        onPublishToGitHub={startPublishing}
        isGeneratingCommitMessageAI={generating}
        isPushing={daemon.isPushing}
        isPulling={daemon.isPulling}
        isAuthenticatingGh={daemon.isAuthenticatingGh}
      />
      {publishing && (
        <GitHubPublishDialog
          defaultRepoName={daemon.projectPath?.split(/[\\/]/).filter(Boolean).pop() ?? "my-project"}
          onPublish={async (name, isPrivate, description) => {
            setPublishError(null);
            const result = await daemon.ghCreateRepo(name, isPrivate, description || undefined);
            if (result.success) {
              setPublishing(false);
              toast(t("git.repoPublished", { url: result.url || "" }), "success");
            } else setPublishError(result.error || t("git.publishDialogTitle"));
          }}
          onCancel={() => {
            setPublishing(false);
            setPublishError(null);
          }}
          isCreating={daemon.isCreatingRepo}
          error={publishError}
        />
      )}
    </>
  );
}
