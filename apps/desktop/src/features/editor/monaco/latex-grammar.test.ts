import { describe, expect, it } from "vitest";
import { tokenizeDocument, typeOf } from "./grammar-testing";
import { latexLanguage } from "./latex-grammar";

const tokens = (source: string) => tokenizeDocument(latexLanguage, source);
const line = (source: string) => tokens(source)[0] ?? [];

describe("LaTeX tokens", () => {
  it("keeps running text plain after a class or package without options", () => {
    const lines = tokens(
      [
        "\\documentclass{article}",
        "\\usepackage{amsmath}",
        "\\begin{document}",
        "We study sparse attention patterns for long-document understanding.",
        "Residual connections [1] remain essential in 2024.",
      ].join("\n"),
    );
    expect(lines[0]).toEqual([
      { text: "\\documentclass", type: "keyword" },
      { text: "{", type: "delimiter" },
      { text: "article", type: "name" },
      { text: "}", type: "delimiter" },
    ]);
    expect(lines[2]?.map((span) => span.type)).toEqual([
      "keyword",
      "delimiter",
      "name",
      "delimiter",
    ]);
    expect(lines[3]).toEqual([
      { text: "We study sparse attention patterns for long-document understanding.", type: "" },
    ]);
    expect(lines[4]).toEqual([
      { text: "Residual connections [1] remain essential in 2024.", type: "" },
    ]);
  });

  it("separates optional arguments from the named argument", () => {
    expect(line("\\documentclass[11pt, a4paper]{article} text")).toEqual([
      { text: "\\documentclass", type: "keyword" },
      { text: "[", type: "delimiter" },
      { text: "11pt, a4paper", type: "attribute" },
      { text: "]{", type: "delimiter" },
      { text: "article", type: "name" },
      { text: "}", type: "delimiter" },
      { text: " text", type: "" },
    ]);
    expect(
      typeOf(tokens("\\includegraphics[width=\\linewidth]{figures/arch}"), "figures/arch"),
    ).toBe("name");
  });

  it("marks section titles as headings, including nested groups and short titles", () => {
    const spans = line("\\section*[Short]{A {nested} title} after");
    expect(spans.filter((span) => span.type === "heading").map((span) => span.text)).toEqual([
      "A ",
      "nested",
      " title",
    ]);
    expect(typeOf([spans], "Short")).toBe("attribute");
    expect(typeOf([spans], " after")).toBe("");
    expect(typeOf(tokens("\\title{Sparse Attention}"), "Sparse Attention")).toBe("heading");
    expect(typeOf(tokens("\\sectionmark{Running head}"), "Running head")).toBe("");
  });

  it("marks citation and reference keys, and keeps the text around them plain", () => {
    const spans = line("As \\citep[see][p.~4]{vaswani2017, devlin2019} and \\ref{sec:intro} show");
    expect(spans.filter((span) => span.type === "reference").map((span) => span.text)).toEqual([
      "vaswani2017",
      "devlin2019",
      "sec:intro",
    ]);
    expect(typeOf([spans], "\\citep")).toBe("keyword");
    expect(typeOf([spans], " show")).toBe("");
    for (const command of ["label", "eqref", "autoref", "cref", "pageref", "textcite", "nocite"])
      expect(typeOf(tokens(`\\${command}{key}`), "key")).toBe("reference");
  });

  it("colours formulas as a whole and returns to text afterwards", () => {
    const inline = line("Let $A \\in \\mathbb{R}^{n}$ be 50\\% of \\(x\\) here");
    expect(inline).toEqual([
      { text: "Let ", type: "" },
      { text: "$A \\in \\mathbb{R}^{n}$", type: "math" },
      { text: " be 50", type: "" },
      { text: "\\%", type: "escape" },
      { text: " of ", type: "" },
      { text: "\\(x\\)", type: "math" },
      { text: " here", type: "" },
    ]);
    const display = tokens(
      [
        "\\begin{align*}",
        "  a &= \\begin{cases} 1 \\\\ 0 \\end{cases} \\label{eq:a}",
        "\\end{align*}",
        "Text \\[ x^2 \\] and $$y$$ done",
      ].join("\n"),
    );
    expect(display[0]?.map((span) => span.type)).toEqual([
      "keyword",
      "delimiter",
      "name",
      "delimiter",
    ]);
    expect(display[1]?.map((span) => span.type)).toEqual([
      "math",
      "keyword",
      "delimiter",
      "reference",
      "delimiter",
    ]);
    expect(display[2]?.map((span) => span.type)).toEqual([
      "keyword",
      "delimiter",
      "name",
      "delimiter",
    ]);
    expect(display[3]).toEqual([
      { text: "Text ", type: "" },
      { text: "\\[ x^2 \\]", type: "math" },
      { text: " and ", type: "" },
      { text: "$$y$$", type: "math" },
      { text: " done", type: "" },
    ]);
  });

  it("treats comments, escapes and line breaks as such", () => {
    expect(line("Cost 5\\% % not shown \\cite{x}")).toEqual([
      { text: "Cost 5", type: "" },
      { text: "\\%", type: "escape" },
      { text: "% not shown \\cite{x}", type: "comment" },
    ]);
    expect(line("a & b \\\\[2pt] c")).toEqual([
      { text: "a ", type: "" },
      { text: "&", type: "delimiter" },
      { text: " b ", type: "" },
      { text: "\\\\", type: "escape" },
      { text: "[2pt] c", type: "" },
    ]);
  });

  it("styles bold and emphasised text", () => {
    const spans = line("\\textbf{Bold {inner}} and \\emph{stress} plain");
    expect(spans.filter((span) => span.type === "strong").map((span) => span.text)).toEqual([
      "Bold ",
      "inner",
    ]);
    expect(typeOf([spans], "stress")).toBe("emphasis");
    expect(typeOf([spans], " plain")).toBe("");
  });

  it("keeps literal text literal", () => {
    const lines = tokens(
      [
        "\\begin{verbatim}",
        "\\section{not a heading} % not a comment $x$",
        "\\end{verbatim}",
        "\\url{https://example.org/a%20b_c} and \\verb|\\raw{}| text",
      ].join("\n"),
    );
    expect(lines[1]).toEqual([
      { text: "\\section{not a heading} % not a comment $x$", type: "verbatim" },
    ]);
    expect(lines[2]?.map((span) => span.type)).toEqual([
      "keyword",
      "delimiter",
      "name",
      "delimiter",
    ]);
    expect(typeOf(lines, "https://example.org/a%20b_c")).toBe("verbatim");
    expect(typeOf(lines, "\\raw{}")).toBe("verbatim");
    expect(typeOf(lines, " text")).toBe("");
  });

  it("never lets an unbalanced argument recolour the next paragraph", () => {
    for (const broken of [
      "\\section{Unclosed",
      "\\cite{key",
      "\\textbf{bold",
      "Price $5",
      "\\item[x",
    ]) {
      const lines = tokens(`${broken}\nstill inside\n\nNext paragraph.`);
      expect(lines[3], broken).toEqual([{ text: "Next paragraph.", type: "" }]);
    }
  });

  it("gives every generic command the same quiet treatment", () => {
    expect(line("\\maketitle \\item[a] \\newcommand{\\R}{\\mathbb{R}} #1")).toEqual([
      { text: "\\maketitle", type: "keyword" },
      { text: "\\item", type: "keyword" },
      { text: "[", type: "delimiter" },
      { text: "a", type: "attribute" },
      { text: "]", type: "delimiter" },
      { text: "\\newcommand", type: "keyword" },
      { text: "{", type: "delimiter" },
      { text: "\\R", type: "keyword" },
      { text: "}{", type: "delimiter" },
      { text: "\\mathbb", type: "keyword" },
      { text: "{", type: "delimiter" },
      { text: "R", type: "" },
      { text: "}}", type: "delimiter" },
      { text: "#1", type: "escape" },
    ]);
  });
});
