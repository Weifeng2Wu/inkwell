"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/features/i18n";
import { backupErrorReason } from "../lib/git-backup";
import type { ExitSyncController } from "../lib/use-exit-sync";

/**
 * Shown while the application is closing: offers to upload pending commits, or
 * reports a closing backup that is slow or failed. Closing cannot be cancelled,
 * so every state offers a way to close anyway.
 */
export function ExitSyncDialog({ controller }: { controller: ExitSyncController }) {
  const { t } = useI18n();
  const { prompt, confirm, closeAnyway } = controller;
  const primary = useRef<HTMLButtonElement>(null);
  const secondary = useRef<HTMLButtonElement>(null);
  const kind = prompt?.kind;

  useEffect(() => {
    if (!kind) return;
    (primary.current ?? secondary.current)?.focus();
  }, [kind]);

  if (!prompt) return null;

  const backup = prompt.kind !== "push";
  const title = t(backup ? "git.exitBackupTitle" : "git.exitPushTitle");
  let message: string;
  let error: string | undefined;
  let primaryLabel: string | null;
  let busy = false;
  switch (prompt.kind) {
    case "push":
      message = t("git.exitPushMessage", { count: prompt.ahead });
      error = prompt.error === "" ? t("git.exitPushFailed") : prompt.error;
      busy = prompt.busy;
      primaryLabel = t(busy ? "git.uploading" : "git.uploadBeforeClose");
      break;
    case "backup-running":
      message = t("git.exitBackupRunning");
      primaryLabel = null;
      break;
    case "backup-failed":
      message = t("git.exitBackupFailedMessage");
      error = backupErrorReason(prompt.code, t);
      primaryLabel = t("git.exitBackupRetry");
      break;
    case "backup-push-failed":
      message = t("git.exitBackupPushFailedMessage");
      error = prompt.error || t("git.pushFailed");
      primaryLabel = t("git.exitBackupRetry");
      break;
  }

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exit-sync-title"
      aria-describedby="exit-sync-message"
      data-exit-sync={prompt.kind}
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h2 id="exit-sync-title" className="text-sm font-medium">
            {title}
          </h2>
        </div>
        <div className="px-5 py-4">
          <p
            id="exit-sync-message"
            className="text-sm text-muted"
            role={prompt.kind === "backup-running" ? "status" : undefined}
          >
            {message}
          </p>
          {error && (
            <p
              role="alert"
              className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm text-error"
            >
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
          <button
            ref={secondary}
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={closeAnyway}
            disabled={busy}
          >
            {t(backup ? "git.closeAnyway" : "git.closeWithoutUploading")}
          </button>
          {primaryLabel && (
            <button
              ref={primary}
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void confirm()}
              disabled={busy}
            >
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
