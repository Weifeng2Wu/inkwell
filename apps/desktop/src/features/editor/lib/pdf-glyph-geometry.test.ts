import { describe, expect, it } from "vitest";
import {
  mergeTightGlyphs,
  type PdfPageGlyphs,
  pdfGlyphLineFragments,
  pdfRectUnion,
  tightPdfTextSelection,
  tightSavedPdfQuote,
} from "./pdf-glyph-geometry";
import type { PdfAnnotationRect } from "./pdf-notes";

const box = (x: number, y = 0.1, width = 0.009, height = 0.01): PdfAnnotationRect => ({
  x,
  y,
  width,
  height,
});
function run(text: string, x = 0.1, y = 0.1) {
  return Array.from(text, (text, index) => ({
    text,
    rect: /^\s$/u.test(text) ? undefined : box(x + index * 0.012, y),
  }));
}
const page = (glyphs: PdfPageGlyphs["glyphs"]): PdfPageGlyphs => ({
  width: 600,
  height: 800,
  glyphs,
});

describe("tight PDF glyph selection", () => {
  it("maps partial source offsets and excludes right padding and font line height", () => {
    const source = page(run("before target   after"));
    const result = tightPdfTextSelection(source, [
      { text: "before target   after", start: 7, end: 16, bounds: box(0.09, 0.09, 0.4, 0.04) },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.x).toBeCloseTo(0.184);
    expect(result[0]?.width).toBeCloseTo(0.069);
    expect(result[0]?.height).toBeCloseTo(0.01);
  });

  it.each([
    "。",
    "，",
    "、",
    "．",
    ".",
    ",",
    ";",
    "-",
    "‐",
    "‑",
    "—",
  ])("joins selected small %s punctuation to its text, without increasing line-end padding", (punctuation) => {
    const text = `研究${punctuation}`;
    const glyphs = [...run("研究"), { text: punctuation, rect: box(0.124, 0.107, 0.002, 0.002) }];
    const result = tightPdfTextSelection(page(glyphs), [
      { text, start: 0, end: 3, bounds: box(0.09, 0.09, 0.06, 0.04) },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.y).toBeCloseTo(0.1);
    expect(result[0]?.height).toBeCloseTo(0.01);
    expect((result[0]?.x ?? 0) + (result[0]?.width ?? 0)).toBeCloseTo(0.126);
    expect(glyphs[2]?.rect?.height).toBe(0.002); // Never modify cached PDFium glyphs.
  });

  it("retains opening/closing quotes and comma descenders within the actual selected ink", () => {
    const text = "“研究，”";
    const glyphs = [
      { text: "“", rect: box(0.094, 0.099, 0.004, 0.003) },
      ...run("研究"),
      { text: "，", rect: box(0.124, 0.107, 0.002, 0.005) },
      { text: "”", rect: box(0.13, 0.099, 0.004, 0.003) },
    ];
    const result = tightPdfTextSelection(page(glyphs), [
      { text, start: 0, end: text.length, bounds: box(0.09, 0.09, 0.1, 0.04) },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.y).toBeCloseTo(0.099);
    expect(result[0]?.height).toBeCloseTo(0.013);
    expect(result[0]?.width).toBeCloseTo(0.04);
  });

  it("does not add unselected punctuation or expand a punctuation-only selection to neighboring text", () => {
    const text = "研究。";
    const dot = box(0.124, 0.107, 0.002, 0.002);
    const source = page([...run("研究"), { text: "。", rect: dot }]);
    const bounds = box(0.09, 0.09, 0.06, 0.04);
    const words = tightPdfTextSelection(source, [{ text, start: 0, end: 2, bounds }]);
    expect((words[0]?.x ?? 0) + (words[0]?.width ?? 0)).toBeCloseTo(0.121);
    expect(tightPdfTextSelection(source, [{ text, start: 2, end: 3, bounds }])).toEqual([dot]);
  });

  it("does not use punctuation to bridge lines, columns or non-punctuation superscripts", () => {
    const text = "A.2";
    const bounds = box(0.09, 0.07, 0.7, 0.1);
    const separateLine = page([
      { text: "A", rect: box(0.1) },
      { text: ".", rect: box(0.112, 0.13, 0.002, 0.002) },
      { text: "2", rect: box(0.12, 0.08, 0.003, 0.003) },
    ]);
    expect(tightPdfTextSelection(separateLine, [{ text, start: 0, end: 3, bounds }])).toHaveLength(
      3,
    );
    const separateColumn = page([
      { text: "A", rect: box(0.1) },
      { text: ".", rect: box(0.6, 0.107, 0.002, 0.002) },
      { text: "2", rect: box(0.12, 0.107, 0.003, 0.002) },
    ]);
    expect(
      tightPdfTextSelection(separateColumn, [{ text, start: 0, end: 3, bounds }]),
    ).toHaveLength(3);
  });

  it("keeps a selected line-end hyphen separate from a tightly spaced continuation", () => {
    const dash = box(0.112, 0.109, 0.006, 0.002);
    const continuation = box(0.1, 0.112);
    const hyphen = { text: "-", rect: dash, lineBreakAfter: true };
    const source = page([{ text: "a", rect: box(0.1) }, hyphen, { text: "b", rect: continuation }]);
    const bounds = box(0.09, 0.09, 0.05, 0.05);
    const result = tightPdfTextSelection(source, [
      { text: "a-", start: 1, end: 2, bounds },
      { text: "b", start: 0, end: 1, bounds },
    ]);
    expect(result).toEqual([dash, continuation]);
    expect(pdfGlyphLineFragments(source)).toHaveLength(2);
    expect(tightSavedPdfQuote(source, "-b", [dash, continuation])).toEqual([dash, continuation]);
  });

  it.each([
    "\n",
    "\r\n",
    "\u2028",
    "\u2029",
  ])("retains explicit %j line boundaries while merging selected punctuation", (newline) => {
    const mark = box(0.112, 0.109, 0.006, 0.002);
    const continuation = box(0.1, 0.112);
    const source = page([
      { text: ".", rect: mark },
      { text: newline },
      { text: "b", rect: continuation },
    ]);
    const text = `.${newline}b`;
    const result = tightPdfTextSelection(source, [
      { text, start: 0, end: text.length, bounds: box(0.09, 0.09, 0.05, 0.05) },
    ]);
    expect(result).toEqual([mark, continuation]);
    expect(pdfGlyphLineFragments(source)).toEqual([mark, continuation]);
  });

  it("retains a line boundary carried by an unselected wrapped hyphen", () => {
    const dot = box(0.112, 0.109, 0.002, 0.002);
    const continuation = box(0.1, 0.112);
    const hyphen = { text: "-", rect: box(0.117, 0.105, 0.006, 0.002), lineBreakAfter: true };
    const source = page([
      { text: "a", rect: box(0.1) },
      { text: ".", rect: dot },
      hyphen,
      { text: "b", rect: continuation },
    ]);
    const bounds = box(0.09, 0.09, 0.05, 0.05);
    expect(
      tightPdfTextSelection(source, [
        { text: "a.-", start: 1, end: 2, bounds },
        { text: "b", start: 0, end: 1, bounds },
      ]),
    ).toEqual([dot, continuation]);
  });

  it("treats a visible soft hyphen as line punctuation without selecting it when PDF.js omits it", () => {
    const dash = box(0.124, 0.104, 0.006, 0.002);
    const source = page([
      ...run("hy"),
      { text: "\u00ad", rect: dash },
      { text: "\r\n" },
      ...run("phenation", 0.1, 0.13),
    ]);
    const lines = pdfGlyphLineFragments(source);
    expect(lines).toHaveLength(2);
    expect((lines[0]?.x ?? 0) + (lines[0]?.width ?? 0)).toBeCloseTo(0.13);
    const bounds = box(0.09, 0.09, 0.2, 0.08);
    const selected = tightPdfTextSelection(source, [
      { text: "hy", start: 0, end: 2, bounds },
      { text: "phenation", start: 0, end: 9, bounds },
    ]);
    expect(selected).toHaveLength(2);
    expect((selected[0]?.x ?? 0) + (selected[0]?.width ?? 0)).toBeCloseTo(0.121);
  });

  it("realigns previously fragmented punctuation using the same sentence geometry", () => {
    const text = "研究。";
    const glyphs = [...run("研究"), { text: "。", rect: box(0.124, 0.107, 0.002, 0.002) }];
    const old = [box(0.1, 0.1, 0.021, 0.01), box(0.124, 0.107, 0.002, 0.002)];
    expect(tightSavedPdfQuote(page(glyphs), text, old)).toHaveLength(1);
    expect(old).toHaveLength(2);
  });

  it("disambiguates identical runs by location and refuses a match in another column", () => {
    const source = page([...run("Finding", 0.1), ...run("Finding", 0.6)]);
    const selected = tightPdfTextSelection(source, [
      { text: "Finding", start: 0, end: 7, bounds: box(0.6, 0.09, 0.1, 0.04) },
    ]);
    expect(selected[0]?.x).toBeCloseTo(0.6);
    expect(() =>
      tightPdfTextSelection(source, [
        { text: "Finding", start: 0, end: 7, bounds: box(0.3, 0.5, 0.1, 0.04) },
      ]),
    ).toThrow("PDF_GEOMETRY_FAILED");
  });

  it("handles ligatures, decomposed accents, fullwidth CJK and UTF-16 surrogate offsets", () => {
    const source = page([
      { text: "ﬁ", rect: box(0.1) },
      { text: "é", rect: box(0.112) },
      { text: "Ａ", rect: box(0.124) },
      { text: "研", rect: box(0.136) },
      { text: "😀", rect: box(0.148) },
    ]);
    const text = "fie\u0301A研😀";
    const selected = tightPdfTextSelection(source, [
      { text, start: 2, end: 4, bounds: box(0.09, 0.09, 0.15, 0.04) },
    ]);
    expect(selected[0]?.x).toBeCloseTo(0.112);
    expect(selected[0]?.width).toBeCloseTo(0.009);
    const emoji = tightPdfTextSelection(source, [
      { text, start: 6, end: 8, bounds: box(0.09, 0.09, 0.15, 0.04) },
    ]);
    expect(emoji[0]?.x).toBeCloseTo(0.148);
  });

  it("never joins separate lines or a column gutter into one tall rectangle", () => {
    expect(mergeTightGlyphs([box(0.1), box(0.112), box(0.6), box(0.1, 0.13)], 1.3)).toHaveLength(3);
    expect(
      mergeTightGlyphs([box(0.1), box(0.12, 0.09, 0.008, 0.005), box(0.14, 0.08, 0.01, 0.06)], 1.3),
    ).toHaveLength(3);
  });

  it("keeps rotated right-to-left and vertical selections continuous without bridging lines", () => {
    expect(mergeTightGlyphs([box(0.124), box(0.112), box(0.1)], 1.3)).toHaveLength(1);
    const vertical = [
      box(0.1, 0.1, 0.01, 0.009),
      box(0.1, 0.112, 0.01, 0.009),
      box(0.13, 0.1, 0.01, 0.009),
    ];
    expect(mergeTightGlyphs(vertical, 1.3, true)).toHaveLength(2);
  });

  it("realigns resolvable old quotes without mutating their anchors and preserves unresolved quotes", () => {
    const previous = [box(0.09, 0.09, 0.3, 0.04)];
    const original = structuredClone(previous);
    const source = page(run("Finding   "));
    const tight = tightSavedPdfQuote(source, "Finding", previous);
    expect(tight[0]?.height).toBeCloseTo(0.01);
    expect(previous).toEqual(original);
    expect(tightSavedPdfQuote(source, "Not here", previous)).toBe(previous);
    expect(tightSavedPdfQuote(source, "Finding", [box(0.6, 0.6)])).toEqual([box(0.6, 0.6)]);
    const ambiguous = [box(0.095, 0.09, 0.119, 0.04)];
    expect(tightSavedPdfQuote(page([...run("A", 0.1), ...run("A", 0.2)]), "A", ambiguous)).toBe(
      ambiguous,
    );
  });

  it("unions large geometry without spreading an unbounded array into Math.min/max", () => {
    expect(pdfRectUnion(Array.from({ length: 150000 }, () => box(0.1)))?.width).toBeCloseTo(0.009);
  });
});
