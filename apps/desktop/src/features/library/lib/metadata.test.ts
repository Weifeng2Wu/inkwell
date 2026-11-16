// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  findArxivId,
  findDoi,
  guessTitle,
  parseIdentifier,
  parseLookupResponse,
  pdfFilenameHints,
  titleSimilarity,
} from "./metadata";

describe("identifiers", () => {
  it("finds DOIs and strips trailing punctuation", () => {
    expect(findDoi("see https://doi.org/10.1038/s41586-021-03819-2.")).toBe(
      "10.1038/s41586-021-03819-2",
    );
    expect(findDoi("(doi:10.1145/3292500.3330701)")).toBe("10.1145/3292500.3330701");
    expect(findDoi("no identifier here 10.5 apples")).toBe("");
  });

  it("finds arXiv ids in stamps and URLs", () => {
    expect(findArxivId("arXiv:1706.03762v5 [cs.CL] 6 Dec 2017")).toBe("1706.03762");
    expect(findArxivId("https://arxiv.org/pdf/2301.00001")).toBe("2301.00001");
    expect(findArxivId("arXiv:hep-th/9901001")).toBe("hep-th/9901001");
    expect(findArxivId("published in 2017.03762 copies")).toBe("");
  });

  it("classifies pasted input", () => {
    expect(parseIdentifier("  ")).toBeNull();
    expect(parseIdentifier("@article{a, title={T}}")?.kind).toBe("bibtex");
    expect(parseIdentifier("10.1000/xyz")).toEqual({ kind: "doi", value: "10.1000/xyz" });
    expect(parseIdentifier("1706.03762v5")).toEqual({ kind: "arxiv", value: "1706.03762" });
    expect(parseIdentifier("https://doi.org/10.48550/arXiv.1706.03762")).toEqual({
      kind: "arxiv",
      value: "1706.03762",
    });
    expect(parseIdentifier("Attention  is all\nyou need")).toEqual({
      kind: "title",
      value: "Attention is all you need",
    });
  });

  it("extracts filename hints from nested and Windows PDF paths", () => {
    expect(pdfFilenameHints("readings/Attention_Is_All_You_Need.PDF")).toEqual({
      title: "Attention Is All You Need",
      doi: "",
      arxiv: "",
    });
    expect(pdfFilenameHints("C:\\Research\\1706.03762v7.pdf")).toEqual({
      title: "",
      doi: "",
      arxiv: "1706.03762",
    });
    expect(pdfFilenameHints("papers/notes.pdf")).toEqual({ title: "notes", doi: "", arxiv: "" });
    expect(pdfFilenameHints("papers/.pdf")).toEqual({ title: "", doi: "", arxiv: "" });
  });
});

describe("parseLookupResponse", () => {
  const work = {
    type: "proceedings-article",
    title: ["Deep Residual Learning"],
    author: [{ family: "He", given: "Kaiming" }, { name: "Vision Group" }, {}],
    "published-print": { "date-parts": [[2016, 6]] },
    issued: { "date-parts": [[2015]] },
    "container-title": ["CVPR"],
    page: "770-778",
    DOI: "10.1109/CVPR.2016.90",
  };

  it("reads a single Crossref work", () => {
    const [paper] = parseLookupResponse("crossref-doi", JSON.stringify({ message: work }));
    expect(paper).toMatchObject({
      type: "inproceedings",
      title: "Deep Residual Learning",
      authors: ["He, Kaiming", "Vision Group"],
      year: "2016",
      venue: "CVPR",
      doi: "10.1109/CVPR.2016.90",
    });
  });

  it("reads Crossref search results and skips untitled works", () => {
    const body = JSON.stringify({ message: { items: [work, { title: [] }] } });
    expect(parseLookupResponse("crossref-title", body)).toHaveLength(1);
  });

  it("reads arXiv Atom entries", () => {
    const body = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
        <entry>
          <id>http://arxiv.org/abs/1706.03762v7</id>
          <published>2017-06-12T17:57:34Z</published>
          <title>Attention Is All
            You Need</title>
          <author><name>Ashish Vaswani</name></author>
          <author><name>Aidan N. Gomez</name></author>
          <arxiv:doi>10.5555/3295222</arxiv:doi>
        </entry>
      </feed>`;
    expect(parseLookupResponse("arxiv-id", body)).toEqual([
      expect.objectContaining({
        type: "misc",
        title: "Attention Is All You Need",
        authors: ["Vaswani, Ashish", "Gomez, Aidan N."],
        year: "2017",
        arxiv: "1706.03762",
        doi: "10.5555/3295222",
        url: "https://arxiv.org/abs/1706.03762",
      }),
    ]);
  });

  it("returns no candidates for malformed or empty responses", () => {
    expect(parseLookupResponse("crossref-doi", "<html>error</html>")).toEqual([]);
    expect(parseLookupResponse("crossref-doi", "{}")).toEqual([]);
    expect(parseLookupResponse("arxiv-id", "<feed></feed>")).toEqual([]);
  });
});

describe("titles", () => {
  it("scores similarity independent of case, accents and punctuation", () => {
    expect(titleSimilarity("Attention Is All You Need", "attention is all you need.")).toBe(1);
    expect(
      titleSimilarity("Attention Is All You Need", "Attention Is Not All You Need"),
    ).toBeLessThan(0.9);
    expect(titleSimilarity("", "anything")).toBe(0);
  });

  it("picks the largest text on the first page as the title", () => {
    expect(
      guessTitle([
        { text: "arXiv:1706.03762v5", height: 20 },
        { text: "Attention Is All", height: 17.2 },
        { text: "You Need", height: 17.2 },
        { text: "Ashish Vaswani, Noam Shazeer and others", height: 10 },
      ]),
    ).toBe("Attention Is All You Need");
    expect(guessTitle([{ text: "12", height: 30 }])).toBe("");
  });
});
