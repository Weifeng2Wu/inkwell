"use client";

import {
  ArrowsInLineVerticalIcon,
  ArrowsOutLineVerticalIcon,
  CaretRightIcon,
  MagnifyingGlassIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Collapse } from "@/components/ui/collapse";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { PanelAction, PanelHeader } from "@/components/ui/panel-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import { shortcutLabel, useKeyboardShortcuts } from "@/features/settings";
import { eventRow, listRows, moveRowFocus, typedCharacter } from "@/lib/list-navigation";
import type { FileNode } from "@/types/files";
import {
  SEARCH_INVALID_REGEX,
  SEARCH_MAX_MATCHES,
  type SearchMatch,
  type SearchOptions,
  searchablePaths,
  searchProject,
} from "../lib/search";

type SearchPanelProps = {
  projectPath: string | null;
  files: FileNode[];
  readFile: (path: string) => Promise<string | null>;
  /** Unsaved editor buffers; these win over the file on disk. */
  buffers?: ReadonlyMap<string, string>;
  onOpenResult: (path: string, line: number) => void;
};

type Result = { matches: SearchMatch[]; truncated: boolean };

const DEBOUNCE_MS = 250;
const NO_RESULT: Result = { matches: [], truncated: false };
const DEFAULT_OPTIONS: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };
const TOGGLE =
  "inline-flex h-6 min-w-7 shrink-0 items-center justify-center rounded-md border px-1.5 font-mono text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";
const TOGGLE_OFF =
  "border-border text-foreground-secondary hover:border-border-dark hover:bg-surface-secondary hover:text-foreground";
const TOGGLE_ON = "border-accent/40 bg-accent-hover text-accent";
/** Rows that get the staggered entrance; later ones appear at once. */
const STAGGERED = 12;

const TOGGLES = [
  { option: "caseSensitive", glyph: "Aa", label: "navigator.caseSensitive" },
  { option: "wholeWord", glyph: "ab", label: "navigator.wholeWord" },
  { option: "regex", glyph: ".*", label: "navigator.regex" },
] as const;

function splitPath(path: string) {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { name: path.slice(at + 1), directory: at > 0 ? path.slice(0, at) : "" };
}

