// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/features/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/path", () => ({ pathSync: { basename: (path: string) => path } }));

import { type EditorPanes, useEditorPanes } from "./use-editor-panes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Change = { path: string; kind: string } | null;

function setup(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const write = vi.fn(async (path: string, content: string) => void disk.set(path, content));
  const read = vi.fn(async (path: string) => {
    if (!disk.has(path)) throw new Error(`FILE_NOT_FOUND:${path}`);
    return disk.get(path) ?? null;
  });
  const state: { editor?: EditorPanes } = {};
  const props = { projectPath: "/p", change: null as Change };
  function Probe(current: typeof props) {
    state.editor = useEditorPanes({
      ...current,
      read,
      write,
      resolvePath: (path) => path,
      readDiff: async (path, staged) => `${staged ? "staged" : "working"} ${path}`,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const render = (next: Partial<typeof props> = {}) =>
    act(async () => root.render(createElement(Probe, Object.assign(props, next))));
  const editor = () => {
    if (!state.editor) throw new Error("not rendered");
    return state.editor;
  };
  return { disk, read, write, render, editor, unmount: () => act(async () => root.unmount()) };
}

beforeEach(() => {
  vi.useFakeTimers();
  toast.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useEditorPanes", () => {
  it("saves a delayed edit to its original tab and rejects callbacks from closed projects", async () => {
    const { render, editor, disk } = setup({ "a.excalidraw": "A", "b.tex": "B" });
    await render();
    await act(async () => void (await editor().open("a.excalidraw")));
    const lateEdit = editor().edit;
    await act(async () => void (await editor().open("b.tex")));
    await act(async () => lateEdit("primary", "Drawing", "a.excalidraw", "/p"));
    expect(editor().panes.primary.content).toBe("B");
    await act(async () => void (await editor().flush()));
    expect(disk.get("a.excalidraw")).toBe("Drawing");
    expect(disk.get("b.tex")).toBe("B");
    await render({ projectPath: "/other" });
    await act(async () => lateEdit("primary", "Stale", "a.excalidraw", "/p"));
    await act(async () => void (await editor().flush()));
    expect(disk.get("a.excalidraw")).toBe("Drawing");
  });

  it("opens files, keeps tabs, and shows a second document beside the first", async () => {
    const { render, editor, read } = setup({ "a.tex": "A", "b.tex": "B" });
    await render();
    await act(async () => expect(await editor().open("a.tex")).toBe(true));
    expect(editor().panes.primary).toMatchObject({ active: "a.tex", content: "A", loading: false });
    await act(async () => void (await editor().open("p.pdf", { pane: "beside", side: "right" })));
    expect(editor().panes.split).toMatchObject({
      tabs: ["p.pdf"],
      active: "p.pdf",
      loading: false,
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => void (await editor().open("b.tex")));
    expect(editor().panes.primary).toMatchObject({ tabs: ["a.tex", "b.tex"], content: "B" });
  });

  it("only applies the most recent of overlapping opens", async () => {
    const { render, editor } = setup({ "a.tex": "A", "b.tex": "B" });
    await render();
    await act(async () => {
      const first = editor().open("a.tex");
      const second = editor().open("b.tex");
      expect(await Promise.all([first, second])).toEqual([false, true]);
    });
    expect(editor().panes.primary).toMatchObject({ active: "b.tex", content: "B" });
  });

  it("closes the tab of a file that no longer exists", async () => {
    const { render, editor } = setup({});
    await render();
    await act(async () => expect(await editor().open("gone.tex")).toBe(false));
    expect(editor().panes.primary.tabs).toEqual([]);
    expect(toast).toHaveBeenCalledWith("files.fileRemovedFromTabs", "error");
  });

  it("debounces saves per file and keeps an edit pending across tab switches", async () => {
    const { render, editor, write, disk } = setup({ "a.tex": "A", "b.tex": "B" });
    await render();
    await act(async () => void (await editor().open("a.tex")));
    act(() => editor().edit("primary", "A1"));
    act(() => editor().edit("primary", "A2"));
    await act(async () => void (await editor().open("b.tex")));
    expect(write).not.toHaveBeenCalled();
    // Returning before the save shows the edit, not the stale disk content.
    await act(async () => void (await editor().open("a.tex")));
    expect(editor().panes.primary.content).toBe("A2");
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(write).toHaveBeenCalledTimes(1);
    expect(disk.get("a.tex")).toBe("A2");
  });

  it("flushes pending edits immediately and reports a failed write", async () => {
    const { render, editor, write, disk } = setup({ "a.tex": "A" });
    await render();
    await act(async () => void (await editor().open("a.tex")));
    act(() => editor().edit("primary", "A1"));
    await act(async () => editor().flush());
    expect(disk.get("a.tex")).toBe("A1");
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(write).toHaveBeenCalledTimes(1);

    write.mockRejectedValueOnce(new Error("disk full"));
    act(() => editor().edit("primary", "A2"));
    await expect(act(async () => editor().flush())).rejects.toThrow("disk full");
  });

  it("keeps an edit pending after a failed save and retries it on flush", async () => {
    const { render, editor, write, disk } = setup({ "a.tex": "A" });
    await render();
    await act(async () => void (await editor().open("a.tex")));
    write.mockRejectedValueOnce(new Error("disk full"));
    act(() => editor().edit("primary", "A1"));
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(toast).toHaveBeenCalledWith("editor.saveFailed", "error");
    expect(disk.get("a.tex")).toBe("A");
    await act(async () => editor().flush());
    expect(disk.get("a.tex")).toBe("A1");
  });

  it("opens a file that may not exist yet as an empty document", async () => {
    const { render, editor } = setup({});
    await render();
    await act(async () => expect(await editor().open("new.tex", { optional: true })).toBe(true));
    expect(editor().panes.primary).toMatchObject({
      active: "new.tex",
      content: "",
      loading: false,
    });
    await act(async () => editor().previewDiff("deleted.tex", false));
    expect(editor().diff?.content).toBe("working deleted.tex");
    expect(editor().panes.primary.tabs).toEqual(["new.tex", "deleted.tex"]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("keeps a left split on the left when one of its tabs is selected", async () => {
    const { render, editor } = setup({ "a.tex": "A", "b.tex": "B", "c.tex": "C" });
    await render();
    await act(async () => void (await editor().open("a.tex")));
    await act(async () => void (await editor().open("b.tex", { pane: "split", side: "left" })));
    await act(async () => void (await editor().open("c.tex", { pane: "split" })));
    expect(editor().panes.side).toBe("left");
  });

  it("reloads external changes but not the echo of its own write or over unsaved edits", async () => {
    const { render, editor, disk } = setup({ "a.tex": "A" });
    await render();
    await act(async () => void (await editor().open("a.tex")));
    disk.set("a.tex", "external");
    await render({ change: { path: "a.tex", kind: "modify" } });
    expect(editor().panes.primary.content).toBe("external");

    act(() => editor().edit("primary", "mine"));
    disk.set("a.tex", "other");
    await render({ change: { path: "a.tex", kind: "modify" } });
    expect(editor().panes.primary.content).toBe("mine");
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    await render({ change: { path: "a.tex", kind: "modify" } });
    expect(editor().panes.primary.content).toBe("mine");
  });

  it("updates an open document when another feature writes the file", async () => {
    const { render, editor, disk, write } = setup({ "refs.bib": "@misc{a}" });
    await render();
    await act(async () => void (await editor().open("refs.bib")));
    act(() => editor().edit("primary", "typing"));
    await act(async () => editor().writeFile("refs.bib", "@misc{a}\n@misc{b}"));
    expect(editor().panes.primary.content).toBe("@misc{a}\n@misc{b}");
    await act(async () => void (await vi.advanceTimersByTimeAsync(600)));
    expect(write).toHaveBeenCalledTimes(1);
    expect(disk.get("refs.bib")).toBe("@misc{a}\n@misc{b}");
  });

  it("closes tabs of removed files and clears everything when the project changes", async () => {
    const { render, editor } = setup({ "a.tex": "A", "b.tex": "B" });
    await render();
    await act(async () => void (await editor().open("a.tex")));
    await act(async () => void (await editor().open("b.tex", { pane: "split" })));
    await render({ change: { path: "b.tex", kind: "remove" } });
    expect(editor().panes.split).toBeNull();
    await render({ projectPath: "/other" });
    expect(editor().panes.primary.tabs).toEqual([]);
  });

  it("shows a diff in place of the editor until the file is opened", async () => {
    const { render, editor } = setup({ "a.tex": "A" });
    await render();
    await act(async () => editor().previewDiff("a.tex", true));
    expect(editor().diff).toMatchObject({
      path: "a.tex",
      content: "staged a.tex",
      isLoading: false,
    });
    expect(editor().panes.primary.content).toBe("A");
    await act(async () => void (await editor().open("a.tex")));
    expect(editor().diff).toBeNull();
    expect(editor().panes.primary).toMatchObject({ content: "A", loading: false });
  });

  it("moves a compiled PDF beside its source", async () => {
    const { render, editor } = setup({ "main.tex": "T" });
    await render();
    await act(async () => void (await editor().open("main.pdf")));
    act(() => void editor().showBeside("main.pdf", "right"));
    expect(editor().panes.split).toBeNull();
    await act(async () => void (await editor().open("main.tex")));
    act(() => void editor().showBeside("main.pdf", "right"));
    expect(editor().panes.primary).toMatchObject({ tabs: ["main.tex"], content: "T" });
    expect(editor().panes.split?.active).toBe("main.pdf");
  });
});
