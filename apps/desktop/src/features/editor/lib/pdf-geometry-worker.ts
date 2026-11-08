import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { PdfGlyph, PdfPageGlyphs, PdfViewportGeometry } from "./pdf-glyph-geometry";

/** The same PDFium tight character boxes used by Lattiora, not font line boxes. */
export class PdfiumGlyphDocument {
  private document = 0;
  private data = 0;
  constructor(private readonly api: WrappedPdfiumModule) {}

  open(bytes: Uint8Array) {
    this.close();
    if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error("PDF_GEOMETRY_FAILED");
    this.data = this.api.pdfium.wasmExports.malloc(bytes.length);
    if (!this.data) throw new Error("PDF_GEOMETRY_FAILED");
    const runtime = this.api.pdfium;
    if (!("HEAPU8" in runtime) || !(runtime.HEAPU8 instanceof Uint8Array)) {
      this.close();
      throw new Error("PDF_GEOMETRY_FAILED");
    }
    runtime.HEAPU8.set(bytes, this.data);
    this.document = this.api.FPDF_LoadMemDocument64(this.data, bytes.length, "");
    if (!this.document) {
      this.close();
      throw new Error("PDF_GEOMETRY_FAILED");
    }
  }

  page(index: number, viewport: PdfViewportGeometry): PdfPageGlyphs {
    if (
      !this.document ||
      !Number.isFinite(viewport.width) ||
      viewport.width <= 0 ||
      !Number.isFinite(viewport.height) ||
      viewport.height <= 0 ||
      !viewport.transform.every(Number.isFinite) ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= this.api.FPDF_GetPageCount(this.document)
    )
      throw new Error("PDF_GEOMETRY_FAILED");
    const page = this.api.FPDF_LoadPage(this.document, index);
    if (!page) throw new Error("PDF_GEOMETRY_FAILED");
    let textPage = 0;
    let scratch = 0;
    try {
      textPage = this.api.FPDFText_LoadPage(page);
      if (!textPage) throw new Error("PDF_GEOMETRY_FAILED");
      const count = this.api.FPDFText_CountChars(textPage);
      if (count < 0 || count > 100000) throw new Error("PDF_GEOMETRY_FAILED");
      scratch = this.api.pdfium.wasmExports.malloc(32);
      if (!scratch) throw new Error("PDF_GEOMETRY_FAILED");
      const glyphs: PdfGlyph[] = [];
      const [a, b, c, d, e, f] = viewport.transform;
      const crossScale = Math.hypot(c, d);
      const fonts = new Map<number, number>();
      for (let character = 0; character < count; character++) {
        const unicode = this.api.FPDFText_GetUnicode(textPage, character);
        // PDFium replaces a printed wrap hyphen with U+0002 and omits the
        // newline. Restore its visible text without losing the row boundary.
        const isHyphen = this.api.FPDFText_IsHyphen(textPage, character) === 1;
        const text = isHyphen
          ? "-"
          : unicode > 0 && unicode <= 0x10ffff
            ? String.fromCodePoint(unicode)
            : "";
        const glyph: PdfGlyph = { text };
        if (isHyphen) glyph.lineBreakAfter = true;
        if (this.api.FPDFText_IsGenerated(textPage, character) === 1) glyph.generated = true;
        if (this.api.FPDFText_GetCharOrigin(textPage, character, scratch, scratch + 8)) {
          const originX = Number(this.api.pdfium.getValue(scratch, "double"));
          const originY = Number(this.api.pdfium.getValue(scratch + 8, "double"));
          const origin = {
            x: (a * originX + c * originY + e) / viewport.width,
            y: (b * originX + d * originY + f) / viewport.height,
          };
          // Baselines may lie outside a CropBox. Unlike painted ink, origins
          // must remain unpadded and unclamped for transient row assignment.
          if (Number.isFinite(origin.x) && Number.isFinite(origin.y)) glyph.origin = origin;
        }
        const fontSize = this.api.FPDFText_GetFontSize(textPage, character) * crossScale;
        if (Number.isFinite(fontSize) && fontSize > 0) glyph.fontSize = fontSize;
        const textObject = this.api.FPDFText_GetTextObject(textPage, character);
        if (textObject) {
          let font = fonts.get(textObject);
          if (font === undefined) {
            font = this.api.FPDFTextObj_GetFont(textObject);
            fonts.set(textObject, font);
          }
          // Font handles are page-local layout hints only, never note anchors.
          if (font) glyph.fontKey = font;
        }
        if (
          text &&
          !/^[\s\u200b\u2060]+$/u.test(text) &&
          this.api.FPDFText_GetCharBox(
            textPage,
            character,
            scratch,
            scratch + 8,
            scratch + 16,
            scratch + 24,
          )
        ) {
          const left = Number(this.api.pdfium.getValue(scratch, "double"));
          const right = Number(this.api.pdfium.getValue(scratch + 8, "double"));
          const bottom = Number(this.api.pdfium.getValue(scratch + 16, "double"));
          const top = Number(this.api.pdfium.getValue(scratch + 24, "double"));
          const points = [
            [left, top],
            [right, top],
            [right, bottom],
            [left, bottom],
          ].map(([x = 0, y = 0]) => ({
            x: (a * x + c * y + e) / viewport.width,
            y: (b * x + d * y + f) / viewport.height,
          }));
          const x = Math.max(0, Math.min(...points.map((point) => point.x)));
          const y = Math.max(0, Math.min(...points.map((point) => point.y)));
          const width = Math.min(1, Math.max(...points.map((point) => point.x))) - x;
          const height = Math.min(1, Math.max(...points.map((point) => point.y))) - y;
          if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0)
            glyph.rect = { x, y, width, height };
        }
        glyphs.push(glyph);
      }
      return {
        width: viewport.width,
        height: viewport.height,
        vertical: Math.abs(viewport.transform[1]) > Math.abs(viewport.transform[0]),
        reverseLines:
          Math.abs(viewport.transform[1]) > Math.abs(viewport.transform[0])
            ? viewport.transform[2] > 0
            : viewport.transform[3] > 0,
        glyphs,
      };
    } finally {
      if (scratch) this.api.pdfium.wasmExports.free(scratch);
      if (textPage) this.api.FPDFText_ClosePage(textPage);
      this.api.FPDF_ClosePage(page);
    }
  }

  close() {
    if (this.document) this.api.FPDF_CloseDocument(this.document);
    if (this.data) this.api.pdfium.wasmExports.free(this.data);
    this.document = this.data = 0;
  }
}

