"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { parsePdfNotes } from "@/features/editor/lib/pdf-notes";
import { useI18n } from "@/features/i18n";
import { appStorage } from "@/lib/storage/app-storage";
import type { FileNode } from "@/types/files";
import type { PdfMetadata } from "@/types/papers";
import {
  addReference,
  identifyPdf,
  importPdf,
  type ProjectFiles,
  readPdfHints,
  removeReference,
  updateReference,
} from "./actions";
import type { PaperMetadata } from "./bibtex";
import {
  buildLibrary,
  DIGEST_PATH,
  filePaths,
  type Library,
  type LibraryItem,
  readingDigest,
} from "./library";
import { pdfFilenameHints } from "./metadata";

export type NewReference = { metadata: PaperMetadata } | { bibtex: string };
/** A request to add a reference by hand, optionally for a PDF already in the project. */
export type ManualAdd = { query?: string; file?: string };

type Args = {
  projectPath: string | null;
  files: FileNode[];
  /** Project `.bib` contents by path, including unsaved editor buffers. */
  bibliographies: ReadonlyMap<string, string>;
  ready?: boolean;
  readFile: ProjectFiles["readFile"];
  /** Writes a project file and keeps any open editor buffer for it in sync. */
  writeFile: ProjectFiles["writeFile"];
};

type WrittenBibliography = { content: string; stale: Set<string | undefined> };

function currentBibliographies(
  indexed: ReadonlyMap<string, string>,
  written: ReadonlyMap<string, WrittenBibliography>,
) {
  const sources = new Map(indexed);
  for (const [path, own] of written)
    if (own.stale.has(indexed.get(path))) sources.set(path, own.content);
  return sources;
}

function exclusionKey(projectPath: string) {
  return `inkwell-library-excluded-pdfs:${encodeURIComponent(projectPath)}`;
}

