"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/features/i18n";

export function ChatMessage({
  role,
  label,
  entering = false,
  children,
}: {
  role: "user" | "assistant";
  label: string;
  /** Marks a message that has just been added, so it rises into place once. */
  entering?: boolean;
  children: ReactNode;
}) {
  const isUser = role === "user";
  return (
    <article
      className={`flex min-w-0 flex-col gap-1 ${isUser ? "items-end" : "items-start"} ${entering ? "motion-rise" : ""}`}
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

const MENTION = /(@[\w-]+)/;

/**
 * What an empty conversation shows: prompts worth trying and how to bring files,
 * papers, Skills and selected text into a message.
 */
export function ChatEmptyState({ onSelect }: { onSelect: (prompt: string) => void }) {
  const { t } = useI18n();
  const examples = [
    { label: t("agent.empty.summarize"), prompt: t("agent.empty.summarizePrompt") },
    { label: t("agent.empty.citations") },
    { label: t("agent.empty.academic") },
    { label: t("agent.empty.latex") },
  ];
  return (
    <div className="motion-rise my-auto w-full max-w-80 self-center py-4">
      <p className="section-label px-3">{t("agent.empty.examples")}</p>
      <ul className="mt-1 divide-y divide-border/60">
        {examples.map(({ label, prompt }) => (
          <li key={label}>
            <button
              type="button"
              data-chat-example
              className="list-row flex min-h-7 w-full items-center rounded-md px-3 py-1.5 text-left text-[13px] leading-5 text-foreground-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => onSelect(prompt ?? label)}
            >
              <span className="min-w-0 break-words">
                {label.split(MENTION).map((part, index) =>
                  MENTION.test(part) ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: The parts of one fixed label never reorder.
                    <span key={index} className="text-accent">
                      {part}
                    </span>
                  ) : (
                    part
                  ),
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ul className="mt-4 space-y-1.5 px-3 text-xs leading-5 text-muted">
        <li className="flex items-baseline gap-2">
          <kbd className="kbd-quiet shrink-0">@</kbd>
          <span>{t("agent.empty.hintMention")}</span>
        </li>
        <li className="flex items-baseline gap-2">
          <kbd className="kbd-quiet shrink-0">/</kbd>
          <span>{t("agent.empty.hintSkill")}</span>
        </li>
        <li>{t("agent.empty.hintSelection", { action: t("interface.addSelection") })}</li>
      </ul>
    </div>
  );
}
