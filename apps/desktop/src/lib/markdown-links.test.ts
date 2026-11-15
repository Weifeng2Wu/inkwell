import { describe, expect, it } from "vitest";
import {
  extractDocumentLinks,
  isLocalDocumentLink,
  markdownHeadingLine,
  transformWikiLinks,
  wikiLinkTargetFromHref,
} from "./markdown-links";

describe("Markdown document links", () => {
  it("parses wiki targets, aliases, Unicode and heading fragments without changing their values", () => {
    expect(
      extractDocumentLinks("[[方法]] [[实验 (一).md#结果|实验结果]] [[notes/研究|**研究**]]"),
    ).toEqual([
      { target: "方法", label: "方法", kind: "wiki" },
      { target: "实验 (一).md#结果", label: "实验结果", kind: "wiki" },
      { target: "notes/研究", label: "**研究**", kind: "wiki" },
    ]);
  });

  it("ignores frontmatter, code, math, HTML blocks, comments, images and escaped wiki syntax", () => {
    const text = [
      "---",
      "title: '[[metadata]]'",
      "---",
      "",
      "```md",
      "[[fenced]]",
      "```",
      "",
      "    [[indented]]",
      "",
      "`[[inline]]`",
      "",
      "$[[inlineMath]]$",
      "",
      "$$",
      "[[displayMath]]",
      "$$",
      "",
      "<!-- [[comment]] -->",
      "",
      "<div>[[html]]</div>",
      "",
      "![[embed]] ![image](picture.png) \\[[escaped]]",
      "",
      "[[real]]",
    ].join("\r\n");
    expect(extractDocumentLinks(text)).toEqual([{ target: "real", label: "real", kind: "wiki" }]);
  });

  it("handles reference links and excludes wiki syntax inside existing links", () => {
    expect(
      extractDocumentLinks(
        "[Title][note]\n\n[note]: ./notes/target.md#result\n\n[[[literal]]](other.md)\n\n![plot][image]\n\n[image]: figure.png",
      ),
    ).toEqual([
      { target: "./notes/target.md#result", label: "Title", kind: "markdown" },
      { target: "other.md", label: "[[literal]]", kind: "markdown" },
    ]);
  });

  it("supports escaped alias delimiters in GFM tables", () => {
    expect(extractDocumentLinks("| Note |\n| --- |\n| [[target\\|Title]] |")).toEqual([
      { target: "target", label: "Title", kind: "wiki" },
    ]);
  });

  it("keeps encoded marker targets intact and rejects malformed markers", () => {
    const transformed = transformWikiLinks("[[a)b(c.md|safe <label>]]");
    expect(transformed).toContain("a%29b%28c.md");
    expect(wikiLinkTargetFromHref("#inkwell-wiki=%E7%A0%94%E7%A9%B6")).toBe("研究");
    expect(wikiLinkTargetFromHref("#inkwell-wiki=%ZZ")).toBeUndefined();
    expect(wikiLinkTargetFromHref("https://example.com")).toBeUndefined();
  });

  it("identifies local Markdown and PDF URLs consistently with encoded paths", () => {
    for (const href of [
      "note.md#results",
      "a%20b%2Emd",
      "../note.MARKDOWN",
      "#结果",
      "papers/研究%20结果.PDF#page=3",
      "paper%2Epdf",
    ])
      expect(isLocalDocumentLink(href)).toBe(true);
    for (const href of [
      "https://example.com/note.md",
      "//example.com/note.md",
      "file:///note.md",
      "figure.png",
      "%ZZ.md",
    ])
      expect(isLocalDocumentLink(href)).toBe(false);
  });

  it("locates headings by text or Unicode slug and counts duplicate slugs", () => {
    const text =
      "---\r\ntitle: Heading\r\n---\r\n# 研究 **方法**\r\n\r\n## Results\r\n\r\n## Results\r\n\r\n```md\r\n# Fake\r\n```";
    expect(markdownHeadingLine(text, "研究 方法")).toBe(4);
    expect(markdownHeadingLine(text, "研究-方法")).toBe(4);
    expect(markdownHeadingLine(text, "results-1")).toBe(8);
    expect(markdownHeadingLine(text, "Fake")).toBeUndefined();
  });
});
