import { describe, expect, it } from "vitest";
import { countWords, currentHeading, documentOutline, readingMinutes } from "./outline";

describe("LaTeX outline", () => {
  it("maps sectioning commands to fixed levels with 1-based lines", () => {
    const text = [
      "\\part{One}",
      "\\chapter{Two}",
      "\\section{Three}",
      "\\subsection{Four}",
      "\\subsubsection{Five}",
      "\\paragraph{Six}",
    ].join("\n");
    expect(documentOutline(text, "latex")).toEqual([
      { level: 0, title: "One", line: 1 },
      { level: 1, title: "Two", line: 2 },
      { level: 2, title: "Three", line: 3 },
      { level: 3, title: "Four", line: 4 },
      { level: 4, title: "Five", line: 5 },
      { level: 5, title: "Six", line: 6 },
    ]);
  });

  it("accepts starred variants and optional short titles", () => {
    const text =
      "\\section*{Acknowledgements}\n\\section[Short [x]]{Long title}\n\\chapter* {Spaced}";
    expect(documentOutline(text, "latex").map((item) => item.title)).toEqual([
      "Acknowledgements",
      "Long title",
      "Spaced",
    ]);
  });

  it("handles nested braces and strips formatting commands and labels", () => {
    const text =
      "\\section{A \\textbf{bold \\emph{nested}} title\\label{sec:a} with $O(n^2)$ \\& 50\\% \\{set\\}}";
    expect(documentOutline(text, "latex")).toEqual([
      { level: 2, title: "A bold nested title with O(n^2) & 50% {set}", line: 1 },
    ]);
  });

  it("prefers the PDF string of texorpdfstring and drops footnotes", () => {
    const text = "\\section{\\texorpdfstring{$\\alpha$-decay}{Alpha decay}\\footnote{note}}";
    expect(documentOutline(text, "latex")[0]?.title).toBe("Alpha decay");
  });

  it("reads titles that continue on the next line", () => {
    const text = "intro\n\\section{A long\n  title}\n\\subsection\n{Next line}";
    expect(documentOutline(text, "latex")).toEqual([
      { level: 2, title: "A long title", line: 2 },
      { level: 3, title: "Next line", line: 4 },
    ]);
  });

  it("ignores commented headings but not escaped percent signs", () => {
    const text = "% \\section{Hidden}\n100\\% done \\section{Shown}\ntext % \\section{Also hidden}";
    expect(documentOutline(text, "latex")).toEqual([{ level: 2, title: "Shown", line: 2 }]);
  });

  it("ignores headings inside verbatim-like environments", () => {
    const text = [
      "\\section{Before}",
      "\\begin{verbatim}",
      "\\section{In verbatim}",
      "\\end{verbatim}",
      "\\begin{lstlisting}[language=TeX]",
      "\\section{In listing}",
      "\\end{lstlisting}",
      "\\begin{minted}{latex}",
      "\\section{In minted}",
      "\\end{minted} \\section{After}",
    ].join("\n");
    expect(documentOutline(text, "latex")).toEqual([
      { level: 2, title: "Before", line: 1 },
      { level: 2, title: "After", line: 10 },
    ]);
  });

  it("ignores look-alike commands and unbalanced titles", () => {
    const text = "\\sectionmark{x}\n\\paragraphs{y}\n\\\\section{z}\n\\section{open\n\\section";
    expect(documentOutline(text, "latex")).toEqual([]);
  });

  it("handles CRLF line endings", () => {
    expect(documentOutline("a\r\n\\section{B}\r\n", "latex")).toEqual([
      { level: 2, title: "B", line: 2 },
    ]);
  });
});

