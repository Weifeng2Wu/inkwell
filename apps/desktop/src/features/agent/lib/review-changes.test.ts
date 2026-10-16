import { describe, expect, it } from "vitest";
import { applyReviewedHunks, type ReviewHunk } from "./review-changes";

const replacement: ReviewHunk = {
  originalStartLineNumber: 2,
  originalEndLineNumber: 2,
  modifiedStartLineNumber: 2,
  modifiedEndLineNumber: 2,
};

describe("reviewed edits", () => {
  it("keeps rejected changes and applies only selected replacements", () => {
    const hunks = [
      replacement,
      {
        originalStartLineNumber: 4,
        originalEndLineNumber: 4,
        modifiedStartLineNumber: 4,
        modifiedEndLineNumber: 4,
      },
    ];
    expect(applyReviewedHunks("a\nb\nc\nd\n", "a\nB\nc\nD\n", hunks, [0])).toBe("a\nB\nc\nd\n");
    expect(applyReviewedHunks("a\nb\nc\nd", "a\nB\nc\nD", hunks, [1])).toBe("a\nb\nc\nD");
    expect(applyReviewedHunks("a\nb", "a\nB", [replacement], [])).toBe("a\nb");
  });
  it("handles insertion at start, middle and end", () => {
    expect(
      applyReviewedHunks(
        "a\nb",
        "new\na\nb",
        [
          {
            originalStartLineNumber: 0,
            originalEndLineNumber: 0,
            modifiedStartLineNumber: 1,
            modifiedEndLineNumber: 1,
          },
        ],
        [0],
      ),
    ).toBe("new\na\nb");
    expect(
      applyReviewedHunks(
        "a\nb",
        "a\nnew\nb",
        [
          {
            originalStartLineNumber: 1,
            originalEndLineNumber: 0,
            modifiedStartLineNumber: 2,
            modifiedEndLineNumber: 2,
          },
        ],
        [0],
      ),
    ).toBe("a\nnew\nb");
    expect(
      applyReviewedHunks(
        "a\nb",
        "a\nb\nnew",
        [
          {
            originalStartLineNumber: 2,
            originalEndLineNumber: 0,
            modifiedStartLineNumber: 3,
            modifiedEndLineNumber: 3,
          },
        ],
        [0],
      ),
    ).toBe("a\nb\nnew");
  });
  it("handles deletions without shifting later hunks", () => {
    expect(
      applyReviewedHunks(
        "a\nb\nc\nd",
        "a\nc\nD",
        [
          {
            originalStartLineNumber: 2,
            originalEndLineNumber: 2,
            modifiedStartLineNumber: 1,
            modifiedEndLineNumber: 0,
          },
          {
            originalStartLineNumber: 4,
            originalEndLineNumber: 4,
            modifiedStartLineNumber: 3,
            modifiedEndLineNumber: 3,
          },
        ],
        [0, 1],
      ),
    ).toBe("a\nc\nD");
  });
});
