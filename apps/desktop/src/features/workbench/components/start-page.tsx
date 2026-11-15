"use client";

import { FilePdfIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useI18n } from "@/features/i18n";
import type { Paper } from "@/types/papers";

export type StartAction = {
  id: string;
  label: string;
  keys?: string;
  icon: ReactNode;
  run: () => void;
};

type Props = {
  projectName: string;
  /** Counts shown under the title. */
  references: number;
  /** What the user can do next, most useful first. */
  actions: readonly StartAction[];
  /** Papers still to read, in reading order. */
  queue: readonly Paper[];
  onOpenPaper: (paper: Paper) => void;
};

/** Shown in the editor area while no document is open. */
export function StartPage({ projectName, references, actions, queue, onOpenPaper }: Props) {
  const { t } = useI18n();
  return (
    <div className="motion-rise flex h-full w-full justify-center overflow-y-auto px-8 py-[10vh]">
      <div className="w-full max-w-xl">
        <h1 className="font-reading text-2xl leading-tight text-foreground">{projectName}</h1>
        <p className="mt-1 text-xs text-muted">
          {t("workbench.start.references", { count: references })}
        </p>

        <section className="mt-8">
          <h2 className="section-label pb-1">{t("workbench.start.actions")}</h2>
          <ul>
            {actions.map((action, index) => (
              <li
                key={action.id}
                className="motion-stagger"
                style={{ "--i": index } as React.CSSProperties}
              >
                <button
                  type="button"
                  onClick={action.run}
                  className="list-row -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]"
                >
                  <span className="flex-shrink-0 text-muted">{action.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {action.keys && <kbd className="kbd-quiet flex-shrink-0">{action.keys}</kbd>}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <h2 className="section-label pb-1">{t("workbench.start.queue")}</h2>
          {queue.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted">{t("workbench.start.queueEmpty")}</p>
          ) : (
            <ul>
              {queue.map((paper, index) => (
                <li
                  key={paper.key}
                  className="motion-stagger"
                  style={{ "--i": index + actions.length } as React.CSSProperties}
                >
                  <button
                    type="button"
                    onClick={() => onOpenPaper(paper)}
                    className="list-row -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-md px-2 py-1.5 text-left"
                  >
                    <FilePdfIcon
                      className="mt-0.5 size-4 flex-shrink-0 text-muted"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="font-reading block truncate text-sm">
                        {paper.title || paper.key}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[paper.authors[0], paper.year, paper.venue].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-10 text-xs text-muted">{t("workbench.start.dropHint")}</p>
      </div>
    </div>
  );
}