describe("Markdown outline", () => {
  it("reads ATX headings with relative levels", () => {
    const text = "# Title\n\ntext\n## Part\n###### Deep\n####### Too deep\n#NoSpace";
    expect(documentOutline(text, "markdown")).toEqual([
      { level: 0, title: "Title", line: 1 },
      { level: 1, title: "Part", line: 4 },
      { level: 5, title: "Deep", line: 5 },
    ]);
  });

  it("strips closing hashes and inline markup", () => {
    const text = [
      "## Closed ##",
      "## **Bold** and `code` with [a link](https://example.com) ###",
      "# C# language",
      "# [[notes/target|Alias]] and [[plain]]",
      "# snake_case stays, _emphasis_ goes",
    ].join("\n");
    expect(documentOutline(text, "markdown").map((item) => item.title)).toEqual([
      "Closed",
      "Bold and code with a link",
      "C# language",
      "Alias and plain",
      "snake_case stays, emphasis goes",
    ]);
  });

  it("skips frontmatter and fenced code blocks", () => {
    const text = [
      "---",
      "title: x",
      "# not a heading",
      "---",
      "# Real",
      "```python",
      "# comment",
      "```",
      "~~~~",
      "# tilde",
      "~~~",
      "# still fenced",
      "~~~~",
      "## After",
    ].join("\n");
    expect(documentOutline(text, "markdown")).toEqual([
      { level: 0, title: "Real", line: 5 },
      { level: 1, title: "After", line: 14 },
    ]);
  });

  it("treats a leading rule without a closing marker as content", () => {
    expect(documentOutline("---\n# Heading", "markdown")).toEqual([
      { level: 0, title: "Heading", line: 2 },
    ]);
  });

  it("skips empty headings and handles CRLF", () => {
    expect(documentOutline("#\r\n## \r\n# A\r\n", "markdown")).toEqual([
      { level: 0, title: "A", line: 3 },
    ]);
  });
});

describe("outline for other languages", () => {
  it("is empty", () => {
    expect(documentOutline("# A\n\\section{B}", "bibtex")).toEqual([]);
    expect(documentOutline("", "latex")).toEqual([]);
  });
});

