"use client";

import type { ReactNode } from "react";
import type { academicLabels } from "../lib/academic-labels";

export function ChatMessage({
  role,
  label,
  children,
}: {
  role: "user" | "assistant";
  label: string;
  children: ReactNode;
}) {
  const isUser = role === "user";
  return (
    <article
      className={`flex min-w-0 flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
    >
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <div
        className={`min-w-0 break-words text-left text-sm ${isUser ? "max-w-[85%] rounded-xl bg-surface px-3 py-2" : "w-full"}`}
        style={{ fontFamily: "var(--font-family-body)" }}
      >
        {children}
      </div>
    </article>
  );
}

export function ChatSuggestions({
  labels,
  onSelect,
}: {
  labels: Pick<
    typeof academicLabels.en,
    "suggestPolish" | "suggestStructure" | "suggestLatex" | "suggestSummary"
  >;
  onSelect: (prompt: string) => void;
}) {
  return (
    <div className="my-auto flex w-full max-w-72 flex-wrap justify-center gap-2 self-center py-8">
      {[
        labels.suggestPolish,
        labels.suggestStructure,
        labels.suggestLatex,
        labels.suggestSummary,
      ].map((prompt) => (
        <button
          key={prompt}
          type="button"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-xs leading-5 text-muted transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={() => onSelect(prompt)}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
