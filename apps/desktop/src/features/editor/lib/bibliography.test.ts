import { describe, expect, it } from "vitest";
import {
  bibliographyPaths,
  citationContext,
  indexBibliographies,
  parseBibliography,
  searchBibliography,
} from "./bibliography";

const fixture = String.raw`
% @article{ignored, title={Commented record}}
@comment{An ignored {nested} comment}
@string{conference = "Machine Learning"}
@preamble{"Ignored preamble"}
@article{smith2024,
  title = {Attention and {Deep {Learning}}},
  author = {Smith, Jane and Garc{\'i}a, Ana},
  year = 2024,
  url = {https://example.com/a?b=c},
}
@inproceedings(kim2025,
  title = "한국어 연구 " # conference,
  author = "Kim, Min",
  date = {2025-01-02}
)
@book{中文键, title={中文研究}, editor={张三}}
`;

describe("bibliography indexing and search", () => {
  it("parses nested braces, quoted fields, concatenated strings, dates, and non-English entries", () => {
    const entries = parseBibliography(fixture, "references.bib");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({
      key: "smith2024",
      title: "Attention and Deep Learning",
      author: "Smith, Jane and Garcia, Ana",
      year: "2024",
      source: "references.bib",
    });
    expect(entries[1]?.title).toBe("한국어 연구 Machine Learning");
    expect(entries[1]?.year).toBe("2025");
    expect(entries[2]?.author).toBe("张三");
  });

  it("keeps parsing after escaped quotes, parentheses and embedded @ signs", () => {
    const entries = parseBibliography(
      String.raw`@article{first,title="A \"quoted\" email a@b.org (test)"} @article{next,title={\LaTeX and {BERT}}}`,
      "refs.bib",
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]?.title).toBe("LaTeX and BERT");
    expect(
      parseBibliography(
        String.raw`@article{format,title={A \textit{Formatted} \textbf{Title}}}`,
        "refs.bib",
      )[0]?.title,
    ).toBe("A Formatted Title");
    expect(parseBibliography("not a bibliography", "bad.bib")).toEqual([]);
    expect(() => parseBibliography("@article{broken, title={unfinished", "bad.bib")).not.toThrow();
  });

  it("collects nested bib files and merges all sources without duplicate keys", () => {
    expect(
      bibliographyPaths([
        {
          name: "refs",
          path: "refs",
          type: "directory",
          children: [
            { name: "lib.BIB", path: "refs/lib.BIB", type: "file" },
            { name: "paper.tex", path: "refs/paper.tex", type: "file" },
          ],
        },
      ]),
    ).toEqual(["refs/lib.BIB"]);
    const entries = indexBibliographies([
      ["first.bib", fixture],
      ["second.bib", "@article{smith2024,title={Duplicate}} @article{new,title={New paper}}"],
    ]);
    expect(entries).toHaveLength(4);
    expect(entries.find((entry) => entry.key === "smith2024")?.source).toBe("first.bib");
  });

  it("narrows by title words, author, year, or key and excludes already used keys", () => {
    const entries = parseBibliography(fixture, "refs.bib");
    expect(searchBibliography(entries, "", new Set())).toHaveLength(3);
    for (const query of ["deep learning", "LEARNING attention", "García", "2024", "smith"])
      expect(searchBibliography(entries, query, new Set()).map((entry) => entry.key)).toEqual([
        "smith2024",
      ]);
    expect(searchBibliography(entries, "한국어", new Set()).map((entry) => entry.key)).toEqual([
      "kim2025",
    ]);
    expect(searchBibliography(entries, "中文", new Set()).map((entry) => entry.key)).toEqual([
      "中文键",
    ]);
    expect(searchBibliography(entries, "smith", new Set(["smith2024"]))).toEqual([]);
  });
});

describe("citation argument context", () => {
  it("recognizes citation variants, stars, optional notes and multiline key lists", () => {
    for (const command of [
      "cite",
      "citep",
      "citet",
      "parencite",
      "textcite",
      "autocite",
      "Citeauthor",
    ])
      expect(citationContext(`\\${command}*[see][p. 2]{`, command.length + 16)?.query).toBe("");
    const text = "\\cite{smith2024,\n  deep learning}";
    const context = citationContext(text, text.indexOf("}"));
    expect(context?.query).toBe("deep learning");
    expect(context?.usedKeys.has("smith2024")).toBe(true);
    expect(text.slice(context?.start, context?.end)).toBe("deep learning");
  });

  it("replaces only the active key, including its suffix, without touching braces or other keys", () => {
    const text = "\\cite{smith2024, oldkey, next}";
    const context = citationContext(text, text.indexOf("oldkey") + 3);
    expect(text.slice(context?.start, context?.end)).toBe("oldkey");
    expect(context && `${text.slice(0, context.start)}kim2025${text.slice(context.end)}`).toBe(
      "\\cite{smith2024, kim2025, next}",
    );
  });

  it("ignores non-citation commands, closed citations, comments and escaped backslashes", () => {
    for (const text of ["\\ref{", "\\section{", "\\cite{done}", "% \\cite{", "\\\\cite{"])
      expect(citationContext(text, text.length)).toBeNull();
    const text = "Escaped \\% \\cite{";
    expect(citationContext(text, text.length)).not.toBeNull();
  });
});
