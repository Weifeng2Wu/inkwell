// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FileNode } from "@/types/files";
import { FileTree } from "./file-tree";

vi.mock("@/features/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/features/settings", () => ({ shortcutLabel: (value: string) => value }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const file = (name: string): FileNode => ({ name, path: `demo/${name}`, type: "file" });
const files: FileNode[] = [
  file("研究计划.mindmap.md"),
  file("conference.poster.json"),
  {
    name: "templates.poster.json",
    path: "demo/templates.poster.json",
    type: "directory",
    children: [file("notes.md")],
  },
  ...Array.from({ length: 200 }, (_, index) => file(`note-${index}.md`)),
];

let container: HTMLDivElement;
let root: Root;

function row(path: string) {
  const element = container.querySelector<HTMLElement>(`[data-path="${path}"]`);
  if (!element) throw new Error(`Missing row: ${path}`);
  return element;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 280, height: 140 } } as ResizeObserverEntry],
          this,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("shows short visual labels while opening original paths and preserving directory names", async () => {
  const onFileSelect = vi.fn();
  await act(async () => root.render(createElement(FileTree, { files, onFileSelect })));

  const map = row("demo/研究计划.mindmap.md");
  expect(map.textContent).toBe("研究计划");
  expect(map.querySelector("span")?.title).toBe("研究计划.mindmap.md");
  const poster = row("demo/conference.poster.json");
  expect(poster.textContent).toBe("conference");
  expect(poster.querySelector("span")?.title).toBe("conference.poster.json");
  expect(row("demo/templates.poster.json").textContent).toBe("templates.poster.json");
  expect(row("demo/notes.md").textContent).toBe("notes.md");

  await act(async () => map.click());
  expect(onFileSelect).toHaveBeenLastCalledWith("demo/研究计划.mindmap.md");
  await act(async () => poster.click());
  expect(onFileSelect).toHaveBeenLastCalledWith("demo/conference.poster.json");

  await act(async () => row("demo/templates.poster.json").click());
  expect(container.querySelector('[data-path="demo/notes.md"]')).toBeNull();
  await act(async () => row("demo/templates.poster.json").click());
  expect(row("demo/notes.md")).toBeDefined();
});

it("keeps virtualization and scrolling after replacing the scroll container", async () => {
  const onFileSelect = vi.fn();
  await act(async () => root.render(createElement(FileTree, { files, onFileSelect })));
  const scroller = [...container.querySelectorAll<HTMLDivElement>("div")].find(
    (element) => element.style.overflow === "auto",
  );
  if (!scroller) throw new Error("Missing virtual scroller");
  expect(scroller.style.willChange).toBe("auto");
  expect(scroller.style.height).toBe("140px");
  expect(container.querySelectorAll("[data-path]").length).toBeLessThan(30);
  expect(container.querySelector('[data-path="demo/note-100.md"]')).toBeNull();

  Object.defineProperty(scroller, "clientHeight", { value: 140, configurable: true });
  Object.defineProperty(scroller, "scrollHeight", { value: 204 * 28, configurable: true });
  await act(async () => {
    scroller.scrollTop = 104 * 28;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const revealed = row("demo/note-100.md");
  await act(async () => revealed.click());
  expect(onFileSelect).toHaveBeenLastCalledWith("demo/note-100.md");
  expect(container.querySelectorAll("[data-path]").length).toBeLessThan(30);
});
