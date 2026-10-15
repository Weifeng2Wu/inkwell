import { describe, expect, it } from "vitest";
import {
  findMainTexFile,
  findTexFiles,
  formatCompilationTime,
  getPdfPathFromTex,
  isTexFile,
} from "@/features/latex/lib/utils";
import type { FileNode } from "@/types/files";

function file(name: string, path?: string): FileNode {
  return { name, path: path ?? name, type: "file" };
}

function dir(name: string, children: FileNode[]): FileNode {
  return { name, path: name, type: "directory", children };
}

describe("findTexFiles", () => {
  it("finds .tex files at root level", () => {
    const files = [file("main.tex"), file("README.md"), file("refs.bib")];
    expect(findTexFiles(files)).toEqual(["main.tex"]);
  });

  it("finds .tex files recursively in directories", () => {
    const files = [
      file("main.tex"),
      dir("chapters", [file("ch1.tex", "chapters/ch1.tex"), file("ch2.tex", "chapters/ch2.tex")]),
    ];
    expect(findTexFiles(files)).toEqual(["main.tex", "chapters/ch1.tex", "chapters/ch2.tex"]);
  });

  it("returns empty array when no .tex files exist", () => {
    const files = [file("README.md"), file("Makefile")];
    expect(findTexFiles(files)).toEqual([]);
  });
});

describe("findMainTexFile", () => {
  it("prefers main.tex", () => {
    const files = [file("intro.tex"), file("main.tex"), file("appendix.tex")];
    expect(findMainTexFile(files)).toBe("main.tex");
  });

  it("prefers paper.tex when main.tex is absent", () => {
    const files = [file("paper.tex"), file("appendix.tex")];
    expect(findMainTexFile(files)).toBe("paper.tex");
  });

  it("falls back to any .tex file in root", () => {
    const files = [file("README.md"), file("myfile.tex")];
    expect(findMainTexFile(files)).toBe("myfile.tex");
  });

  it("searches recursively when no root .tex files", () => {
    const files = [file("README.md"), dir("src", [file("main.tex", "src/main.tex")])];
    expect(findMainTexFile(files)).toBe("src/main.tex");
  });

  it("returns null when no .tex files exist", () => {
    const files = [file("README.md"), file("Makefile")];
    expect(findMainTexFile(files)).toBeNull();
  });
});

describe("getPdfPathFromTex", () => {
  it("replaces .tex with .pdf", () => {
    expect(getPdfPathFromTex("main.tex")).toBe("main.pdf");
  });

  it("only replaces trailing .tex", () => {
    expect(getPdfPathFromTex("file.texture")).toBe("file.texture");
  });
});

describe("isTexFile", () => {
  it("returns true for .tex extension", () => {
    expect(isTexFile("main.tex")).toBe(true);
  });

  it("returns true for uppercase .TEX (case insensitive)", () => {
    expect(isTexFile("MAIN.TEX")).toBe(true);
  });

  it("returns false for other extensions", () => {
    expect(isTexFile("main.pdf")).toBe(false);
    expect(isTexFile("main.txt")).toBe(false);
    expect(isTexFile("main.bib")).toBe(false);
  });
});

describe("formatCompilationTime", () => {
  it("formats milliseconds under 1000", () => {
    expect(formatCompilationTime(500)).toBe("500ms");
    expect(formatCompilationTime(0)).toBe("0ms");
    expect(formatCompilationTime(999)).toBe("999ms");
  });

  it("formats seconds for 1000ms and above", () => {
    expect(formatCompilationTime(1000)).toBe("1.0s");
    expect(formatCompilationTime(2500)).toBe("2.5s");
    expect(formatCompilationTime(10000)).toBe("10.0s");
  });
});
