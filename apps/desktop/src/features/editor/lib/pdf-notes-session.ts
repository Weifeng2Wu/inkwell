import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  type PdfAnnotation,
  type PdfReadingMode,
  parsePdfNotes,
  removePdfAnnotation,
  setPdfReadingMode,
  upsertPdfAnnotation,
} from "./pdf-notes";

type NativeDocument = { path: string; content: string; canSyncSource: boolean };
export type PdfNotesSnapshot = {
  content: string | undefined;
  annotations: PdfAnnotation[];
  mode: PdfReadingMode | undefined;
  canSyncSource: boolean;
  pdfRevision: number;
  busy: boolean;
  error: string | undefined;
};
const sessions = new Map<string, PdfNotesSession>();

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export class PdfNotesSession {
  private snapshot: PdfNotesSnapshot = {
    content: undefined,
    annotations: [],
    mode: undefined,
    canSyncSource: false,
    pdfRevision: 0,
    busy: false,
    error: undefined,
  };
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
      this.stopWatching = listen<{ path: string; kind: string }>("file-changed", ({ payload }) => {
        const path = normalizePath(payload.path);
        const pdf = normalizePath(this.pdfPath);
        const absolute = normalizePath(`${this.projectPath}/${this.pdfPath}`);
        if ([pdf, absolute].includes(path) && payload.kind === "modify") {
          this.publish({ pdfRevision: this.snapshot.pdfRevision + 1 });
        }
        const companion = ["synctex.gz", "synctex", "tex"].flatMap((extension) => [
          pdf.replace(/\.pdf$/i, `.${extension}`),
          absolute.replace(/\.pdf$/i, `.${extension}`),
        ]);
        if (
          [`${pdf}.notes.md`, `${absolute}.notes.md`, pdf, absolute, ...companion].includes(path) &&
          payload.kind !== "access"
        )
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

  private accept(document: NativeDocument) {
    try {
      const parsed = parsePdfNotes(document.content);
      const name = this.pdfPath.split("/").pop();
      if (parsed.pdf !== name) throw new Error("PDF_NOTES_INVALID");
      this.publish({
        content: document.content,
        annotations: parsed.annotations,
        mode: parsed.mode,
        canSyncSource: document.canSyncSource,
        error: undefined,
      });
    } catch {
      // Keep the raw Markdown available for repair; never replace a malformed sidecar.
      this.publish({
        content: document.content,
        annotations: [],
        mode: undefined,
        canSyncSource: document.canSyncSource,
        error: "PDF_NOTES_INVALID",
      });
    }
  }

  private async load() {
    const document = await invoke<NativeDocument>("pdf_notes_load", {
      expectedProject: this.projectPath,
      relativePath: this.pdfPath,
      initialContent: this.initialContent,
    });
    this.accept(document);
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

  private async save(content: string, expectedContent: string) {
    try {
      await invoke("pdf_notes_save", {
        expectedProject: this.projectPath,
        relativePath: this.pdfPath,
        expectedContent,
        content,
      });
      this.accept({
        path: `${this.pdfPath}.notes.md`,
        content,
        canSyncSource: this.snapshot.canSyncSource,
      });
    } catch (error) {
      // A competing Markdown editor can win the compare-and-swap. Read its version,
      // but leave the rejected local draft with its caller for recovery.
      if (String(error).includes("PDF_NOTES_CONFLICT")) await this.load();
      throw error;
    }
  }

  private mutate(transform: (content: string) => string) {
    return this.enqueue(async () => {
      await this.load();
      const current = this.snapshot.content;
      if (current === undefined || this.snapshot.error) throw new Error("PDF_NOTES_INVALID");
      await this.save(transform(current), current);
    }, true);
  }

  setMode(mode: PdfReadingMode) {
    return this.mutate((content) => setPdfReadingMode(content, mode));
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
    return this.mutate((content) => {
      let next = content;
      for (const [index, annotation] of annotations.entries()) {
        if (parsePdfNotes(next).annotations.some((item) => item.id === annotation.id)) {
          throw new Error("PDF_NOTES_CONFLICT");
        }
        next = upsertPdfAnnotation(next, annotation, headings[index] ?? `Page ${annotation.page}`);
      }
      return next;
    });
  }

  replaceMarkdown(content: string, expectedContent: string) {
    return this.enqueue(async () => {
      const parsed = parsePdfNotes(content);
      if (parsed.pdf !== this.pdfPath.split("/").pop()) throw new Error("PDF_NOTES_INVALID");
      await this.save(content, expectedContent);
    }, true);
  }

  flush = async () => {
    // A read-only PDF folder or a failed initial load must not trap the user in
    // the app. Only still-pending explicit writes participate in the close barrier.
    await Promise.all([...this.pendingWrites]);
  };
}

export function getPdfNotesSession(projectPath: string, pdfPath: string, initialContent: string) {
  const root = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = pdfPath.replace(/\\/g, "/");
  const relative = normalizePath(normalized).startsWith(`${normalizePath(root)}/`)
    ? normalized.slice(root.length + 1)
    : normalized;
  const key = normalizePath(`${projectPath}/${relative}`);
  let session = sessions.get(key);
  if (!session) {
    session = new PdfNotesSession(projectPath, relative, initialContent);
    sessions.set(key, session);
  }
  return session;
}
