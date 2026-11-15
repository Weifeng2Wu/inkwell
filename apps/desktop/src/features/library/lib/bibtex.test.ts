import { describe, expect, it } from "vitest";
import { parseBibliographyRecords } from "@/features/editor/lib/bibliography";
import {
  citationKey,
  EMPTY_METADATA,
  metadataFields,
  removeBibEntry,
  serializeBibEntry,
  setBibFields,
  upsertBibEntry,
} from "./bibtex";

const paper = {
  ...EMPTY_METADATA,
  type: "article",
  title: "On the Électrodynamics of Moving Bodies",
  authors: ["Einstein, Albert"],
  year: "1905",
  venue: "Annalen der Physik",
  pages: "891 – 921",
  doi: "10.1002/andp.19053221004",
};

describe("citationKey", () => {
  it("combines the first family name, year and first significant title word", () => {
    expect(citationKey(paper, new Set())).toBe("einstein1905electrodynamics");
  });

  it("appends letters until the key is unique", () => {
    const taken = new Set(["einstein1905electrodynamics", "einstein1905electrodynamicsa"]);
    expect(citationKey(paper, taken)).toBe("einstein1905electrodynamicsb");
  });

  it("falls back to a generic key without usable metadata", () => {
    expect(citationKey({ ...EMPTY_METADATA, title: "深度学习" }, new Set())).toBe("paper");
  });
});

describe("serializeBibEntry", () => {
  it("writes entries that the bibliography parser reads back", () => {
    const text = serializeBibEntry({ type: "article", key: "k", fields: metadataFields(paper) });
    const [entry] = parseBibliographyRecords(text);
    expect(entry).toMatchObject({ type: "article", key: "k" });
    expect(entry?.fields).toMatchObject({
      author: "Einstein, Albert",
      journal: "Annalen der Physik",
      pages: "891--921",
      doi: "10.1002/andp.19053221004",
    });
    expect(entry?.fields.volume).toBeUndefined();
  });

  it("escapes LaTeX specials in text but keeps identifiers verbatim", () => {
    const text = serializeBibEntry({
      type: "misc",
      key: "k",
      fields: { title: "R&D: 50% of {GPU}s \\& more", url: "https://e.org/a_b#c%20d" },
    });
    expect(text).toContain("title = {R\\&D: 50\\% of {GPU}s \\& more},");
    expect(text).toContain("url = {https://e.org/a_b#c%20d},");
  });

  it("drops unbalanced braces so a value cannot break the file", () => {
    const text = serializeBibEntry({ type: "misc", key: "k", fields: { title: "Open { brace" } });
    expect(parseBibliographyRecords(`${text}\n@misc{next, title = {Next}}`)).toHaveLength(2);
  });

  it("uses booktitle for conference papers", () => {
    expect(metadataFields({ ...paper, type: "inproceedings" }).booktitle).toBe(paper.venue);
  });
});

describe("editing a bibliography", () => {
  const file =
    "% my refs\n@string{jan = {January}}\n\n@article{a, title = {A}}\n\n@book{b,\n  title = {B},\n}\n";

  it("appends new entries and leaves existing text untouched", () => {
    const next = upsertBibEntry(file, { type: "misc", key: "c", fields: { title: "C" } });
    expect(next.startsWith(file.trimEnd())).toBe(true);
    expect(parseBibliographyRecords(next).map((entry) => entry.key)).toEqual(["a", "b", "c"]);
    expect(upsertBibEntry("", { type: "misc", key: "c", fields: { title: "C" } })).toBe(
      "@misc{c,\n  title = {C},\n}\n",
    );
  });

  it("updates and removes fields of one entry in place", () => {
    const next = setBibFields(file, "a", { readstatus: "read", title: "" });
    const [a, b] = parseBibliographyRecords(next);
    expect(a?.fields).toEqual({ readstatus: "read" });
    expect(b?.fields.title).toBe("B");
    expect(next).toContain("% my refs\n@string{jan = {January}}");
    expect(setBibFields(file, "missing", { title: "X" })).toBe(file);
  });

  it("removes only the requested entry", () => {
    const next = removeBibEntry(file, "a");
    expect(parseBibliographyRecords(next).map((entry) => entry.key)).toEqual(["b"]);
    expect(next).toContain("@string{jan = {January}}");
    expect(removeBibEntry(file, "missing")).toBe(file);
  });
});
