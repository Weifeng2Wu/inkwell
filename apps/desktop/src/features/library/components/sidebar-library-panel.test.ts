// @vitest-environment jsdom

import { act, type ComponentProps, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { LIBRARY_SORT_STORAGE_KEY, type LibraryItem } from "../lib/library";
import type { LibraryController } from "../lib/use-library";
import { LibrarySidebarPanel } from "./sidebar-library-panel";

const stored = vi.hoisted(() => new Map<string, string>());

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));
vi.mock("@/lib/storage/app-storage", () => ({
  appStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  },
}));

const entry = (key: string, fields: Partial<LibraryItem>): LibraryItem => ({
  key,
  type: "article",
  title: key,
  authors: [],
  year: "",
  venue: "",
  doi: "",
  arxiv: "",
  url: "",
  tags: [],
  status: "unread",
  source: "references.bib",
  ...fields,
});

// Bibliography order; the list shows the most recently added (last) entry first.
const items = [
  entry("lecun2015", { title: "Deep Learning", year: "2015", status: "read", tags: ["survey"] }),
  entry("vaswani2017", {
    title: "Attention Is All You Need",
    year: "2017",
    tags: ["nlp", "survey"],
    file: "papers/attention.pdf",
  }),
  entry("ho2020", { title: "Denoising Diffusion", year: "2020", status: "reading" }),
];

describe("LibrarySidebarPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  const update = vi.fn(async () => undefined);
  const onOpenFile = vi.fn();
  const onEditEntry = vi.fn();
  const onCite = vi.fn();

  const render = () => {
    const controller = {
      library: { items, unlinked: [] },
      busy: null,
      manualAdd: null,
      setManualAdd: vi.fn(),
      update,
    } as unknown as LibraryController;
    const props: ComponentProps<typeof LibrarySidebarPanel> = {
      projectPath: "/paper",
      library: controller,
      onOpenFile,
      onOpenBeside: vi.fn(),
      onEditEntry,
      onCite,
    };
    return act(async () =>
      root.render(createElement(I18nProvider, null, createElement(LibrarySidebarPanel, props))),
    );
  };
  const rows = () => [...container.querySelectorAll<HTMLElement>("[data-key]")];
  const keys = () => rows().map((row) => row.dataset.key);
  const row = (key: string) => {
    const found = rows().find((item) => item.dataset.key === key);
    if (!found) throw new Error(`Missing row: ${key}`);
    return found;
  };
  const search = () => {
    const input = container.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) throw new Error("Missing search field");
    return input;
  };
  const labelled = (label: string, within: ParentNode = container) => {
    const found = within.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    if (!found) throw new Error(`Missing control: ${label}`);
    return found;
  };
  const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
    act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
    });
  const click = (target: HTMLElement) => act(async () => target.click());

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    stored.clear();
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("is one tab stop and moves between the search field and rows with the keyboard", async () => {
    await render();
    expect(keys()).toEqual(["ho2020", "vaswani2017", "lecun2015"]);
    expect(rows().map((item) => item.tabIndex)).toEqual([0, -1, -1]);

    await press(search(), "ArrowDown");
    expect(document.activeElement).toBe(row("ho2020"));
    await press(row("ho2020"), "ArrowDown");
    expect(document.activeElement).toBe(row("vaswani2017"));
    expect(rows().map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
    expect(row("vaswani2017").closest("li")?.dataset.active).toBe("true");
    expect(labelled("Reference details").textContent).toContain("Attention Is All You Need");

    await press(row("vaswani2017"), "End");
    expect(document.activeElement).toBe(row("lecun2015"));
    await press(row("lecun2015"), "Home");
    expect(document.activeElement).toBe(row("ho2020"));
    await press(row("ho2020"), "ArrowUp");
    expect(document.activeElement).toBe(search());
  });

  it("opens, cites and opens the menu from the keyboard, and typing returns to search", async () => {
    await render();
    await click(row("vaswani2017"));
    expect(onOpenFile).toHaveBeenCalledWith("papers/attention.pdf");
    await click(row("ho2020"));
    expect(onEditEntry).toHaveBeenCalledWith(items[2]);

    await press(row("vaswani2017"), "Enter", { ctrlKey: true });
    expect(onCite).toHaveBeenCalledWith(items[1]);

    await press(row("vaswani2017"), "F10", { shiftKey: true });
    expect(document.body.textContent).toContain("Copy citation key");
    await press(document.body, "Escape");

    await press(row("vaswani2017"), "g");
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe("g");
    expect(keys()).toEqual(["ho2020", "lecun2015"]);
    await press(search(), "Escape");
    expect(search().value).toBe("");
    await press(row("ho2020"), "/");
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe("");
  });

  it("cycles the reading status from the status dot", async () => {
    await render();
    const dot = (key: string, label: string) => {
      const item = row(key).closest("li");
      if (!item) throw new Error(`Missing row: ${key}`);
      return labelled(label, item);
    };
    await click(dot("vaswani2017", "Unread · click to mark as Reading"));
    expect(update).toHaveBeenLastCalledWith(items[1], { readstatus: "reading" });
    await click(dot("ho2020", "Reading · click to mark as Read"));
    expect(update).toHaveBeenLastCalledWith(items[2], { readstatus: "read" });
    await click(dot("lecun2015", "Read · click to mark as Unread"));
    expect(update).toHaveBeenLastCalledWith(items[0], { readstatus: "" });
  });

  it("filters by a clicked tag and clears the filter from its chip", async () => {
    await render();
    const item = row("vaswani2017").closest("li");
    if (!item) throw new Error("Missing row");
    await click(labelled("Show references tagged nlp", item));
    expect(keys()).toEqual(["vaswani2017"]);
    await click(labelled("Clear tag filter nlp"));
    expect(keys()).toHaveLength(3);
  });

  it("sorts from the menu and remembers the order", async () => {
    await render();
    await click(labelled("Sort: Recently added"));
    const title = [...container.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      (option) => option.textContent === "Title",
    );
    if (!title) throw new Error("Missing sort option");
    await click(title);
    expect(keys()).toEqual(["vaswani2017", "lecun2015", "ho2020"]);
    expect(stored.get(LIBRARY_SORT_STORAGE_KEY)).toBe("title");
    expect(container.querySelector('[role="menu"]')).toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await render();
    expect(keys()).toEqual(["vaswani2017", "lecun2015", "ho2020"]);
  });
});
