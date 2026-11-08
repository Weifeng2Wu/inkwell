import { describe, expect, it } from "vitest";
import { type PdfPageGlyphs, pdfGlyphLines } from "./pdf-glyph-geometry";
import { connectedPdfHighlightRects } from "./pdf-highlight-geometry";
import type { PdfAnnotationRect } from "./pdf-notes";

const box = (x: number, y: number, width = 0.1, height = 0.01): PdfAnnotationRect => ({
  x,
  y,
  width,
  height,
});
const page = (rects: PdfAnnotationRect[]): PdfPageGlyphs => ({
  width: 600,
  height: 800,
  glyphs: rects.map((rect) => ({ text: "A", rect })),
});
const bottom = (rect: PdfAnnotationRect | undefined) => (rect?.y ?? 0) + (rect?.height ?? 0);

function typedPage(
  rows: {
    rect: PdfAnnotationRect;
    fontSize?: number;
    fontKey?: number;
    baseline?: number;
  }[],
): PdfPageGlyphs {
  return {
    width: 600,
    height: 800,
    glyphs: rows.flatMap(({ rect, fontSize = 12, fontKey = 1, baseline }) => [
      { text: "A", rect, fontSize, fontKey, origin: { x: rect.x, y: baseline ?? bottom(rect) } },
      { text: "\n", generated: true },
    ]),
  };
}

