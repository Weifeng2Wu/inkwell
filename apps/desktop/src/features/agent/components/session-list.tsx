"use client";

import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useMemo, useState } from "react";
import { TrashIcon } from "@/features/agent/components/icons";
import { formatRelativeTime } from "@/features/agent/components/utils";
import type { SessionInfo } from "@/features/agent/lib/types";
import { useI18n } from "@/features/i18n";

export function SessionList({
  sessions,
  currentSessionId,
  onSelect,
  onNewSession,
  onDelete,
}: {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onNewSession: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [listParent] = useAutoAnimate({ duration: 200 });
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.time.updated - a.time.updated),
    [sessions],
  );

  if (sortedSessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted">{t("agent.noSessionsYet")}</p>
          <button type="button" onClick={onNewSession} className="btn btn-sm">
            {t("agent.createFirstSession")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={listParent} className="flex-1 min-h-0 overflow-y-auto">
      {sortedSessions.map((session) => {
        const isActive = session.id === currentSessionId;
        const timeStr = formatRelativeTime(new Date(session.time.updated));

        return (
          <div
            key={session.id}
            className={`w-full flex items-center border-b border-border hover:bg-accent-hover transition-colors ${isActive ? "bg-surface-secondary" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelect(session.id)}
              className="flex-1 text-left px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{session.title || t("agent.newChat")}</p>
                  {session.summary?.files !== undefined && (
                    <p className="text-xs text-muted mt-0.5">
                      {t("agent.filesModified", {
                        count: session.summary.files,
                        s: session.summary.files !== 1 ? "s" : "",
                      })}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted flex-shrink-0">{timeStr}</span>
              </div>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteConfirmId(session.id);
              }}
              className="px-3 py-2 text-muted hover:text-error transition-colors"
              title={t("common.delete")}
            >
              <TrashIcon className="size-4" />
            </button>
          </div>
        );
      })}

      {deleteConfirmId && (
        <ConfirmDialog
          message={t("agent.deleteSessionConfirm")}
          onConfirm={() => {
            onDelete(deleteConfirmId);
            setDeleteConfirmId(null);
          }}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
}

export function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <p className="text-sm text-muted">{t("agent.emptyState")}</p>
    </div>
  );
}

export function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="bg-background border border-border rounded-lg p-4 max-w-xs w-full mx-4 shadow-2xl">
        <p className="text-sm mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm border border-border hover:bg-surface-secondary transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button type="button" onClick={onConfirm} className="btn btn-sm">
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
