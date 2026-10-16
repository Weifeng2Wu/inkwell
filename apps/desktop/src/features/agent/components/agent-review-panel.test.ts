import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewHunk } from "../lib/review-changes";
import type { useAgentReview } from "../lib/use-agent-review";
import { AgentReviewPanel } from "./agent-review-panel";

const editor = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("@/features/editor/components/lazy", () => ({
  GitMonacoDiffEditor: (props: unknown) => {
    editor.render(props);
    return null;
  },
}));
vi.mock("@/features/i18n", () => ({ useI18n: () => ({ locale: "zh" }) }));

const change = {
  path: "paper.tex",
  before: "aaaa\nunchanged\ncccc",
  after: "bbbb\nunchanged\ndddd",
};
const hunks: ReviewHunk[] = [
  {
    originalStartLineNumber: 1,
    originalEndLineNumber: 1,
    modifiedStartLineNumber: 1,
    modifiedEndLineNumber: 1,
  },
  {
    originalStartLineNumber: 3,
    originalEndLineNumber: 3,
    modifiedStartLineNumber: 3,
    modifiedEndLineNumber: 3,
  },
];

function fixture(filePath?: string) {
  const review: ReturnType<typeof useAgentReview> = {
    changes: [change, { path: "notes.md", before: "old note", after: "new note" }],
    open: true,
    setOpen: vi.fn(),
    error: null,
    busy: false,
    beforeTurn: vi.fn(),
    afterTurn: vi.fn(),
    decide: vi.fn(),
    decideAll: vi.fn(),
  };
  const markup = renderToStaticMarkup(createElement(AgentReviewPanel, { review, filePath }));
  const props = editor.render.mock.calls.at(-1)?.[0] as {
    original: string;
    modified: string;
    inlineReview: { onDecide: (hunks: ReviewHunk[], index: number, accept: boolean) => void };
  };
  return { review, markup, props };
}

beforeEach(() => editor.render.mockClear());

describe("inline Agent review", () => {
  it("follows the selected file and leaves other file suggestions pending", () => {
    const { review, props } = fixture("notes.md");
    expect(props.original).toBe("old note");
    expect(props.modified).toBe("new note");
    expect(review.changes).toHaveLength(2);
    expect(review.decide).not.toHaveBeenCalled();
  });
  it("uses the existing editor region rather than a full-screen modal or split review page", () => {
    const { markup, props } = fixture();
    expect(markup).toContain("返回编辑");
    expect(markup).not.toContain('role="dialog"');
    expect(markup).not.toContain("aria-modal");
    expect(markup).not.toContain("fixed");
    expect(markup).not.toContain("<aside");
    expect(markup).not.toContain("红色为原文");
    expect(markup).not.toContain("<p");
    expect(props.original).toBe(change.before);
    expect(props.modified).toBe(change.after);
    expect(props.inlineReview).toBeDefined();
  });
  it("accepts a single inline change immediately and retains later suggestions", () => {
    const { review, props } = fixture();
    props.inlineReview.onDecide(hunks, 0, true);
    expect(review.decide).toHaveBeenCalledWith(change, true, "bbbb\nunchanged\ncccc", change.after);
  });
  it("rejects just the chosen inline change and retains other suggestions", () => {
    const { review, props } = fixture();
    props.inlineReview.onDecide(hunks, 0, false);
    expect(review.decide).toHaveBeenCalledWith(
      change,
      false,
      change.after,
      "aaaa\nunchanged\ndddd",
    );
  });
  it("resolves the file when its last inline change is decided", () => {
    const { review, props } = fixture();
    props.inlineReview.onDecide(hunks.slice(0, 1), 0, false);
    expect(review.decide).toHaveBeenCalledWith(change, false);
  });
});