describe("connected multiline PDF highlight bands", () => {
  it("fills an interior gap and gives the last line half a gap without covering normal text below", () => {
    const source = page([box(0.1, 0.1), box(0.1, 0.13), box(0.1, 0.16)]);
    const tight = [box(0.15, 0.1, 0.05), box(0.1, 0.13, 0.02)];
    const original = structuredClone(tight);
    const bands = connectedPdfHighlightRects(source, tight);
    expect(bands).toHaveLength(2);
    expect(bottom(bands[0])).toBeCloseTo(bands[1]?.y ?? 0);
    expect(bands[0]?.height).toBeCloseTo(0.03);
    expect(bands[1]?.height).toBeCloseTo(0.02);
    expect(bottom(bands[1])).toBeCloseTo(0.15);
    expect(bottom(bands[1])).toBeLessThan(0.16);
    expect(bands.map(({ x, width }) => ({ x, width }))).toEqual(
      tight.map(({ x, width }) => ({ x, width })),
    );
    expect(tight).toEqual(original);
  });

  it("fills each interior line, not one large bounding rectangle around a paragraph", () => {
    const source = page([box(0.1, 0.1), box(0.1, 0.13), box(0.1, 0.16), box(0.1, 0.19)]);
    const bands = connectedPdfHighlightRects(source, [
      box(0.14, 0.1, 0.06),
      box(0.1, 0.13),
      box(0.1, 0.16, 0.03),
    ]);
    expect(bands).toHaveLength(3);
    expect(bottom(bands[0])).toBeCloseTo(bands[1]?.y ?? 0);
    expect(bottom(bands[1])).toBeCloseTo(bands[2]?.y ?? 0);
    expect(bottom(bands[2])).toBeCloseTo(0.18);
    expect(bands[2]?.width).toBe(0.03);
  });

  it("shortens the last padding when unselected text below is closer than the previous line", () => {
    const source = page([box(0.1, 0.1), box(0.1, 0.13), box(0.1, 0.144)]);
    const bands = connectedPdfHighlightRects(source, [box(0.1, 0.1), box(0.1, 0.13)]);
    expect(bottom(bands[1])).toBeCloseTo(0.142);
    expect(bottom(bands[1])).toBeLessThan(0.144);
  });

  it("treats larger-font unselected headings as an obstacle, not a line to skip", () => {
    const source = page([box(0.1, 0.1), box(0.1, 0.13), box(0.1, 0.141, 0.1, 0.04)]);
    const bands = connectedPdfHighlightRects(source, [box(0.1, 0.1), box(0.1, 0.13)]);
    expect(bottom(bands[1])).toBeCloseTo(0.1405, 6);
    expect(bottom(bands[1])).toBeLessThan(0.141);
  });

  it("adds no lower padding when a taller next line already reaches the last selected row", () => {
    const source = page([box(0.1, 0.1), box(0.1, 0.13), box(0.1, 0.138, 0.1, 0.04)]);
    const bands = connectedPdfHighlightRects(source, [box(0.1, 0.1), box(0.1, 0.13)]);
    expect(bottom(bands[1])).toBeCloseTo(0.14, 6);
  });

  it("uses actual full-row ink to align partial lowercase selections, not browser font padding", () => {
    const source = page([box(0.1, 0.098, 0.1, 0.012), box(0.1, 0.128, 0.1, 0.014), box(0.1, 0.16)]);
    const bands = connectedPdfHighlightRects(source, [
      box(0.14, 0.1, 0.03, 0.008),
      box(0.1, 0.132, 0.04, 0.008),
    ]);
    expect(bands[0]?.y).toBeCloseTo(0.098);
    expect(bottom(bands[0])).toBeCloseTo(0.128);
    expect(bands[1]?.y).toBeCloseTo(0.128);
    expect(bottom(bands[1])).toBeCloseTo(0.151);
  });

  it("does not bridge an unselected row, separate paragraphs, or lone lines in different columns", () => {
    const source = page([box(0.1, 0.1), box(0.1, 0.13), box(0.1, 0.16), box(0.6, 0.13)]);
    const skipped = [box(0.1, 0.1), box(0.1, 0.16)];
    expect(connectedPdfHighlightRects(source, skipped)).toEqual(skipped);
    const columns = [box(0.1, 0.1), box(0.6, 0.13)];
    expect(connectedPdfHighlightRects(source, columns)).toEqual(columns);
    const distant = [box(0.1, 0.1), box(0.1, 0.3)];
    expect(connectedPdfHighlightRects(page(distant), distant)).toEqual(distant);
  });

  it("keeps column chains independent even when another column has selected or unselected lines", () => {
    const source = page([
      box(0.1, 0.1),
      box(0.1, 0.13),
      box(0.1, 0.16),
      box(0.6, 0.1),
      box(0.6, 0.12),
      box(0.6, 0.14),
    ]);
    const bands = connectedPdfHighlightRects(source, [
      box(0.1, 0.1),
      box(0.1, 0.13),
      box(0.6, 0.12),
    ]);
    expect(bottom(bands[0])).toBeCloseTo(0.13);
    expect(bottom(bands[1])).toBeCloseTo(0.15);
    expect(bands[2]).toEqual(box(0.6, 0.12));
  });

  it("leaves a single-line selection and same-line fragments at their existing tight height", () => {
    const source = page([box(0.1, 0.1)]);
    const single = [box(0.1, 0.1)];
    expect(connectedPdfHighlightRects(source, single)).toBe(single);
    const fragments = [box(0.1, 0.1, 0.03), box(0.15, 0.1, 0.03)];
    expect(connectedPdfHighlightRects(source, fragments)).toEqual(fragments);
  });

  it("caps final half-gap padding at the page edge", () => {
    const source = page([box(0.1, 0.965), box(0.1, 0.992, 0.1, 0.008)]);
    const bands = connectedPdfHighlightRects(source, [
      box(0.1, 0.965),
      box(0.1, 0.992, 0.1, 0.008),
    ]);
    expect(bottom(bands[1])).toBeCloseTo(1);
    expect(bottom(bands[0])).toBeCloseTo(bands[1]?.y ?? 0);
  });

  it.each([
    { name: "different font size", fontSize: 16, fontKey: 1 },
    { name: "same-size bold font", fontSize: 12, fontKey: 2 },
  ])("keeps a $name heading tight while connecting the body below", ({ fontSize, fontKey }) => {
    const heading = box(0.1, 0.1, 0.16, 0.012);
    const first = box(0.1, 0.14, 0.4);
    const last = box(0.1, 0.162, 0.35);
    const source = typedPage([
      { rect: heading, fontSize, fontKey },
      { rect: first },
      { rect: last },
      { rect: box(0.1, 0.184, 0.4) },
    ]);
    const bands = connectedPdfHighlightRects(source, [heading, first, last]);
    expect(bands[0]).toEqual(heading);
    expect(bottom(bands[1])).toBeCloseTo(last.y);
    expect(bottom(bands[2])).toBeCloseTo(0.178);
    expect(bottom(bands[2])).toBeLessThan(0.184);
  });

  it("connects a multiline heading only within its own style block", () => {
    const firstHeading = box(0.1, 0.1, 0.3, 0.014);
    const lastHeading = box(0.1, 0.128, 0.25, 0.014);
    const first = box(0.1, 0.17, 0.4);
    const last = box(0.1, 0.192, 0.35);
    const source = typedPage([
      { rect: firstHeading, fontSize: 16, fontKey: 2 },
      { rect: lastHeading, fontSize: 16, fontKey: 2 },
      { rect: first },
      { rect: last },
      { rect: box(0.1, 0.214, 0.4) },
    ]);
    const bands = connectedPdfHighlightRects(source, [firstHeading, lastHeading, first, last]);
    expect(bottom(bands[0])).toBeCloseTo(lastHeading.y);
    expect(bottom(bands[1])).toBeCloseTo(0.149);
    expect(bottom(bands[1])).toBeLessThan(first.y);
    expect(bottom(bands[2])).toBeCloseTo(last.y);
    expect(bottom(bands[3])).toBeCloseTo(0.208);
  });

  it("uses neighboring same-font cadence to leave a larger paragraph break unpainted", () => {
    const heading = box(0.1, 0.1, 0.2);
    const first = box(0.1, 0.129, 0.4);
    const last = box(0.1, 0.144, 0.35);
    const source = typedPage([
      { rect: heading },
      { rect: first },
      { rect: last },
      { rect: box(0.1, 0.159, 0.4) },
    ]);
    const bands = connectedPdfHighlightRects(source, [heading, first, last]);
    expect(bands[0]).toEqual(heading);
    expect(bottom(bands[1])).toBeCloseTo(last.y);
    expect(bottom(bands[2])).toBeCloseTo(0.1565);
  });

  it("does not require extra cadence evidence to connect an ordinary two-line selection", () => {
    const first = box(0.1, 0.1, 0.4);
    const last = box(0.1, 0.13, 0.35);
    const source = typedPage([{ rect: first }, { rect: last }]);
    const bands = connectedPdfHighlightRects(source, [first, last]);
    expect(bottom(bands[0])).toBeCloseTo(last.y);
    expect(bottom(bands[1])).toBeCloseTo(0.15);
  });

  it("keeps double-spaced lowercase rows connected using font size rather than ink height", () => {
    const first = box(0.1, 0.1, 0.4, 0.006);
    const last = box(0.1, 0.13, 0.35, 0.004);
    const source = typedPage([
      { rect: first, baseline: 0.11 },
      { rect: last, baseline: 0.14 },
      { rect: box(0.1, 0.16, 0.4, 0.006), baseline: 0.17 },
      { rect: box(0.1, 0.19, 0.4, 0.005), baseline: 0.2 },
    ]);
    const bands = connectedPdfHighlightRects(source, [first, last]);
    expect(bottom(bands[0])).toBeCloseTo(last.y);
    expect(bottom(bands[1])).toBeCloseTo(0.146);
    expect(bottom(bands[1])).toBeLessThan(0.16);
  });

  it("keeps attached script paint local and does not use a script-only selection to bridge rows", () => {
    const first = box(0.1, 0.1, 0.3);
    const last = box(0.1, 0.13, 0.3);
    const source = typedPage([{ rect: first }, { rect: last }, { rect: box(0.1, 0.16, 0.3) }]);
    const script = box(0.21, 0.092, 0.007, 0.005);
    source.glyphs.splice(1, 0, {
      text: "1",
      rect: script,
      fontSize: 8,
      fontKey: 1,
      origin: { x: script.x, y: 0.1 },
    });
    expect(pdfGlyphLines(source)[0]?.localGlyphs).toHaveLength(1);
    const bands = connectedPdfHighlightRects(source, [first, script, last]);
    expect(bands[0]?.y).toBeCloseTo(first.y);
    expect(bottom(bands[0])).toBeCloseTo(last.y);
    expect(bands[1]).toEqual(script);
    expect(bottom(bands[2])).toBeCloseTo(0.15);
    expect(connectedPdfHighlightRects(source, [script, last])).toEqual([script, last]);
  });

  it("caps final padding before an unselected following row's raised script ink", () => {
    const first = box(0.1, 0.1, 0.3);
    const last = box(0.1, 0.13, 0.3);
    const normal = box(0.1, 0.16, 0.3);
    const source = typedPage([{ rect: first }, { rect: last }, { rect: normal }]);
    source.glyphs.splice(5, 0, {
      text: "1",
      rect: box(0.21, 0.145, 0.007, 0.005),
      fontSize: 8,
      fontKey: 1,
      origin: { x: 0.21, y: 0.159 },
    });
    const lines = pdfGlyphLines(source);
    expect(lines[2]?.bounds.y).toBeCloseTo(0.145);
    const bands = connectedPdfHighlightRects(source, [first, last]);
    expect(bottom(bands[1])).toBeCloseTo(0.1425);
    expect(bottom(bands[1])).toBeLessThan(0.145);
  });

  it("preserves a tall local math glyph without raising the whole main text band", () => {
    const first = box(0.1, 0.1, 0.3);
    const last = box(0.1, 0.13, 0.3);
    const source = typedPage([{ rect: first }, { rect: last }, { rect: box(0.1, 0.16, 0.3) }]);
    const math = box(0.21, 0.08, 0.02, 0.04);
    source.glyphs.splice(1, 0, {
      text: "∑",
      rect: math,
      fontSize: 30,
      fontKey: 2,
      origin: { x: math.x, y: 0.11 },
    });
    const line = pdfGlyphLines(source)[0];
    expect(line?.rect.x).toBeCloseTo(first.x);
    expect(line?.rect.y).toBeCloseTo(first.y);
    expect(line?.rect.width).toBeCloseTo(first.width);
    expect(line?.rect.height).toBeCloseTo(first.height);
    expect(line?.bounds.y).toBeCloseTo(math.y);
    expect(line?.localGlyphs).toHaveLength(1);
    const bands = connectedPdfHighlightRects(source, [first, math, last]);
    expect(bands[0]?.y).toBeCloseTo(first.y);
    expect(bottom(bands[0])).toBeCloseTo(last.y);
    expect(bands[1]).toEqual(math);
    expect(bottom(bands[2])).toBeCloseTo(0.15);
  });

  it("does not infer a style boundary from a low-confidence mixed-font body row", () => {
    const first = box(0.1, 0.1, 0.3);
    const last = box(0.1, 0.13, 0.3);
    const source = typedPage([
      { rect: first, fontKey: 2 },
      { rect: last },
      { rect: box(0.1, 0.16, 0.3) },
    ]);
    source.glyphs.splice(1, 0, {
      text: "B",
      rect: box(0.2, 0.1, 0.02),
      fontSize: 12,
      fontKey: 1,
      origin: { x: 0.2, y: 0.11 },
    });
    expect(pdfGlyphLines(source)[0]?.fontConfidence).toBeCloseTo(0.5);
    const bands = connectedPdfHighlightRects(source, [first, last]);
    expect(bottom(bands[0])).toBeCloseTo(last.y);
    expect(bottom(bands[1])).toBeCloseTo(0.15);
  });
});
