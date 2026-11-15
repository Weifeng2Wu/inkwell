// @vitest-environment jsdom

import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ActiveEditor,
  clearActiveEditor,
  reportCursor,
  setActiveEditor,
} from "@/features/editor/lib/active-editor";
import { I18nProvider } from "@/features/i18n";
import type { FileNode } from "@/types/files";
import { OutlinePanel } from "./outline-panel";
import { SearchPanel } from "./search-panel";

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => createElement("div", null, children),
}));

const tree = (...paths: string[]): FileNode[] =>
  paths.map((path) => ({ path, name: path.split("/").pop() ?? path, type: "file" }));

describe("navigator panels", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (element: ReactElement) =>
    act(async () => root.render(createElement(I18nProvider, null, element)));
  const buttons = () => [...container.querySelectorAll("button")];
  const button = (text: string) => {
    const found = buttons().find((item) => item.textContent?.includes(text));
    if (!found) throw new Error(`Missing button: ${text}`);
    return found;
  };
  const searchInput = () => {
    const input = container.querySelector("input");
    if (!input) throw new Error("Missing search input");
    return input;
  };
  async function type(value: string) {
    const input = searchInput();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const press = (key: string) =>
    act(async () => {
      searchInput().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
  const settle = (ms = 300) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  describe("OutlinePanel", () => {
    it("lists indented headings with a word count and jumps to lines", async () => {
      const onGoToLine = vi.fn();
      await render(
        createElement(OutlinePanel, {
          filePath: "chapters/intro.tex",
          content: "\\section{Introduction}\nTwo words\n\\subsection{Related \\emph{Work}}",
          language: "latex",
          onGoToLine,
        }),
      );
      expect(container.textContent).toContain("intro.tex");
      expect(container.textContent).toContain("5 words · about 1 min read");
      expect(buttons().map((item) => [item.textContent, item.style.paddingLeft])).toEqual([
        ["Introduction", "12px"],
        ["Related Work", "24px"],
      ]);
      expect(button("Related Work").title).toBe("Related Work");
      await act(async () => button("Related Work").click());
      expect(onGoToLine).toHaveBeenCalledWith(3);
    });

    it("marks the section under the cursor and moves between headings with the keyboard", async () => {
      const editor: ActiveEditor = { language: () => "markdown", insert: () => true };
      const current = () =>
        container.querySelector<HTMLElement>('[aria-current="location"]')?.textContent;
      await render(
        createElement(OutlinePanel, {
          filePath: "notes.md",
          content: "# One\ntext\n## Two\ntext\n# Three",
          language: "markdown",
          onGoToLine: vi.fn(),
        }),
      );
      expect(current()).toBeUndefined();
      expect(buttons().map((item) => item.tabIndex)).toEqual([0, -1, -1]);

      setActiveEditor(editor);
      await act(async () => reportCursor(editor, { line: 4, column: 1, selected: 0 }));
      expect(current()).toBe("Two");
      expect(button("Two").dataset.active).toBe("true");
      expect(buttons().map((item) => item.tabIndex)).toEqual([-1, 0, -1]);
      await act(async () => reportCursor(editor, { line: 5, column: 2, selected: 0 }));
      expect(current()).toBe("Three");

      button("One").focus();
      await act(async () => {
        button("One").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
      });
      expect(document.activeElement).toBe(button("Three"));
      await act(async () => {
        button("Three").dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
        );
      });
      expect(document.activeElement).toBe(button("Two"));

      await act(async () => clearActiveEditor(editor));
      expect(current()).toBeUndefined();
    });

    it("shows empty states", async () => {
      const props = { content: "plain", language: "markdown", onGoToLine: vi.fn() };
      await render(createElement(OutlinePanel, props));
      expect(container.textContent).toContain("No document open");
      expect(container.textContent).toContain("Open a LaTeX or Markdown document");
      await render(createElement(OutlinePanel, { ...props, filePath: "a.md" }));
      expect(container.textContent).toContain("No headings yet");
      expect(container.textContent).toContain("Start a line with #");
      expect(container.textContent).toContain("1 word · about 1 min read");
      await render(
        createElement(OutlinePanel, { ...props, filePath: "refs.bib", language: "bibtex" }),
      );
      expect(container.textContent).toContain("available for LaTeX and Markdown");
      expect(container.textContent).not.toContain("words");
      expect(buttons()).toEqual([]);
    });
  });

  describe("SearchPanel", () => {
    const files = tree("main.tex", "chapters/intro.tex", "figure.png");
    const disk: Record<string, string> = {
      "main.tex": "A Needle in main\nsecond needle line",
      "chapters/intro.tex": "no match here",
    };
    const setup = (update: Partial<Parameters<typeof SearchPanel>[0]> = {}) => {
      const props = {
        projectPath: "/project",
        files,
        readFile: vi.fn(async (path: string) => disk[path] ?? null),
        onOpenResult: vi.fn(),
        ...update,
      };
      return { props, element: createElement(SearchPanel, props) };
    };

    it("searches after the debounce, highlights matches and opens a result", async () => {
      const { props, element } = setup();
      await render(element);
      expect(document.activeElement).toBe(searchInput());
      await type("needle");
      expect(props.readFile).not.toHaveBeenCalled();
      await settle();
      expect(props.readFile).toHaveBeenCalledTimes(2);
      expect(props.readFile).not.toHaveBeenCalledWith("figure.png");
      expect(container.textContent).toContain("2 found in 1 file");
      expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
        "Needle",
        "needle",
      ]);
      await act(async () => button("second needle line").click());
      expect(props.onOpenResult).toHaveBeenCalledWith("main.tex", 2);

      const group = button("main.tex");
      expect(group.getAttribute("aria-expanded")).toBe("true");
      await act(async () => group.click());
      expect(group.getAttribute("aria-expanded")).toBe("false");
      // Folded results stay mounted but inert: out of reach of focus and the arrow keys.
      expect(container.querySelectorAll("[inert] mark")).toHaveLength(2);
    });

    it("searches immediately on Enter, applies toggles and clears on Escape", async () => {
      const { element } = setup();
      await render(element);
      await type("needle");
      await press("Enter");
      await settle(0);
      expect(container.querySelectorAll("mark")).toHaveLength(2);

      const caseToggle = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Match case"]',
      );
      expect(caseToggle?.getAttribute("aria-pressed")).toBe("false");
      await act(async () => caseToggle?.click());
      expect(caseToggle?.getAttribute("aria-pressed")).toBe("true");
      await settle();
      expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
        "needle",
      ]);

      await press("Escape");
      expect(searchInput().value).toBe("");
      await settle();
      expect(container.querySelectorAll("mark")).toHaveLength(0);
      expect(container.textContent).not.toContain("No results");
    });

    it("moves through results with the keyboard, folds file groups and marks cut previews", async () => {
      const { props, element } = setup({
        files: tree("main.tex", "notes.md"),
        buffers: new Map([
          ["main.tex", `${"x".repeat(80)} needle\nneedle two`],
          ["notes.md", "needle three"],
        ]),
      });
      await render(element);
      expect(container.textContent).toContain("Match whole word");
      await type("needle");
      await settle();
      const focused = () => document.activeElement?.textContent ?? "";
      const key = (name: string) =>
        act(async () => {
          document.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", { key: name, bubbles: true }),
          );
        });
      expect(container.textContent).toContain("3 found in 2 files");
      expect(button("1…").textContent).toContain("…xxx");
      expect(button("needle two").textContent).not.toContain("…");

      await press("ArrowDown");
      expect(focused()).toContain("main.tex");
      await key("ArrowDown");
      await key("ArrowDown");
      expect(focused()).toContain("needle two");
      await key("ArrowDown");
      expect(focused()).toContain("notes.md");
      await key("End");
      expect(focused()).toContain("needle three");
      await act(async () => (document.activeElement as HTMLElement).click());
      expect(props.onOpenResult).toHaveBeenCalledWith("notes.md", 1);

      await key("Home");
      expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true");
      await key("ArrowLeft");
      expect(document.activeElement?.getAttribute("aria-expanded")).toBe("false");
      await key("ArrowDown");
      expect(focused()).toContain("notes.md");
      await key("ArrowUp");
      await key("ArrowRight");
      expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true");
      await key("ArrowUp");
      expect(document.activeElement).toBe(searchInput());

      await press("ArrowDown");
      await key("Escape");
      expect(searchInput().value).toBe("");
      expect(document.activeElement).toBe(searchInput());
    });

    it("reports no results and invalid regular expressions", async () => {
      const { element } = setup();
      await render(element);
      await type("absent");
      await settle();
      expect(container.textContent).toContain("No results");

      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('button[aria-label="Use regular expression"]')
          ?.click(),
      );
      await type("(");
      await settle();
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "This regular expression is not valid",
      );
      expect(container.textContent).not.toContain("No results");
    });

    it("prefers unsaved buffers and says when results are truncated", async () => {
      const { props, element } = setup({
        buffers: new Map([["main.tex", Array.from({ length: 1200 }, () => "needle").join("\n")]]),
      });
      await render(element);
      await type("needle");
      await settle();
      expect(props.readFile).not.toHaveBeenCalledWith("main.tex");
      expect(container.textContent).toContain("Only the first 1000 matches are shown");
      expect(container.querySelectorAll("mark")).toHaveLength(1000);
    });

    it("drops a superseded search", async () => {
      const pending: ((text: string) => void)[] = [];
      const { props, element } = setup({
        files: tree("main.tex"),
        readFile: vi.fn(() => new Promise<string>((resolve) => pending.push(resolve))),
      });
      await render(element);
      await type("needle");
      await settle();
      await type("second");
      await settle();
      expect(props.readFile).toHaveBeenCalledTimes(2);
      await act(async () => pending[0]?.("needle only"));
      expect(container.querySelectorAll("mark")).toHaveLength(0);
      await act(async () => pending[1]?.("second only"));
      expect([...container.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual([
        "second",
      ]);
    });

    it("clears when the project changes and shows the no-folder state", async () => {
      const { props } = setup();
      await render(createElement(SearchPanel, props));
      await type("needle");
      await settle();
      expect(container.querySelectorAll("mark")).toHaveLength(2);
      await render(createElement(SearchPanel, { ...props, projectPath: "/other" }));
      expect(searchInput().value).toBe("");
      expect(container.querySelectorAll("mark")).toHaveLength(0);
      await render(createElement(SearchPanel, { ...props, projectPath: null }));
      expect(container.querySelector("input")).toBeNull();
      expect(container.textContent).toContain("Open a project to search its files.");
    });
  });
});
