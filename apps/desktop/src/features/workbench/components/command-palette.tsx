"use client";

import {
  CommandIcon,
  FilePdfIcon,
  FileTextIcon,
  HashIcon,
  MagnifyingGlassIcon,
  QuotesIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/features/i18n";
import { isMac } from "@/features/settings";
import { pathSync } from "@/lib/path";
import type { Paper } from "@/types/papers";
import {
  highlight,
  modePrefix,
  type PaletteMode,
  parseInput,
  type Range,
  rank,
} from "../lib/palette";

export type PaletteCommand = {
  id: string;
  label: string;
  /** Shortcut as shown to the user, already formatted for the platform. */
  keys?: string;
  run: () => void;
};
export type PaletteHeading = { title: string; level: number; line: number };

type Props = {
  /** The mode to start in. */
  mode: PaletteMode;
  /** Project-relative paths; open tabs should come first. */
  files: readonly string[];
  papers: readonly Paper[];
  /** Headings of the document being written. */
  headings: readonly PaletteHeading[];
  commands: readonly PaletteCommand[];
  onOpenFile: (path: string, beside: boolean) => void;
  onOpenPaper: (paper: Paper, beside: boolean) => void;
  onCite: (paper: Paper) => void;
  onGoToHeading: (line: number) => void;
  onClose: () => void;
};

type Row = {
  key: string;
  group?: string;
  icon: ReactNode;
  primary: string;
  ranges: Range[];
  secondary?: string;
  keys?: string;
  /** Content titles read as serif; paths and commands stay sans. */
  reading?: boolean;
  run: (beside: boolean) => void;
};

const LIMIT = 40;
const ICON = "size-4 flex-shrink-0 text-muted";
const byline = (paper: Paper) =>
  [paper.authors[0]?.split(/\s+/).pop(), paper.year, paper.key].filter(Boolean).join(" · ");

/** Quick open, command runner, citation picker and heading jump behind one input. */
export function CommandPalette({
  mode: initialMode,
  files,
  papers,
  headings,
  commands,
  onOpenFile,
  onOpenPaper,
  onCite,
  onGoToHeading,
  onClose,
}: Props) {
  const { t } = useI18n();
  const listId = useId();
  const [input, setInput] = useState(() => modePrefix(initialMode));
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const { mode, query } = parseInput(input);

  const rows = useMemo((): Row[] => {
    const paperText = (paper: Paper) => ({
      primary: paper.title || paper.key,
      secondary: `${paper.authors.join(" ")} ${paper.year} ${paper.key} ${paper.venue}`,
    });
    if (mode === "command")
      return rank(commands, query, (command) => ({ primary: command.label }), LIMIT).map(
        ({ item, ranges }) => ({
          key: item.id,
          icon: <CommandIcon className={ICON} />,
          primary: item.label,
          ranges,
          keys: item.keys,
          run: item.run,
        }),
      );
    if (mode === "cite")
      return rank(papers, query, paperText, LIMIT).map(({ item, ranges }) => ({
        key: item.key,
        icon: <QuotesIcon className={ICON} />,
        primary: item.title || item.key,
        ranges,
        secondary: byline(item),
        reading: true,
        run: () => onCite(item),
      }));
    if (mode === "heading")
      return rank(headings, query, (heading) => ({ primary: heading.title }), LIMIT).map(
        ({ item, ranges }) => ({
          key: `${item.line}`,
          icon: <HashIcon className={ICON} style={{ marginLeft: Math.min(item.level, 4) * 10 }} />,
          primary: item.title,
          ranges,
          secondary: `${item.line}`,
          run: () => onGoToHeading(item.line),
        }),
      );
    const fileRows = rank(
      files,
      query,
      (path) => ({ primary: pathSync.basename(path), secondary: path }),
      query ? 24 : 8,
    ).map(({ item, ranges }): Row => {
      const directory = pathSync.dirname(item);
      return {
        key: `file:${item}`,
        group: t("workbench.palette.groupFiles"),
        icon: /\.pdf$/i.test(item) ? (
          <FilePdfIcon className={ICON} />
        ) : (
          <FileTextIcon className={ICON} />
        ),
        primary: pathSync.basename(item),
        ranges,
        secondary: directory === "." ? undefined : directory,
        run: (beside) => onOpenFile(item, beside),
      };
    });
    const paperRows = rank(papers, query, paperText, query ? 16 : 6).map(
      ({ item, ranges }): Row => ({
        key: `paper:${item.key}`,
        group: t("workbench.palette.groupPapers"),
        icon: <FilePdfIcon className={ICON} />,
        primary: item.title || item.key,
        ranges,
        secondary: item.file ? byline(item) : `${byline(item)} · ${t("workbench.palette.noPdf")}`,
        reading: true,
        run: (beside) => onOpenPaper(item, beside),
      }),
    );
    return [...fileRows, ...paperRows];
  }, [
    mode,
    query,
    files,
    papers,
    headings,
    commands,
    onOpenFile,
    onOpenPaper,
    onCite,
    onGoToHeading,
    t,
  ]);

  const active = Math.min(index, Math.max(rows.length - 1, 0));
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the active row changes.
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, rows]);

  const run = (row: Row | undefined, beside: boolean) => {
    if (!row) return;
    onClose();
    row.run(beside);
  };
  const beside = isMac() ? "⌘↩" : "Ctrl+↵";
  const hints = [
    t("workbench.palette.hintSelect"),
    mode === "open"
      ? `${t("workbench.palette.hintOpen")} · ${t("workbench.palette.hintBeside", { keys: beside })}`
      : t(
          mode === "command"
            ? "workbench.palette.hintRun"
            : mode === "cite"
              ? "workbench.palette.hintCite"
              : "workbench.palette.hintGo",
        ),
  ];
  const placeholder = t(
    mode === "command"
      ? "workbench.palette.placeholderCommand"
      : mode === "cite"
        ? "workbench.palette.placeholderCite"
        : mode === "heading"
          ? "workbench.palette.placeholderHeading"
          : "workbench.palette.placeholderOpen",
  );
  const empty =
    mode === "heading" && headings.length === 0
      ? t("workbench.palette.emptyHeadings")
      : mode !== "command" && mode !== "heading" && papers.length === 0 && mode === "cite"
        ? t("workbench.palette.emptyPapers")
        : t("workbench.palette.empty");

  return createPortal(
    <div
      className="fixed inset-0 z-[10001] flex justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("workbench.paletteTrigger")}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("common.close")}
        className="motion-fade absolute inset-0 cursor-default bg-black/25"
        onClick={onClose}
      />
      <div className="motion-pop relative flex max-h-[min(28rem,70vh)] w-full max-w-xl flex-col self-start overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3">
          <MagnifyingGlassIcon className={ICON} aria-hidden="true" />
          <input
            // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into.
            autoFocus
            value={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
            aria-label={placeholder}
            placeholder={placeholder}
            spellCheck={false}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setInput(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const move = (next: number) => {
                event.preventDefault();
                if (rows.length) setIndex((next + rows.length) % rows.length);
              };
              if (event.key === "ArrowDown") move(active + 1);
              else if (event.key === "ArrowUp") move(active - 1);
              else if (event.key === "Home" && !input) move(0);
              else if (event.key === "Enter") {
                event.preventDefault();
                run(rows[active], event.metaKey || event.ctrlKey);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
                // The shortcut that opened the palette also closes it.
                event.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <div ref={list} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
          {rows.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted">{empty}</p>}
          {rows.map((row, position) => (
            <div key={row.key}>
              {row.group && row.group !== rows[position - 1]?.group && (
                <div className="section-label px-3 pb-1 pt-2">{row.group}</div>
              )}
              {/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the input; rows are reached with the arrow keys. */}
              <div
                id={`${listId}-${position}`}
                role="option"
                aria-selected={position === active}
                data-active={position === active}
                className="list-row mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5"
                onPointerMove={() => position !== active && setIndex(position)}
                onClick={(event) => run(row, event.metaKey || event.ctrlKey)}
                onKeyDown={() => {}}
              >
                {row.icon}
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${row.reading ? "font-reading" : ""}`}
                >
                  {highlight(row.primary, row.ranges).map((part, offset) =>
                    part.hit ? (
                      // biome-ignore lint/suspicious/noArrayIndexKey: segments of one static string.
                      <mark key={offset} className="bg-transparent font-semibold text-accent">
                        {part.text}
                      </mark>
                    ) : (
                      part.text
                    ),
                  )}
                </span>
                {row.secondary && (
                  <span className="max-w-[45%] flex-shrink-0 truncate text-xs text-muted">
                    {row.secondary}
                  </span>
                )}
                {row.keys && <kbd className="kbd-quiet flex-shrink-0">{row.keys}</kbd>}
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted">
          <span className="truncate">{hints.join(" · ")}</span>
          {mode === "open" && (
            <span className="flex-shrink-0">{t("workbench.palette.hintModes")}</span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
