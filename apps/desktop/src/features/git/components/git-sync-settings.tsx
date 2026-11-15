"use client";

import { useState } from "react";
import { useI18n } from "@/features/i18n";
import type { GitStatus } from "@/types/git";

export interface GitSyncController {
  projectPath: string | null;
  status: GitStatus | null;
  isRefreshing: boolean;
  isPulling: boolean;
  isPushing: boolean;
  error?: string | null;
  onRefresh: () => Promise<{ success: boolean; error?: string }>;
  onPull: () => Promise<{ success: boolean; error?: string }>;
  /** Runs a backup now. The "Back up now" row is shown only when this is provided. */
  onBackupNow?: () => Promise<unknown>;
  /** Time of the last completed backup, as epoch milliseconds. */
  lastBackupAt?: number | null;
  isBackingUp?: boolean;
}

export function GitSyncSettings({ controller }: { controller?: GitSyncController }) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  const status = controller?.status;
  const available = Boolean(controller?.projectPath && status?.isRepo && status.remote);
  const busy =
    pending ||
    controller?.isRefreshing ||
    controller?.isPulling ||
    controller?.isPushing ||
    controller?.isBackingUp;
  const onBackupNow = controller?.onBackupNow;
  const lastBackupAt = controller?.lastBackupAt;

  async function backUp() {
    if (!onBackupNow || busy) return;
    setPending(true);
    setFeedback(null);
    try {
      await onBackupNow();
    } catch (error) {
      setFeedback({ failed: true, message: String(error) });
    } finally {
      setPending(false);
    }
  }

  async function run(action: "fetch" | "pull") {
    if (!controller || busy) return;
    setPending(true);
    setFeedback(null);
    try {
      const result = await (action === "fetch" ? controller.onRefresh() : controller.onPull());
      setFeedback({
        failed: !result.success,
        message: result.success
          ? t(action === "fetch" ? "git.fetchSuccess" : "git.pullSuccess")
          : result.error || t(action === "fetch" ? "git.fetchFailed" : "git.pullFailed"),
      });
    } catch (error) {
      setFeedback({ failed: true, message: String(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-2 border-b border-border/40 pb-4">
      <h4 className="text-sm font-medium">{t("settings.gitSection.syncProject")}</h4>
      <p className="text-xs text-muted break-all">
        {controller?.projectPath || t("settings.gitSection.syncNoProject")}
      </p>
      {available ? (
        <p className="text-xs text-muted">
          {status?.branch} ·{" "}
          {status?.hasUpstream
            ? t("settings.gitSection.syncCounts", { ahead: status.ahead, behind: status.behind })
            : t("settings.gitSection.syncNoUpstream")}
        </p>
      ) : controller?.projectPath ? (
        <p className="text-xs text-muted">{t("settings.gitSection.syncNoRemote")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={!controller?.projectPath || busy}
          onClick={() => void run("fetch")}
        >
          {controller?.isRefreshing
            ? t("settings.gitSection.syncBusy")
            : t("settings.gitSection.fetchNow")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!available || busy}
          onClick={() => void run("pull")}
        >
          {controller?.isPulling
            ? t("settings.gitSection.syncBusy")
            : t("settings.gitSection.pullNow")}
        </button>
        {onBackupNow && (
          <button
            type="button"
            className="btn btn-sm"
            data-git-backup-now
            disabled={!controller?.projectPath || !status?.isRepo || busy}
            onClick={() => void backUp()}
          >
            {controller?.isBackingUp
              ? t("settings.gitSection.backingUp")
              : t("settings.gitSection.backupNow")}
          </button>
        )}
      </div>
      {onBackupNow && (
        <p className="text-xs text-muted" data-git-last-backup>
          {typeof lastBackupAt === "number" ? (
            <>
              {t("settings.gitSection.lastBackup")}{" "}
              <time dateTime={new Date(lastBackupAt).toISOString()}>
                {new Date(lastBackupAt).toLocaleString(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </>
          ) : (
            t("settings.gitSection.lastBackupNever")
          )}
        </p>
      )}
      {(controller?.error || feedback) && (
        <p
          role={controller?.error || feedback?.failed ? "alert" : "status"}
          className="text-xs break-words"
        >
          {controller?.error || feedback?.message}
        </p>
      )}
    </section>
  );
}
