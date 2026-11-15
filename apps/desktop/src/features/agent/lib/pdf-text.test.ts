import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractPdfText } from "./pdf-text";

const pdf = vi.hoisted(() => ({
  pages: [] as { str?: string; hasEOL?: boolean }[][],
  getDocument: vi.fn(),
  destroy: vi.fn(),
  read: vi.fn(),
}));
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: { workerSrc: "" }, getDocument: pdf.getDocument },
}));

beforeEach(() => {
  pdf.destroy.mockReset();
  pdf.read.mockReset();
  pdf.getDocument.mockReset().mockImplementation(() => ({
    destroy: pdf.destroy,
    promise: Promise.resolve({
      numPages: pdf.pages.length,
      getPage: async (number: number) => {
        pdf.read(number);
        return { cleanup: vi.fn(), getTextContent: async () => ({ items: pdf.pages[number - 1] }) };
      },
    }),
  }));
});

describe("local PDF text extraction", () => {
  it("joins text items per page under 1-based page markers", async () => {
    pdf.pages = [
      [{ str: "Deep ", hasEOL: false }, { str: "learning", hasEOL: true }, { str: "works." }],
      [{}, { str: "Second page" }],
    ];
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const result = await extractPdfText(bytes, 1000);
    expect(result).toEqual({
      text: "[page 1]\nDeep learning\nworks.\n\n[page 2]\nSecond page",
      pages: 2,
      characters: "Deeplearningworks.Secondpage".length,
      truncated: false,
    });
    expect(pdf.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ data: bytes, isEvalSupported: false, cMapUrl: "/pdfjs/cmaps/" }),
    );
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it("reports scans as having no characters", async () => {
    pdf.pages = [[], [{ str: "  " }]];
    const result = await extractPdfText(new Uint8Array(), 1000);
    expect(result.characters).toBe(0);
    expect(result.text).toBe("[page 1]\n\n\n[page 2]\n");
  });

  it("stops reading once the limit is passed and says so", async () => {
    pdf.pages = Array.from({ length: 5 }, () => [{ str: "x".repeat(60) }]);
    const result = await extractPdfText(new Uint8Array(), 100);
    expect(result.truncated).toBe(true);
    expect(result.pages).toBe(5);
    expect(pdf.read).toHaveBeenCalledTimes(2);
    expect(result.text).not.toContain("[page 3]");
  });

  it("releases the document when cancelled or unreadable", async () => {
    pdf.pages = [[{ str: "text" }]];
    const abort = new AbortController();
    abort.abort();
    await expect(extractPdfText(new Uint8Array(), 100, abort.signal)).rejects.toThrow();
    expect(pdf.read).not.toHaveBeenCalled();
    expect(pdf.destroy).toHaveBeenCalledOnce();
    pdf.getDocument.mockImplementation(() => ({
      destroy: pdf.destroy,
      promise: Promise.reject(new Error("Invalid PDF structure")),
    }));
    await expect(extractPdfText(new Uint8Array(), 100)).rejects.toThrow("Invalid PDF");
    expect(pdf.destroy).toHaveBeenCalledTimes(2);
  });
});
