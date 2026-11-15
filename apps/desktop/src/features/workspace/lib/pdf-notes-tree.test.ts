import { describe, expect, it } from "vitest";
import type { FileNode } from "@/types/files";
import { nestPdfNotes } from "./pdf-notes-tree";

const file = (path: string): FileNode => ({
  name: path.split("/").pop() ?? path,
  path,
  type: "file",
});
const tree: FileNode[] = [
  {
    name: "papers",
    path: "papers",
    type: "directory",
    children: [file("papers/a.pdf"), file("papers/a.pdf.notes.md"), file("papers/b.pdf")],
  },
  file("main.tex"),
  file("lost.pdf.notes.md"),
];
const names = (nodes: FileNode[] | undefined) => nodes?.map((node) => node.name);

describe("PDF notes in the file tree", () => {
  it("hides a sidecar while its PDF is closed", () => {
    const [papers] = nestPdfNotes(tree, new Set());
    expect(names(papers?.children)).toEqual(["a.pdf", "b.pdf"]);
    expect(papers?.children?.[0]?.children).toBeUndefined();
  });

  it("lists the sidecar under its PDF while either of them is open", () => {
    for (const open of ["papers/a.pdf", "papers/a.pdf.notes.md"]) {
      const [papers] = nestPdfNotes(tree, new Set([open]));
      expect(names(papers?.children)).toEqual(["a.pdf", "b.pdf"]);
      expect(papers?.children?.[0]).toMatchObject({ type: "file", path: "papers/a.pdf" });
      expect(papers?.children?.[0]?.children).toEqual([file("papers/a.pdf.notes.md")]);
      expect(papers?.children?.[1]?.children).toBeUndefined();
    }
  });

  it("keeps notes without a PDF beside them as ordinary files", () => {
    expect(names(nestPdfNotes(tree, new Set()))).toEqual([
      "papers",
      "main.tex",
      "lost.pdf.notes.md",
    ]);
  });
});
