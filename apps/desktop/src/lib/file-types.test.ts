import { describe, expect, it } from "vitest";
import { fileDisplayName, fileLanguage, fileType, visualDocumentKind } from "./file-types";

describe("file types", () => {
  it("classifies previews by extension, ignoring case", () => {
    expect(fileType("papers/A.PDF")).toBe("pdf");
    expect(fileType("fig/plot.Png")).toBe("image");
    expect(fileType("main.tex")).toBe("text");
    expect(fileType("papers/a.pdf.notes.md")).toBe("text");
    expect(fileType("figures/diagram.excalidraw")).toBe("text");
    expect(fileType("notes/research.mindmap.md")).toBe("text");
    expect(fileType("Makefile")).toBe("text");
  });

  it("maps extensions to Monaco languages", () => {
    expect(fileLanguage("main.tex")).toBe("latex");
    expect(fileLanguage("style.CLS")).toBe("latex");
    expect(fileLanguage("refs.bib")).toBe("bibtex");
    expect(fileLanguage("notes.markdown")).toBe("markdown");
    expect(fileLanguage("diagram.EXCALIDRAW")).toBe("json");
    expect(fileLanguage("research.mindmap.md")).toBe("markdown");
    expect(fileLanguage("data.unknown")).toBe("plaintext");
  });

  it("recognizes complete visual document suffixes without matching backups", () => {
    expect(visualDocumentKind("研究计划.MINDMAP.MD")).toBe("mindmap");
    expect(visualDocumentKind("研究海报.POSTER.JSON")).toBe("poster");
    expect(visualDocumentKind("research.mindmap.md.bak")).toBeUndefined();
    expect(visualDocumentKind("research.poster.json.bak")).toBeUndefined();
    expect(visualDocumentKind("research.md")).toBeUndefined();
  });

  it("shortens visual labels while preserving ordinary names and nonempty labels", () => {
    expect(fileDisplayName("research.v2.mindmap.md")).toBe("research.v2");
    expect(fileDisplayName("研究海报.POSTER.JSON")).toBe("研究海报");
    expect(fileDisplayName("notes.md")).toBe("notes.md");
    expect(fileDisplayName("poster.json")).toBe("poster.json");
    expect(fileDisplayName(".mindmap.md")).toBe(".mindmap.md");
    expect(fileDisplayName(".poster.json")).toBe(".poster.json");
  });
});
