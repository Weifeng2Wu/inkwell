// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PdfAnnotationRect } from "./pdf-notes";
import {
  collectPdfSelection,
  mergePdfSelectionRects,
  pdfHighlightPath,
  pdfUnderlinePath,
} from "./pdf-selection";

const rect = (x: number, y: number, width: number, height = 0.02): PdfAnnotationRect => ({
  x,
  y,
  width,
  height,
});

function domRectList(...rects: DOMRect[]): DOMRectList {
  return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
}

describe("line-aware PDF selection geometry", () => {
  it("merges neighboring, duplicate and contained fragments without changing the source", () => {
    const input = [
      rect(0.15, 0.101, 0.03),
      rect(0.1, 0.1, 0.05),
      rect(0.12, 0.1, 0.01),
      rect(0.1, 0.1, 0.05),
      rect(0.184, 0.1, 0.03),
    ];
    const baseline = structuredClone(input);
    const result = mergePdfSelectionRects(input, 1.3);
    expect(result).toHaveLength(1);
    expect(result[0]?.x).toBeCloseTo(0.1);
    expect(result[0]?.width).toBeCloseTo(0.114);
    expect(input).toEqual(baseline);
  });

  it("keeps separate lines and two columns separate regardless of DOM order", () => {
    const result = mergePdfSelectionRects(
      [
        rect(0.6, 0.1, 0.1),
        rect(0.1, 0.13, 0.1),
        rect(0.1, 0.1, 0.1),
        rect(0.205, 0.1, 0.08),
        rect(0.705, 0.1, 0.08),
      ],
      1.3,
    );
    expect(result).toHaveLength(3);
    expect(result[0]?.x).toBe(0.1);
    expect(result[1]?.x).toBe(0.6);
    expect(result[2]?.y).toBe(0.13);
  });

  it("does not turn superscripts and tall formula fragments into a multiline box", () => {
    const result = mergePdfSelectionRects(
      [
        rect(0.1, 0.1, 0.1),
        rect(0.205, 0.09, 0.01, 0.008),
        rect(0.215, 0.08, 0.01, 0.08),
        rect(0.1, 0.13, 0.1),
      ],
      1.3,
    );
    expect(result).toHaveLength(4);
  });

  it("accounts for page aspect ratio when closing a word-sized gap", () => {
    const input = [rect(0.1, 0.1, 0.1, 0.01), rect(0.207, 0.1, 0.1, 0.01)];
    expect(mergePdfSelectionRects(input, 2)).toHaveLength(1);
    expect(mergePdfSelectionRects(input, 0.5)).toHaveLength(2);
  });

  it("creates one closed path with separate subpaths, not one bounding box across lines", () => {
    const input = [rect(0.1, 0.1, 0.2), rect(0.1, 0.13, 0.1)];
    expect(pdfHighlightPath(input).match(/M/g)).toHaveLength(2);
    expect(pdfHighlightPath(input).match(/Z/g)).toHaveLength(2);
    expect(pdfUnderlinePath(input)).toContain("M0.1 0.15h0.1");
    expect(pdfHighlightPath([])).toBe("");
  });
});

