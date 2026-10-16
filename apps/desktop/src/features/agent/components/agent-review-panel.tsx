"use client";

import { useId, useState } from "react";
import { GitMonacoDiffEditor } from "@/features/editor/components/lazy";
import { useI18n } from "@/features/i18n";
import type { EditorSettings } from "@/features/settings";
import { applyReviewedHunks, type ReviewHunk } from "../lib/review-changes";
import type { useAgentReview } from "../lib/use-agent-review";

const copy = {
  zh: {
    title: "审阅 Agent 修改",
    accept: "接受",
    reject: "拒绝",
    acceptAll: "全部接受",
    rejectAll: "全部拒绝",
    close: "返回编辑",
    file: "文件",
  },
  en: {
    title: "Review Agent changes",
    accept: "Accept",
    reject: "Reject",
    acceptAll: "Accept all",
    rejectAll: "Reject all",
    close: "Back to editing",
    file: "File",
  },
  ko: {
    title: "Agent 변경 검토",
    accept: "수락",
    reject: "거절",
    acceptAll: "모두 수락",
    rejectAll: "모두 거절",
    close: "편집으로 돌아가기",
    file: "파일",
  },
};

export function AgentReviewPanel({
  review,
  editorSettings,
  filePath,
  onFileSelect,
}: {
  review: ReturnType<typeof useAgentReview>;
  editorSettings?: Partial<EditorSettings>;
  filePath?: string;
  onFileSelect?: (path: string) => void;
}) {
  const { locale } = useI18n();
  const labels = copy[locale];
  const title = useId();
  const [path, setPath] = useState("");
  const change =
    review.changes.find((entry) => entry.path === (filePath ?? path)) ?? review.changes[0];
  if (!review.open || !change) return null;

  function decideHunk(hunks: ReviewHunk[], index: number, accept: boolean) {
    if (!change || review.busy) return;
    if (hunks.length === 1) {
      void review.decide(change, accept);
      return;
    }
    const original = change.before ?? "";
    const proposed = change.after ?? "";
    if (accept) {
      const content = applyReviewedHunks(original, proposed, hunks, [index]);
      void review.decide(change, true, content, proposed);
    } else {
      const remaining = applyReviewedHunks(
        original,
        proposed,
        hunks,
        hunks.flatMap((_, position) => (position === index ? [] : [position])),
      );
      void review.decide(change, false, change.after, remaining);
    }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      aria-labelledby={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 id={title} className="text-sm font-semibold">
          {labels.title} ({review.changes.length})
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={review.busy}
            onClick={() => void review.decideAll(true)}
          >
            {labels.acceptAll}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={review.busy}
            onClick={() => void review.decideAll(false)}
          >
            {labels.rejectAll}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={review.busy}
            onClick={() => review.setOpen(false)}
          >
            {labels.close}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <select
          aria-label={labels.file}
          className="settings-control min-w-0 flex-1"
          value={change.path}
          onChange={(event) => {
            setPath(event.target.value);
            onFileSelect?.(event.target.value);
          }}
        >
          {review.changes.map((entry) => (
            <option key={entry.path} value={entry.path}>
              {entry.path}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={review.busy}
          onClick={() => void review.decide(change, true)}
        >
          {labels.accept}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={review.busy}
          onClick={() => void review.decide(change, false)}
        >
          {labels.reject}
        </button>
      </div>
      {review.error && (
        <p role="alert" className="px-3 py-2 text-xs text-error">
          {review.error}
        </p>
      )}
      <GitMonacoDiffEditor
        key={change.path}
        original={change.before ?? ""}
        modified={change.after ?? ""}
        filePath={change.path}
        editorSettings={editorSettings}
        inlineReview={{
          acceptLabel: labels.accept,
          rejectLabel: labels.reject,
          disabled: review.busy,
          onDecide: decideHunk,
        }}
        className="min-h-0 min-w-0 flex-1"
      />
    </section>
  );
}
