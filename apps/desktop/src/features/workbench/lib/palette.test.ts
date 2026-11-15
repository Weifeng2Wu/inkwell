import { describe, expect, it } from "vitest";
import { fuzzyMatch, highlight, modePrefix, parseInput, rank } from "./palette";

describe("parseInput", () => {
  it("reads the mode from the prefix character", () => {
    expect(parseInput("  main ")).toEqual({ mode: "open", query: "main" });
    expect(parseInput("> compile")).toEqual({ mode: "command", query: "compile" });
    expect(parseInput("@vaswani")).toEqual({ mode: "cite", query: "vaswani" });
    expect(parseInput("#")).toEqual({ mode: "heading", query: "" });
    expect(modePrefix("cite")).toBe("@");
    expect(modePrefix("open")).toBe("");
  });
});

describe("fuzzyMatch", () => {
  it("prefers word-boundary substrings over scattered characters", () => {
    const boundary = fuzzyMatch("sections/intro.tex", "intro");
    const inside = fuzzyMatch("reintroduce.tex", "intro");
    const scattered = fuzzyMatch("index-notes-reviews-outline.md", "intro");
    expect(boundary?.ranges).toEqual([[9, 14]]);
    expect(boundary?.score).toBeGreaterThan(inside?.score ?? 0);
    expect(inside?.score).toBeGreaterThan(scattered?.score ?? 0);
    expect(fuzzyMatch("main.tex", "xyz")).toBeNull();
  });

  it("requires every term and searches secondary text without highlighting it", () => {
    const match = fuzzyMatch("Attention Is All You Need", "need vaswani", "Vaswani 2017 NeurIPS");
    expect(match?.ranges).toEqual([[21, 25]]);
    expect(fuzzyMatch("Attention Is All You Need", "need lecun", "Vaswani 2017")).toBeNull();
    expect(fuzzyMatch("深度学习综述", "学习")?.ranges).toEqual([[2, 4]]);
  });

  it("merges overlapping highlights", () => {
    expect(fuzzyMatch("attention", "atten tent")?.ranges).toEqual([[0, 6]]);
  });
});

describe("rank", () => {
  const files = ["notes/ideas.md", "main.tex", "sections/intro.tex", "main.pdf"];
  const text = (path: string) => ({ primary: path });

  it("keeps the given order for an empty query and limits the result", () => {
    expect(rank(files, " ", text, 2).map((result) => result.item)).toEqual(files.slice(0, 2));
  });

  it("orders by score, then by the original order", () => {
    expect(rank(files, "main", text, 5).map((result) => result.item)).toEqual([
      "main.tex",
      "main.pdf",
    ]);
    expect(rank(files, "tex", text, 5).map((result) => result.item)).toEqual([
      "main.tex",
      "sections/intro.tex",
    ]);
  });
});

describe("highlight", () => {
  it("splits text around the matched ranges", () => {
    expect(highlight("main.tex", [[0, 4]])).toEqual([
      { text: "main", hit: true },
      { text: ".tex", hit: false },
    ]);
    expect(highlight("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });
});
