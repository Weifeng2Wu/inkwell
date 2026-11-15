"use client";

import { FolderIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { formatRelativeTime, useI18n } from "@/features/i18n";
import type { RecentProject } from "@/features/workspace/lib/recent-projects";

type Pending = { kind: "remove"; project: RecentProject } | { kind: "clear" };

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
  const { t, locale } = useI18n();
  const [pending, setPending] = useState<Pending | null>(null);

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 w-full max-w-md">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="section-label">{t("recentProjects.title")}</h3>
        <button
          type="button"
          onClick={() => setPending({ kind: "clear" })}
          className="rounded text-[11px] text-muted transition-colors hover:text-foreground"
        >
          {t("recentProjects.clearAll")}
        </button>
      </div>
      <ul className="overflow-hidden rounded-lg border border-border bg-background">
        {projects.map((project, index) => (
          <li
            key={project.path}
            className="list-row motion-stagger group flex items-center border-border border-b last:border-b-0"
            style={{ "--i": index } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => onSelect(project.path)}
              className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left"
            >
              <FolderIcon className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-reading block truncate text-[14px]">{project.name}</span>
                <span
                  className="block truncate font-mono text-[11px] text-muted"
                  title={project.path}
                >
                  {project.path}
                </span>
              </span>
              <span className="shrink-0 text-[12px] text-muted">
                {formatRelativeTime(project.lastOpened, locale)}
              </span>
            </button>
            <Tooltip label={t("recentProjects.remove")} side="top">
              <button
                type="button"
                onClick={() => setPending({ kind: "remove", project })}
                className="mr-1 rounded p-1.5 text-muted opacity-0 transition-[color,opacity] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={t("recentProjects.remove")}
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            </Tooltip>
          </li>
        ))}
      </ul>

      {pending && (
        <ConfirmDialog
          title={
            pending.kind === "remove"
              ? t("recentProjects.removeTitle", { name: pending.project.name })
              : t("recentProjects.clearTitle")
          }
          message={t("recentProjects.keepsFiles")}
          confirmLabel={
            pending.kind === "remove" ? t("common.remove") : t("recentProjects.clearAll")
          }
          onConfirm={() => {
            if (pending.kind === "remove") onRemove(pending.project.path);
            else onClearAll();
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
