import { describe, expect, it } from "vitest";
import { placeTourCard } from "./tour-placement";

describe("workspace tour placement", () => {
  it("places a toolbar explanation below the highlighted button without overflowing the right edge", () => {
    const result = placeTourCard({ left: 1240, top: 8, width: 24, height: 32 }, 1280, 800, 280);
    expect(result).toEqual({ left: 864, top: 56, width: 400 });
  });
  it("moves above a target near the bottom of the window", () => {
    const result = placeTourCard({ left: 500, top: 700, width: 100, height: 32 }, 1280, 800, 280);
    expect(result.top).toBe(404);
  });
  it("keeps cards inside narrow windows even when the content is taller than the viewport", () => {
    const result = placeTourCard(null, 320, 300, 600);
    expect(result).toEqual({ left: 16, top: 16, width: 288 });
  });
});
