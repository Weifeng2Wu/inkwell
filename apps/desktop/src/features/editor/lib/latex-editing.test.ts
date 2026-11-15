import { describe, expect, it } from "vitest";
import { unclosedEnvironment, wrapEdit } from "./latex-editing";

/** Applies an edit and marks the resulting selection with brackets. */
function apply(text: string, before: string, after: string) {
  const start = text.indexOf("<");
  const end = text.indexOf(">") - 1;
  const source = text.replace("<", "").replace(">", "");
  const edit = wrapEdit(source, start, end, before, after);
  const result = source.slice(0, edit.start) + edit.replacement + source.slice(edit.end);
  return `${result.slice(0, edit.selectionStart)}<${result.slice(edit.selectionStart, edit.selectionEnd)}>${result.slice(edit.selectionEnd)}`;
}

describe("wrapping a selection", () => {
  it("wraps LaTeX text and keeps it selected", () => {
    expect(apply("a <word> b", "\\textbf{", "}")).toBe("a \\textbf{<word>} b");
    expect(apply("a <> b", "\\textit{", "}")).toBe("a \\textit{<>} b");
  });

  it("unwraps text that already carries the command", () => {
    expect(apply("a \\textbf{<word>} b", "\\textbf{", "}")).toBe("a <word> b");
    expect(apply("a <\\textbf{word}> b", "\\textbf{", "}")).toBe("a <word> b");
    expect(apply("a \\textit{<word>} b", "\\textbf{", "}")).toBe("a \\textit{\\textbf{<word>}} b");
  });

  it("toggles Markdown bold and italic independently", () => {
    expect(apply("<word>", "**", "**")).toBe("**<word>**");
    expect(apply("**<word>**", "**", "**")).toBe("<word>");
    expect(apply("*<word>*", "*", "*")).toBe("<word>");
    expect(apply("**<word>**", "*", "*")).toBe("***<word>***");
    expect(apply("***<word>***", "*", "*")).toBe("**<word>**");
    expect(apply("***<word>***", "**", "**")).toBe("*<word>*");
    expect(apply("*<word>*", "**", "**")).toBe("***<word>***");
  });
});

describe("closing an environment on Enter", () => {
  it("names the environment a line opens when it has no end yet", () => {
    expect(unclosedEnvironment("\\begin{figure}", "\\begin{figure}")).toBe("figure");
    expect(unclosedEnvironment("x\n  \\begin{table}[htbp]", "  \\begin{table}[htbp]")).toBe(
      "table",
    );
    expect(unclosedEnvironment("\\begin{tabular}{l r}", "\\begin{tabular}{l r} ")).toBe("tabular");
    expect(unclosedEnvironment("\\begin{align*}", "\\begin{align*}")).toBe("align*");
  });

  it("leaves closed, commented and unrelated lines alone", () => {
    expect(unclosedEnvironment("\\begin{figure}\n\\end{figure}", "\\begin{figure}")).toBeNull();
    expect(unclosedEnvironment("% \\begin{figure}", "% \\begin{figure}")).toBeNull();
    expect(unclosedEnvironment("\\begin{figure} text", "\\begin{figure} text")).toBeNull();
    expect(unclosedEnvironment("\\section{A}", "\\section{A}")).toBeNull();
    expect(unclosedEnvironment("\\begin{a}\n\\begin{a}\n\\end{a}\n% \\end{a}", "\\begin{a}")).toBe(
      "a",
    );
  });
});
