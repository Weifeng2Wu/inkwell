"use client";

import { useI18n } from "@/features/i18n";
import "./editor.css";

const ROWS = [70, 45, 60, 80, 35, 55, 40, 75];

/**
 * Placeholder lines while a document loads. It stays invisible for the first moments
 * (see `editor.css`), so a document that opens quickly never flashes it.
 */
export function EditorSkeleton({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-label={t("common.loading")}
      className={`editor-skeleton flex flex-col bg-background ${className}`}
    >
      <div className="flex-1 space-y-2.5 p-4">
        {ROWS.map((width) => (
          <div key={width} className="flex gap-4">
            <div className="h-3.5 w-8 shrink-0 rounded-sm bg-surface-secondary" />
            <div className="h-3.5 rounded-sm bg-surface-secondary" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
