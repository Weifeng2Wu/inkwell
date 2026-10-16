"use client";

import { CodeIcon, ColumnsIcon, EyeIcon } from "@phosphor-icons/react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import dynamic from "next/dynamic";
import { type ComponentProps, useCallback, useDeferredValue, useState } from "react";
import { useI18n } from "@/features/i18n";
import { resolveMarkdownImage } from "../lib/markdown";
import { MonacoEditor } from "./lazy";

const MarkdownContent = dynamic(() =>
  import("@/components/markdown/markdown-content").then((module) => module.MarkdownContent),
);

type ViewMode = "source" | "split" | "preview";

export function DraftEditor({
  filePath,
  projectPath,
  ...props
}: ComponentProps<typeof MonacoEditor> & { filePath: string; projectPath: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<ViewMode>("split");
  const content = useDeferredValue(props.content ?? "");
  const resolveImage = useCallback(
    (source: string) => {
      const path = resolveMarkdownImage(source, filePath, projectPath);
      if (!path || /^https?:\/\//i.test(path)) return path;
      return isTauri() ? convertFileSrc(path) : undefined;
    },
    [filePath, projectPath],
  );
  const views = [
    { mode: "source", icon: CodeIcon, label: t("markdown.source") },
    { mode: "split", icon: ColumnsIcon, label: t("markdown.split") },
    { mode: "preview", icon: EyeIcon, label: t("markdown.preview") },
  ] as const;
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={t("markdown.draft")}
    >
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="truncate text-xs text-muted-foreground">{t("markdown.draft")}</span>
        <fieldset aria-label={t("markdown.viewMode")} className="flex gap-1">
          {views.map(({ mode: view, icon: Icon, label }) => (
            <button
              key={view}
              type="button"
              className="toolbar-icon-button"
              title={label}
              aria-label={label}
              aria-pressed={mode === view}
              onClick={() => setMode(view)}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          ))}
        </fieldset>
      </div>
      <div
        className={`grid min-h-0 flex-1 ${mode === "split" ? "grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1" : "grid-cols-1"}`}
      >
        <div className={`min-h-0 min-w-0 ${mode === "preview" ? "hidden" : ""}`}>
          <MonacoEditor {...props} language="markdown" className="h-full" />
        </div>
        {mode !== "source" && (
          <section
            aria-label={t("markdown.preview")}
            className={`min-h-0 min-w-0 overflow-auto overscroll-contain ${mode === "split" ? "border-t border-border md:border-t-0 md:border-l" : ""}`}
          >
            <article
              className="mx-auto w-full max-w-3xl px-6 py-8 lg:px-10"
              aria-busy={content !== props.content}
            >
              {content.trim() ? (
                <MarkdownContent text={content} variant="document" resolveImage={resolveImage} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("markdown.empty")}</p>
              )}
            </article>
          </section>
        )}
      </div>
    </section>
  );
}
