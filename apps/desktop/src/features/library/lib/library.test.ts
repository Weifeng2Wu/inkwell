import { describe, expect, it } from "vitest";
import {
  bibliographyTarget,
  buildLibrary,
  citationText,
  type LibraryItem,
  nextReadingStatus,
  parseSortOrder,
  quotationText,
  readingDigest,
  referenceLinks,
  searchLibrary,
  shortAuthors,
  sortLibrary,
} from "./library";

const refs = `
@inproceedings{vaswani2017attention,
  title = {Attention Is {All} You Need},
  author = {Vaswani, Ashish and Shazeer, Noam},
  booktitle = {NeurIPS},
  year = {2017},
  eprint = {1706.03762},
  archiveprefix = {arXiv},
  keywords = {transformers; nlp},
  readstatus = {skimmed},
  file = {:papers/Attention.pdf:PDF},
}
@article{lecun2015deep, title = {Deep Learning}, author = {Yann LeCun}, year = 2015,
  doi = {10.1038/nature14539}, readstatus = {read}, file = {missing.pdf}}
`;
const paths = [
  "main.pdf",
  "papers/attention.pdf",
  "papers/attention.pdf.notes.md",
  "papers/new.pdf",
  "refs/extra.bib",
];

describe("buildLibrary", () => {
  const library = buildLibrary(
    [
      ["references.bib", refs],
      [
        "refs/extra.bib",
        "@misc{lecun2015deep, title = {Duplicate}}\n@misc{x, file = {../papers/new.pdf}}",
      ],
    ],
    paths,
  );

  it("reads entries with their linked PDFs, notes, status and tags", () => {
    expect(library.items.map((item) => item.key)).toEqual([
      "vaswani2017attention",
      "lecun2015deep",
      "x",
    ]);
    expect(library.items[0]).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      venue: "NeurIPS",
      arxiv: "1706.03762",
      tags: ["transformers", "nlp"],
      status: "reading",
      source: "references.bib",
      file: "papers/attention.pdf",
      notes: "papers/attention.pdf.notes.md",
    });
    expect(library.items[1]).toMatchObject({
      title: "Deep Learning",
      status: "read",
      file: undefined,
    });
  });

  it("discovers unlinked PDFs throughout the project", () => {
    expect(library.unlinked).toEqual(["main.pdf", "papers/new.pdf"]);
    expect(buildLibrary([], paths).unlinked).toEqual([
      "main.pdf",
      "papers/attention.pdf",
      "papers/new.pdf",
    ]);
    expect(
      buildLibrary([], ["Readings/nested/Paper.PDF", "draft.md", "refs.bib"]).unlinked,
    ).toEqual(["Readings/nested/Paper.PDF"]);
  });

  it("searches across fields and filters by status", () => {
    const keys = (query: string, status: Parameters<typeof searchLibrary>[2] = "all") =>
      searchLibrary(library.items, query, status).map((item) => item.key);
    expect(keys("vaswani NEURIPS")).toEqual(["vaswani2017attention"]);
    expect(keys("nlp")).toEqual(["vaswani2017attention"]);
    expect(keys("", "read")).toEqual(["lecun2015deep"]);
    expect(keys("attention", "read")).toEqual([]);
  });

  it("filters by an exact tag, ignoring case and accents", () => {
    const keys = (tag: string | null, query = "") =>
      searchLibrary(library.items, query, "all", tag).map((item) => item.key);
    expect(keys("NLP")).toEqual(["vaswani2017attention"]);
    expect(keys("nl")).toEqual([]);
    expect(keys("nlp", "lecun")).toEqual([]);
    expect(keys(null)).toHaveLength(library.items.length);
  });

  it("abbreviates author lists", () => {
    expect(library.items.map(shortAuthors)).toEqual(["Vaswani et al.", "LeCun", ""]);
  });
});

