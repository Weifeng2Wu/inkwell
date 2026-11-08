// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfGeometry } from "../lib/pdf-geometry";
import {
  createPdfNotes,
  type PdfAnnotation,
  parsePdfNotes,
  upsertPdfAnnotation,
} from "../lib/pdf-notes";
import type { PdfSelectionPage } from "../lib/pdf-selection";
import { PdfAnnotationLayer } from "./pdf-annotation-layer";
import { PdfSelectionPreview } from "./pdf-selection-preview";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.getSelection()?.removeAllRanges();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const annotation: PdfAnnotation = {
  id: "first",
  page: 1,
  fingerprint: "pdf",
  kind: "highlight",
  color: "warning",
  quote: "Selected words",
  note: "Keep my note",
  rects: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.02 }],
};

describe("saved PDF highlight paint", () => {
  it("paints connected highlight bands but keeps underlines and persisted anchors tight", async () => {
    const tight = [
      { x: 0.1, y: 0.1, width: 0.4, height: 0.01 },
      { x: 0.1, y: 0.13, width: 0.2, height: 0.01 },
    ];
    const bands = [
      { ...tight[0], x: 0.1, y: 0.1, width: 0.4, height: 0.03 },
      { ...tight[1], x: 0.1, y: 0.13, width: 0.2, height: 0.02 },
    ];
    const highlighted = { ...annotation, rects: tight, highlightRects: bands };
    const underlined = { ...highlighted, id: "underline", kind: "underline" as const };
    await act(async () =>
      root.render(createElement(PdfAnnotationLayer, { annotations: [highlighted, underlined] })),
    );
    expect(
      host.querySelector('[data-pdf-annotation-paint="highlight"]')?.getAttribute("d"),
    ).toContain("v0.03");
    expect(
      host.querySelector('[data-pdf-annotation-paint="underline"]')?.getAttribute("d"),
    ).toContain("M0.1 0.11");
    const saved = upsertPdfAnnotation(
      createPdfNotes("paper.pdf", "Notes", ""),
      highlighted,
      "Note",
    );
    expect(parsePdfNotes(saved).annotations[0]?.rects).toEqual(tight);
    expect(saved).not.toContain("highlightRects");
  });

  it("paints overlapping same-color notes in one path without changing their anchors", async () => {
    const annotations = [
      annotation,
      {
        ...annotation,
        id: "second",
        note: "Another note",
        rects: [{ x: 0.3, y: 0.1, width: 0.4, height: 0.02 }],
      },
    ];
    const baseline = structuredClone(annotations);
    await act(async () => root.render(createElement(PdfAnnotationLayer, { annotations })));
    const paints = host.querySelectorAll("[data-pdf-annotation-paint]");
    expect(paints).toHaveLength(1);
    expect(paints[0]?.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(paints[0]?.getAttribute("fill-opacity")).toBe("0.28");
    expect(paints[0]?.getAttribute("fill")).toBe("var(--warning)");
    expect(annotations).toEqual(baseline);
  });

  it("keeps colors and underlines independent and uses fixed-screen underline thickness", async () => {
    const annotations = [
      annotation,
      { ...annotation, id: "other-color", color: "info" as const },
      { ...annotation, id: "underline", kind: "underline" as const },
    ];
    await act(async () => root.render(createElement(PdfAnnotationLayer, { annotations })));
    expect(host.querySelectorAll('[data-pdf-annotation-paint="highlight"]')).toHaveLength(2);
    const underline = host.querySelector('[data-pdf-annotation-paint="underline"]');
    expect(underline?.getAttribute("fill")).toBe("none");
    expect(underline?.getAttribute("stroke")).toBe("var(--warning)");
    expect(underline?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(underline?.getAttribute("stroke-width")).toBe("2");
  });

  it("renders legacy anchors without a color using the original accent", async () => {
    await act(async () =>
      root.render(
        createElement(PdfAnnotationLayer, {
          annotations: [{ ...annotation, color: undefined }],
        }),
      ),
    );
    expect(host.querySelector("path")?.getAttribute("fill")).toBe("var(--accent)");
    expect(host.querySelector("svg")?.getAttribute("preserveAspectRatio")).toBe("none");
  });
});

describe("live PDF selection preview", () => {
  let pdf: HTMLDivElement;
  let frames: Map<number, FrameRequestCallback>;
  let serial: number;
  const pdfRef = { current: null as HTMLDivElement | null };
  let geometry: PdfGeometry;

  function page(number: number) {
    const element = document.createElement("div");
    element.dataset.pdfPage = String(number);
    element.className = "inkwell-pdf-page";
    const layer = document.createElement("div");
    layer.className = "react-pdf__Page__textContent textLayer";
    const span = document.createElement("span");
    const text = document.createTextNode("selected words");
    span.append(text);
    layer.append(span);
    element.append(layer);
    pdf.append(element);
    return text;
  }

  async function flushFrames() {
    await act(async () => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(0);
    });
  }

  async function renderPreview(geometryKey = "original") {
    await act(async () =>
      root.render(createElement(PdfSelectionPreview, { rootRef: pdfRef, geometryKey, geometry })),
    );
    await flushFrames();
  }

  function select(start: Text, end = start, endOffset = 8) {
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  function deferredRefinement() {
    let resolve: ((pages: PdfSelectionPage[]) => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const promise = new Promise<PdfSelectionPage[]>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return {
      promise,
      resolve: (pages: PdfSelectionPage[]) => resolve?.(pages),
      reject: (error: Error) => reject?.(error),
    };
  }

  const refined = (pages: PdfSelectionPage[]) =>
    pages.map((item) => ({
      ...item,
      rects: item.rects.map((rect) => ({ ...rect, height: 0.01 })),
    }));

  beforeEach(() => {
    geometry = {
      refineSelection: vi.fn(async (pages: PdfSelectionPage[]) =>
        pages.map((item) => ({
          ...item,
          rects: item.rects.map((rect) => ({ ...rect, height: 0.01 })),
        })),
      ),
      refineAnnotation: vi.fn(async (item) => item),
    };
    frames = new Map();
    serial = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frames.set(++serial, callback);
        return serial;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((id: number) => frames.delete(id)),
    );
    pdf = document.createElement("div");
    pdfRef.current = pdf;
    document.body.append(pdf);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const number = Number(this.closest("[data-pdf-page]")?.getAttribute("data-pdf-page") ?? 1);
      return new DOMRect(0, (number - 1) * 100, 100, 100);
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: function (this: Range) {
        const number = Number(
          this.startContainer.parentElement
            ?.closest("[data-pdf-page]")
            ?.getAttribute("data-pdf-page") ?? 1,
        );
        return [new DOMRect(10, (number - 1) * 100 + 10, this.endOffset - this.startOffset, 2)];
      },
    });
  });

  afterEach(() => {
    pdf.remove();
    pdfRef.current = null;
  });

  it("uses one frame for repeated drag changes and leaves native selection/copy intact", async () => {
    const text = page(1);
    await renderPreview();
    select(text);
    document.dispatchEvent(new Event("selectionchange"));
    document.dispatchEvent(new Event("selectionchange"));
    expect(frames.size).toBe(1);
    await flushFrames();
    expect(pdf.querySelectorAll("[data-pdf-selection-preview]")).toHaveLength(1);
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe("M0.1 0.1h0.08v0.01h-0.08Z");
    expect(window.getSelection()?.toString()).toBe("selected");
    expect(host.querySelector("svg")).toBeNull(); // The preview is portalled onto its page.
  });

  it("suppresses loose native backgrounds before the first selection refinement is ready", async () => {
    const text = page(1);
    const pending = deferredRefinement();
    geometry.refineSelection = vi.fn(() => pending.promise);
    await renderPreview();
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
    select(text);
    await flushFrames();
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    expect(window.getSelection()?.toString()).toBe("selected");
    const captured = vi.mocked(geometry.refineSelection).mock.calls[0]?.[0] ?? [];
    await act(async () => {
      pending.resolve(refined(captured));
      await pending.promise;
    });
    await flushFrames();
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe("M0.1 0.1h0.08v0.01h-0.08Z");
  });

  it("keeps the last precise frame during a delayed drag update and replaces it atomically", async () => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    const before = pdf.querySelector("path")?.getAttribute("d");
    const pending = deferredRefinement();
    geometry.refineSelection = vi.fn(() => pending.promise);
    select(text, text, 12);
    await flushFrames();
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe(before);
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
    const captured = vi.mocked(geometry.refineSelection).mock.calls[0]?.[0] ?? [];
    await act(async () => {
      pending.resolve(refined(captured));
      await pending.promise;
    });
    await flushFrames();
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe("M0.1 0.1h0.12v0.01h-0.12Z");
    expect(window.getSelection()?.toString()).toBe("selected wor");
  });

  it("suppresses loose backgrounds on newly selected pages while keeping existing precise paint", async () => {
    const first = page(1);
    const second = page(2);
    await renderPreview();
    select(first);
    await flushFrames();
    const before = pdf.querySelector("path")?.getAttribute("d");
    const pending = deferredRefinement();
    geometry.refineSelection = vi.fn(() => pending.promise);
    select(first, second);
    await flushFrames();
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
    expect(pdf.querySelectorAll("[data-pdf-selection-preview]")).toHaveLength(1);
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe(before);
    const captured = vi.mocked(geometry.refineSelection).mock.calls[0]?.[0] ?? [];
    await act(async () => {
      pending.resolve(refined(captured));
      await pending.promise;
    });
    await flushFrames();
    expect(pdf.querySelectorAll("[data-pdf-selection-preview]")).toHaveLength(2);
  });

  it.each([
    "resolve",
    "reject",
  ])("ignores a late %s from an older drag without changing the newest paint or native suppression", async (outcome) => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    const stale = deferredRefinement();
    const current = deferredRefinement();
    geometry.refineSelection = vi
      .fn<PdfGeometry["refineSelection"]>()
      .mockReturnValue(current.promise)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    select(text, text, 10);
    await flushFrames();
    select(text, text, 12);
    await flushFrames();
    const calls = vi.mocked(geometry.refineSelection).mock.calls;
    await act(async () => {
      current.resolve(refined(calls[1]?.[0] ?? []));
      await current.promise;
    });
    await flushFrames();
    const latest = pdf.querySelector("path")?.getAttribute("d");
    expect(latest).toBe("M0.1 0.1h0.12v0.01h-0.12Z");
    await act(async () => {
      if (outcome === "resolve") stale.resolve(refined(calls[0]?.[0] ?? []));
      else stale.reject(new Error("Old geometry failure"));
      await stale.promise.catch(() => {});
    });
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe(latest);
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
  });

  it("restores native feedback only after the current refinement actually fails", async () => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    const pending = deferredRefinement();
    geometry.refineSelection = vi.fn(() => pending.promise);
    select(text, text, 12);
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).not.toBeNull();
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
    await act(async () => {
      pending.reject(new Error("PDF_GEOMETRY_FAILED"));
      await pending.promise.catch(() => {});
    });
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    expect(window.getSelection()?.toString()).toBe("selected wor");
  });

  it.each([
    "resolve",
    "reject",
  ])("keeps confirmed native fallback stable until a retry can %s", async (outcome) => {
    const text = page(1);
    geometry.refineSelection = vi.fn(async () => {
      throw new Error("PDF_GEOMETRY_FAILED");
    });
    await renderPreview();
    select(text);
    await flushFrames();
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    const pending = deferredRefinement();
    geometry.refineSelection = vi.fn(() => pending.promise);
    pdf.dispatchEvent(new Event("pointerdown"));
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    select(text, text, 12);
    window.dispatchEvent(new Event("resize"));
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    await flushFrames();
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    const captured = vi.mocked(geometry.refineSelection).mock.calls[0]?.[0] ?? [];
    await act(async () => {
      if (outcome === "resolve") pending.resolve(refined(captured));
      else pending.reject(new Error("Still unavailable"));
      await pending.promise.catch(() => {});
    });
    await flushFrames();
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe(
      outcome === "resolve" ? "glyph" : null,
    );
    expect(pdf.querySelectorAll("[data-pdf-selection-preview]")).toHaveLength(
      outcome === "resolve" ? 1 : 0,
    );
  });

  it.each([
    "resize",
    "text-layer-ready",
  ])("keeps precise feedback while %s remeasurement is pending in the same document", async (event) => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    const before = pdf.querySelector("path")?.getAttribute("d");
    const pending = deferredRefinement();
    geometry.refineSelection = vi.fn(() => pending.promise);
    if (event === "resize") window.dispatchEvent(new Event("resize"));
    else pdf.dispatchEvent(new Event("inkwell-pdf-text-layer-ready"));
    await flushFrames();
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe(before);
    const captured = vi.mocked(geometry.refineSelection).mock.calls[0]?.[0] ?? [];
    await act(async () => {
      pending.resolve(refined(captured));
      await pending.promise;
    });
    await flushFrames();
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe(before);
  });

  it("clears old-document paint before a new document's geometry is ready and cleans up on unmount", async () => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).not.toBeNull();
    const pending = deferredRefinement();
    geometry.refineSelection = vi.fn(() => pending.promise);
    await renderPreview("different-document");
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    expect(pdf.getAttribute("data-pdf-selection-renderer")).toBe("glyph");
    const captured = vi.mocked(geometry.refineSelection).mock.calls[0]?.[0] ?? [];
    await act(async () => root.render(null));
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    await act(async () => {
      pending.resolve(refined(captured));
      await pending.promise;
    });
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
  });

  it("keeps native selection available when the geometry service is unavailable", async () => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    await act(async () =>
      root.render(
        createElement(PdfSelectionPreview, {
          rootRef: pdfRef,
          geometryKey: "original",
          geometry: null,
        }),
      ),
    );
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    expect(window.getSelection()?.toString()).toBe("selected");
  });

  it("uses the service's connected paint bands while keeping the native text range intact", async () => {
    const text = page(1);
    geometry.refineSelection = vi.fn(async (pages: PdfSelectionPage[]) =>
      pages.map((item) => ({
        ...item,
        rects: [
          { x: 0.1, y: 0.1, width: 0.1, height: 0.01 },
          { x: 0.1, y: 0.13, width: 0.08, height: 0.01 },
        ],
        highlightRects: [
          { x: 0.1, y: 0.1, width: 0.1, height: 0.03 },
          { x: 0.1, y: 0.13, width: 0.08, height: 0.02 },
        ],
      })),
    );
    await renderPreview();
    select(text);
    await flushFrames();
    const path = pdf.querySelector("[data-pdf-selection-preview] path")?.getAttribute("d");
    expect(path).toContain("v0.03");
    expect(path).toContain("v0.02");
    expect(window.getSelection()?.toString()).toBe("selected");
  });

  it("previews both pages and removes all stale paint when the selection clears", async () => {
    const first = page(1);
    const second = page(2);
    await renderPreview();
    select(first, second);
    await flushFrames();
    expect(pdf.querySelectorAll("[data-pdf-selection-preview]")).toHaveLength(2);
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await flushFrames();
    expect(pdf.querySelectorAll("[data-pdf-selection-preview]")).toHaveLength(0);
  });

  it("ignores selections belonging to a different viewer or editable note", async () => {
    const text = page(1);
    await renderPreview();
    const other = document.createTextNode("outside PDF");
    host.append(other);
    select(other);
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    select(text, other);
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
  });

  it("remeasures after zoom/text-layer completion and cancels pending frames on unmount", async () => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    const before = pdf.querySelector("path")?.getAttribute("d");
    await renderPreview("zoomed");
    expect(pdf.querySelector("path")?.getAttribute("d")).toBe(before);
    pdf.dispatchEvent(new Event("inkwell-pdf-text-layer-ready"));
    expect(frames.size).toBe(1);
    await act(async () => root.render(null));
    expect(frames.size).toBe(0);
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    document.dispatchEvent(new Event("selectionchange"));
    expect(frames.size).toBe(0);
  });

  it("falls back to native selection instead of leaving stale paint after geometry errors", async () => {
    const text = page(1);
    await renderPreview();
    select(text);
    await flushFrames();
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(() => {
      throw new Error("Unavailable geometry");
    });
    document.dispatchEvent(new Event("selectionchange"));
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    expect(pdf.hasAttribute("data-pdf-selection-renderer")).toBe(false);
    expect(window.getSelection()?.toString()).toBe("selected");
  });

  it("does not restore a cleared selection when tight geometry resolves late", async () => {
    const text = page(1);
    let resolve: ((value: Awaited<ReturnType<PdfGeometry["refineSelection"]>>) => void) | undefined;
    const pending = new Promise<Awaited<ReturnType<PdfGeometry["refineSelection"]>>>((done) => {
      resolve = done;
    });
    geometry.refineSelection = vi.fn(() => pending);
    await renderPreview();
    select(text);
    await flushFrames();
    const captured = vi.mocked(geometry.refineSelection).mock.calls[0]?.[0] ?? [];
    expect(captured).toHaveLength(1);
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await flushFrames();
    await act(async () => {
      resolve?.(captured);
      await pending;
    });
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
  });

  it("keeps native selection when the glyph service fails instead of painting loose browser boxes", async () => {
    const text = page(1);
    geometry.refineSelection = vi.fn(async () => {
      throw new Error("PDF_GEOMETRY_FAILED");
    });
    await renderPreview();
    select(text);
    await flushFrames();
    expect(pdf.querySelector("[data-pdf-selection-preview]")).toBeNull();
    expect(window.getSelection()?.toString()).toBe("selected");
  });
});

it("keeps selection glyphs transparent and preserves native feedback in forced-color mode", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "pdf-viewer.css"), "utf8");
  expect(css).toContain("color: transparent");
  expect(css).toContain("text-shadow: none");
  expect(css).toContain("mix-blend-mode: multiply");
  expect(css).toContain("@media (forced-colors: active)");
  expect(css).toContain("background: Highlight");
  const renderer = '[data-pdf-selection-renderer="glyph"] .inkwell-pdf-page .textLayer';
  expect(css).toContain(`${renderer} ::selection`);
  const forcedColors = css.slice(css.indexOf("@media (forced-colors: active)"));
  expect(forcedColors).toContain(`${renderer} ::selection`);
  expect(forcedColors).toContain(`${renderer} br::selection`);
});
