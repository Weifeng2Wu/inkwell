"use client";

import { FolderIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { formatRelativeTime } from "@/features/agent/components/utils";
import { useI18n } from "@/features/i18n";
import type { RecentProject } from "@/features/workspace/lib/recent-projects";

export function RecentProjects({
  projects,
  onSelect,
  onRemove,
  onClearAll,
}: {
  projects: RecentProject[];
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
  onClearAll: () => void;
}) {
  const { t } = useI18n();
  const [deleteConfirmPath, setDeleteConfirmPath] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 w-full max-w-md">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted">{t("welcome.recentProjects")}</h3>
        <button
          type="button"
          onClick={() => setShowClearConfirm(true)}
          className="text-xs text-muted hover:text-foreground transition-colors"
        >
          {t("welcome.clearAll")}
        </button>
      </div>
      <div className="border border-border bg-background">
        {projects.map((project) => {
          const timeStr = formatRelativeTime(new Date(project.lastOpened));
          return (
            <div
              key={project.path}
              className="flex items-center border-b border-border last:border-b-0 hover:bg-accent-hover transition-colors"
            >
              <button
                type="button"
                onClick={() => onSelect(project.path)}
                className="flex-1 text-left px-3 py-2.5 flex items-center gap-3 min-w-0"
              >
                <FolderIcon className="size-4 text-muted flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{project.name}</p>
                  <p className="text-xs text-muted truncate">{project.path}</p>
                </div>
                <span className="text-xs text-muted flex-shrink-0">{timeStr}</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteConfirmPath(project.path);
                }}
                className="px-3 py-2 text-muted hover:text-error transition-colors"
                title={t("common.remove")}
              >
                <TrashIcon className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      {deleteConfirmPath && (
        <ConfirmDialog
          message={t("welcome.removeRecentConfirm")}
          onConfirm={() => {
            onRemove(deleteConfirmPath);
            setDeleteConfirmPath(null);
          }}
          onCancel={() => setDeleteConfirmPath(null)}
        />
      )}

      {showClearConfirm && (
        <ConfirmDialog
          message={t("welcome.clearRecentConfirm")}
          onConfirm={() => {
            onClearAll();
            setShowClearConfirm(false);
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}

function ConfirmDialog({
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
            {t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
