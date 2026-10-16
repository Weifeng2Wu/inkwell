import { describe, expect, it } from "vitest";
import { placeSynctexPdfOnRight, type SplitPaneState } from "./synctex-layout";

const pdf = { path: "paper.pdf", url: "asset://paper.pdf", refreshKey: 3 };

describe("SyncTeX split layout", () => {
  it("creates a right PDF pane when jumping from a single PDF viewer", () => {
    expect(placeSynctexPdfOnRight(null, pdf, "paper.tex")).toEqual({
      side: "right",
      openTabs: ["paper.pdf"],
      selectedFile: "paper.pdf",
      content: "",
      isLoading: false,
      error: null,
      binaryPreviewUrl: "asset://paper.pdf",
      pdfRefreshKey: 3,
    });
  });

  it("moves an existing left PDF pane to the right without duplicating its tab", () => {
    const current: SplitPaneState = {
      ...placeSynctexPdfOnRight(null, pdf, "paper.tex"),
      side: "left",
    };
    const next = placeSynctexPdfOnRight(current, pdf, "paper.tex");
    expect(next.side).toBe("right");
    expect(next.openTabs).toEqual(["paper.pdf"]);
    expect(next.pdfRefreshKey).toBe(3);
    expect(current.side).toBe("left");
  });

  it("transfers the source out of the PDF pane while preserving other tabs", () => {
    const current: SplitPaneState = {
      ...placeSynctexPdfOnRight(null, pdf, "paper.tex"),
      openTabs: ["paper.tex", "notes.tex", "paper.pdf"],
      selectedFile: "paper.tex",
      content: "source text",
    };
    const next = placeSynctexPdfOnRight(current, pdf, "paper.tex");
    expect(next.openTabs).toEqual(["notes.tex", "paper.pdf"]);
    expect(next.selectedFile).toBe("paper.pdf");
    expect(next.content).toBe("");
  });

  it("keeps repeated jumps in the same two-pane layout", () => {
    const first = placeSynctexPdfOnRight(null, pdf, "paper.tex");
    expect(placeSynctexPdfOnRight(first, pdf, "sections/introduction.tex")).toEqual(first);
  });
});
