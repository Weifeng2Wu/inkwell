"use client";

import {
  ArrowSquareOutIcon,
  ArrowsClockwiseIcon,
  FileDashedIcon,
  FileXIcon,
  type Icon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import type { EditorSettings, EditorTheme } from "@/features/settings";
import { parseUnifiedDiffContent } from "../lib/diff";
import { EditorSkeleton } from "./editor-skeleton";
import { GitMonacoDiffEditor, MonacoEditor } from "./lazy";

export type GitDiffPreview = {
  path: string;
  staged: boolean;
  content: string;
  isLoading: boolean;
  error: string | null;
};

type Props = {
  diff: GitDiffPreview;
  editorSettings: EditorSettings;
  editorTheme: EditorTheme;
  onRefresh: () => void;
  onOpenFile: () => void;
};

/** Side-by-side preview of one file's staged or working-tree changes. */
export function GitDiffPane({ diff, editorSettings, editorTheme, onRefresh, onOpenFile }: Props) {
  const { t } = useI18n();
  const parsed = useMemo(
    () => (diff.content ? parseUnifiedDiffContent(diff.content) : null),
    [diff.content],
  );
  const notice: { icon: Icon; title: string; description: string; retry?: boolean } | null =
    diff.error
      ? {
          icon: WarningCircleIcon,
          title: t("editor.diffFailedTitle"),
          description: t("editor.diffFailed", { error: diff.error }),
          retry: true,
        }
      : parsed?.isBinary
        ? {
            icon: FileXIcon,
            title: t("editor.diffBinaryTitle"),
            description: t("editor.diffBinary"),
          }
        : !diff.content.trim()
          ? {
              icon: FileDashedIcon,
              title: t("editor.diffEmptyTitle"),
              description: t("editor.diffEmpty"),
            }
          : null;
  const slash = Math.max(diff.path.lastIndexOf("/"), diff.path.lastIndexOf("\\"));
  const directory = diff.path.slice(0, slash + 1);
  const name = diff.path.slice(slash + 1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex min-w-0 font-mono text-xs" title={diff.path}>
            {directory && <span className="truncate text-muted">{directory}</span>}
            <span className="shrink-0 text-foreground">{name}</span>
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              diff.staged ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
            }`}
          >
            {t(diff.staged ? "editor.diffStaged" : "editor.diffUnstaged")}
          </span>
          {parsed?.hasRenderableHunks && (
            <span className="flex shrink-0 gap-1.5 font-mono text-xs tabular-nums">
              <span className="text-success">+{parsed.added}</span>
              <span className="text-error">−{parsed.removed}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip label={t("editor.diffRefresh")}>
            <button
              type="button"
              onClick={onRefresh}
              disabled={diff.isLoading}
              aria-label={t("editor.diffRefresh")}
              className="toolbar-icon-button size-7"
            >
              <ArrowsClockwiseIcon className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label={t("editor.diffOpenFile")}>
            <button
              type="button"
              onClick={onOpenFile}
              aria-label={t("editor.diffOpenFile")}
              className="toolbar-icon-button size-7"
            >
              <ArrowSquareOutIcon className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div key={`${diff.path}:${diff.staged}`} className="motion-fade min-h-0 flex-1">
        {diff.isLoading ? (
          <EditorSkeleton className="h-full" />
        ) : notice ? (
          <div className="flex h-full flex-col">
            <PanelEmpty
              icon={<notice.icon className="size-7" />}
              title={notice.title}
              description={notice.description}
            >
              <div className="mt-2 flex gap-2">
                {notice.retry && (
                  <button type="button" onClick={onRefresh} className="btn btn-sm btn-secondary">
                    {t("editor.diffRetry")}
                  </button>
                )}
                <button type="button" onClick={onOpenFile} className="btn btn-sm btn-secondary">
                  {t("editor.diffOpenFile")}
                </button>
              </div>
            </PanelEmpty>
          </div>
        ) : parsed?.hasRenderableHunks ? (
          <GitMonacoDiffEditor
            original={parsed.original}
            modified={parsed.modified}
            filePath={diff.path}
            editorSettings={editorSettings}
            className="h-full"
          />
        ) : (
          <MonacoEditor
            content={diff.content}
            readOnly
            language="diff"
            editorSettings={editorSettings}
            editorTheme={editorTheme}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
