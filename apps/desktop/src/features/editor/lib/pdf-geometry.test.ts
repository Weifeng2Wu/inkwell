// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfGeometryClient } from "./pdf-geometry";
import type { PdfPageGlyphs } from "./pdf-glyph-geometry";
import type { PdfSelectionPage } from "./pdf-selection";

const glyphs: PdfPageGlyphs = {
  width: 600,
  height: 800,
  glyphs: [{ text: "A", rect: { x: 0.1, y: 0.1, width: 0.01, height: 0.01 } }],
};
let worker: TestWorker;
class TestWorker {
  onmessage:
    | ((event: { data: { id: number; page?: PdfPageGlyphs; error?: string } }) => void)
    | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  requests: { id: number; kind: string; bytes?: Uint8Array }[] = [];
  terminate = vi.fn();
  postMessage = vi.fn((request: { id: number; kind: string; bytes?: Uint8Array }) =>
    this.requests.push(request),
  );
  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    worker = this;
  }
  respond(index: number, page?: PdfPageGlyphs, error?: string) {
    const request = this.requests[index];
    if (!request) throw new Error("Missing worker request");
    this.onmessage?.({ data: { id: request.id, page, error } });
  }
}
const viewport = vi.fn(async () => ({
  width: 600,
  height: 800,
  transform: [1, 0, 0, -1, 0, 800] as [number, number, number, number, number, number],
}));
const selection = (): PdfSelectionPage[] => [
  {
    element: document.createElement("div"),
    page: 1,
    quote: "A",
    rects: [{ x: 0.09, y: 0.09, width: 0.03, height: 0.03 }],
    runs: [
      { text: "A", start: 0, end: 1, bounds: { x: 0.09, y: 0.09, width: 0.03, height: 0.03 } },
    ],
  },
];
beforeEach(() => {
  vi.stubGlobal("Worker", TestWorker);
  viewport.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local PDF geometry worker client", () => {
  it("uses identical multiline paint for previews and reopened notes without padding underline anchors", async () => {
    const client = new PdfGeometryClient(new Uint8Array([1]), viewport);
    const page: PdfPageGlyphs = {
      width: 600,
      height: 800,
      glyphs: [
        { text: "A", rect: { x: 0.1, y: 0.1, width: 0.01, height: 0.01 } },
        { text: "B", rect: { x: 0.1, y: 0.13, width: 0.01, height: 0.01 } },
        { text: "C", rect: { x: 0.1, y: 0.16, width: 0.01, height: 0.01 } },
      ],
    };
    const input = selection();
    const selected = input[0];
    if (!selected) throw new Error("Missing selection");
    selected.quote = "AB";
    selected.runs = [
      { text: "AB", start: 0, end: 2, bounds: { x: 0.09, y: 0.09, width: 0.03, height: 0.06 } },
    ];
    const preview = client.refineSelection(input);
    worker.respond(0);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    worker.respond(1, page);
    const refined = (await preview)[0];
    if (!refined) throw new Error("Missing refinement");
    const note = {
      id: "annotation",
      page: 1,
      kind: "highlight" as const,
      quote: "AB",
      fingerprint: "pdf",
      note: "Keep this note",
      rects: refined.rects,
    };
    const reopened = await client.refineAnnotation(note);
    expect(reopened.highlightRects).toEqual(refined.highlightRects);
    expect(reopened.rects).toEqual(note.rects);
    expect(reopened.highlightRects?.[0]?.height).toBeCloseTo(0.03);
    expect(reopened.highlightRects?.[1]?.height).toBeCloseTo(0.02);
    const underline = await client.refineAnnotation({ ...note, kind: "underline" });
    expect(underline.highlightRects).toBeUndefined();
    expect(underline.rects).toEqual(note.rects);
    // Quoting/extraction order may differ in an old PDF; keep its existing anchors
    // but still apply the user-requested display style at those same locations.
    const legacy = await client.refineAnnotation({ ...note, quote: "Legacy text order" });
    expect(legacy.rects).toBe(note.rects);
    expect(legacy.highlightRects).toEqual(refined.highlightRects);
    client.dispose();
  });

  it("copies document bytes, uses a local module worker, and caches a page across previews and saving", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const client = new PdfGeometryClient(bytes, viewport);
    expect(worker.url.pathname).toBe("/pdfjs/geometry/worker.js");
    expect(worker.options.type).toBe("module");
    expect(worker.requests[0]?.bytes).not.toBe(bytes);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    const first = client.refineSelection(selection());
    const second = client.refineSelection(selection());
    worker.respond(0);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    worker.respond(1, glyphs);
    expect((await first)[0]?.rects).toEqual([glyphs.glyphs[0]?.rect]);
    await second;
    expect(viewport).toHaveBeenCalledTimes(1);
    await client.refineSelection(selection());
    expect(worker.requests).toHaveLength(2);
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects pending and cached work after disposal and ignores late responses", async () => {
    const client = new PdfGeometryClient(new Uint8Array([1]), viewport);
    const pending = client.refineSelection(selection());
    const rejected = expect(pending).rejects.toThrow("PDF_GEOMETRY_FAILED");
    client.dispose();
    worker.respond(0);
    await rejected;
    await expect(client.refineSelection(selection())).rejects.toThrow("PDF_GEOMETRY_FAILED");
    client.dispose();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("times out failed startup and terminates without unhandled rejections", async () => {
    vi.useFakeTimers();
    const client = new PdfGeometryClient(new Uint8Array([1]), viewport);
    const pending = client.refineSelection(selection());
    const rejected = expect(pending).rejects.toThrow("PDF_GEOMETRY_FAILED");
    await vi.advanceTimersByTimeAsync(20001);
    await rejected;
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("evicts failed page requests so a subsequent selection can retry", async () => {
    const client = new PdfGeometryClient(new Uint8Array([1]), viewport);
    const pending = client.refineSelection(selection());
    const rejected = expect(pending).rejects.toThrow("PDF_GEOMETRY_FAILED");
    worker.respond(0);
    await vi.waitFor(() => expect(worker.requests).toHaveLength(2));
    worker.respond(1, undefined, "failure");
    await rejected;
    const retried = client.refineSelection(selection());
    await vi.waitFor(() => expect(worker.requests).toHaveLength(3));
    worker.respond(2, glyphs);
    await retried;
    client.dispose();
  });
});