type Request =
  | { id: number; kind: "open"; bytes: Uint8Array }
  | { id: number; kind: "page"; page: number; viewport: PdfViewportGeometry };
type WorkerScope = {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (response: { id: number; page?: PdfPageGlyphs; error?: string }) => void;
};

// This source is transpiled into the app's local public assets at dev/build time.
// No Node code, external URL or PDF network upload is used by the worker.
if (typeof document === "undefined" && typeof self !== "undefined") {
  const scope = self as unknown as WorkerScope;
  let documentPromise: Promise<PdfiumGlyphDocument> | undefined;
  let queue = Promise.resolve();
  scope.onmessage = (event) => {
    const request = event.data;
    queue = queue.then(async () => {
      try {
        documentPromise ??= fetch(new URL("./pdfium.wasm", import.meta.url)).then(
          async (response) => {
            if (!response.ok) throw new Error("PDF_GEOMETRY_FAILED");
            const api = await init({
              wasmBinary: new Uint8Array(await response.arrayBuffer()),
              print: () => {},
              printErr: () => {},
            });
            api.FPDF_InitLibrary();
            return new PdfiumGlyphDocument(api);
          },
        );
        const pdf = await documentPromise;
        if (request.kind === "open") {
          pdf.open(request.bytes);
          scope.postMessage({ id: request.id });
        } else
          scope.postMessage({ id: request.id, page: pdf.page(request.page - 1, request.viewport) });
      } catch {
        scope.postMessage({ id: request.id, error: "PDF_GEOMETRY_FAILED" });
      }
    });
  };
}
