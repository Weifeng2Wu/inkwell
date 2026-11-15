"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CloudCheckIcon,
  GitBranchIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useSyncExternalStore } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { cursorSnapshot, subscribeCursor } from "@/features/editor/lib/active-editor";
import { useI18n } from "@/features/i18n";

export type CompileState = "idle" | "compiling" | "ok" | "failed";

type Props = {
  git: { branch: string; ahead: number; behind: number; changes: number } | null;
  /** Automatic backup, when it is enabled. */
  backup: { running: boolean; lastBackupAt: number | null } | null;
  compile: CompileState;
  /** The text document being written. */
  document: { words: number | null; citations: number; missing: number } | null;
  unsaved: boolean;
  onOpenGit: () => void;
  onOpenOutline: () => void;
  /** Shows where the citations are: the library, or the first missing one. */
  onOpenCitations: () => void;
  onCompile: () => void;
};

function Segment({
  hint,
  onClick,
  tone = "",
  children,
}: {
  hint: string;
  onClick?: () => void;
  tone?: string;
  children: ReactNode;
}) {
  const className = `flex h-6 items-center gap-1 px-2 transition-colors duration-150 ${tone}`;
  return (
    <Tooltip label={hint} side="top">
      {onClick ? (
        <button
          type="button"
          aria-label={hint}
          onClick={onClick}
          className={`${className} hover:bg-surface-secondary hover:text-foreground`}
        >
          {children}
        </button>
      ) : (
        <span className={className}>{children}</span>
      )}
    </Tooltip>
  );
}

/** The bottom bar: repository state on the left, the document being written on the right. */
export function StatusBar({
  git,
  backup,
  compile,
  document,
  unsaved,
  onOpenGit,
  onOpenOutline,
  onOpenCitations,
  onCompile,
}: Props) {
  const { t, locale } = useI18n();
  const cursor = useSyncExternalStore(subscribeCursor, cursorSnapshot, () => null);
  const number = new Intl.NumberFormat(locale);
  const icon = "size-3.5 flex-shrink-0";
  const backedUp = backup?.lastBackupAt
    ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
        backup.lastBackupAt,
      )
    : null;

  return (
    <footer
      data-workspace-shell
      className="flex h-6 flex-shrink-0 items-center justify-between border-t border-border bg-surface text-[11px] text-muted"
    >
      <div className="flex min-w-0 items-center">
        {git && (
          <Segment hint={t("workbench.status.openGit")} onClick={onOpenGit}>
            <GitBranchIcon className={icon} aria-hidden="true" />
            <span className="max-w-40 truncate font-mono">{git.branch}</span>
            {git.ahead > 0 && (
              <span className="flex items-center">
                <ArrowUpIcon className="size-3" aria-hidden="true" />
                {git.ahead}
              </span>
            )}
            {git.behind > 0 && (
              <span className="flex items-center">
                <ArrowDownIcon className="size-3" aria-hidden="true" />
                {git.behind}
              </span>
            )}
            {git.changes > 0 && (
              <span>{t("workbench.status.changes", { count: git.changes })}</span>
            )}
          </Segment>
        )}
        {backup && (backup.running || backedUp) && (
          <Segment hint={t("workbench.status.backupHint")}>
            {backup.running ? (
              <CircleNotchIcon className={`${icon} animate-spin`} aria-hidden="true" />
            ) : (
              <CloudCheckIcon className={icon} aria-hidden="true" />
            )}
            {backup.running
              ? t("workbench.status.backingUp")
              : t("workbench.status.backedUp", { time: backedUp ?? "" })}
          </Segment>
        )}
        {compile !== "idle" && (
          <Segment
            hint={t("workbench.compile")}
            onClick={compile === "compiling" ? undefined : onCompile}
            tone={compile === "failed" ? "text-error" : ""}
          >
            {compile === "compiling" ? (
              <CircleNotchIcon className={`${icon} animate-spin`} aria-hidden="true" />
            ) : compile === "ok" ? (
              <CheckCircleIcon className={`${icon} text-success`} aria-hidden="true" />
            ) : (
              <WarningCircleIcon className={icon} aria-hidden="true" />
            )}
            {t(
              compile === "compiling"
                ? "workbench.compiling"
                : compile === "ok"
                  ? "workbench.status.compiled"
                  : "workbench.status.compileFailed",
            )}
          </Segment>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center">
        {document && document.missing > 0 && (
          <Segment
            hint={t("workbench.status.missingHint")}
            onClick={onOpenCitations}
            tone="text-warning"
          >
            <WarningCircleIcon className={icon} aria-hidden="true" />
            {t("workbench.status.missing", { count: document.missing })}
          </Segment>
        )}
        {document && document.citations > 0 && (
          <Segment hint={t("workbench.status.citationsHint")} onClick={onOpenCitations}>
            {t("workbench.status.citations", { count: document.citations })}
          </Segment>
        )}
        {document && document.words !== null && (
          <Segment hint={t("workbench.status.wordsHint")} onClick={onOpenOutline}>
            {t("workbench.status.words", { count: number.format(document.words) })}
          </Segment>
        )}
        {cursor && (
          <Segment hint={t("workbench.status.cursorHint")}>
            <span className="tabular-nums">
              {t("workbench.status.cursor", { line: cursor.line, column: cursor.column })}
              {cursor.selected > 0 &&
                ` (${t("workbench.status.selected", { count: number.format(cursor.selected) })})`}
            </span>
          </Segment>
        )}
        {document && (
          <span className="flex h-6 items-center px-2" aria-live="polite">
            {t(unsaved ? "workbench.status.saving" : "workbench.status.saved")}
          </span>
        )}
      </div>
    </footer>
  );
}
