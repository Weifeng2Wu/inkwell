import { describe, expect, it } from "vitest";
import { bibtexLanguage } from "./bibtex-grammar";
import { tokenizeDocument, typeOf } from "./grammar-testing";

const tokens = (source: string) => tokenizeDocument(bibtexLanguage, source);

describe("BibTeX tokens", () => {
  it("tints entry types, keys and field names and leaves values as text", () => {
    const lines = tokens(
      [
        "% Exported from the library",
        "@InProceedings{vaswani2017attention,",
        "  title = {Attention Is {All} You Need},",
        '  author = "Vaswani, Ashish and M{\\"u}ller, Jakob",',
        "  year = 2017,",
        "  month = jun,",
        "}",
      ].join("\n"),
    );
    expect(lines[0]).toEqual([{ text: "% Exported from the library", type: "comment" }]);
    expect(lines[1]).toEqual([
      { text: "@InProceedings", type: "keyword" },
      { text: "{", type: "delimiter" },
      { text: "vaswani2017attention", type: "reference" },
      { text: ",", type: "delimiter" },
    ]);
    expect(lines[2]).toEqual([
      { text: "title", type: "attribute" },
      { text: "=", type: "delimiter" },
      { text: "{", type: "delimiter" },
      { text: "Attention Is ", type: "" },
      { text: "{", type: "delimiter" },
      { text: "All", type: "" },
      { text: "}", type: "delimiter" },
      { text: " You Need", type: "" },
      { text: "},", type: "delimiter" },
    ]);
    expect(typeOf(lines, "Vaswani, Ashish and M")).toBe("");
    expect(typeOf(lines, '\\"')).toBe("escape");
    expect(typeOf(lines, "2017")).toBe("");
    expect(typeOf(lines, "jun")).toBe("variable");
    expect(lines[6]).toEqual([{ text: "}", type: "delimiter" }]);
  });

  it("starts over at the next entry when a brace is missing", () => {
    const lines = tokens(
      ["@article{first,", "  title = {Unclosed,", "@book{second,", "  year = 2020}"].join("\n"),
    );
    expect(lines[2]).toEqual([
      { text: "@book", type: "keyword" },
      { text: "{", type: "delimiter" },
      { text: "second", type: "reference" },
      { text: ",", type: "delimiter" },
    ]);
    expect(typeOf(lines, "year")).toBe("attribute");
  });

  it("reads string macros and treats text between entries as a comment", () => {
    const lines = tokens(
      ['@string{nips = "NeurIPS"}', "stray text", "@comment{ignored {nested}}"].join("\n"),
    );
    expect(lines[0]?.map((span) => span.type)).toEqual([
      "keyword",
      "delimiter",
      "attribute",
      "delimiter",
      "delimiter",
      "",
      "delimiter",
    ]);
    expect(lines[1]).toEqual([{ text: "stray text", type: "comment" }]);
    expect(lines[2]).toEqual([{ text: "@comment{ignored {nested}}", type: "comment" }]);
  });
});
