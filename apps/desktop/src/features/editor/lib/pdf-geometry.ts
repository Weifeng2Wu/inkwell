import {
  type PdfPageGlyphs,
  type PdfViewportGeometry,
  tightPdfTextSelection,
  tightSavedPdfQuote,
} from "./pdf-glyph-geometry";
import { connectedPdfHighlightRects } from "./pdf-highlight-geometry";
import type { PdfAnnotation, PdfAnnotationRect } from "./pdf-notes";
import type { PdfSelectionPage } from "./pdf-selection";

type Response = { id: number; page?: PdfPageGlyphs; error?: string };
export type PdfGeometry = Pick<PdfGeometryClient, "refineSelection" | "refineAnnotation">;
export type PdfPaintAnnotation = PdfAnnotation & { highlightRects?: PdfAnnotationRect[] };

export class PdfGeometryClient {
  private worker: Worker;
  private serial = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (page?: PdfPageGlyphs) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private pages = new Map<number, Promise<PdfPageGlyphs>>();
  private ready: Promise<unknown>;

  constructor(
    bytes: Uint8Array,
    private readonly viewport: (page: number) => Promise<PdfViewportGeometry>,
  ) {
    this.worker = new Worker(new URL("/pdfjs/geometry/worker.js", window.location.href), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const { id, page, error } = event.data;
      const task = this.pending.get(id);
      if (!task) return;
      clearTimeout(task.timer);
      this.pending.delete(id);
      if (error) task.reject(new Error("PDF_GEOMETRY_FAILED"));
      else task.resolve(page);
    };
    this.worker.onerror = () => this.dispose();
    this.worker.onmessageerror = () => this.dispose();
    const copy = bytes.slice();
    this.ready = this.request({ kind: "open", bytes: copy }, [copy.buffer]);
    // Handle opening failures even if nobody selects text in this document.
    void this.ready.catch(() => {});
  }

  private request(
    payload:
      | { kind: "open"; bytes: Uint8Array }
      | { kind: "page"; page: number; viewport: PdfViewportGeometry },
    transfer: Transferable[] = [],
  ) {
    return new Promise<PdfPageGlyphs | undefined>((resolve, reject) => {
      if (this.closed) {
        reject(new Error("PDF_GEOMETRY_FAILED"));
        return;
      }
      const id = ++this.serial;
      const timer = setTimeout(() => this.dispose(), 20000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ id, ...payload }, transfer);
      } catch {
        this.dispose();
      }
    });
  }

  private getPage(number: number) {
    if (this.closed) return Promise.reject(new Error("PDF_GEOMETRY_FAILED"));
    let result = this.pages.get(number);
    if (!result) {
      result = (async () => {
        await this.ready;
        const page = await this.request({
          kind: "page",
          page: number,
          viewport: await this.viewport(number),
        });
        if (!page) throw new Error("PDF_GEOMETRY_FAILED");
        return page;
      })();
      this.pages.set(number, result);
      void result.catch(() => this.pages.delete(number));
      if (this.pages.size > 12) {
        const oldest = this.pages.keys().next().value;
        if (oldest !== undefined) this.pages.delete(oldest);
      }
    }
    return result;
  }

  async refineSelection(selections: PdfSelectionPage[]): Promise<PdfSelectionPage[]> {
    const result = await Promise.all(
      selections.map(async (selection) => {
        const page = await this.getPage(selection.page);
        const rects = tightPdfTextSelection(page, selection.runs);
        return { ...selection, rects, highlightRects: connectedPdfHighlightRects(page, rects) };
      }),
    );
    if (this.closed) throw new Error("PDF_GEOMETRY_FAILED");
    return result;
  }

  async refineAnnotation(annotation: PdfAnnotation): Promise<PdfPaintAnnotation> {
    const page = await this.getPage(annotation.page);
    if (this.closed) throw new Error("PDF_GEOMETRY_FAILED");
    const rects = tightSavedPdfQuote(page, annotation.quote, annotation.rects);
    return {
      ...annotation,
      rects,
      ...(annotation.kind === "highlight"
        ? { highlightRects: connectedPdfHighlightRects(page, rects) }
        : {}),
    };
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const task of this.pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error("PDF_GEOMETRY_FAILED"));
    }
    this.pending.clear();
    this.pages.clear();
  }
}
