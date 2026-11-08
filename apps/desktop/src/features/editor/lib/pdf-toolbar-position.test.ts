import { describe, expect, it } from "vitest";
import { pdfToolbarPosition } from "./pdf-toolbar-position";

const panel = { width: 600, height: 800 };
const toolbar = { width: 204, height: 42 };
const anchor = { left: 200, right: 400, top: 200, bottom: 220 };

describe("compact PDF toolbar placement", () => {
  it("centers above the selection with a small gap", () => {
    expect(pdfToolbarPosition(anchor, panel, toolbar, 56)).toEqual({ left: 198, top: 150 });
  });
  it("flips below when the header leaves no room above", () => {
    expect(pdfToolbarPosition({ ...anchor, top: 60, bottom: 80 }, panel, toolbar, 56)).toEqual({
      left: 198,
      top: 88,
    });
  });
  it("stays above near the bottom instead of leaving the PDF pane", () => {
    expect(pdfToolbarPosition({ ...anchor, top: 750, bottom: 780 }, panel, toolbar, 56)).toEqual({
      left: 198,
      top: 700,
    });
  });
  it("keeps left and right edge selections inside the pane", () => {
    expect(pdfToolbarPosition({ ...anchor, left: 0, right: 20 }, panel, toolbar, 56).left).toBe(8);
    expect(pdfToolbarPosition({ ...anchor, left: 580, right: 600 }, panel, toolbar, 56).left).toBe(
      388,
    );
  });
  it("uses the measured control size and toolbar header height", () => {
    expect(pdfToolbarPosition(anchor, panel, { width: 180, height: 48 }, 180)).toEqual({
      left: 210,
      top: 228,
    });
  });
  it("opens the palette below its trigger and flips it above at the bottom", () => {
    const palette = { width: 166, height: 46 };
    expect(pdfToolbarPosition(anchor, panel, palette, 56, true)).toEqual({ left: 217, top: 228 });
    expect(
      pdfToolbarPosition({ ...anchor, top: 740, bottom: 782 }, panel, palette, 56, true),
    ).toEqual({ left: 217, top: 686 });
  });
  it("keeps the header margin even in a very narrow or short pane", () => {
    expect(pdfToolbarPosition(anchor, { width: 150, height: 100 }, toolbar, 56)).toEqual({
      left: 8,
      top: 56,
    });
  });
});
