"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/features/i18n";
import { fileType } from "@/lib/file-types";
import { pathSync } from "@/lib/path";
import type { GitDiffPreview } from "../components/git-diff-pane";
import {
  activate,
  activeBuffers,
  closeTabs,
  EMPTY_PANES,
  failed,
  keepTabs,
  loaded,
  moveTab,
  type PaneId,
  type Panes,
  reorderTab,
  type SplitSide,
  setContent,
} from "./panes";
import { pdfPathFromNotes } from "./pdf-notes";

const SAVE_DELAY = 500;
/** How long after our own write a change event for the file is taken to be its echo. */
const OWN_WRITE_WINDOW = 2000;

type Args = {
  projectPath: string | null;
  /** Reads a project file; rejects with `FILE_NOT_FOUND` when it does not exist. */
  read: (path: string) => Promise<string | null>;
  /** Writes a project file; rejects on failure. */
  write: (path: string, content: string) => Promise<void>;
  /** Maps what the user picked (possibly a bare file name) to a project-relative path. */
  resolvePath: (path: string) => string;
  /** Loads a file's staged or working-tree diff. */
  readDiff: (path: string, staged: boolean) => Promise<string>;
  /** The latest file-watcher event. */
  change: { path: string; kind: string } | null;
};

/**
 * State of the editor area: the tabs and documents of both groups, debounced saving, and
 * reloading after external changes. Paths are project-relative.
 */
