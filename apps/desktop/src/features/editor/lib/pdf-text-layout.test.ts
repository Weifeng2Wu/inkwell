import { describe, expect, it } from "vitest";
import {
  type PdfGlyph,
  type PdfPageGlyphs,
  pdfGlyphLines,
  pdfRectUnion,
  tightPdfTextSelection,
  tightSavedPdfQuote,
} from "./pdf-glyph-geometry";
import type { PdfAnnotationRect } from "./pdf-notes";
import { pdfTextLayout } from "./pdf-text-layout";

function glyph(
  text: string,
  x: number,
  y = 0.1,
  baseline = 0.115,
  fontSize = 16,
  width = 0.009,
  height = 0.01,
  fontKey = 1,
): PdfGlyph {
  return { text, rect: { x, y, width, height }, origin: { x, y: baseline }, fontSize, fontKey };
}

const page = (glyphs: PdfGlyph[]): PdfPageGlyphs => ({ width: 600, height: 800, glyphs });
const generatedBreak: PdfGlyph = { text: "\r\n", generated: true };

function scriptPage(reordered = false) {
  const before = glyph("A", 0.1);
  const script = glyph("1", 0.112, 0.085, 0.10625, 8, 0.004, 0.005);
  const after = [
    glyph("(", 0.126, 0.1, 0.115, 16, 0.004, 0.014),
    glyph("B", 0.134),
    glyph(")", 0.148, 0.1, 0.115, 16, 0.004, 0.014),
  ];
  const first = reordered
    ? [before, ...after, generatedBreak, script]
    : [before, script, generatedBreak, ...after];
  return page([...first, generatedBreak, glyph("Z", 0.1, 0.145, 0.16)]);
}

function rotated(source: PdfPageGlyphs, rotation: number): PdfPageGlyphs {
  const point = ({ x, y }: { x: number; y: number }) =>
    rotation === 90
      ? { x: 1 - y, y: x }
      : rotation === 180
        ? { x: 1 - x, y: 1 - y }
        : rotation === 270
          ? { x: y, y: 1 - x }
          : { x, y };
  const rect = (box: PdfAnnotationRect): PdfAnnotationRect => {
    const first = point(box);
    const second = point({ x: box.x + box.width, y: box.y + box.height });
    return {
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      width: Math.abs(first.x - second.x),
      height: Math.abs(first.y - second.y),
    };
  };
  const vertical = rotation % 180 !== 0;
  return {
    width: vertical ? source.height : source.width,
    height: vertical ? source.width : source.height,
    vertical,
    reverseLines: rotation === 90 || rotation === 180,
    glyphs: source.glyphs.map((item) => ({
      ...item,
      rect: item.rect ? rect(item.rect) : undefined,
      origin: item.origin ? point(item.origin) : undefined,
    })),
  };
}

function hint(source: PdfPageGlyphs) {
  const bounds = pdfRectUnion(source.glyphs.flatMap((item) => (item.rect ? [item.rect] : [])));
  if (!bounds) throw new Error("Missing fixture bounds");
  return bounds;
}

function expectRect(
  actual: PdfAnnotationRect | undefined,
  expected: PdfAnnotationRect | undefined,
) {
  if (!actual || !expected) throw new Error("Missing expected rectangle");
  for (const key of ["x", "y", "width", "height"] as const)
    expect(actual[key]).toBeCloseTo(expected[key], 9);
}

