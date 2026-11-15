"use client";

import { useId, useState } from "react";
import { GitMonacoDiffEditor } from "@/features/editor/components/lazy";
import { useI18n } from "@/features/i18n";
import type { EditorSettings } from "@/features/settings";
import { applyReviewedHunks, type ReviewHunk } from "../lib/review-changes";
import type { useAgentReview } from "../lib/use-agent-review";

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
  const { t } = useI18n();
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
          {t("agent.review.title", { count: review.changes.length })}
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={review.busy}
            onClick={() => void review.decideAll(true)}
          >
            {t("agent.review.acceptAll")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={review.busy}
            onClick={() => void review.decideAll(false)}
          >
            {t("agent.review.rejectAll")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={review.busy}
            onClick={() => review.setOpen(false)}
          >
            {t("agent.review.close")}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <select
          aria-label={t("agent.review.file")}
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
          {t("agent.review.accept")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={review.busy}
          onClick={() => void review.decide(change, false)}
        >
          {t("agent.review.reject")}
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
          acceptLabel: t("agent.review.accept"),
          rejectLabel: t("agent.review.reject"),
          disabled: review.busy,
          onDecide: decideHunk,
        }}
        className="min-h-0 min-w-0 flex-1"
      />
    </section>
  );
}
