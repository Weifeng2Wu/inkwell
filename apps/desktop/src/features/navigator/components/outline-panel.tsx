"use client";

import { ListBulletsIcon, TextHOneIcon } from "@phosphor-icons/react";
import { type CSSProperties, useDeferredValue, useMemo, useSyncExternalStore } from "react";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cursorSnapshot, subscribeCursor } from "@/features/editor/lib/active-editor";
import { formatNumber, useI18n } from "@/features/i18n";
import { isMenuKey, moveRowFocus } from "@/lib/list-navigation";
import { countWords, currentHeading, documentOutline, readingMinutes } from "../lib/outline";

type OutlinePanelProps = {
  /** Active document; an empty state is shown when missing or unsupported. */
  filePath?: string;
  content: string;
  /** Monaco language id: "latex" | "markdown" | anything else. */
  language: string;
  onGoToLine: (line: number) => void;
};

const INDENT = 12;
const PROSE_LANGUAGES = new Set(["latex", "markdown", "plaintext"]);
const noCursor = () => null;

export function OutlinePanel({ filePath, content, language, onGoToLine }: OutlinePanelProps) {
  const { t, locale } = useI18n();
  const text = useDeferredValue(content);
  const cursor = useSyncExternalStore(subscribeCursor, cursorSnapshot, noCursor);
  const supported = language === "latex" || language === "markdown";
  const items = useMemo(
    () => (filePath && supported ? documentOutline(text, language) : []),
    [filePath, supported, text, language],
  );
  const stats = useMemo(
    () =>
      filePath && PROSE_LANGUAGES.has(language)
        ? { words: countWords(text, language), minutes: readingMinutes(text, language) }
        : null,
    [filePath, text, language],
  );
  const title = t("workbench.views.outline");

  if (!filePath) {
    return (
      <>
        <PanelHeader title={title} />
        <PanelEmpty
          icon={<ListBulletsIcon className="size-7" />}
          title={t("navigator.noDocument")}
          description={t("navigator.noDocumentHint")}
        />
      </>
    );
  }

  const base = Math.min(...items.map((item) => item.level));
  const current = currentHeading(items, cursor?.line);
  const summary = stats
    ? [
        t("navigator.wordCount", {
          count: formatNumber(stats.words, locale),
          s: stats.words === 1 ? "" : "s",
        }),
        stats.minutes > 0 ? t("navigator.readingTime", { minutes: stats.minutes }) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <PanelHeader title={title} />
      <div className="border-b border-border px-3 py-2">
        <p className="truncate text-[13px] text-foreground" title={filePath}>
          {filePath.split(/[\\/]/).pop()}
        </p>
        {summary && <p className="mt-0.5 truncate text-xs tabular-nums text-muted">{summary}</p>}
      </div>
      {items.length === 0 ? (
        <PanelEmpty
          icon={<TextHOneIcon className="size-7" />}
          title={t(supported ? "navigator.noHeadings" : "navigator.unsupported")}
          description={
            supported
              ? t(
                  language === "latex"
                    ? "navigator.noHeadingsLatex"
                    : "navigator.noHeadingsMarkdown",
                )
              : undefined
          }
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1" autoHide="leave">
          <nav
            aria-label={t("navigator.outlineLabel")}
            className="motion-rise py-1"
            onKeyDown={(event) => {
              if (!isMenuKey(event)) moveRowFocus(event);
            }}
          >
            <ul>
              {items.map((item, index) => {
                const depth = item.level - base;
                const active = item === current;
                return (
                  <li key={`${item.line}:${item.level}`} className="relative">
                    {Array.from({ length: depth }, (_, guide) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: guides are positional and never reorder.
                        key={guide}
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 z-10 w-px bg-border"
                        style={{ left: INDENT + 4 + guide * INDENT }}
                      />
                    ))}
                    <button
                      type="button"
                      data-list-row
                      data-active={active}
                      aria-current={active ? "location" : undefined}
                      tabIndex={(current ? active : index === 0) ? 0 : -1}
                      onClick={() => onGoToLine(item.line)}
                      title={item.title}
                      style={
                        {
                          paddingLeft: INDENT + depth * INDENT,
                          "--i": index,
                        } as CSSProperties
                      }
                      className={`list-row motion-stagger block w-full truncate pr-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent ${
                        depth === 0 ? "font-reading py-1.5 text-sm" : "py-1 text-[13px]"
                      } ${
                        active
                          ? "text-accent"
                          : depth === 0
                            ? "text-foreground"
                            : "text-foreground-secondary"
                      }`}
                    >
                      {item.title || t("navigator.untitled")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        </ScrollArea>
      )}
    </>
  );
}
