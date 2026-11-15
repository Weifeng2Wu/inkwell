import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, convertFileSrc: vi.fn() }));
vi.mock("@/lib/path", () => ({ join: vi.fn(), pathSync: { dirname: () => "." } }));

import {
  addReference,
  identifyPdf,
  lookupIdentifier,
  removeReference,
  updateReference,
} from "./actions";
import { EMPTY_METADATA } from "./bibtex";
import { buildLibrary } from "./library";

const crossref = (...titles: string[]) =>
  JSON.stringify({ message: { items: titles.map((title) => ({ title: [title], DOI: title })) } });

function project(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  return {
    disk,
    files: {
      projectPath: "/project",
      readFile: async (path: string) => {
        if (!disk.has(path)) throw new Error(`FILE_NOT_FOUND:${path}`);
        return disk.get(path) ?? null;
      },
      writeFile: async (path: string, content: string) => void disk.set(path, content),
    },
    library: () => buildLibrary(disk, ["papers/a.pdf", "papers/b.pdf"]).items,
  };
}
const paper = { ...EMPTY_METADATA, title: "Deep Learning", authors: ["LeCun, Yann"], year: "2015" };

beforeEach(() => {
  mock.invoke.mockReset();
});

describe("addReference", () => {
  it("creates references.bib and links the PDF", async () => {
    const { files, disk, library } = project();
    const key = await addReference(files, [], [], { metadata: paper, file: "papers/a.pdf" });
    expect(key).toBe("lecun2015deep");
    expect([...disk.keys()]).toEqual(["references.bib"]);
    expect(library()[0]).toMatchObject({ key, title: "Deep Learning", file: "papers/a.pdf" });
  });

  it("generates a distinct key for a different paper with the same author and year", async () => {
    const { files, library } = project({ "refs.bib": "@misc{lecun2015deep, title = {Other}}\n" });
    const key = await addReference(files, library(), ["refs.bib"], { metadata: paper });
    expect(key).toBe("lecun2015deepa");
    expect(library().map((item) => item.key)).toEqual(["lecun2015deep", "lecun2015deepa"]);
  });

  it("links a PDF to the existing entry instead of duplicating a known DOI", async () => {
    const { files, disk, library } = project({
      "references.bib": "@article{known, title = {Deep Learning}, doi = {10.1038/NATURE14539}}\n",
    });
    const key = await addReference(files, library(), ["references.bib"], {
      metadata: { ...paper, doi: "10.1038/nature14539" },
      file: "papers/b.pdf",
    });
    expect(key).toBe("known");
    expect(library()).toHaveLength(1);
    expect(library()[0]?.file).toBe("papers/b.pdf");
    expect(disk.get("references.bib")).toContain("doi = {10.1038/NATURE14539}");
  });

  it("adds pasted BibTeX, renaming a key that is already taken", async () => {
    const { files, library } = project({ "references.bib": "@misc{smith, title = {First}}\n" });
    const bibtex = "@book{smith, title = {Second}, publisher = {MIT Press}}";
    expect(await addReference(files, library(), ["references.bib"], { bibtex })).toBe("smitha");
    expect(library()[1]).toMatchObject({ key: "smitha", type: "book", title: "Second" });
    await expect(addReference(files, [], [], { bibtex: "not bibtex" })).rejects.toThrow(
      "LIBRARY_INVALID_BIBTEX",
    );
  });
});

describe("editing references", () => {
  it("updates and removes an entry in the file that defines it", async () => {
    const { files, disk, library } = project({
      "references.bib": "@misc{a, title = {A}}\n",
      "extra.bib": "@misc{b, title = {B}, readstatus = {read}}\n",
    });
    const b = library().find((item) => item.key === "b");
    if (!b) throw new Error("fixture");
    await updateReference(files, b, { readstatus: "", file: "papers/b.pdf" });
    expect(library().find((item) => item.key === "b")).toMatchObject({
      status: "unread",
      file: "papers/b.pdf",
    });
    await removeReference(files, b);
    expect(disk.get("extra.bib")?.trim()).toBe("");
    expect(disk.get("references.bib")).toBe("@misc{a, title = {A}}\n");
  });
});

describe("online lookup", () => {
  it("queries the service that matches the identifier", async () => {
    mock.invoke.mockResolvedValue(crossref("Found"));
    await lookupIdentifier({ kind: "doi", value: "10.1/x" });
    expect(mock.invoke).toHaveBeenCalledWith("library_lookup", {
      source: "crossref-doi",
      query: "10.1/x",
    });
  });

  it("treats a missing record as no result but reports network failures", async () => {
    mock.invoke.mockRejectedValueOnce("LIBRARY_NOT_FOUND");
    expect(await lookupIdentifier({ kind: "doi", value: "10.1/x" })).toEqual([]);
    mock.invoke.mockRejectedValue("LIBRARY_LOOKUP_FAILED");
    await expect(lookupIdentifier({ kind: "doi", value: "10.1/x" })).rejects.toBe(
      "LIBRARY_LOOKUP_FAILED",
    );
    await expect(lookupIdentifier({ kind: "title", value: "x" })).rejects.toBe(
      "LIBRARY_LOOKUP_FAILED",
    );
  });

  it("ranks title candidates from both services by similarity", async () => {
    mock.invoke.mockImplementation(async (_command, { source }) =>
      source === "crossref-title"
        ? crossref("Graph Networks", "Attention Is All You Need")
        : "<feed/>",
    );
    const found = await lookupIdentifier({ kind: "title", value: "attention is all you need" });
    expect(found.map((candidate) => candidate.title)).toEqual([
      "Attention Is All You Need",
      "Graph Networks",
    ]);
  });

  it("accepts a title search only when the best candidate closely matches", async () => {
    mock.invoke.mockImplementation(async (_command, { source }) =>
      source === "crossref-title" ? crossref("A Survey of Graph Networks") : "<feed/>",
    );
    const hints = { doi: "", arxiv: "" };
    expect(await identifyPdf({ ...hints, title: "Attention Is All You Need" })).toBeNull();
    expect((await identifyPdf({ ...hints, title: "a survey of graph networks" }))?.title).toBe(
      "A Survey of Graph Networks",
    );
    expect(await identifyPdf({ ...hints, title: "" })).toBeNull();
  });

  it("prefers the DOI printed in the PDF over a title search", async () => {
    mock.invoke.mockResolvedValue(
      JSON.stringify({ message: { title: ["By DOI"], DOI: "10.1/x" } }),
    );
    const found = await identifyPdf({ doi: "10.1/x", arxiv: "1706.03762", title: "Other" });
    expect(found?.title).toBe("By DOI");
    expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
});
