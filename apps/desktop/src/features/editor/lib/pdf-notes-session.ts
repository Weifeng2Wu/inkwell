import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  addPdfAnnotations,
  type PdfAnnotation,
  parsePdfNotes,
  removePdfAnnotation,
  upsertPdfAnnotation,
} from "./pdf-notes";

type NativeDocument = { content: string; revision: string };
export type PdfNotesSnapshot = {
  /** The sidecar's Markdown, or the starting template while it has not been created. */
  content: string | undefined;
  annotations: PdfAnnotation[];
  busy: boolean;
  error: string | undefined;
};
const sessions = new Map<string, PdfNotesSession>();

export function normalizePdfPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

/** The PDF's path relative to the project, which is how the backend addresses it. */
export function projectRelativePdfPath(projectPath: string, pdfPath: string) {
  const root = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = pdfPath.replace(/\\/g, "/");
  return normalizePdfPath(normalized).startsWith(`${normalizePdfPath(root)}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
}

function isConflict(error: unknown) {
  return String(error).includes("PDF_NOTES_CONFLICT");
}

export class PdfNotesSession {
  private snapshot: PdfNotesSnapshot = {
    content: undefined,
    annotations: [],
    busy: false,
    error: undefined,
  };
  /** What a save must still find on disk; null while the sidecar does not exist. */
  private revision: string | null = null;
  private loaded = false;
  private invalid = false;
  private subscribers = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private pendingWrites = new Set<Promise<unknown>>();
  private initialization: Promise<void> | undefined;
  private stopWatching: Promise<UnlistenFn> | undefined;

  constructor(
    readonly projectPath: string,
    readonly pdfPath: string,
    readonly initialContent: string,
  ) {}

  getSnapshot = () => this.snapshot;

  subscribe = (callback: () => void) => {
    this.subscribers.add(callback);
    if (this.subscribers.size === 1) {
      const notes = normalizePdfPath(`${this.pdfPath}.notes.md`);
      const absolute = normalizePdfPath(`${this.projectPath}/${this.pdfPath}.notes.md`);
      this.stopWatching = listen<{ path: string; kind: string }>("file-changed", ({ payload }) => {
        if ([notes, absolute].includes(normalizePdfPath(payload.path)) && payload.kind !== "access")
          void this.reload().catch(() => {});
      }).catch(() => () => {});
      void this.reload().catch(() => {});
    }
    return () => {
      this.subscribers.delete(callback);
      if (!this.subscribers.size) {
        void this.stopWatching?.then((stop) => stop());
        this.stopWatching = undefined;
      }
    };
  };

  private publish(update: Partial<PdfNotesSnapshot>) {
    this.snapshot = { ...this.snapshot, ...update };
    for (const callback of this.subscribers) callback();
  }

  private accept(document: NativeDocument | null) {
    const content = document?.content ?? this.initialContent;
    const revision = document?.revision ?? null;
    // The watcher echoes this session's own saves; an unchanged file needs no parsing.
    const unchanged =
      this.loaded && revision === this.revision && content === this.snapshot.content;
    this.loaded = true;
    this.revision = revision;
    if (unchanged) {
      const error = this.invalid ? "PDF_NOTES_INVALID" : undefined;
      if (this.snapshot.error !== error) this.publish({ error });
      return;
    }
    try {
      const parsed = parsePdfNotes(content);
      if (parsed.pdf !== this.pdfPath.split("/").pop()) throw new Error("PDF_NOTES_INVALID");
      this.invalid = false;
      this.publish({ content, annotations: parsed.annotations, error: undefined });
    } catch {
      // Keep the raw Markdown available for repair; never replace a malformed sidecar.
      this.invalid = true;
      this.publish({ content, annotations: [], error: "PDF_NOTES_INVALID" });
    }
  }

  private async load() {
    this.accept(
      await invoke<NativeDocument | null>("pdf_notes_load", {
        expectedProject: this.projectPath,
        relativePath: this.pdfPath,
      }),
    );
  }

  private enqueue<Result>(operation: () => Promise<Result>, writes = false): Promise<Result> {
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        this.publish({ busy: true });
        try {
          return await operation();
        } catch (error) {
          this.publish({ error: String(error) });
          throw error;
        } finally {
          this.publish({ busy: false });
        }
      });
    this.queue = pending;
    if (writes) {
      this.pendingWrites.add(pending);
      void pending.then(
        () => this.pendingWrites.delete(pending),
        () => this.pendingWrites.delete(pending),
      );
    }
    return pending;
  }

  reload = () => {
    // Coalesce duplicate watcher/subscription refreshes, including Strict Mode mounts.
    if (!this.initialization) {
      this.initialization = this.enqueue(() => this.load()).finally(() => {
        this.initialization = undefined;
      });
    }
    return this.initialization;
  };

  /** Replaces the sidecar, creating it on the first save. */
  private async save(content: string) {
    const revision = await invoke<string>("pdf_notes_save", {
      expectedProject: this.projectPath,
      relativePath: this.pdfPath,
      expectedRevision: this.revision,
      content,
    });
    this.accept({ content, revision });
  }

  private mutate(transform: (content: string) => string) {
    return this.enqueue(async () => {
      if (!this.loaded) await this.load();
      for (let attempt = 0; ; attempt += 1) {
        const current = this.snapshot.content;
        if (current === undefined || this.invalid) throw new Error("PDF_NOTES_INVALID");
        try {
          return await this.save(transform(current));
        } catch (error) {
          if (!isConflict(error)) throw error;
          // The notes changed underneath: apply the change to the newer version once.
          await this.load();
          if (attempt > 0) throw error;
        }
      }
    }, true);
  }

  upsert(annotation: PdfAnnotation, heading: string, expectedNote?: string) {
    return this.mutate((content) => {
      const existing = parsePdfNotes(content).annotations.find((item) => item.id === annotation.id);
      if (
        (expectedNote !== undefined && existing?.note !== expectedNote) ||
        (expectedNote === undefined && existing)
      )
        throw new Error("PDF_NOTES_CONFLICT");
      return upsertPdfAnnotation(content, annotation, heading);
    });
  }

  remove(id: string, expectedNote: string) {
    return this.mutate((content) => {
      const existing = parsePdfNotes(content).annotations.find((item) => item.id === id);
      if (existing?.note !== expectedNote) throw new Error("PDF_NOTES_CONFLICT");
      return removePdfAnnotation(content, id);
    });
  }

  addMany(annotations: PdfAnnotation[], headings: string[]) {
    return this.mutate((content) => addPdfAnnotations(content, annotations, headings));
  }

  /** Saves a hand-edited draft; it is never merged, so a newer disk version wins. */
  replaceMarkdown(content: string, expectedContent: string) {
    return this.enqueue(async () => {
      const parsed = parsePdfNotes(content);
      if (parsed.pdf !== this.pdfPath.split("/").pop()) throw new Error("PDF_NOTES_INVALID");
      if (this.snapshot.content !== expectedContent) await this.load();
      if (this.snapshot.content !== expectedContent) throw new Error("PDF_NOTES_CONFLICT");
      try {
        await this.save(content);
      } catch (error) {
        if (isConflict(error)) await this.load();
        throw error;
      }
    }, true);
  }

  flush = async () => {
    // A read-only PDF folder or a failed initial load must not trap the user in
    // the app. Only still-pending explicit writes participate in the close barrier.
    await Promise.all([...this.pendingWrites]);
  };
}

export function getPdfNotesSession(projectPath: string, pdfPath: string, initialContent: string) {
  const relative = projectRelativePdfPath(projectPath, pdfPath);
  const key = normalizePdfPath(`${projectPath}/${relative}`);
  let session = sessions.get(key);
  if (!session) {
    session = new PdfNotesSession(projectPath, relative, initialContent);
    sessions.set(key, session);
  }
  return session;
}
