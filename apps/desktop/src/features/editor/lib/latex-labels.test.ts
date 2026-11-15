import { describe, expect, it } from "vitest";
import { latexLabels, latexReferenceAt, referenceContext } from "./latex-labels";

const manuscript = [
  "\\section{Introduction}\\label{sec:intro}",
  "Text. % \\label{sec:commented}",
  "\\subsection{Sparse \\textbf{Pattern}}",
  "\\label{sec:pattern}",
  "\\begin{figure}",
  "  \\centering",
  "  \\label{fig:early}",
  "  \\caption[Short]{Overview of the \\emph{model} \\cite{x}.}\\label{fig:arch}",
  "\\end{figure}",
  "\\begin{equation}",
  "  \\label{eq:attn}",
  "  E = mc^2",
  "\\end{equation}",
  "\\begin{itemize}",
  "  \\item First \\label{item:first}",
  "\\end{itemize}",
].join("\n");

describe("LaTeX labels", () => {
  const labels = latexLabels(manuscript);
  const label = (key: string) => labels.find((item) => item.key === key);

  it("lists labels in document order and skips commented ones", () => {
    expect(labels.map((item) => item.key)).toEqual([
      "sec:intro",
      "sec:pattern",
      "fig:early",
      "fig:arch",
      "eq:attn",
      "item:first",
    ]);
    const first = label("sec:intro");
    expect(manuscript.slice(first?.start, first?.end)).toBe("sec:intro");
    expect(label("eq:attn")?.line).toBe(11);
  });

  it("describes a label by the heading above it", () => {
    expect(label("sec:intro")).toMatchObject({ scope: "section", title: "Introduction", line: 1 });
    expect(label("sec:pattern")).toMatchObject({ scope: "subsection", title: "Sparse Pattern" });
  });

  it("describes a label inside an environment by its caption or formula", () => {
    expect(label("fig:arch")).toMatchObject({ scope: "figure", title: "Overview of the model ." });
    expect(label("fig:early")?.title).toBe("Overview of the model .");
    expect(label("eq:attn")).toMatchObject({ scope: "equation", title: "E = mc^2" });
    expect(label("item:first")).toMatchObject({ scope: "itemize", title: "" });
  });

  it("tolerates unbalanced documents and labels before any heading", () => {
    expect(latexLabels("\\label{top}\n\\begin{table}\n\\label{tab:open}")).toMatchObject([
      { key: "top", scope: "", title: "" },
      { key: "tab:open", scope: "table", title: "" },
    ]);
    expect(
      latexLabels("\\begin{center}\\label{c}\\end{center}\\end{figure}\\label{ }"),
    ).toMatchObject([{ key: "c", scope: "" }]);
  });
});

describe("reference completion context", () => {
  const at = (text: string, cursor = text.length) => referenceContext(text, cursor);

  it("opens after the brace of a reference command", () => {
    expect(at("see \\ref{")).toEqual({ query: "", start: 9, end: 9 });
    expect(at("\\eqref{eq:a")).toEqual({ query: "eq:a", start: 7, end: 11 });
    expect(at("\\autoref {fig")).toMatchObject({ query: "fig" });
    expect(at("\\cref{a, b")).toEqual({ query: "b", start: 9, end: 10 });
  });

  it("replaces the whole key under the caret", () => {
    const text = "\\ref{sec:intro} and more";
    expect(at(text, 8)).toEqual({ query: "sec", start: 5, end: 14 });
  });

  it("stays closed elsewhere", () => {
    expect(at("\\cite{")).toBeNull();
    expect(at("\\label{")).toBeNull();
    expect(at("\\ref{a} text")).toBeNull();
    expect(at("% \\ref{")).toBeNull();
    expect(at("a \\\\ref{")).toBeNull();
    expect(at("\\ref{a}\n")).toBeNull();
  });
});

describe("reference under the caret", () => {
  const text =
    "As \\cref{sec:intro, fig:arch} and \\eqref{eq:attn} show % \\ref{hidden}\n\\cite{paper}";

  it("finds the key and its range", () => {
    expect(latexReferenceAt(text, text.indexOf("fig:") + 2)).toEqual({
      key: "fig:arch",
      start: text.indexOf("fig:arch"),
      end: text.indexOf("fig:arch") + 8,
    });
    expect(latexReferenceAt(text, text.indexOf("sec:intro"))?.key).toBe("sec:intro");
    expect(latexReferenceAt(text, text.indexOf("eq:attn") + 7)?.key).toBe("eq:attn");
  });

  it("ignores commands, comments, citations and labels", () => {
    expect(latexReferenceAt(text, 4)).toBeNull();
    expect(latexReferenceAt(text, text.indexOf("hidden") + 1)).toBeNull();
    expect(latexReferenceAt(text, text.indexOf("paper") + 1)).toBeNull();
    expect(latexReferenceAt("\\label{sec:a}", 9)).toBeNull();
  });
});