function excludedPdfs(projectPath: string | null): Set<string> {
  try {
    const value: unknown = JSON.parse(
      (projectPath && appStorage.getItem(exclusionKey(projectPath))) || "[]",
    );
    return new Set(Array.isArray(value) ? value.filter((path) => typeof path === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * The project's reference library and the operations that change it. Operations run one
 * at a time; `busy` holds the progress text of the running one. Failures are reported as
 * toasts.
 */
export function useLibrary({
  projectPath,
  files,
  bibliographies,
  ready = true,
  readFile,
  writeFile,
}: Args) {
  const { t } = useI18n();
  const { toast } = useToast();
  const session = useMemo(
    () => ({
      projectPath,
      attempted: new Set<string>(),
      excluded: excludedPdfs(projectPath),
      metadata: new Map<string, PaperMetadata>(),
      written: new Map<string, WrittenBibliography>(),
      running: false,
    }),
    [projectPath],
  );
  const active = useRef<typeof session | null>(session);
  active.current = session;
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const [progress, setProgress] = useState<{ session: typeof session; label: string } | null>(null);
  const busy = progress?.session === session ? progress.label : "";
  const [manualAdd, setManualAdd] = useState<ManualAdd | null>(null);
  const paths = useMemo(() => filePaths(files), [files]);
  const sources = useMemo(
    () => currentBibliographies(bibliographies, session.written),
    [bibliographies, session.written],
  );
  const library = useMemo((): Library => buildLibrary(sources, paths), [sources, paths]);
  const pdfMetadata = useMemo((): ReadonlyMap<string, PdfMetadata> => {
    const metadata = new Map<string, PdfMetadata>(
      [...session.metadata].filter(([path]) => paths.includes(path)),
    );
    for (const item of library.items) if (item.file && item.title) metadata.set(item.file, item);
    return metadata;
  }, [session.metadata, paths, library.items]);

  useEffect(() => {
    active.current = session;
    setManualAdd(null);
    return () => {
      if (active.current === session) active.current = null;
    };
  }, [session]);

  useEffect(() => {
    for (const [path, own] of session.written) {
      const indexed = bibliographies.get(path);
      if (indexed === own.content || !own.stale.has(indexed)) session.written.delete(path);
    }
  }, [bibliographies, session]);

  // `bibliographies` lags behind our own writes until the file watcher reports them. A
  // write stays authoritative while the indexed content is something it replaced.
  const latest = useRef({ bibliographies, paths, ready });
  latest.current = { bibliographies, paths, ready };
  const project = useMemo((): ProjectFiles | null => {
    if (!projectPath) return null;
    return {
      projectPath,
      readFile: async (path) => {
        if (active.current !== session) throw new Error("Project changed");
        if (!/\.bib$/i.test(path)) return readFile(path);
        const indexed = latest.current.bibliographies.get(path);
        const own = session.written.get(path);
        return own?.stale.has(indexed) ? own.content : (indexed ?? readFile(path));
      },
      writeFile: async (path, content) => {
        if (active.current !== session) throw new Error("Project changed");
        await writeFile(path, content);
        if (active.current !== session || !/\.bib$/i.test(path)) return;
        // The index may still report anything this session has already replaced.
        const previous = session.written.get(path);
        const stale = previous?.stale ?? new Set<string | undefined>();
        stale.add(latest.current.bibliographies.get(path));
        if (previous) stale.add(previous.content);
        session.written = new Map(session.written).set(path, { content, stale });
        refresh();
      },
    };
  }, [projectPath, session, readFile, writeFile]);

  const snapshot = useCallback(() => {
    const sources = currentBibliographies(latest.current.bibliographies, session.written);
    return { sources, library: buildLibrary(sources, latest.current.paths) };
  }, [session]);

  const exclude = useCallback(
    (path: string, excluded: boolean) => {
      if (excluded) session.excluded.add(path);
      else session.excluded.delete(path);
      if (!projectPath) return;
      try {
        appStorage.setItem(exclusionKey(projectPath), JSON.stringify([...session.excluded]));
      } catch {}
    },
    [projectPath, session],
  );

  /** Runs one operation at a time; resolves to whether it ran and finished without error. */
  const run = useCallback(
    async (label: string, task: (project: ProjectFiles) => Promise<void>): Promise<boolean> => {
      if (!project || session.running || active.current !== session) return false;
      session.running = true;
      setProgress({ session, label });
      try {
        await task(project);
        return true;
      } catch (error) {
        if (active.current === session)
          toast(t("library.failed", { error: String(error) }), "error");
        return false;
      } finally {
        session.running = false;
        if (active.current === session) setProgress(null);
      }
    },
    [project, session, toast, t],
  );

  const identifyAll = useCallback(
    async (project: ProjectFiles, paths: string[], automatic = false) => {
      const unidentified: ManualAdd[] = [];
      let offline = false;
      let added = 0;
      for (const [index, path] of paths.entries()) {
        if (active.current !== session) return;
        if (automatic && !latest.current.ready) return;
        if (!latest.current.paths.includes(path) && automatic) continue;
        if (snapshot().library.items.some((item) => item.file === path)) continue;
        session.attempted.add(path);
        setProgress({
          session,
          label: t("library.identifying", { current: index + 1, total: paths.length }),
        });
        let hints = pdfFilenameHints(path);
        let metadata = automatic ? session.metadata.get(path) : undefined;
        if (!metadata) {
          hints = await readPdfHints(project.projectPath, path).catch(() => hints);
          if (active.current !== session) return;
          metadata =
            (await identifyPdf(hints).catch(() => {
              offline = true;
              return null;
            })) ?? undefined;
        }
        if (active.current !== session) return;
        if (!latest.current.paths.includes(path) && automatic) continue;
        if (!metadata) {
          unidentified.push({ file: path, query: hints.title });
          continue;
        }
        session.metadata = new Map(session.metadata).set(path, metadata);
        refresh();
        if (automatic && session.excluded.has(path)) continue;
        if (automatic && !latest.current.ready) {
          session.attempted.delete(path);
          return;
        }
        const { library, sources } = snapshot();
        const key = await addReference(project, library.items, sources.keys(), {
          metadata,
          file: path,
        });
        if (library.items.some((item) => item.key === key)) continue;
        added += 1;
      }
      if (automatic || active.current !== session) return;
      if (added)
        toast(t("library.identified", { count: added, s: added === 1 ? "" : "s" }), "success");
      if (offline) toast(t("library.lookupFailed"), "error");
      else if (unidentified.length === 1 && unidentified[0]) setManualAdd(unidentified[0]);
      else if (unidentified.length)
        toast(t("library.unidentified", { count: unidentified.length, s: "s" }), "info");
    },
    [session, snapshot, toast, t],
  );

  useEffect(() => {
    if (!project || !ready || busy || session.running) return;
    const present = new Set(paths);
    for (const path of session.attempted) if (!present.has(path)) session.attempted.delete(path);
    for (const path of session.metadata.keys())
      if (!present.has(path)) session.metadata.delete(path);
    const pending = library.unlinked.filter((path) => !session.attempted.has(path));
    if (!pending.length) return;
    void run(t("library.identifying", { current: 1, total: pending.length }), (project) =>
      identifyAll(project, pending, true),
    );
  }, [project, ready, busy, session, paths, library.unlinked, run, identifyAll, t]);

  /** Identifies PDFs already in the project and adds the recognised ones. */
  const identify = useCallback(
    (paths: string[]) =>
      run(t("library.identifying", { current: 1, total: paths.length }), (project) => {
        for (const path of paths) exclude(path, false);
        return identifyAll(project, paths);
      }),
    [run, identifyAll, exclude, t],
  );

  /** Copies PDFs from anywhere on disk into the project, then identifies them. */
  const importSources = useCallback(
    (sources: string[]) =>
      run(t("library.importing", { current: 1, total: sources.length }), async (project) => {
        const imported: string[] = [];
        for (const [index, source] of sources.entries()) {
          if (active.current !== session) return;
          setProgress({
            session,
            label: t("library.importing", { current: index + 1, total: sources.length }),
          });
          imported.push(await importPdf(project.projectPath, source));
        }
        if (imported.length) await identifyAll(project, imported);
      }),
    [run, identifyAll, session, t],
  );

  const add = useCallback(
    (reference: NewReference, file?: string) =>
      run(t("library.adding"), async (project) => {
        const { library, sources } = snapshot();
        const key = await addReference(project, library.items, sources.keys(), {
          ...reference,
          file,
        });
        if (active.current !== session) return;
        setManualAdd(null);
        toast(t("library.added", { key }), "success");
      }),
    [run, snapshot, session, toast, t],
  );

  /** Sets BibTeX fields on an entry; an empty value removes the field. */
  const update = useCallback(
    (item: LibraryItem, fields: Record<string, string>) =>
      run(t("library.saving"), (project) => updateReference(project, item, fields)),
    [run, t],
  );

  /** Removes the entry from its bibliography; its PDF and notes are kept. */
  const remove = useCallback(
    (item: LibraryItem) =>
      run(t("library.removing"), async (project) => {
        await removeReference(project, item);
        if (item.file) exclude(item.file, true);
      }),
    [run, exclude, t],
  );

  /** Copies a PDF into the project and links it to an existing entry. */
  const attach = useCallback(
    (item: LibraryItem, source: string) =>
      run(t("library.attaching"), async (project) =>
        updateReference(project, item, { file: await importPdf(project.projectPath, source) }),
      ),
    [run, t],
  );

  /** Writes the reading digest and resolves to its path, or null when there is nothing to collect. */
  const writeDigest = useCallback(async (): Promise<string | null> => {
    let path: string | null = null;
    await run(t("library.digesting"), async (project) => {
      const papers = await Promise.all(
        snapshot().library.items.map(async (item) => {
          try {
            const notes = item.notes ? await readFile(item.notes) : null;
            return { item, annotations: notes ? parsePdfNotes(notes).annotations : [] };
          } catch {
            return { item, annotations: [] };
          }
        }),
      );
      if (!papers.some((paper) => paper.annotations.length))
        return toast(t("library.digestEmpty"), "info");
      await project.writeFile(DIGEST_PATH, readingDigest(t("library.digestTitle"), papers));
      path = DIGEST_PATH;
    });
    return path;
  }, [run, readFile, snapshot, toast, t]);

  return {
    library,
    pdfMetadata,
    busy,
    manualAdd,
    setManualAdd,
    identify,
    importSources,
    add,
    update,
    remove,
    attach,
    writeDigest,
  };
}

export type LibraryController = ReturnType<typeof useLibrary>;
