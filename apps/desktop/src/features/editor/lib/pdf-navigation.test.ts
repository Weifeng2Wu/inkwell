import { describe, expect, it } from "vitest";
import { pdfNavigationPoint } from "./pdf-navigation";

const click = {
  clientX: 140,
  clientY: 280,
  rect: { left: 100, top: 200, width: 600, height: 800 },
  scale: 2,
  pointerStartedOnPage: true,
  keyboard: false,
};

describe("PDF source navigation", () => {
  it("rejects click-through from controls outside the PDF", () => {
    expect(pdfNavigationPoint({ ...click, pointerStartedOnPage: false })).toBeNull();
  });
  it("uses top-left PDF coordinates required by SyncTeX", () => {
    expect(pdfNavigationPoint(click)).toEqual({ x: 20, y: 40 });
  });
  it("ignores clicks outside the page", () => {
    expect(pdfNavigationPoint({ ...click, clientX: 10 })).toBeNull();
  });
  it("retains keyboard navigation at the page centre", () => {
    expect(pdfNavigationPoint({ ...click, pointerStartedOnPage: false, keyboard: true })).toEqual({
      x: 150,
      y: 200,
    });
  });
});
