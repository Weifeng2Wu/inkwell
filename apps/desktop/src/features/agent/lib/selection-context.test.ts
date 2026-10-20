import { describe, expect, it } from "vitest";
import type { SelectionAttachment } from "@/types/editor-selection";
import { withSelectionContext } from "./selection-context";

const selection: SelectionAttachment = {
  id: "excerpt-1",
  path: "chapters/intro.tex",
  text: "  Our \\emph{unsaved} finding.\nSecond sentence.  ",
  startLineNumber: 12,
  startColumn: 5,
  endLineNumber: 13,
  endColumn: 20,
};

describe("selected editor context", () => {
  it("preserves prompts without selected text", () => {
    expect(withSelectionContext("Polish this", [])).toBe("Polish this");
  });

  it("includes only selected snapshots with exact file and range metadata", () => {
    const prompt = withSelectionContext("Polish this", [selection]);
    expect(prompt).toContain('"chapters/intro.tex":12:5-13:20');
    expect(prompt).toContain(`\n${selection.text}\n`);
    expect(prompt).toContain("possibly unsaved");
    expect(prompt).not.toContain("@file:");
    expect(prompt).not.toContain(selection.id);
  });

  it("preserves the order of passages across files", () => {
    const second = { ...selection, id: "excerpt-2", path: "results.tex", text: "A second passage" };
    const prompt = withSelectionContext("Compare", [selection, second]);
    expect(prompt.indexOf(selection.text)).toBeLessThan(prompt.indexOf(second.text));
  });

  it("keeps backtick fences and hostile path characters inside their boundaries", () => {
    const prompt = withSelectionContext("Read", [
      { ...selection, path: 'a"\nb.tex', text: "```latex\nText\n```" },
    ]);
    expect(prompt).toContain('"a\\"\\nb.tex":12:5-13:20');
    expect(prompt).toContain("\n````\n```latex\nText\n```\n````");
  });
});
