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
}

export function GitSyncSettings({ controller }: { controller?: GitSyncController }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  const status = controller?.status;
  const available = Boolean(controller?.projectPath && status?.isRepo && status.remote);
  const busy =
    pending || controller?.isRefreshing || controller?.isPulling || controller?.isPushing;

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
      <p className="text-xs text-muted">{t("settings.gitSection.syncHint")}</p>
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
      </div>
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
