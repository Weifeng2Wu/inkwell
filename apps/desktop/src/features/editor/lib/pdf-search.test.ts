import { describe, expect, it, vi } from "vitest";
import {
  buildPdfSearchSource,
  extractPdfSearchText,
  findPdfMatches,
  initialPdfMatch,
  normalizePdfQuery,
  pdfMatchSegments,
  pdfPageSearchText,
  searchPdfPages,
  stepPdfMatch,
} from "./pdf-search";

describe("PDF search text", () => {
  it("lower-cases and collapses whitespace and line ends into single spaces", () => {
    expect(
      pdfPageSearchText([
        { str: "Attention  Is", hasEOL: true },
        { str: "" },
        { str: " All\tYou", hasEOL: false },
        { str: "Need" },
        { type: "beginMarkedContent" },
        null,
      ]),
    ).toBe("attention is all youneed");
    expect(normalizePdfQuery("  Is \n ALL ")).toBe("is all");
    expect(normalizePdfQuery("   ")).toBe("");
  });

  it("finds case-insensitive, non-overlapping matches across runs and lines", () => {
    const text = pdfPageSearchText([
      { str: "Trans", hasEOL: false },
      { str: "former models and", hasEOL: true },
      { str: "TRANSFORMER layers" },
    ]);
    expect(findPdfMatches(text, normalizePdfQuery("transformer"))).toEqual([0, 23]);
    expect(findPdfMatches(text, normalizePdfQuery("and Transformer"))).toEqual([19]);
    expect(findPdfMatches("aaaa", "aa")).toEqual([0, 2]);
    expect(findPdfMatches("aaaa", "a", 3)).toEqual([0, 1, 2]);
    expect(findPdfMatches(text, "")).toEqual([]);
    expect(findPdfMatches(text, "absent")).toEqual([]);
  });

  it("maps a match back to character ranges of the original runs", () => {
    const source = buildPdfSearchSource([
      { text: "Deep  Lear" },
      { text: "ning", eol: true },
      { text: "Works" },
    ]);
    expect(source.text).toBe("deep learning works");
    const [start] = findPdfMatches(source.text, "learning works");
    expect(start).toBe(5);
    expect(pdfMatchSegments(source, start ?? 0, "learning works".length)).toEqual([
      { part: 0, start: 6, end: 10 },
      { part: 1, start: 0, end: 4 },
      { part: 2, start: 0, end: 5 },
    ]);
    // A collapsed run of spaces inside a match keeps the range contiguous.
    expect(pdfMatchSegments(source, 0, "deep l".length)).toEqual([{ part: 0, start: 0, end: 7 }]);
    expect(pdfMatchSegments(source, 99, 3)).toEqual([]);
  });

  it("keeps offsets aligned when lower-casing changes a character's length", () => {
    const source = buildPdfSearchSource([{ text: "İstanbul x" }]);
    const [start] = findPdfMatches(source.text, "x");
    expect(pdfMatchSegments(source, start ?? 0, 1)).toEqual([{ part: 0, start: 9, end: 10 }]);
  });
});

describe("PDF search results", () => {
  const texts = ["alpha beta", "", "beta beta gamma", "beta"];

  it("numbers matches by page and by ordinal within the page", () => {
    expect(searchPdfPages(texts, "beta")).toEqual({
      matches: [
        { page: 1, index: 0 },
        { page: 3, index: 0 },
        { page: 3, index: 1 },
        { page: 4, index: 0 },
      ],
      capped: false,
    });
    expect(searchPdfPages(texts, "delta")).toEqual({ matches: [], capped: false });
    expect(searchPdfPages(texts, "")).toEqual({ matches: [], capped: false });
  });

  it("caps very common queries and says so", () => {
    expect(searchPdfPages(texts, "beta", 4).capped).toBe(false);
    const capped = searchPdfPages(texts, "beta", 2);
    expect(capped.capped).toBe(true);
    expect(capped.matches).toEqual([
      { page: 1, index: 0 },
      { page: 3, index: 0 },
    ]);
  });

  it("steps with wrap-around and starts from the page being read", () => {
    expect(stepPdfMatch(0, 3, 1)).toBe(1);
    expect(stepPdfMatch(2, 3, 1)).toBe(0);
    expect(stepPdfMatch(0, 3, -1)).toBe(2);
    expect(stepPdfMatch(-1, 3, 1)).toBe(0);
    expect(stepPdfMatch(-1, 3, -1)).toBe(2);
    expect(stepPdfMatch(0, 0, 1)).toBe(-1);
    const { matches } = searchPdfPages(texts, "beta");
    expect(initialPdfMatch(matches, 1)).toBe(0);
    expect(initialPdfMatch(matches, 2)).toBe(1);
    expect(initialPdfMatch(matches, 4)).toBe(3);
    expect(initialPdfMatch(matches, 9)).toBe(0);
    expect(initialPdfMatch([], 1)).toBe(-1);
  });
});

describe("PDF text extraction", () => {
  function fixture(numPages: number) {
    const getPage = vi.fn(async (page: number) => ({
      getTextContent: async () => {
        if (page === 2) throw new Error("damaged page");
        return { items: [{ str: `Page ${page}` }] };
      },
    }));
    return { numPages, getPage };
  }

  it("extracts every page in order and tolerates an unreadable page", async () => {
    const pdf = fixture(5);
    expect(await extractPdfSearchText(pdf, () => false, 2)).toEqual([
      "page 1",
      "",
      "page 3",
      "page 4",
      "page 5",
    ]);
    expect(pdf.getPage).toHaveBeenCalledTimes(5);
  });

  it("stops between batches once cancelled", async () => {
    const pdf = fixture(40);
    let cancelled = false;
    pdf.getPage.mockImplementation(async (page: number) => {
      if (page === 4) cancelled = true;
      return { getTextContent: async () => ({ items: [{ str: `Page ${page}` }] }) };
    });
    expect(await extractPdfSearchText(pdf, () => cancelled, 4)).toBeNull();
    expect(pdf.getPage).toHaveBeenCalledTimes(4);
  });
});
