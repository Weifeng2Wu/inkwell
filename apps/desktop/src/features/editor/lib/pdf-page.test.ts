import { describe, expect, it, vi } from "vitest";
import {
  clampPdfPage,
  createPdfPageStore,
  parsePdfPageInput,
  pdfExcerpt,
  pdfVisiblePage,
} from "./pdf-page";

describe("PDF page helpers", () => {
  it("notifies subscribers only when the page changes", () => {
    const store = createPdfPageStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(1);
    expect(listener).not.toHaveBeenCalled();
    store.set(3);
    expect(store.get()).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set(4);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("accepts only whole page numbers of the document", () => {
    expect(parsePdfPageInput(" 12 ", 20)).toBe(12);
    expect(parsePdfPageInput("1", 1)).toBe(1);
    for (const text of ["0", "21", "-3", "2.5", "1e1", "two", "", " "])
      expect(parsePdfPageInput(text, 20)).toBeNull();
    expect(parsePdfPageInput("1", 0)).toBeNull();
  });

  it("clamps pages into the document", () => {
    expect(clampPdfPage(0, 5)).toBe(1);
    expect(clampPdfPage(9, 5)).toBe(5);
    expect(clampPdfPage(2.9, 5)).toBe(2);
    expect(clampPdfPage(Number.NaN, 5)).toBe(1);
    expect(clampPdfPage(3, 0)).toBe(1);
  });

  it("picks the page covering most of the viewport", () => {
    const pages = [0, 1, 2, 3].map((index) => ({ top: index * 1000, bottom: index * 1000 + 980 }));
    expect(pdfVisiblePage(pages, 0, 600)).toBe(1);
    expect(pdfVisiblePage(pages, 600, 1200)).toBe(1);
    expect(pdfVisiblePage(pages, 800, 1400)).toBe(2);
    expect(pdfVisiblePage(pages, 3500, 4100)).toBe(4);
    // Exactly between two pages: the earlier one wins.
    expect(pdfVisiblePage(pages, 690, 1290)).toBe(1);
    // In the gap between pages, or past the end.
    expect(pdfVisiblePage(pages, 985, 995)).toBe(2);
    expect(pdfVisiblePage(pages, 9000, 9600)).toBe(4);
    expect(pdfVisiblePage([], 0, 600)).toBe(1);
  });

  it("builds an excerpt from one or several selected pages", () => {
    expect(pdfExcerpt([{ quote: " One passage ", page: 4 }])).toEqual({
      text: "One passage",
      page: 4,
    });
    expect(
      pdfExcerpt([
        { quote: "ends here", page: 4 },
        { quote: "  ", page: 5 },
        { quote: "and continues", page: 6 },
      ]),
    ).toEqual({ text: "ends here\nand continues", page: 4 });
    expect(pdfExcerpt([])).toBeNull();
    expect(pdfExcerpt([{ quote: "  ", page: 1 }])).toBeNull();
  });
});
