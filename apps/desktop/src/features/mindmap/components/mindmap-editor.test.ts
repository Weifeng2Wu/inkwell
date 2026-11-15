// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/features/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/features/poster/lib/export", () => ({ savePosterExport: vi.fn() }));
vi.mock("@/features/settings", () => ({
  useSystemFonts: () => ({ fonts: ["Microsoft YaHei"], status: "ready", retry: vi.fn() }),
  readThemePalette: () => ({ foreground: "#111111", surface: "#ffffff", border: "#cccccc" }),
}));

import { parseMindmap } from "../lib/mindmap";
import { MindmapEditor } from "./mindmap-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const release of cleanup.splice(0)) await release();
});

function fixture() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const onContentChange = vi.fn();
  const render = (content: string, readOnly = false) =>
    act(async () =>
      root.render(
        createElement(MindmapEditor, {
          filePath: "research.mindmap.md",
          projectPath: "/p",
          content,
          readOnly,
          onContentChange,
        }),
      ),
    );
  const node = (id: string) => {
    const element = container.querySelector<HTMLButtonElement>(`[data-mindmap-node="${id}"]`);
    if (!element) throw new Error(`Missing node ${id}`);
    return element;
  };
  const click = (label: string) =>
    act(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (item) =>
          item.textContent === label ||
          item.getAttribute("aria-label") === label ||
          item.firstChild?.textContent === label,
      );
      if (!button) throw new Error(`Missing button ${label}`);
      button.click();
    });
  const key = (target: Element, value: string) =>
    act(async () => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
      );
    });
  const context = (id: string) =>
    act(async () => {
      node(id).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 120,
        }),
      );
    });
  return { container, node, render, click, key, context, onContentChange };
}

it("keeps the toolbar compact and adds left/right branches with node controls", async () => {
  const { container, node, render, click, key, onContentChange } = fixture();
  await render("# Root\n\n- Existing\n");
  expect(container.querySelector("input,textarea,select")).toBeNull();
  expect(container.textContent).not.toContain("markdown.source");
  expect(container.textContent).not.toContain("mindmap.styleHint");
  await click("mindmap.addLeft");
  const edited = onContentChange.mock.lastCall?.[0];
  expect(parseMindmap(edited).children[1]?.side).toBe("left");
  await render(edited);
  expect(container.querySelector("textarea")?.value).toBe("mindmap.newNode");
  const field = container.querySelector("textarea");
  if (!field) throw new Error("Missing inline editor");
  await key(field, "Escape");
  await act(async () => node("0.1").click());
  await click("common.delete");
  const deleted = onContentChange.mock.lastCall?.[0];
  expect(parseMindmap(deleted).children).toHaveLength(1);
  await render(deleted);
  await click("mindmap.undo");
  expect(onContentChange).toHaveBeenLastCalledWith(edited);
});

it("edits text in place, cancels Escape and preserves keyboard node creation", async () => {
  const { container, node, render, key, onContentChange } = fixture();
  await render("# Root\n\n- Existing\n");
  await act(async () => node("0.0").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  const field = container.querySelector("textarea");
  if (!field) throw new Error("Missing inline editor");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, "Renamed");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await key(field, "Enter");
  const changed = onContentChange.mock.lastCall?.[0];
  expect(parseMindmap(changed).children[0]?.text).toBe("Renamed");
  await render(changed);
  await key(node("0.0"), "F2");
  const cancelled = container.querySelector("textarea");
  if (!cancelled) throw new Error("Missing inline editor");
  await key(cancelled, "Escape");
  expect(onContentChange).toHaveBeenCalledTimes(1);
  await key(node("0.0"), "Tab");
  expect(parseMindmap(onContentChange.mock.lastCall?.[0]).children[0]?.children).toHaveLength(1);
  const toolbar = container.querySelector('button[aria-label="mindmap.undo"]');
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  await act(async () => {
    toolbar?.dispatchEvent(tab);
  });
  expect(tab.defaultPrevented).toBe(false);
});

it("right-clicks the target node to set fonts, change direction and add siblings", async () => {
  const { node, render, click, context, onContentChange } = fixture();
  await render("# Root\n\n- Existing\n");
  await context("0.0");
  const font = document.querySelector<HTMLSelectElement>('[role="dialog"] select');
  if (!font) throw new Error("Missing font menu");
  await act(async () => {
    font.value = "Microsoft YaHei";
    font.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const styled = onContentChange.mock.lastCall?.[0];
  expect(parseMindmap(styled).children[0]?.style?.fontFamily).toBe("Microsoft YaHei");
  await render(styled);
  expect(node("0.0").style.fontFamily).toContain("Microsoft YaHei");
  const color = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="color"]');
  const fontSize = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="number"]');
  if (!color || !fontSize) throw new Error("Missing style controls");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(color, "#336699");
    color.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const colored = onContentChange.mock.lastCall?.[0];
  expect(parseMindmap(colored).children[0]?.style?.color).toBe("#336699");
  await render(colored);
  await act(async () => {
    setValue?.call(fontSize, "24");
    fontSize.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const resized = onContentChange.mock.lastCall?.[0];
  expect(parseMindmap(resized).children[0]?.style?.fontSize).toBe(24);
  await render(resized);
  await click("mindmap.moveLeft");
  const moved = onContentChange.mock.lastCall?.[0];
  expect(parseMindmap(moved).children[0]?.side).toBe("left");
  await render(moved);
  await context("0.0");
  await click("mindmap.addSibling");
  expect(parseMindmap(onContentChange.mock.lastCall?.[0]).children[1]?.side).toBe("left");
});

it("protects read-only maps and unsupported Markdown from edits", async () => {
  const { container, render, context, onContentChange } = fixture();
  await render("# Root\n", true);
  expect(container.querySelector('[aria-label="mindmap.addLeft"]')).toBeNull();
  await context("0");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await render("# Root\nKeep this paragraph");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("mindmap.invalid");
  expect(onContentChange).not.toHaveBeenCalled();
});