describe("sortLibrary", () => {
  const entry = (key: string, title: string, author: string, year: string) =>
    ({ key, title, authors: author ? [author] : [], year }) as LibraryItem;
  const items = [
    entry("a", "Zebra", "Ada Young", "2019"),
    entry("b", "apple", "Bo de Álvarez", "2021"),
    entry("c", "", "", ""),
    entry("d", "Mango 10", "Cy Brown", "2021"),
    entry("e", "Mango 9", "Di brown", "in press"),
  ];
  const keys = (order: Parameters<typeof sortLibrary>[1]) =>
    sortLibrary(items, order)
      .map((item) => item.key)
      .join("");

  it("puts the most recently added first without changing the input", () => {
    expect(keys("added")).toBe("edcba");
    expect(items.map((item) => item.key).join("")).toBe("abcde");
  });

  it("sorts by year, newest first, with undated entries last", () => {
    expect(keys("year")).toBe("dbaec");
  });

  it("sorts by first author's family name and by title, blanks last", () => {
    expect(keys("author")).toBe("bedac");
    expect(keys("title")).toBe("bedac");
  });

  it("reads the saved order and falls back to most recently added", () => {
    expect(parseSortOrder("year")).toBe("year");
    expect(parseSortOrder("citations")).toBe("added");
    expect(parseSortOrder(null)).toBe("added");
  });
});

describe("reading status and links", () => {
  it("cycles unread, reading, read and back", () => {
    expect(nextReadingStatus("unread")).toBe("reading");
    expect(nextReadingStatus("reading")).toBe("read");
    expect(nextReadingStatus("read")).toBe("unread");
  });

  it("links the DOI and arXiv page, and another URL only when it adds something", () => {
    expect(
      referenceLinks({ doi: "10.1/x", arxiv: "1706.03762", url: "https://doi.org/10.1/x" }),
    ).toEqual([
      { kind: "doi", label: "10.1/x", url: "https://doi.org/10.1/x" },
      { kind: "arxiv", label: "arXiv:1706.03762", url: "https://arxiv.org/abs/1706.03762" },
    ]);
    expect(referenceLinks({ doi: "", arxiv: "", url: "https://www.example.org/paper/" })).toEqual([
      { kind: "url", label: "example.org/paper", url: "https://www.example.org/paper/" },
    ]);
    expect(referenceLinks({ doi: "", arxiv: "", url: "javascript:alert(1)" })).toEqual([]);
  });
});

describe("citations", () => {
  it("formats the citation for the target document", () => {
    expect(citationText("k", "latex")).toBe("\\cite{k}");
    expect(citationText("k", "markdown")).toBe("[@k]");
    expect(citationText("k", "plaintext")).toBe("k");
  });

  it("formats a quotation with its citation", () => {
    expect(quotationText(" 50% of\n  {runs} ", "k", "latex")).toBe("``50\\% of runs'' \\cite{k}");
    expect(quotationText("a  b", "k", "markdown")).toBe("> a b [@k]\n");
    expect(quotationText("a b", undefined, "markdown")).toBe("> a b\n");
    expect(quotationText("a b", undefined, "plaintext")).toBe('"a b"');
  });

  it("prefers references.bib, then the first bibliography", () => {
    expect(bibliographyTarget(["z.bib", "references.bib"])).toBe("references.bib");
    expect(bibliographyTarget(["z.bib", "a/b.bib"])).toBe("a/b.bib");
    expect(bibliographyTarget([])).toBe("references.bib");
  });
});

describe("readingDigest", () => {
  it("collects annotations per paper in page order and skips papers without any", () => {
    const [first, second] = buildLibrary([["references.bib", refs]], paths).items;
    if (!first || !second) throw new Error("fixture");
    const annotation = { id: "1", kind: "highlight" as const, fingerprint: "f", rects: [] };
    const digest = readingDigest("Digest", [
      {
        item: first,
        annotations: [
          { ...annotation, page: 5, quote: "later\nline", note: "" },
          { ...annotation, page: 2, quote: "earlier", note: "My **comment**" },
        ],
      },
      { item: second, annotations: [] },
    ]);
    expect(digest).toBe(
      "# Digest\n\n## Attention Is All You Need\n\n`vaswani2017attention` · Vaswani et al., 2017\n\n" +
        "[[papers/attention.pdf]]\n\n> earlier\n> — p. 2\n\nMy **comment**\n\n> later\n> line\n> — p. 5\n",
    );
  });
});