export function useEditorPanes({ projectPath, read, write, resolvePath, readDiff, change }: Args) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [panes, setPanes] = useState(EMPTY_PANES);
  const [diff, setDiff] = useState<GitDiffPreview | null>(null);
  const [pdfRevision, setPdfRevision] = useState(0);
  const [unsaved, setUnsaved] = useState(false);

  // Imperative operations chain several updates, so they work on a synchronous mirror.
  const current = useRef(panes);
  const project = useRef(projectPath);
  project.current = projectPath;
  const io = useRef({ read, write, resolvePath, readDiff });
  io.current = { read, write, resolvePath, readDiff };
  const loading = useRef<Partial<Record<PaneId, { path: string; done: Promise<boolean> }>>>({});
  const saves = useRef(
    new Map<string, { content: string; timer: ReturnType<typeof setTimeout> }>(),
  );
  const written = useRef(new Map<string, number>());
  const diffRequest = useRef(0);
  const syncUnsaved = useCallback(() => setUnsaved(saves.current.size > 0), []);
  /** Files that may not exist on disk yet, such as an agent's proposed new file. */
  const optional = useRef(new Set<string>());

  const writeNow = useCallback(async (path: string, content: string) => {
    written.current.set(path, Date.now());
    await io.current.write(path, content);
    written.current.set(path, Date.now());
  }, []);

  // `load` and `apply` call each other; the ref breaks the cycle.
  const applyRef = useRef<(change: (panes: Panes) => Panes) => Panes>((change) =>
    change(current.current),
  );
  const load = useCallback(
    (id: PaneId, path: string): Promise<boolean> => {
      const root = project.current;
      const entry = { path, done: Promise.resolve(false) };
      const isCurrent = () => project.current === root && loading.current[id] === entry;
      loading.current[id] = entry;
      entry.done = (async () => {
        try {
          // Unsaved edits of this file are newer than the disk.
          const shown = activeBuffers(current.current).find((buffer) => buffer.path === path);
          const content =
            saves.current.get(path)?.content ?? shown?.content ?? (await io.current.read(path));
          if (!isCurrent()) return false;
          applyRef.current((panes) => loaded(panes, id, path, content ?? ""));
          return true;
        } catch (error) {
          if (!isCurrent()) return false;
          // PDF notes are created by their first save; until then they open as a new file.
          const missing = optional.current.has(path) || Boolean(pdfPathFromNotes(path));
          if (String(error).includes("FILE_NOT_FOUND") && missing) {
            applyRef.current((panes) => loaded(panes, id, path, ""));
            return true;
          }
          if (String(error).includes("FILE_NOT_FOUND")) {
            toast(t("files.fileRemovedFromTabs", { name: pathSync.basename(path) }), "error");
            applyRef.current((panes) => closeTabs(panes, id, [path]));
          } else applyRef.current((panes) => failed(panes, id, path, String(error)));
          return false;
        } finally {
          if (loading.current[id] === entry) delete loading.current[id];
        }
      })();
      return entry.done;
    },
    [toast, t],
  );

  /** Applies a state change, then starts reading any document it left waiting to load. */
  const apply = useCallback(
    (change: (panes: Panes) => Panes) => {
      const next = change(current.current);
      if (next === current.current) return next;
      current.current = next;
      setPanes(next);
      for (const id of ["primary", "split"] as const) {
        const pane = next[id];
        if (pane?.loading && pane.active && loading.current[id]?.path !== pane.active)
          void load(id, pane.active);
      }
      return next;
    },
    [load],
  );
  applyRef.current = apply;

  /**
   * Opens a file and resolves once it is shown. `pane: "beside"` opens next to whatever
   * the primary group shows, so a paper and the manuscript stay visible together.
   */
  const open = useCallback(
    async (
      target: string,
      options: { pane?: PaneId | "beside"; side?: SplitSide; optional?: boolean } = {},
    ): Promise<boolean> => {
      const path = io.current.resolvePath(target);
      if (options.optional) optional.current.add(path);
      const now = current.current;
      let id: PaneId = options.pane === "beside" ? "split" : (options.pane ?? "primary");
      if (options.pane === "beside") {
        if (now.primary.active === path) return true;
        if (now.split?.tabs.includes(path) || !now.primary.active)
          id = now.split ? "split" : "primary";
      }
      if (id === "primary") {
        diffRequest.current += 1;
        setDiff(null);
      }
      const pane = now[id];
      const shown = pane?.active === path && !pane.error && !(id === "primary" && diff);
      if (shown && !pane.loading) return true;
      apply((panes) => activate(panes, id, path, options.side));
      // The first file always lands in the primary group.
      const actual = current.current[id]?.active === path ? id : "primary";
      return (await loading.current[actual]?.done) ?? current.current[actual]?.active === path;
    },
    [apply, diff],
  );

  const close = useCallback(
    (id: PaneId, paths: readonly string[]) => apply((panes) => closeTabs(panes, id, paths)),
    [apply],
  );
  const closeOthers = useCallback(
    (id: PaneId, path: string) =>
      apply((panes) => keepTabs(panes, id, path, (index, pivot) => index === pivot)),
    [apply],
  );
  const closeToLeft = useCallback(
    (id: PaneId, path: string) =>
      apply((panes) => keepTabs(panes, id, path, (index, pivot) => index >= pivot)),
    [apply],
  );
  const closeToRight = useCallback(
    (id: PaneId, path: string) =>
      apply((panes) => keepTabs(panes, id, path, (index, pivot) => index <= pivot)),
    [apply],
  );
  const closeAll = useCallback(
    (id: PaneId) => apply((panes) => closeTabs(panes, id, panes[id]?.tabs ?? [])),
    [apply],
  );
  const reorder = useCallback(
    (id: PaneId, dragged: string, target: string, position: "before" | "after") =>
      apply((panes) => reorderTab(panes, id, dragged, target, position)),
    [apply],
  );
  const move = useCallback(
    (path: string, to: PaneId, side?: SplitSide) =>
      apply((panes) => moveTab(panes, path, to, side)),
    [apply],
  );

  /** Shows a file in the split group on the given side, moving its tab out of the primary. */
  const showBeside = useCallback(
    (path: string, side: SplitSide) =>
      apply((panes) => {
        const moved = closeTabs(panes, "primary", [path]);
        // With nothing else open there is no document to show it beside.
        if (!moved.primary.active) return panes.split ? { ...panes, side } : panes;
        return activate(moved, "split", path, side);
      }),
    [apply],
  );

  /** Records an edit of a group's active document and schedules saving it. */
  const edit = useCallback(
    (id: PaneId, content: string, filePath?: string, projectPath?: string) => {
      if (projectPath !== undefined && projectPath !== project.current) return;
      const path = filePath ?? current.current[id]?.active;
      if (
        !path ||
        ![current.current.primary, current.current.split].some((pane) => pane?.tabs.includes(path))
      )
        return;
      apply((panes) => setContent(panes, path, content));
      const root = project.current;
      const pending = saves.current.get(path);
      if (pending) clearTimeout(pending.timer);
      const timer = setTimeout(() => {
        if (project.current !== root) {
          saves.current.delete(path);
          return syncUnsaved();
        }
        // A failed write stays pending, so the edit is kept and `flush` retries it.
        writeNow(path, content).then(
          () => {
            if (saves.current.get(path)?.timer === timer) saves.current.delete(path);
            syncUnsaved();
          },
          (error: unknown) =>
            toast(
              t("editor.saveFailed", { name: pathSync.basename(path), error: String(error) }),
              "error",
            ),
        );
      }, SAVE_DELAY);
      saves.current.set(path, { content, timer });
      syncUnsaved();
    },
    [apply, writeNow, toast, t, syncUnsaved],
  );

  /** Writes every pending edit now; rejects when a write fails, keeping that edit pending. */
  const flush = useCallback(async () => {
    const pending = [...saves.current];
    await Promise.all(
      pending.map(async ([path, { content, timer }]) => {
        clearTimeout(timer);
        await writeNow(path, content);
        if (saves.current.get(path)?.timer === timer) saves.current.delete(path);
      }),
    ).finally(syncUnsaved);
  }, [writeNow, syncUnsaved]);

  /** Writes a file on behalf of another feature and updates any editor showing it. */
  const writeFile = useCallback(
    async (path: string, content: string) => {
      const pending = saves.current.get(path);
      if (pending) clearTimeout(pending.timer);
      saves.current.delete(path);
      syncUnsaved();
      await writeNow(path, content);
      apply((panes) => setContent(panes, path, content));
    },
    [apply, writeNow, syncUnsaved],
  );

  /** Replaces an open document with content that is already on disk; null means deleted. */
  const replaceContent = useCallback(
    (path: string, content: string | null) => {
      const pending = saves.current.get(path);
      if (pending) clearTimeout(pending.timer);
      saves.current.delete(path);
      syncUnsaved();
      written.current.set(path, Date.now());
      apply((panes) =>
        content === null
          ? closeTabs(closeTabs(panes, "primary", [path]), "split", [path])
          : setContent(panes, path, content),
      );
    },
    [apply, syncUnsaved],
  );

  const loadDiff = useCallback(async (path: string, staged: boolean) => {
    const request = ++diffRequest.current;
    setDiff({ path, staged, content: "", isLoading: true, error: null });
    const result = await io.current.readDiff(path, staged).then(
      (content) => ({ content, error: null }),
      (error: unknown) => ({ content: "", error: String(error) }),
    );
    if (diffRequest.current === request) setDiff({ path, staged, isLoading: false, ...result });
  }, []);

  /** Shows a file's diff in the primary group in place of its editor. */
  const previewDiff = useCallback(
    async (path: string, staged: boolean) => {
      // A deleted file still has a diff to show.
      optional.current.add(path);
      apply((panes) => (panes.primary.active === path ? panes : activate(panes, "primary", path)));
      await loadDiff(path, staged);
    },
    [apply, loadDiff],
  );

  const reloadPdfs = useCallback(() => setPdfRevision((revision) => revision + 1), []);

  // Follow changes made outside the editor.
  useEffect(() => {
    if (!change) return;
    const { path, kind } = change;
    const now = current.current;
    const shown = [now.primary, now.split].some((pane) => pane?.active === path);
    if (kind === "remove") {
      if (![now.primary, now.split].some((pane) => pane?.tabs.includes(path))) return;
      const pending = saves.current.get(path);
      if (pending) clearTimeout(pending.timer);
      saves.current.delete(path);
      syncUnsaved();
      apply((panes) => closeTabs(closeTabs(panes, "primary", [path]), "split", [path]));
    } else if ((kind === "modify" || kind === "create") && shown && fileType(path) === "text") {
      const own = Date.now() - (written.current.get(path) ?? 0) < OWN_WRITE_WINDOW;
      // Local edits that are not saved yet win over the disk; notes manage their own file.
      if (own || saves.current.has(path) || pdfPathFromNotes(path)) return;
      const root = project.current;
      io.current
        .read(path)
        .then((content) => {
          if (content !== null && project.current === root && !saves.current.has(path))
            apply((panes) => setContent(panes, path, content));
        })
        .catch(() => {});
    }
  }, [change, apply, syncUnsaved]);

  // A different project starts with an empty editor area.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset exactly when the project changes.
  useEffect(() => {
    for (const { timer } of saves.current.values()) clearTimeout(timer);
    saves.current.clear();
    setUnsaved(false);
    written.current.clear();
    optional.current.clear();
    loading.current = {};
    diffRequest.current += 1;
    current.current = EMPTY_PANES;
    setPanes(EMPTY_PANES);
    setDiff(null);
  }, [projectPath]);

  return {
    panes,
    /** The diff shown in place of the primary group's editor, if any. */
    diff: diff && diff.path === panes.primary.active ? diff : null,
    pdfRevision,
    /** True while an edit is waiting to be written to disk. */
    unsaved,
    open,
    close,
    closeOthers,
    closeToLeft,
    closeToRight,
    closeAll,
    reorder,
    move,
    showBeside,
    edit,
    flush,
    writeFile,
    replaceContent,
    previewDiff,
    loadDiff,
    reloadPdfs,
  };
}

export type EditorPanes = ReturnType<typeof useEditorPanes>;
