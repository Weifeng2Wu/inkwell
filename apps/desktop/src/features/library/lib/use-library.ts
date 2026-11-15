"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { parsePdfNotes } from "@/features/editor/lib/pdf-notes";
import { useI18n } from "@/features/i18n";
import type { FileNode } from "@/types/files";
import {
  addReference,
  identifyPdf,
  importPdf,
  type KnownReference,
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

export type NewReference = { metadata: PaperMetadata } | { bibtex: string };
/** A request to add a reference by hand, optionally for a PDF already in the project. */
export type ManualAdd = { query?: string; file?: string };

type Args = {
  projectPath: string | null;
  files: FileNode[];
  /** Project `.bib` contents by path, including unsaved editor buffers. */
  bibliographies: ReadonlyMap<string, string>;
  readFile: ProjectFiles["readFile"];
  /** Writes a project file and keeps any open editor buffer for it in sync. */
  writeFile: ProjectFiles["writeFile"];
};

/**
 * The project's reference library and the operations that change it. Operations run one
 * at a time; `busy` holds the progress text of the running one. Failures are reported as
 * toasts.
 */
export function useLibrary({ projectPath, files, bibliographies, readFile, writeFile }: Args) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState("");
  const [manualAdd, setManualAdd] = useState<ManualAdd | null>(null);
  const running = useRef(false);
  const library = useMemo(
    (): Library => buildLibrary(bibliographies, filePaths(files)),
    [bibliographies, files],
  );

  // `bibliographies` lags behind our own writes until the file watcher reports them. A
  // write stays authoritative while the indexed content is something it replaced.
  const latest = useRef({ bibliographies, library });
  latest.current = { bibliographies, library };
  const written = useRef(new Map<string, { content: string; stale: Set<string | undefined> }>());
  const project = useMemo((): ProjectFiles | null => {
    if (!projectPath) return null;
    written.current.clear();
    return {
      projectPath,
      readFile: async (path) => {
        if (!/\.bib$/i.test(path)) return readFile(path);
        const indexed = latest.current.bibliographies.get(path);
        const own = written.current.get(path);
        return own?.stale.has(indexed) ? own.content : (indexed ?? null);
      },
      writeFile: async (path, content) => {
        await writeFile(path, content);
        if (!/\.bib$/i.test(path)) return;
        // The index may still report anything this session has already replaced.
        const previous = written.current.get(path);
        const stale = previous?.stale ?? new Set<string | undefined>();
        stale.add(latest.current.bibliographies.get(path));
        if (previous) stale.add(previous.content);
        written.current.set(path, { content, stale });
      },
    };
  }, [projectPath, readFile, writeFile]);

  /** Runs one operation at a time; resolves to whether it ran and finished without error. */
  const run = useCallback(
    async (label: string, task: (project: ProjectFiles) => Promise<void>): Promise<boolean> => {
      if (!project || running.current) return false;
      running.current = true;
      setBusy(label);
      try {
        await task(project);
        return true;
      } catch (error) {
        toast(t("library.failed", { error: String(error) }), "error");
        return false;
      } finally {
        running.current = false;
        setBusy("");
      }
    },
    [project, toast, t],
  );

  const identifyAll = useCallback(
    async (project: ProjectFiles, paths: string[]) => {
      const { library, bibliographies } = latest.current;
      const known: KnownReference[] = [...library.items];
      const linked = new Set(library.items.map((item) => item.file));
      const unidentified: ManualAdd[] = [];
      let offline = false;
      let added = 0;
      for (const [index, path] of paths.entries()) {
        if (linked.has(path)) continue;
        setBusy(t("library.identifying", { current: index + 1, total: paths.length }));
        const hints = await readPdfHints(project.projectPath, path).catch(() => null);
        const metadata = hints
          ? await identifyPdf(hints).catch(() => {
              offline = true;
              return null;
            })
          : null;
        if (!metadata) {
          unidentified.push({ file: path, query: hints?.title ?? "" });
          continue;
        }
        const key = await addReference(project, known, bibliographies.keys(), {
          metadata,
          file: path,
        });
        if (known.some((item) => item.key === key)) continue;
        added += 1;
        known.push({ key, doi: metadata.doi, arxiv: metadata.arxiv, file: path });
      }
      if (added)
        toast(t("library.identified", { count: added, s: added === 1 ? "" : "s" }), "success");
      if (offline) toast(t("library.lookupFailed"), "error");
      else if (unidentified.length === 1 && unidentified[0]) setManualAdd(unidentified[0]);
      else if (unidentified.length)
        toast(t("library.unidentified", { count: unidentified.length, s: "s" }), "info");
    },
    [toast, t],
  );

  /** Identifies PDFs already in the project and adds the recognised ones. */
  const identify = useCallback(
    (paths: string[]) =>
      run(t("library.identifying", { current: 1, total: paths.length }), (project) =>
        identifyAll(project, paths),
      ),
    [run, identifyAll, t],
  );

  /** Copies PDFs from anywhere on disk into the project, then identifies them. */
  const importSources = useCallback(
    (sources: string[]) =>
      run(t("library.importing", { current: 1, total: sources.length }), async (project) => {
        const imported: string[] = [];
        for (const [index, source] of sources.entries()) {
          setBusy(t("library.importing", { current: index + 1, total: sources.length }));
          imported.push(await importPdf(project.projectPath, source));
        }
        if (imported.length) await identifyAll(project, imported);
      }),
    [run, identifyAll, t],
  );

  const add = useCallback(
    (reference: NewReference, file?: string) =>
      run(t("library.adding"), async (project) => {
        const { library, bibliographies } = latest.current;
        const key = await addReference(project, library.items, bibliographies.keys(), {
          ...reference,
          file,
        });
        setManualAdd(null);
        toast(t("library.added", { key }), "success");
      }),
    [run, toast, t],
  );

  /** Sets BibTeX fields on an entry; an empty value removes the field. */
  const update = useCallback(
    (item: LibraryItem, fields: Record<string, string>) =>
      run(t("library.saving"), (project) => updateReference(project, item, fields)),
    [run, t],
  );

  /** Removes the entry from its bibliography; its PDF and notes are kept. */
  const remove = useCallback(
    (item: LibraryItem) => run(t("library.removing"), (project) => removeReference(project, item)),
    [run, t],
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
        latest.current.library.items.map(async (item) => {
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
  }, [run, readFile, toast, t]);

  return {
    library,
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
