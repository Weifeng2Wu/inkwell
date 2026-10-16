import { describe, expect, it } from "vitest";
import { formatStars } from "./format-stars";

describe("formatStars", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [7523, "7.5k"],
    [1250000, "1.3m"],
  ])("formats %s as %s", (count, result) => {
    expect(formatStars(count)).toBe(result);
  });
});
