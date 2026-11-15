import { describe, expect, it } from "vitest";
import {
  buildMarkdownGraph,
  graphFilePaths,
  normalizeNotePath,
  resolveDocumentLink,
} from "./markdown-links";

const paths = [
  "index.md",
  "shared.md",
  "notes/index.md",
  "notes/shared.md",
  "other/shared.md",
  "other/研究 结果.markdown",
  "only.mdown",
];

describe("PDF graph documents", () => {
  it("resolves explicit PDF links and requires an extension when Markdown and PDF names collide", () => {
    const documents = ["index.md", "paper.md", "paper.pdf", "papers/研究 结果.PDF"];
    expect(resolveDocumentLink("paper", "index.md", documents).status).toBe("ambiguous");
    expect(resolveDocumentLink("paper.pdf", "index.md", documents)).toMatchObject({
      status: "resolved",
      path: "paper.pdf",
    });
    expect(
      resolveDocumentLink("papers/研究%20结果.PDF#page=3", "index.md", documents, "markdown"),
    ).toEqual({ status: "resolved", path: "papers/研究 结果.PDF", heading: "page=3" });
    expect(resolveDocumentLink("PAPER.PDF", "index.md", documents, "wiki", true)).toMatchObject({
      status: "resolved",
      path: "paper.pdf",
    });
  });

  it("includes disconnected PDFs and links notes to PDFs without parsing binary content", () => {
    const graph = buildMarkdownGraph(
      new Map([
        ["index.md", "[[papers/paper.pdf]] [again](papers/paper.pdf) [missing](absent.pdf)"],
        ["papers/paper.pdf", "[[must-not-be-parsed]]"],
        ["papers/paper.pdf.notes.md", "[[index]] [PDF](paper.pdf)"],
        ["isolated.pdf", ""],
      ]),
    );
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.find((node) => node.path === "papers/paper.pdf")).toMatchObject({
      kind: "pdf",
      incoming: ["index.md", "papers/paper.pdf.notes.md"],
      outgoing: [],
      unresolved: [],
    });
    expect(graph.nodes.find((node) => node.path === "index.md")?.unresolved).toEqual([
      "absent.pdf",
    ]);
    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes.find((node) => node.path === "isolated.pdf")).toMatchObject({
      kind: "pdf",
      incoming: [],
      outgoing: [],
    });
  });

  it("pairs an existing PDF sidecar even without an explicit link", () => {
    const sources = new Map([
      ["paper.pdf", ""],
      ["PAPER.PDF.notes.md", "# Reading notes"],
    ]);
    expect(buildMarkdownGraph(sources, true).edges).toEqual([
      { source: "PAPER.PDF.notes.md", target: "paper.pdf" },
    ]);
    expect(buildMarkdownGraph(sources, false).edges).toEqual([]);
    expect(buildMarkdownGraph(new Map([["missing.pdf.notes.md", ""]])).nodes).toHaveLength(1);
  });
});