describe("text-only PDF range capture", () => {
  let root: HTMLDivElement;
  let bounds: DOMRect;
  let fragments: Map<Node, DOMRect[]>;
  let measured: { node: Node; start: number; end: number }[];

  function page(number: number, texts: string[]) {
    const element = document.createElement("div");
    element.dataset.pdfPage = String(number);
    const layer = document.createElement("div");
    layer.className = "react-pdf__Page__textContent textLayer";
    const nodes = texts.map((text) => {
      const span = document.createElement("span");
      const node = document.createTextNode(text);
      span.append(node);
      layer.append(span);
      return node;
    });
    element.append(layer);
    root.append(element);
    return { element, layer, nodes };
  }

  function nodeAt(nodes: Text[], index: number) {
    const node = nodes[index];
    if (!node) throw new Error("Missing fixture text");
    return node;
  }

  beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
    bounds = new DOMRect(0, 0, 100, 100);
    fragments = new Map();
    measured = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => bounds);
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: function (this: Range) {
        measured.push({ node: this.startContainer, start: this.startOffset, end: this.endOffset });
        // Deliberately bogus container geometry: old whole-range capture must fail.
        return this.startContainer.nodeType === Node.TEXT_NODE
          ? (fragments.get(this.startContainer) ?? [])
          : [new DOMRect(0, 0, 100, 100)];
      },
    });
  });

  afterEach(() => {
    root.remove();
    vi.restoreAllMocks();
  });

  it("measures only selected text, excluding duplicate span and marked-content boxes", () => {
    const { layer, nodes } = page(1, ["Before", "selected ", "words", "After"]);
    const first = nodeAt(nodes, 1);
    const second = nodeAt(nodes, 2);
    const wrapper = document.createElement("span");
    wrapper.className = "markedContent";
    wrapper.append(first.parentElement ?? first, second.parentElement ?? second);
    layer.insertBefore(wrapper, nodeAt(nodes, 3).parentElement);
    fragments.set(first, [new DOMRect(10, 10, 20, 2), new DOMRect(10, 10, 20, 2)]);
    fragments.set(second, [new DOMRect(30, 10, 10, 2)]);
    const range = document.createRange();
    range.setStart(first, 2);
    range.setEnd(second, 3);
    const result = collectPdfSelection(root, range);
    expect(result[0]?.quote).toBe("lected wor");
    expect(result[0]?.rects).toHaveLength(1);
    expect(result[0]?.rects[0]?.width).toBeCloseTo(0.3);
    expect(measured).toEqual([
      { node: first, start: 0, end: 9 },
      { node: first, start: 2, end: 8 },
      { node: second, start: 0, end: 5 },
      { node: second, start: 0, end: 3 },
    ]);
    expect(result[0]?.runs.map(({ text, start, end }) => ({ text, start, end }))).toEqual([
      { text: "selected ", start: 2, end: 8 },
      { text: "words", start: 0, end: 3 },
    ]);
  });

  it("clips a cross-page selection independently without including outside controls", () => {
    const first = page(1, ["first page"]);
    const outside = document.createElement("button");
    outside.textContent = "Not PDF text";
    root.append(outside);
    const second = page(2, ["second page"]);
    const start = nodeAt(first.nodes, 0);
    const end = nodeAt(second.nodes, 0);
    fragments.set(start, [new DOMRect(10, 10, 20, 2)]);
    fragments.set(end, [new DOMRect(20, 20, 20, 2)]);
    const range = document.createRange();
    range.setStart(start, 6);
    range.setEnd(end, 6);
    const result = collectPdfSelection(root, range);
    expect(result.map(({ page, quote }) => ({ page, quote }))).toEqual([
      { page: 1, quote: "page" },
      { page: 2, quote: "second" },
    ]);
    expect(result[0]?.rects[0]?.x).toBeCloseTo(0.1);
    expect(result[1]?.rects[0]?.x).toBeCloseTo(0.2);
  });

  it("supports element-boundary selections without painting unselected text nodes", () => {
    const { layer, nodes } = page(1, ["not selected", "selected", "not selected"]);
    const text = nodeAt(nodes, 1);
    fragments.set(text, [new DOMRect(10, 10, 20, 2)]);
    const range = document.createRange();
    range.setStart(layer, 1);
    range.setEnd(layer, 2);
    expect(collectPdfSelection(root, range)[0]?.quote).toBe("selected");
    expect(measured.map(({ node }) => node)).toEqual([text, text]);
  });

  it("ignores line-break/sentinel boxes, whitespace and off-page rectangles", () => {
    const { layer, nodes } = page(1, ["word", " ", "tail"]);
    const sentinel = document.createElement("div");
    sentinel.className = "endOfContent";
    sentinel.textContent = "";
    layer.append(document.createElement("br"), sentinel);
    fragments.set(nodeAt(nodes, 0), [new DOMRect(-5, 10, 20, 2), new DOMRect(10, 10, 0, 2)]);
    fragments.set(nodeAt(nodes, 1), [new DOMRect(0, 0, 100, 100)]);
    fragments.set(nodeAt(nodes, 2), [new DOMRect(150, 10, 20, 2)]);
    const range = document.createRange();
    range.selectNodeContents(layer);
    const result = collectPdfSelection(root, range);
    expect(result[0]?.rects).toEqual([{ x: 0, y: 0.1, width: 0.15, height: 0.02 }]);
    expect(measured).toHaveLength(4);
  });

  it("retains normalized geometry when the page and text scale together", () => {
    const { nodes } = page(1, ["selected"]);
    const text = nodeAt(nodes, 0);
    const range = document.createRange();
    range.selectNodeContents(text);
    bounds = new DOMRect(10, 20, 200, 400);
    fragments.set(text, [new DOMRect(30, 60, 40, 10)]);
    const before = collectPdfSelection(root, range)[0]?.rects;
    bounds = new DOMRect(20, 40, 400, 800);
    fragments.set(text, [new DOMRect(60, 120, 80, 20)]);
    expect(collectPdfSelection(root, range)[0]?.rects).toEqual(before);
  });

  it("does not extend a line's right edge through trailing spaces in the same text run", () => {
    const { nodes } = page(1, ["word       "]);
    const text = nodeAt(nodes, 0);
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      return domRectList(
        new DOMRect(10 + this.startOffset * 2, 10, (this.endOffset - this.startOffset) * 2, 2),
      );
    });
    const range = document.createRange();
    range.selectNodeContents(text);
    const result = collectPdfSelection(root, range);
    expect(result[0]?.quote).toBe("word");
    expect(result[0]?.rects[0]?.width).toBeCloseTo(0.08);
    expect(range.endOffset).toBe(11); // Geometry trimming must not change native selection.
  });

  it("excludes leading/trailing Unicode whitespace and invisible padding without cutting CJK glyphs", () => {
    const { nodes } = page(1, [" \u3000论文结论\u00a0 \u200b\u2060"]);
    const text = nodeAt(nodes, 0);
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      return domRectList(
        new DOMRect(10 + this.startOffset * 4, 10, (this.endOffset - this.startOffset) * 4, 2),
      );
    });
    const range = document.createRange();
    range.selectNodeContents(text);
    const result = collectPdfSelection(root, range);
    expect(result[0]?.quote).toBe(range.toString().trim());
    expect(result[0]?.rects[0]?.x).toBeCloseTo(0.18);
    expect(result[0]?.rects[0]?.width).toBeCloseTo(0.16);
  });

  it("trims padding only inside the exact selected offsets, not the entire source node", () => {
    const { nodes } = page(1, ["before  target    after"]);
    const text = nodeAt(nodes, 0);
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      return domRectList(
        new DOMRect(10 + this.startOffset, 10, this.endOffset - this.startOffset, 2),
      );
    });
    const range = document.createRange();
    range.setStart(text, 8);
    range.setEnd(text, 18);
    const result = collectPdfSelection(root, range);
    expect(result[0]?.quote).toBe("target");
    expect(result[0]?.rects[0]?.x).toBeCloseTo(0.18);
    expect(result[0]?.rects[0]?.width).toBeCloseTo(0.06);
    expect(range.toString()).toBe("target    ");
  });

  it("trims each line's trailing padding when one node contains multiple lines", () => {
    const { nodes } = page(1, ["first   \nnext\u00a0\u00a0"]);
    const text = nodeAt(nodes, 0);
    const offsets: [number, number][] = [];
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      offsets.push([this.startOffset, this.endOffset]);
      if (this.startOffset < 9 && this.endOffset > 8)
        return domRectList(new DOMRect(10, 10, 90, 15));
      return domRectList(
        new DOMRect(10, this.startOffset < 9 ? 10 : 20, (this.endOffset - this.startOffset) * 2, 2),
      );
    });
    const range = document.createRange();
    range.selectNodeContents(text);
    const result = collectPdfSelection(root, range);
    expect(offsets).toEqual([
      [0, 15],
      [0, 5],
      [9, 13],
    ]);
    expect(result[0]?.rects).toEqual([
      { x: 0.1, y: 0.1, width: 0.1, height: 0.02 },
      { x: 0.1, y: 0.2, width: 0.08, height: 0.02 },
    ]);
    expect(result[0]?.quote).toBe("first   \nnext");
  });

  it("keeps normal word gaps continuous but stops before the final run's padding", () => {
    const { layer, nodes } = page(1, ["one  ", "  two  "]);
    const first = nodeAt(nodes, 0);
    bounds = new DOMRect(0, 0, 1000, 1000);
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      const left = this.startContainer === first ? 100 : 114;
      return domRectList(
        new DOMRect(
          left + this.startOffset * 10,
          100,
          (this.endOffset - this.startOffset) * 10,
          10,
        ),
      );
    });
    const range = document.createRange();
    range.selectNodeContents(layer);
    const result = collectPdfSelection(root, range);
    expect(result[0]?.quote).toBe("one    two");
    expect(result[0]?.rects).toHaveLength(1);
    expect(result[0]?.rects[0]?.x).toBeCloseTo(0.1);
    expect(result[0]?.rects[0]?.width).toBeCloseTo(0.064);
  });

  it("does not create marks from invisible-only selected padding", () => {
    const { nodes } = page(1, ["\u200b\u2060"]);
    const text = nodeAt(nodes, 0);
    fragments.set(text, [new DOMRect(10, 10, 50, 2)]);
    const range = document.createRange();
    range.selectNodeContents(text);
    expect(collectPdfSelection(root, range)).toEqual([]);
  });

  it("returns no rectangles for collapsed, outside-viewer or scanned selections", () => {
    const { layer, nodes } = page(1, ["selected"]);
    const range = document.createRange();
    range.setStart(nodeAt(nodes, 0), 0);
    range.collapse(true);
    expect(collectPdfSelection(root, range)).toEqual([]);
    range.selectNodeContents(document.body);
    expect(collectPdfSelection(root, range)).toEqual([]);
    range.selectNodeContents(layer);
    expect(collectPdfSelection(root, range)).toEqual([]);
  });

  it("bounds the total selected text across pages before saving", () => {
    const first = page(1, ["a".repeat(11000)]);
    const second = page(2, ["b".repeat(11000)]);
    const range = document.createRange();
    range.setStart(nodeAt(first.nodes, 0), 0);
    range.setEnd(nodeAt(second.nodes, 0), 11000);
    expect(() => collectPdfSelection(root, range)).toThrow("PDF_SELECTION_TOO_LONG");
  });
});