export function SearchPanel({
  projectPath,
  files,
  readFile,
  buffers,
  onOpenResult,
}: SearchPanelProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [result, setResult] = useState(NO_RESULT);
  const [state, setState] = useState<"idle" | "searching" | "done" | "invalid">("idle");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [project, setProject] = useState(projectPath);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const { bindings } = useKeyboardShortcuts();
  const searchKeys = shortcutLabel(bindings.search);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const source = useRef({ files, readFile, buffers });

  // A different project invalidates everything; the query effect below aborts the running search.
  if (project !== projectPath) {
    setProject(projectPath);
    setQuery("");
    setResult(NO_RESULT);
    setState("idle");
    setCollapsed(new Set());
  }

  useEffect(() => {
    source.current = { files, readFile, buffers };
  });

  const run = useCallback(async (text: string, searchOptions: SearchOptions) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
    if (!text) {
      setResult(NO_RESULT);
      setState("idle");
      return;
    }
    const current = new AbortController();
    controller.current = current;
    setState("searching");
    setResult(NO_RESULT);
    setCollapsed(new Set());
    try {
      const found = await searchProject({
        paths: searchablePaths(source.current.files),
        readFile: source.current.readFile,
        buffers: source.current.buffers,
        query: text,
        options: searchOptions,
        signal: current.signal,
        onProgress: (matches) => {
          if (!current.signal.aborted) setResult({ matches, truncated: false });
        },
      });
      if (current.signal.aborted) return;
      setResult(found);
      setState("done");
    } catch (error) {
      if (current.signal.aborted) return;
      setResult(NO_RESULT);
      setState(
        error instanceof Error && error.message === SEARCH_INVALID_REGEX ? "invalid" : "done",
      );
    }
  }, []);

  useEffect(() => {
    if (!query) {
      void run("", options);
      return;
    }
    timer.current = setTimeout(() => void run(query, options), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, options, run]);

  useEffect(() => {
    if (project !== null) input.current?.focus();
    return () => controller.current?.abort();
  }, [project]);

  const groups = useMemo(() => {
    const byPath = new Map<string, SearchMatch[]>();
    for (const match of result.matches) {
      const group = byPath.get(match.path);
      if (group) group.push(match);
      else byPath.set(match.path, [match]);
    }
    return [...byPath];
  }, [result.matches]);
  const summary = t("navigator.resultSummary", {
    matches: result.matches.length,
    files: groups.length,
    s: groups.length === 1 ? "" : "s",
  });

  const title = t("workbench.views.search");
  if (!projectPath) {
    return (
      <>
        <PanelHeader title={title} />
        <PanelEmpty
          icon={<MagnifyingGlassIcon className="size-7" />}
          title={t("navigator.searchNoProject")}
        />
      </>
    );
  }

  const toggleGroup = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const allCollapsed = groups.length > 0 && groups.every(([path]) => collapsed.has(path));
  const clear = () => {
    setQuery("");
    input.current?.focus();
  };

  const onResultsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    const row = eventRow(event.target);
    if (!row) return;
    if (event.key === "Escape") {
      event.preventDefault();
      return clear();
    }
    if (event.key === "ArrowUp" && listRows(event.currentTarget)[0] === row) {
      event.preventDefault();
      return input.current?.focus();
    }
    if (moveRowFocus(event)) return;
    const group = row.dataset.group;
    if (group !== undefined && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      if (collapsed.has(group) === (event.key === "ArrowRight")) toggleGroup(group);
      return;
    }
    const typed = typedCharacter(event);
    if (typed === null) return;
    event.preventDefault();
    setQuery((current) => current + typed);
    input.current?.focus();
  };

  return (
    <>
      <PanelHeader title={title}>
        <PanelAction
          label={t(allCollapsed ? "navigator.expandAll" : "navigator.collapseAll")}
          disabled={groups.length === 0}
          onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map(([p]) => p)))}
        >
          {allCollapsed ? (
            <ArrowsOutLineVerticalIcon className="size-4" aria-hidden="true" />
          ) : (
            <ArrowsInLineVerticalIcon className="size-4" aria-hidden="true" />
          )}
        </PanelAction>
        <PanelAction
          label={t("navigator.clearSearch")}
          keys="Esc"
          disabled={!query}
          onClick={clear}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </PanelAction>
      </PanelHeader>
      <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
        <div className="relative">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted"
          />
          <input
            ref={input}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") void run(query, options);
              else if (event.key === "Escape") setQuery("");
              else if (event.key === "ArrowDown" && results.current) {
                const first = listRows(results.current)[0];
                if (!first) return;
                event.preventDefault();
                first.focus();
              }
            }}
            aria-label={t("navigator.searchPlaceholder")}
            aria-invalid={state === "invalid"}
            placeholder={t("navigator.searchPlaceholder")}
            spellCheck={false}
            className="h-7 w-full rounded-md border border-border bg-background pl-7 pr-2 text-[13px] transition-colors duration-150 placeholder:text-muted-foreground focus:border-accent focus:outline-none aria-invalid:border-error"
          />
        </div>
        <div className="flex items-center gap-1">
          {TOGGLES.map(({ option, glyph, label }) => (
            <Tooltip key={option} label={t(label)}>
              <button
                type="button"
                aria-pressed={options[option]}
                aria-label={t(label)}
                onClick={() =>
                  setOptions((previous) => ({ ...previous, [option]: !previous[option] }))
                }
                className={`${TOGGLE} ${options[option] ? TOGGLE_ON : TOGGLE_OFF} ${
                  option === "wholeWord" ? "underline underline-offset-2" : ""
                }`}
              >
                {glyph}
              </button>
            </Tooltip>
          ))}
          <span
            className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted"
            role="status"
          >
            {state === "searching" && (
              <>
                <Spinner className="size-3.5 flex-shrink-0" />
                <span className="sr-only">{t("navigator.searching")}</span>
              </>
            )}
            {result.matches.length > 0 && (
              <span className="truncate tabular-nums" title={summary}>
                {summary}
              </span>
            )}
          </span>
        </div>
        {state === "invalid" && (
          <p className="text-xs leading-relaxed text-error" role="alert">
            {t("navigator.invalidRegex")}
          </p>
        )}
      </div>
      {result.matches.length === 0 ? (
        state === "idle" ? (
          <PanelEmpty
            icon={<MagnifyingGlassIcon className="size-7" />}
            title={t("navigator.searchPlaceholder")}
            description={t("navigator.searchHint")}
          >
            <ul className="mt-2 space-y-1 text-left text-xs text-muted">
              {TOGGLES.map(({ option, glyph, label }) => (
                <li key={option} className="flex items-center gap-2">
                  <kbd className="kbd-quiet min-w-7 text-center">{glyph}</kbd>
                  {t(label)}
                </li>
              ))}
            </ul>
            <p className="mt-2 max-w-[16rem] text-[11px] leading-relaxed text-muted-foreground">
              {t("navigator.searchKeys")}
            </p>
            {searchKeys && <kbd className="kbd-quiet mt-1">{searchKeys}</kbd>}
          </PanelEmpty>
        ) : state === "done" ? (
          <div className="motion-fade px-4 py-6 text-center text-xs leading-relaxed">
            <p className="break-words text-foreground">{t("navigator.noResults", { query })}</p>
            <p className="mt-1 text-muted">{t("navigator.noResultsHint")}</p>
          </div>
        ) : null
      ) : (
        <ScrollArea className="min-h-0 flex-1" autoHide="leave">
          {result.truncated && (
            <p className="border-b border-border px-3 py-1.5 text-xs leading-relaxed text-muted">
              {t("navigator.truncated", { count: SEARCH_MAX_MATCHES })}
            </p>
          )}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: keys bubble up from the rows, which are buttons. */}
          <div ref={results} onKeyDown={onResultsKeyDown}>
            <ul aria-label={t("navigator.resultsLabel")} className="pb-2">
              {groups.map(([path, matches], groupIndex) => {
                const { name, directory } = splitPath(path);
                const open = !collapsed.has(path);
                return (
                  <li key={path}>
                    <button
                      type="button"
                      data-list-row
                      data-group={path}
                      aria-expanded={open}
                      onClick={() => toggleGroup(path)}
                      title={path}
                      style={{ "--i": groupIndex } as CSSProperties}
                      className={`list-row flex h-7 w-full items-center gap-1.5 pl-2 pr-3 text-left text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent ${
                        groupIndex < STAGGERED ? "motion-stagger" : ""
                      }`}
                    >
                      <CaretRightIcon
                        aria-hidden="true"
                        className={`size-3 flex-shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none ${
                          open ? "rotate-90" : ""
                        }`}
                      />
                      <span className="max-w-[70%] flex-shrink-0 truncate font-medium text-foreground">
                        {name}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">
                        {directory}
                      </span>
                      <span className="flex-shrink-0 rounded-full bg-surface-tertiary px-1.5 text-[11px] leading-4 tabular-nums text-foreground-secondary">
                        {matches.length}
                      </span>
                    </button>
                    <Collapse open={open}>
                      <ul>
                        {matches.map((match) => (
                          <li key={`${match.line}:${match.column}`}>
                            <button
                              type="button"
                              data-list-row
                              tabIndex={-1}
                              onClick={() => onOpenResult(match.path, match.line)}
                              title={match.preview}
                              className="list-row flex w-full items-baseline gap-2 py-1 pl-6 pr-3 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
                            >
                              <span className="w-7 flex-shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                                {match.line}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-foreground-secondary">
                                {match.clipped && "…"}
                                {match.preview.slice(0, match.previewStart)}
                                <mark className="rounded-sm bg-warning/30 text-foreground">
                                  {match.preview.slice(match.previewStart, match.previewEnd)}
                                </mark>
                                {match.preview.slice(match.previewEnd)}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Collapse>
                  </li>
                );
              })}
            </ul>
          </div>
        </ScrollArea>
      )}
    </>
  );
}