describe("word count", () => {
  it("counts Unicode words with inner apostrophes and hyphens", () => {
    expect(countWords("It's a well-known résumé, 3.14 and 1,000 – naïve.", "plaintext")).toBe(8);
    expect(countWords("", "plaintext")).toBe(0);
    expect(countWords("  \n -- ' ", "plaintext")).toBe(0);
  });

  it("counts each CJK character and mixes with Latin words", () => {
    expect(countWords("科研写作", "markdown")).toBe(4);
    expect(countWords("使用 Transformer 模型，效果很好。", "markdown")).toBe(9);
    expect(countWords("ひらがなカタカナ", "plaintext")).toBe(8);
    expect(countWords("한국어 문장 입니다", "plaintext")).toBe(3);
  });

  it("skips the LaTeX preamble, comments and everything after the document", () => {
    const text = [
      "\\documentclass[11pt]{article}",
      "\\usepackage{amsmath}",
      "\\title{Ignored preamble title}",
      "\\begin{document}",
      "Hello brave world. % not counted here",
      "50\\% of cases",
      "\\end{document}",
      "trailing junk",
    ].join("\n");
    expect(countWords(text, "latex")).toBe(6);
  });

  it("counts a fragment without a document environment", () => {
    expect(countWords("\\section{Related Work}\nSome \\emph{very} good text.", "latex")).toBe(6);
  });

  it("omits math in every delimiter form", () => {
    const text = [
      "Inline $x + y$ and \\(a b\\) here.",
      "\\[ E = mc^2 \\]",
      "$$ a b c $$",
      "\\begin{equation}",
      "  f(x) = \\text{loss} + y",
      "\\end{equation}",
      "\\begin{align*}",
      "  a &= b \\\\",
      "\\end{align*}",
      "Costs \\$5 total.",
    ].join("\n");
    expect(countWords(text, "latex")).toBe(6);
  });

  it("omits citation keys, references, labels and file arguments", () => {
    const text =
      "As shown \\cite{smith2020,kim2021} and \\citep[p.~3]{lee} in Figure~\\ref{fig:one}\\label{sec:x} \\includegraphics[width=3cm]{figures/plot.pdf} \\input{chapters/intro} done.";
    expect(countWords(text, "latex")).toBe(6);
  });

  it("omits command and environment names but keeps their prose", () => {
    const text = [
      "\\begin{figure}[htbp]",
      "\\centering",
      "\\caption{A small caption}",
      "\\end{figure}",
      "\\begin{tabular}{lcc}",
      "one & two \\\\[2pt]",
      "\\end{tabular}",
      "\\begin{itemize}",
      "\\item[a] First \\textbf{bold} point\\footnote{A note}",
      "\\end{itemize}",
      "\\href{https://example.com/a-b}{link text}",
    ].join("\n");
    expect(countWords(text, "latex")).toBe(12);
  });

  it("ignores verbatim content and joins accented letters", () => {
    const text =
      "Schr\\\"odinger wrote\n\\begin{verbatim}\nmany words in here\n\\end{verbatim}\ncaf\\'e";
    expect(countWords(text, "latex")).toBe(3);
  });

  it("counts CJK LaTeX prose", () => {
    expect(countWords("\\section{引言}\n本文提出 $x$ 方法\\cite{a}。", "latex")).toBe(8);
  });

  it("omits Markdown code, frontmatter, URLs and HTML comments", () => {
    const text = [
      "---",
      "title: Not counted",
      "---",
      "# Heading one",
      "",
      "Some [link text](https://example.com/very/long) and ![alt](img.png).",
      "<!-- hidden",
      "comment -->",
      "```js",
      "const ignored = true;",
      "```",
      "See https://example.org/page or <https://example.net>.",
      "[ref]: https://example.com/ref",
      "<b>bold</b> end",
    ].join("\n");
    expect(countWords(text, "markdown")).toBe(10);
  });

  it("omits Markdown math but keeps prices", () => {
    expect(countWords("Energy $E = mc^2$ is $$a b$$ known", "markdown")).toBe(3);
    expect(countWords("It costs $5 and $10 today", "markdown")).toBe(6);
  });
});

describe("readingMinutes", () => {
  it("reads 220 words a minute, rounded up", () => {
    expect(readingMinutes("", "plaintext")).toBe(0);
    expect(readingMinutes("one", "plaintext")).toBe(1);
    expect(readingMinutes("word ".repeat(220), "plaintext")).toBe(1);
    expect(readingMinutes("word ".repeat(221), "plaintext")).toBe(2);
  });

  it("reads 300 Han characters a minute and adds mixed text up", () => {
    expect(readingMinutes("字".repeat(300), "markdown")).toBe(1);
    expect(readingMinutes("字".repeat(301), "markdown")).toBe(2);
    expect(readingMinutes(`${"字".repeat(150)} ${"word ".repeat(110)}`, "markdown")).toBe(1);
    expect(readingMinutes(`${"字".repeat(150)} ${"word ".repeat(111)}`, "markdown")).toBe(2);
  });

  it("counts prose only", () => {
    expect(readingMinutes(`\\section{A}\n$${"x ".repeat(500)}$`, "latex")).toBe(1);
  });
});

describe("currentHeading", () => {
  const items = [{ line: 3 }, { line: 10 }, { line: 20 }];

  it("is the last heading at or before the cursor", () => {
    expect(currentHeading(items, 3)).toBe(items[0]);
    expect(currentHeading(items, 19)).toBe(items[1]);
    expect(currentHeading(items, 400)).toBe(items[2]);
  });

  it("is nothing before the first heading or without a cursor", () => {
    expect(currentHeading(items, 2)).toBeUndefined();
    expect(currentHeading(items, null)).toBeUndefined();
    expect(currentHeading([], 5)).toBeUndefined();
  });
});
