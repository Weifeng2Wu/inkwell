import { describe, expect, it, vi } from "vitest";
import type { FileNode } from "@/types/files";
import {
  SEARCH_INVALID_REGEX,
  SEARCH_MAX_FILE_LENGTH,
  SEARCH_MAX_MATCHES,
  type SearchOptions,
  searchablePaths,
  searchProject,
  searchText,
} from "./search";

const plain: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };
const file = (path: string): FileNode => ({
  path,
  name: path.split("/").pop() ?? path,
  type: "file",
});
const directory = (path: string, children: FileNode[]): FileNode => ({
  path,
  name: path.split("/").pop() ?? path,
  type: "directory",
  children,
});

describe("searchablePaths", () => {
  it("collects text files recursively in tree order", () => {
    const files = [
      directory("chapters", [file("chapters/intro.tex"), file("chapters/fig.png")]),
      directory("papers", [file("papers/a.pdf"), file("papers/a.pdf.notes.md")]),
      file("main.TEX"),
      file("refs.bib"),
      file("notes.md"),
      file("data.csv"),
      file("analysis.py"),
      file("Makefile"),
    ];
    expect(searchablePaths(files)).toEqual([
      "chapters/intro.tex",
      "papers/a.pdf.notes.md",
      "main.TEX",
      "refs.bib",
      "notes.md",
      "data.csv",
      "analysis.py",
      "Makefile",
    ]);
  });

  it("skips binaries, build artefacts, poster documents and vendored folders", () => {
    const files = [
      file("main.pdf"),
      file("main.aux"),
      file("main.log"),
      file("main.synctex.gz"),
      file("main.toc"),
      file("talk.poster.json"),
      file("config.json"),
      file(".hidden"),
      file("noextension"),
      directory(".git", [file(".git/config.txt")]),
      directory("node_modules", [file("node_modules/readme.md")]),
      directory("empty", []),
    ];
    expect(searchablePaths(files)).toEqual(["config.json"]);
  });
});

describe("searchText", () => {
  it("reports 1-based positions and highlight offsets", () => {
    const [match, ...rest] = searchText("a.tex", "first\n  the Needle here", "needle", plain, 10);
    expect(rest).toEqual([]);
    expect(match).toEqual({
      path: "a.tex",
      line: 2,
      column: 7,
      preview: "the Needle here",
      previewStart: 4,
      previewEnd: 10,
    });
  });

  it("returns nothing for an empty query or a zero limit", () => {
    expect(searchText("a", "text", "", plain, 10)).toEqual([]);
    expect(searchText("a", "text", "", { ...plain, regex: true }, 10)).toEqual([]);
    expect(searchText("a", "text", "text", plain, 0)).toEqual([]);
  });

  it("honours case sensitivity", () => {
    expect(searchText("a", "Alpha alpha", "alpha", plain, 10)).toHaveLength(2);
    const strict = searchText("a", "Alpha alpha", "alpha", { ...plain, caseSensitive: true }, 10);
    expect(strict.map((match) => match.column)).toEqual([7]);
  });

  it("matches whole words, including non-ASCII neighbours", () => {
    const options = { ...plain, wholeWord: true };
    expect(
      searchText("a", "cat concat cat_s (cat) écat", "cat", options, 10).map((m) => m.column),
    ).toEqual([1, 19]);
  });

  it("treats special characters literally unless regex is on", () => {
    expect(searchText("a", "f(x) = a.b", "a.b", plain, 10)).toHaveLength(1);
    expect(searchText("a", "f(x) = axb", "a.b", plain, 10)).toHaveLength(0);
    expect(searchText("a", "\\cite{k}", "\\cite{", plain, 10)).toHaveLength(1);
    expect(searchText("a", "f(x) = axb", "a.b", { ...plain, regex: true }, 10)).toHaveLength(1);
    expect(
      searchText("a", "fig:one fig:two", "fig:(one|two)", { ...plain, regex: true }, 10),
    ).toHaveLength(2);
  });

  it("throws a fixed error for invalid patterns", () => {
    for (const options of [
      { ...plain, regex: true },
      { ...plain, regex: true, wholeWord: true },
    ])
      expect(() => searchText("a", "text", "(unclosed", options, 10)).toThrow(SEARCH_INVALID_REGEX);
    expect(() => searchText("a", "text", "(unclosed", plain, 10)).not.toThrow();
  });

  it("skips empty regex matches without looping", () => {
    expect(searchText("a", "baab\n\nb", "a*", { ...plain, regex: true }, 10)).toMatchObject([
      { line: 1, column: 2, previewStart: 1, previewEnd: 3 },
    ]);
    expect(searchText("a", "abc", "^", { ...plain, regex: true }, 10)).toEqual([]);
  });

  it("caps matches per line and overall", () => {
    const line = "x ".repeat(100);
    expect(searchText("a", line, "x", plain, 500)).toHaveLength(20);
    expect(searchText("a", `${line}\n${line}`, "x", plain, 25)).toHaveLength(25);
  });

  it("trims long lines around the match", () => {
    const text = `${"a".repeat(100)}NEEDLE${"b".repeat(300)}`;
    const [match] = searchText("a", text, "needle", plain, 10);
    expect(match?.column).toBe(101);
    expect(match?.preview).toHaveLength(160);
    expect(match?.previewStart).toBe(40);
    expect(match?.preview.slice(match.previewStart, match.previewEnd)).toBe("NEEDLE");
  });

  it("marks previews whose beginning was cut off", () => {
    const long = `    ${"a".repeat(100)}NEEDLE`;
    expect(searchText("a", long, "needle", plain, 10)[0]?.clipped).toBe(true);
    const [short] = searchText("a", "    indented needle", "needle", plain, 10);
    expect(short?.preview).toBe("indented needle");
    expect(short && "clipped" in short).toBe(false);
  });

  it("clamps the highlight when the match is longer than the preview", () => {
    const [match] = searchText("a", "z".repeat(400), "z+", { ...plain, regex: true }, 10);
    expect(match).toMatchObject({ previewStart: 0, previewEnd: 160 });
  });

  it("handles CRLF and astral characters", () => {
    const [match] = searchText("a", "one\r\ntwo 𝒳 end\r\n", "end$", { ...plain, regex: true }, 10);
    expect(match).toMatchObject({ line: 2, preview: "two 𝒳 end" });
  });
});