describe("physical PDF text rows", () => {
  it("ignores only virtual inline breaks and keeps the script's height out of the main row", () => {
    const source = scriptPage();
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.localGlyphs).toEqual([1]);
    expect(lines[0]?.rect.y).toBeCloseTo(0.1);
    expect(lines[0]?.rect.height).toBeCloseTo(0.014);
    expect(lines[0]?.bounds.y).toBeCloseTo(0.085);
    const text = "A1(B)";
    const tight = tightPdfTextSelection(source, [
      { text, start: 0, end: text.length, bounds: hint(source) },
    ]);
    expect(tight).toHaveLength(2);
    expectRect(tight[0], lines[0]?.rect);
    expectRect(tight[1], source.glyphs[1]?.rect);
  });

  it.each([
    0, 90, 180, 270,
  ])("matches a reordered script through physical origins at rotation %i", (rotation) => {
    const source = rotated(scriptPage(true), rotation);
    const text = "A1(B)";
    const tight = tightPdfTextSelection(source, [
      { text, start: 0, end: text.length, bounds: hint(source) },
    ]);
    expect(tight).toHaveLength(2);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(2);
    expectRect(tight[0], lines[0]?.rect);
    expectRect(tight[1], source.glyphs.find((item) => item.text === "1")?.rect);
  });

  it.each([
    "authored",
    "hyphen",
  ])("never ignores a hard %s boundary even when origins share a baseline", (kind) => {
    const first = glyph(kind === "hyphen" ? "-" : "A", 0.1);
    if (kind === "hyphen") first.lineBreakAfter = true;
    const source = page([
      first,
      kind === "authored" ? { text: "\r\n" } : generatedBreak,
      glyph("B", 0.112),
    ]);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(2);
    const text = `${first.text}B`;
    expect(
      tightPdfTextSelection(source, [{ text, start: 0, end: text.length, bounds: hint(source) }]),
    ).toHaveLength(2);
  });

  it("does not bridge body ranges through an unselected inline script", () => {
    const source = scriptPage();
    const bounds = hint(source);
    const tight = tightPdfTextSelection(source, [
      { text: "A", start: 0, end: 1, bounds },
      { text: "(B)", start: 0, end: 3, bounds },
    ]);
    expect(tight).toHaveLength(2);
    expectRect(tight[0], source.glyphs[0]?.rect);
    expect(tight.every((rect) => rect.y >= 0.1)).toBe(true);
  });

  it("rejoins main text segments only across a real wide multi-digit script", () => {
    const source = page([
      glyph("A", 0.1),
      glyph("1", 0.112, 0.085, 0.10625, 8, 0.006, 0.005),
      glyph("2", 0.122, 0.085, 0.10625, 8, 0.006, 0.005),
      glyph("3", 0.132, 0.085, 0.10625, 8, 0.006, 0.005),
      generatedBreak,
      glyph("(", 0.146, 0.1, 0.115, 16, 0.004, 0.014),
      glyph("B", 0.154),
      glyph(")", 0.168, 0.1, 0.115, 16, 0.004, 0.014),
    ]);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(1);
    expect(new Set(lines[0]?.localGlyphs)).toEqual(new Set([1, 2, 3]));
    const text = "A123(B)";
    const tight = tightPdfTextSelection(source, [
      { text, start: 0, end: text.length, bounds: hint(source) },
    ]);
    expect(tight).toHaveLength(2);
    expectRect(tight[0], lines[0]?.rect);
  });

  it("does not attach a short small-font following row as a subscript", () => {
    const source = page([
      glyph("A", 0.1),
      generatedBreak,
      glyph("1", 0.1, 0.124, 0.13, 8, 0.006, 0.005),
    ]);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.localGlyphs.length === 0)).toBe(true);
  });

  it("does not attach a long neighboring small-font passage as a local annotation", () => {
    const note = Array.from("footnote with ordinary words", (text, index) =>
      glyph(text, 0.1 + index * 0.009, 0.09, 0.108, 8, 0.007, 0.006),
    );
    const source = page([glyph("A", 0.1), generatedBreak, ...note]);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.localGlyphs.length === 0)).toBe(true);
  });

  it("keeps same-baseline columns separate and assigns scripts only to their own column", () => {
    const source = page([
      glyph("A", 0.1),
      glyph("B", 0.6),
      glyph("1", 0.615, 0.085, 0.10625, 8, 0.004, 0.005),
      glyph("C", 0.628),
    ]);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.localGlyphs).toEqual([]);
    expect(lines[1]?.localGlyphs).toEqual([2]);
    expect(lines[0]?.rect.width).toBeLessThan(0.02);
    expect(lines[1]?.rect.x).toBeCloseTo(0.6);
  });

  it("keeps larger same-baseline math local rather than selecting its font as the paragraph size", () => {
    const source = page([
      glyph("A", 0.1),
      glyph("Σ", 0.112, 0.083, 0.115, 22, 0.025, 0.031, 2),
      glyph("(", 0.145, 0.1, 0.115, 16, 0.004, 0.014),
      glyph("B", 0.152),
      glyph(")", 0.167, 0.1, 0.115, 16, 0.004, 0.014),
    ]);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fontSize).toBe(16);
    expect(lines[0]?.fontKey).toBe(1);
    expect(lines[0]?.localGlyphs).toEqual([1]);
    expect(lines[0]?.rect.y).toBeCloseTo(0.1);
    expect(lines[0]?.rect.height).toBeCloseTo(0.014);
  });

  it.each([
    false,
    true,
  ])("preserves ambiguous old anchors with reordered source %s", (reordered) => {
    const source = scriptPage(reordered);
    const duplicate = source.glyphs.map((item) => ({
      ...item,
      rect: item.rect ? { ...item.rect, x: item.rect.x + 0.25 } : undefined,
      origin: item.origin ? { ...item.origin, x: item.origin.x + 0.25 } : undefined,
    }));
    const combined = page([...source.glyphs, ...duplicate]);
    const bounds = pdfRectUnion(
      combined.glyphs.flatMap((item) => (item.rect && item.text !== "Z" ? [item.rect] : [])),
    );
    if (!bounds) throw new Error("Missing ambiguous bounds");
    const previous = [{ ...bounds, y: bounds.y - 0.005, height: bounds.height + 0.01 }];
    const original = structuredClone(previous);
    expect(tightSavedPdfQuote(combined, "A1(B)", previous)).toBe(previous);
    expect(previous).toEqual(original);
  });

  it.each([
    "X",
    "Ｘ",
    "ﬁ",
    "\u0301",
  ])("never drops a non-ink semantic character %j when retrying visual order", (text) => {
    const source = page([
      glyph("A", 0.1),
      { text, origin: { x: 0.112, y: 0.115 }, fontSize: 16, fontKey: 1 },
      glyph("B", 0.124),
    ]);
    const previous = [{ ...hint(source), y: 0.095, height: 0.025 }];
    const original = structuredClone(previous);
    expect(tightSavedPdfQuote(source, "AB", previous)).toBe(previous);
    expect(previous).toEqual(original);
    expect(() =>
      tightPdfTextSelection(source, [{ text: "AB", start: 0, end: 2, bounds: hint(source) }]),
    ).toThrow("PDF_GEOMETRY_FAILED");
  });

  it("can retry visual order across only normalized-away non-ink whitespace", () => {
    const source = page([
      glyph("B", 0.112),
      { text: " \t\u200b\u2060\u00ad", generated: true },
      glyph("A", 0.1),
    ]);
    const tight = tightPdfTextSelection(source, [
      { text: "AB", start: 0, end: 2, bounds: hint(source) },
    ]);
    expect(tight).toHaveLength(1);
    expectRect(tight[0], hint(source));
  });

  it.each([
    0.01, 0.03, 0.07, 0.11, 0.29,
  ])("keeps the real tiny font size %s and finite main-row geometry", (fontSize) => {
    const source = page([
      glyph("A", 0.1, 0.1, 0.1 + (fontSize * 0.8) / 800, fontSize, fontSize / 600, fontSize / 800),
    ]);
    const lines = pdfGlyphLines(source);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fontSize).toBeCloseTo(fontSize, 12);
    expect(lines[0]?.localGlyphs).toEqual([]);
    expectRect(lines[0]?.rect, source.glyphs[0]?.rect);
    expect(lines.every((line) => Object.values(line.rect).every(Number.isFinite))).toBe(true);
    const tight = tightPdfTextSelection(source, [
      { text: "A", start: 0, end: 1, bounds: hint(source) },
    ]);
    expectRect(tight[0], source.glyphs[0]?.rect);
  });

  it("caches physical layout without changing the extracted glyphs", () => {
    const source = scriptPage();
    const original = structuredClone(source);
    const first = pdfTextLayout(source);
    expect(first).not.toBeNull();
    expect(pdfTextLayout(source)).toBe(first);
    expect(source).toEqual(original);
  });

  it("fails safely to legacy tight geometry when metadata is unavailable", () => {
    const source = page([{ text: "A", rect: { x: 0.1, y: 0.1, width: 0.009, height: 0.01 } }]);
    expect(pdfTextLayout(source)).toBeNull();
    expectRect(pdfGlyphLines(source)[0]?.rect, source.glyphs[0]?.rect);
  });
});
