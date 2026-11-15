import { describe, expect, it } from "vitest";
import {
  activate,
  activeBuffers,
  closeTabs,
  EMPTY_PANES,
  failed,
  keepTabs,
  loaded,
  moveTab,
  type Panes,
  reorderTab,
  setContent,
} from "./panes";

function open(panes: Panes, id: "primary" | "split", path: string, content = path) {
  return loaded(activate(panes, id, path), id, path, content);
}
const three = ["a.tex", "b.tex", "c.tex"].reduce(
  (panes, path) => open(panes, "primary", path),
  EMPTY_PANES,
);

describe("activate", () => {
  it("adds a tab once and marks text files as loading", () => {
    const panes = activate(activate(EMPTY_PANES, "primary", "a.tex"), "primary", "a.tex");
    expect(panes.primary).toEqual({
      tabs: ["a.tex"],
      active: "a.tex",
      content: "",
      loading: true,
      error: null,
    });
    expect(activate(EMPTY_PANES, "primary", "a.pdf").primary.loading).toBe(false);
  });

  it("opens the first file in the primary group even when a split was requested", () => {
    const panes = activate(EMPTY_PANES, "split", "a.pdf", "left");
    expect(panes.primary.active).toBe("a.pdf");
    expect(panes.split).toBeNull();
    const beside = activate(panes, "split", "b.tex", "left");
    expect(beside.split?.active).toBe("b.tex");
    expect(beside.side).toBe("left");
  });

  it("ignores results for a file that is no longer active", () => {
    const panes = activate(three, "primary", "a.tex");
    expect(loaded(panes, "primary", "b.tex", "late")).toBe(panes);
    expect(failed(panes, "split", "a.tex", "boom")).toBe(panes);
    expect(failed(panes, "primary", "a.tex", "boom").primary).toMatchObject({
      loading: false,
      error: "boom",
    });
  });
});

describe("closing tabs", () => {
  it("keeps the active document when another tab closes", () => {
    const panes = closeTabs(three, "primary", ["a.tex"]);
    expect(panes.primary).toMatchObject({
      tabs: ["b.tex", "c.tex"],
      active: "c.tex",
      content: "c.tex",
    });
  });

  it("activates the neighbour of a closed active tab and reloads it", () => {
    const middle = closeTabs(open(three, "primary", "b.tex"), "primary", ["b.tex"]);
    expect(middle.primary).toMatchObject({ active: "c.tex", loading: true, content: "" });
    expect(closeTabs(three, "primary", ["c.tex"]).primary.active).toBe("b.tex");
    expect(closeTabs(three, "primary", ["a.tex", "b.tex", "c.tex"])).toEqual(EMPTY_PANES);
    expect(closeTabs(three, "primary", ["missing"])).toBe(three);
  });

  it("removes an empty split and promotes the split when the primary group empties", () => {
    const panes = open(open(EMPTY_PANES, "primary", "a.tex"), "split", "a.pdf");
    expect(closeTabs(panes, "split", ["a.pdf"]).split).toBeNull();
    const promoted = closeTabs(panes, "primary", ["a.tex"]);
    expect(promoted.primary.active).toBe("a.pdf");
    expect(promoted.split).toBeNull();
  });

  it("closes tabs relative to a pivot", () => {
    const others = keepTabs(three, "primary", "a.tex", (index, pivot) => index === pivot);
    expect(others.primary).toMatchObject({ tabs: ["a.tex"], active: "a.tex", loading: true });
    const right = keepTabs(three, "primary", "b.tex", (index, pivot) => index <= pivot);
    expect(right.primary).toMatchObject({ tabs: ["a.tex", "b.tex"], active: "b.tex" });
    const left = keepTabs(three, "primary", "b.tex", (index, pivot) => index >= pivot);
    expect(left.primary).toMatchObject({
      tabs: ["b.tex", "c.tex"],
      active: "c.tex",
      loading: false,
    });
    expect(keepTabs(three, "primary", "a.tex", (index, pivot) => index >= pivot)).toBe(three);
  });
});

describe("arranging tabs", () => {
  it("reorders within a group", () => {
    expect(reorderTab(three, "primary", "c.tex", "a.tex", "before").primary.tabs).toEqual([
      "c.tex",
      "a.tex",
      "b.tex",
    ]);
    expect(reorderTab(three, "primary", "a.tex", "b.tex", "after").primary.tabs).toEqual([
      "b.tex",
      "a.tex",
      "c.tex",
    ]);
    expect(reorderTab(three, "primary", "a.tex", "a.tex", "after")).toBe(three);
  });

  it("moves a tab into a new split and back", () => {
    const split = moveTab(three, "c.tex", "split", "left");
    expect(split.primary).toMatchObject({ tabs: ["a.tex", "b.tex"], active: "b.tex" });
    expect(split.split).toMatchObject({ tabs: ["c.tex"], active: "c.tex" });
    expect(split.side).toBe("left");
    const back = moveTab(split, "c.tex", "primary");
    expect(back.split).toBeNull();
    expect(back.primary).toMatchObject({ tabs: ["a.tex", "b.tex", "c.tex"], active: "c.tex" });
  });

  it("does not split off the only tab, and keeps both files when the primary empties", () => {
    const single = open(EMPTY_PANES, "primary", "a.tex");
    expect(moveTab(single, "a.tex", "split", "right")).toBe(single);
    const two = open(single, "split", "a.pdf");
    const moved = moveTab(two, "a.tex", "split");
    expect(moved.split).toBeNull();
    expect(moved.primary).toMatchObject({ tabs: ["a.pdf", "a.tex"], active: "a.tex" });
  });
});

describe("buffers", () => {
  it("updates a file in every group that shows it, once loaded", () => {
    const both = open(open(EMPTY_PANES, "primary", "a.tex", "old"), "split", "a.tex", "old");
    const next = setContent(both, "a.tex", "new");
    expect([next.primary.content, next.split?.content]).toEqual(["new", "new"]);
    expect(setContent(next, "a.tex", "new")).toBe(next);
    const loading = activate(EMPTY_PANES, "primary", "a.tex");
    expect(setContent(loading, "a.tex", "new")).toBe(loading);
  });

  it("lists loaded text documents and skips previews", () => {
    const panes = open(
      open(open(EMPTY_PANES, "primary", "a.tex", "A"), "split", "p.pdf"),
      "primary",
      "b.md",
      "B",
    );
    expect(activeBuffers(panes)).toEqual([{ path: "b.md", content: "B" }]);
    expect(activeBuffers(activate(panes, "primary", "a.tex"))).toEqual([]);
  });
});
