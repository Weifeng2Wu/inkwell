// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode } from "@/types/files";
import { useMarkdownGraph } from "./use-markdown-graph";

type Props = Parameters<typeof useMarkdownGraph>[0];
const tree = (...paths: string[]): FileNode[] =>
  paths.map((path) => ({ path, name: path, type: "file" }));

describe("workspace Markdown index", () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: ReturnType<typeof useMarkdownGraph>;
  let props: Props;

  function Probe(input: Props) {
    result = useMarkdownGraph(input);
    return null;
  }

  async function render(update: Partial<Props> = {}) {
    props = { ...props, ...update };
    await act(async () => root.render(createElement(Probe, props)));
  }

  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    props = {
      projectPath: "/project",
      files: tree("first.md", "second.md"),
      readFile: vi.fn(async (path) => (path === "first.md" ? "[[second]]" : "")),
      change: null,
      buffers: [],
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("indexes disk links and overlays live buffers without writing files", async () => {
    await render();
    await settle();
    expect(result.graph.edges).toEqual([{ source: "first.md", target: "second.md" }]);
    expect(result.isLoading).toBe(false);
    await render({
      buffers: [
        { path: "first.md", content: "[[missing]]" },
        { path: "second.md", content: "[[first]]" },
      ],
    });
    expect(result.graph.edges).toEqual([{ source: "second.md", target: "first.md" }]);
    expect(result.content("first.md")).toBe("[[missing]]");
    expect(props.readFile).toHaveBeenCalledTimes(2);
  });

  it("indexes PDFs and their sidecars without reading PDF binaries as text", async () => {
    const readFile = vi.fn(async (path: string) => {
      if (path.endsWith(".pdf")) throw new Error("PDF must not be read as text");
      return path === "note.md" ? "[[papers/paper.pdf]]" : "# Reading notes";
    });
    await render({
      files: tree("note.md", "papers/paper.pdf", "papers/paper.pdf.notes.md"),
      readFile,
    });
    await settle();
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(readFile).not.toHaveBeenCalledWith("papers/paper.pdf");
    expect(result.errors).toEqual([]);
    expect(result.content("papers/paper.pdf")).toBeUndefined();
    expect(result.paths).toContain("papers/paper.pdf");
    expect(result.graph.edges).toEqual([
      { source: "note.md", target: "papers/paper.pdf" },
      { source: "papers/paper.pdf.notes.md", target: "papers/paper.pdf" },
    ]);
    await render({
      files: tree("note.md", "papers/paper.pdf.notes.md"),
      change: { path: "papers/paper.pdf", kind: "remove" },
    });
    expect(result.graph.nodes.some((node) => node.kind === "pdf")).toBe(false);
  });

  it("refreshes changed files and drops renamed or removed notes", async () => {
    const disk = new Map([
      ["first.md", "[[second]]"],
      ["second.md", ""],
    ]);
    await render({ readFile: vi.fn(async (path) => disk.get(path) ?? null) });
    await settle();
    disk.set("first.md", "[[renamed]]");
    disk.delete("second.md");
    disk.set("renamed.md", "[[first]]");
    await render({
      files: tree("first.md", "renamed.md"),
      change: { path: "second.md", kind: "rename" },
    });
    expect(result.graph.nodes.some((node) => node.path === "second.md")).toBe(false);
    await settle();
    expect(result.graph.edges).toEqual([
      { source: "first.md", target: "renamed.md" },
      { source: "renamed.md", target: "first.md" },
    ]);
    disk.set("renamed.md", "");
    await render({ change: { path: "renamed.md", kind: "modify" } });
    await settle();
    expect(result.graph.edges).toEqual([{ source: "first.md", target: "renamed.md" }]);
  });

  it("discards late reads and deferred buffers when projects change", async () => {
    let finish: (content: string) => void = () => {};
    const oldRead = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await render({
      files: tree("first.md"),
      readFile: () => oldRead,
      buffers: [{ path: "first.md", content: "[[oldDraft]]" }],
    });
    await settle();
    await render({
      projectPath: "/new-project",
      files: tree("first.md"),
      readFile: async () => "[[newProject]]",
      buffers: [],
    });
    expect(result.content("first.md")).toBeUndefined();
    expect(result.isLoading).toBe(true);
    await settle();
    await act(async () => finish("[[lateOldProject]]"));
    expect(result.content("first.md")).toBe("[[newProject]]");
    expect(result.graph.nodes[0]?.unresolved).toEqual(["newProject"]);
    await render({ projectPath: null, files: [] });
    expect(result.graph.nodes).toEqual([]);
    expect(result.isLoading).toBe(false);
  });

  it("reports failed reads and recovers with an explicit refresh", async () => {
    const readFile = vi.fn(async (path: string): Promise<string | null> => {
      if (path === "second.md") throw new Error("file unavailable");
      return "[[second]]";
    });
    await render({ readFile });
    await settle();
    expect(result.errors).toEqual(["second.md"]);
    expect(result.graph.nodes).toHaveLength(2);
    readFile.mockImplementation(async () => "");
    await act(async () => result.refresh());
    await settle();
    expect(result.errors).toEqual([]);
    expect(result.graph.edges).toEqual([]);
  });

  it("debounces watch events, ignores access and unrelated files, and bounds concurrent reads", async () => {
    let running = 0;
    let maximum = 0;
    const readFile = vi.fn(async () => {
      running += 1;
      maximum = Math.max(maximum, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return "";
    });
    await render({
      readFile,
      files: tree(...Array.from({ length: 16 }, (_, index) => `${index}.md`)),
    });
    await settle();
    expect(maximum).toBe(6);
    expect(readFile).toHaveBeenCalledTimes(16);
    await render({ change: { path: "0.md", kind: "access" } });
    await render({ change: { path: "main.tex", kind: "modify" } });
    await settle();
    expect(readFile).toHaveBeenCalledTimes(16);
    for (let index = 0; index < 4; index += 1) {
      await render({ change: { path: `${index}.md`, kind: "modify" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
    }
    await settle();
    expect(readFile).toHaveBeenCalledTimes(32);
  });
});