describe("searchProject", () => {
  const disk = (entries: Record<string, string | null>) =>
    vi.fn(async (path: string) => {
      const text = entries[path];
      if (text === undefined) throw new Error("ENOENT");
      return text;
    });

  it("returns matches in path order and reports progress", async () => {
    const readFile = disk({ "a.tex": "needle a", "b.tex": "nothing", "c.md": "needle c\nneedle" });
    const onProgress = vi.fn();
    const result = await searchProject({
      paths: ["a.tex", "b.tex", "c.md"],
      readFile,
      query: "needle",
      options: plain,
      onProgress,
    });
    expect(result.truncated).toBe(false);
    expect(result.matches.map((match) => `${match.path}:${match.line}`)).toEqual([
      "a.tex:1",
      "c.md:1",
      "c.md:2",
    ]);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.lastCall?.[0]).toEqual(result.matches);
  });

  it("prefers unsaved buffers over disk", async () => {
    const readFile = disk({ "a.tex": "old needle", "b.tex": "needle" });
    const result = await searchProject({
      paths: ["a.tex", "b.tex"],
      readFile,
      buffers: new Map([["a.tex", "edited without it"]]),
      query: "needle",
      options: plain,
    });
    expect(result.matches.map((match) => match.path)).toEqual(["b.tex"]);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith("b.tex");
  });

  it("skips unreadable, missing, binary and oversized files", async () => {
    const readFile = disk({
      "null.tex": null,
      "binary.txt": "needle\u0000",
      "huge.txt": `needle${" ".repeat(SEARCH_MAX_FILE_LENGTH)}`,
      "ok.tex": "needle",
    });
    const result = await searchProject({
      paths: ["missing.tex", "null.tex", "binary.txt", "huge.txt", "ok.tex"],
      readFile,
      query: "needle",
      options: plain,
    });
    expect(result.matches.map((match) => match.path)).toEqual(["ok.tex"]);
  });

  it("reads at most six files at a time", async () => {
    let active = 0;
    let peak = 0;
    const readFile = async () => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return "needle";
    };
    const paths = Array.from({ length: 40 }, (_, index) => `${index}.tex`);
    const result = await searchProject({ paths, readFile, query: "needle", options: plain });
    expect(result.matches).toHaveLength(40);
    expect(result.matches.map((match) => match.path)).toEqual(paths);
    expect(peak).toBe(6);
  });

  it("truncates at the match limit and stops reading", async () => {
    const text = Array.from({ length: 300 }, () => "needle").join("\n");
    const paths = Array.from({ length: 30 }, (_, index) => `${index}.tex`);
    const readFile = vi.fn(async () => text);
    const result = await searchProject({ paths, readFile, query: "needle", options: plain });
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(SEARCH_MAX_MATCHES);
    expect(readFile.mock.calls.length).toBeLessThan(paths.length);
  });

  it("is not truncated at exactly the limit", async () => {
    const text = Array.from({ length: SEARCH_MAX_MATCHES }, () => "needle").join("\n");
    const result = await searchProject({
      paths: ["a.tex", "b.tex"],
      readFile: async (path) => (path === "a.tex" ? text : "nothing"),
      query: "needle",
      options: plain,
    });
    expect(result).toMatchObject({ truncated: false });
    expect(result.matches).toHaveLength(SEARCH_MAX_MATCHES);
  });

  it("returns what it has and stops reading once aborted", async () => {
    const controller = new AbortController();
    const paths = Array.from({ length: 30 }, (_, index) => `${index}.tex`);
    const readFile = vi.fn(async (path: string) => {
      if (path === "7.tex") controller.abort();
      return "needle";
    });
    const result = await searchProject({
      paths,
      readFile,
      query: "needle",
      options: plain,
      signal: controller.signal,
    });
    expect(readFile.mock.calls.length).toBeLessThanOrEqual(12);
    expect(result.matches.length).toBeLessThan(12);
    expect(result.truncated).toBe(false);
  });

  it("reads nothing when already aborted or the query is empty", async () => {
    const readFile = vi.fn(async () => "needle");
    const controller = new AbortController();
    controller.abort();
    const args = { paths: ["a.tex"], readFile, options: plain };
    expect(await searchProject({ ...args, query: "needle", signal: controller.signal })).toEqual({
      matches: [],
      truncated: false,
    });
    expect(await searchProject({ ...args, query: "" })).toEqual({ matches: [], truncated: false });
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects invalid patterns before reading", async () => {
    const readFile = vi.fn(async () => "x");
    await expect(
      searchProject({
        paths: ["a.tex"],
        readFile,
        query: "[",
        options: { ...plain, regex: true },
      }),
    ).rejects.toThrow(SEARCH_INVALID_REGEX);
    expect(readFile).not.toHaveBeenCalled();
  });
});
