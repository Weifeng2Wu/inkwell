import { describe, expect, it } from "vitest";
import { lineEndings, pathSync, pathsEqual } from "@/lib/path";

describe("pathSync.basename", () => {
  it("extracts filename from Unix path", () => {
    expect(pathSync.basename("/home/user/file.tex")).toBe("file.tex");
  });

  it("extracts filename from Windows path", () => {
    expect(pathSync.basename("C:\\Users\\user\\file.tex")).toBe("file.tex");
  });

  it("handles trailing slash", () => {
    expect(pathSync.basename("/home/user/folder/")).toBe("folder");
  });

  it("returns single component path as-is", () => {
    expect(pathSync.basename("file.tex")).toBe("file.tex");
  });
});

describe("pathSync.dirname", () => {
  it("returns parent directory for Unix path", () => {
    expect(pathSync.dirname("/home/user/file.tex")).toBe("/home/user");
  });

  it("returns parent directory for Windows path", () => {
    expect(pathSync.dirname("C:\\Users\\user\\file.tex")).toBe("C:\\Users\\user");
  });

  it("returns root for file in root", () => {
    expect(pathSync.dirname("/file.tex")).toBe("/");
  });
});

describe("pathSync.extname", () => {
  it("returns .tex for tex files", () => {
    expect(pathSync.extname("main.tex")).toBe(".tex");
  });

  it("returns empty string for no extension", () => {
    expect(pathSync.extname("Makefile")).toBe("");
  });

  it("normalizes extension to lowercase", () => {
    expect(pathSync.extname("FILE.TEX")).toBe(".tex");
  });
});

describe("pathSync.join", () => {
  it("joins Unix paths", () => {
    expect(pathSync.join("/home/user", "docs", "file.tex")).toBe("/home/user/docs/file.tex");
  });

  it("preserves Windows backslash separator", () => {
    expect(pathSync.join("C:\\Users", "docs", "file.tex")).toBe("C:\\Users\\docs\\file.tex");
  });
});

describe("pathsEqual", () => {
  it("returns true for identical paths", () => {
    expect(pathsEqual("/home/user/file", "/home/user/file")).toBe(true);
  });

  it("returns false for different paths", () => {
    expect(pathsEqual("/home/user/a", "/home/user/b")).toBe(false);
  });

  it("compares Windows paths case-insensitively", () => {
    expect(pathsEqual("C:\\Users\\User\\file.tex", "c:\\users\\user\\file.tex")).toBe(true);
  });

  it("normalizes mixed separators", () => {
    expect(pathsEqual("C:\\Users\\user\\file.tex", "C:/Users/user/file.tex")).toBe(true);
  });
});

describe("lineEndings.normalize", () => {
  it("converts CRLF to LF", () => {
    expect(lineEndings.normalize("a\r\nb\r\nc")).toBe("a\nb\nc");
  });

  it("converts CR to LF", () => {
    expect(lineEndings.normalize("a\rb\rc")).toBe("a\nb\nc");
  });
});

describe("lineEndings.split", () => {
  it("splits on mixed line endings", () => {
    expect(lineEndings.split("a\nb\r\nc\rd")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("lineEndings.count", () => {
  it("counts lines correctly", () => {
    expect(lineEndings.count("a\nb\nc")).toBe(3);
  });
});