describe("project Markdown link resolution", () => {
  it("prefers siblings, resolves folder paths from the root, and supports explicit relative links", () => {
    expect(resolveDocumentLink("shared", "notes/index.md", paths)).toMatchObject({
      status: "resolved",
      path: "notes/shared.md",
    });
    expect(resolveDocumentLink("../shared", "notes/index.md", paths)).toMatchObject({
      status: "resolved",
      path: "shared.md",
    });
    expect(resolveDocumentLink("other/研究 结果", "notes/index.md", paths)).toMatchObject({
      status: "resolved",
      path: "other/研究 结果.markdown",
    });
    expect(resolveDocumentLink("only", "notes/index.md", paths)).toMatchObject({
      status: "resolved",
      path: "only.mdown",
    });
    expect(resolveDocumentLink("/index.md", "notes/index.md", paths)).toMatchObject({
      status: "resolved",
      path: "index.md",
    });
  });

  it("never guesses between ambiguous basenames or extensions", () => {
    expect(
      resolveDocumentLink(
        "shared",
        "other/研究 结果.markdown",
        paths.filter((path) => path !== "other/shared.md"),
      ),
    ).toMatchObject({ status: "ambiguous", candidates: ["shared.md", "notes/shared.md"] });
    expect(resolveDocumentLink("note", "index.md", ["note.md", "note.markdown"])).toMatchObject({
      status: "ambiguous",
    });
    expect(resolveDocumentLink("note.md", "index.md", ["note.md", "note.markdown"])).toMatchObject({
      status: "resolved",
      path: "note.md",
    });
  });

  it("resolves Markdown URLs relative to the source, including encoded Unicode and headings", () => {
    expect(
      resolveDocumentLink(
        "../other/%E7%A0%94%E7%A9%B6%20%E7%BB%93%E6%9E%9C.markdown#%E7%BB%93%E6%9E%9C",
        "notes/index.md",
        paths,
        "markdown",
      ),
    ).toEqual({ status: "resolved", path: "other/研究 结果.markdown", heading: "结果" });
    expect(resolveDocumentLink("other/shared.md", "notes/index.md", paths, "markdown").status).toBe(
      "missing",
    );
    expect(resolveDocumentLink("#results", "notes/index.md", paths, "markdown")).toEqual({
      status: "resolved",
      path: "notes/index.md",
      heading: "results",
    });
  });

  it("uses case-insensitive matching only for Windows projects", () => {
    expect(resolveDocumentLink("SHARED.MD", "notes/index.md", paths).status).toBe("missing");
    expect(resolveDocumentLink("SHARED.MD", "notes/index.md", paths, "wiki", true)).toMatchObject({
      status: "resolved",
      path: "notes/shared.md",
    });
    expect(resolveDocumentLink("notes\\shared.md", "index.md", paths)).toMatchObject({
      status: "resolved",
      path: "notes/shared.md",
    });
  });

  it("rejects malformed paths and traversal outside the workspace", () => {
    for (const target of [
      "../../shared.md",
      "%2E%2E/%2E%2E/shared.md",
      "%ZZ.md",
      "%00.md",
      "%43%3A/file.md",
    ])
      expect(resolveDocumentLink(target, "notes/index.md", paths).status).toBe("invalid");
    for (const target of [
      "https://example.com/shared.md",
      "//server/share.md",
      "file:///shared.md",
      "javascript:alert(1)",
    ])
      expect(resolveDocumentLink(target, "index.md", paths).status).toBe("external");
    for (const path of ["/tmp/note.md", "\\server\\note.md", "../note.md", "C:\\note.md"])
      expect(normalizeNotePath(path)).toBeUndefined();
  });

  it("collects Markdown and PDF files from the file tree", () => {
    expect(
      graphFilePaths([
        {
          name: "notes",
          path: "notes",
          type: "directory",
          children: [
            { name: "note.MD", path: "notes\\note.MD", type: "file" },
            { name: "plot.png", path: "notes/plot.png", type: "file" },
            { name: "paper.PDF", path: "notes/paper.PDF", type: "file" },
            { name: "directory.md", path: "notes/directory.md", type: "directory" },
          ],
        },
      ]),
    ).toEqual(["notes/note.MD", "notes/paper.PDF"]);
  });

  it("deduplicates edges and backlinks while retaining disconnected and unreadable notes", () => {
    const graph = buildMarkdownGraph(
      new Map([
        [
          "index.md",
          "[[note]] [[note#Result|again]] [note](note.md) [[index]] [[missing]] [bad](absent%2Emd) [external](https://example.com/a.md) ![picture](figure.png)",
        ],
        ["note.md", "[[index]]"],
        ["isolated.md", ""],
      ]),
    );
    expect(graph.edges).toEqual([
      { source: "index.md", target: "note.md" },
      { source: "note.md", target: "index.md" },
    ]);
    expect(graph.nodes.find((node) => node.path === "index.md")).toMatchObject({
      incoming: ["note.md"],
      outgoing: ["note.md"],
      unresolved: ["missing", "absent%2Emd"],
    });
    expect(graph.nodes.find((node) => node.path === "isolated.md")).toMatchObject({
      incoming: [],
      outgoing: [],
    });
  });
});
