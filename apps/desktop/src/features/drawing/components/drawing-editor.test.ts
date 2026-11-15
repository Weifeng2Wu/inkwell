// @vitest-environment jsdom
import type { ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ props: null as ExcalidrawProps | null }));
vi.mock("@excalidraw/excalidraw", () => {
  const menu = Object.assign(({ children }: { children?: ReactNode }) => children, {
    DefaultItems: {
      SaveAsImage: () => null,
      SearchMenu: () => null,
      ClearCanvas: () => null,
      ChangeCanvasBackground: () => null,
    },
  });
  return {
    Excalidraw: (props: ExcalidrawProps) => {
      captured.props = props;
      return createElement("div", { "data-testid": "canvas" });
    },
    MainMenu: menu,
    hashElementsVersion: (elements: { version: number }[]) =>
      elements.reduce((sum, element) => sum + element.version, 0),
    serializeAsJSON: (
      elements: unknown[],
      state: { viewBackgroundColor?: string },
      files: unknown,
    ) =>
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements,
        appState: { viewBackgroundColor: state.viewBackgroundColor },
        files,
      }),
  };
});
vi.mock("@/features/i18n", () => ({ useI18n: () => ({ locale: "en", t: (key: string) => key }) }));
vi.mock("@/features/settings", () => ({ useThemeMode: () => "dark" }));
vi.mock("@/features/editor/components/lazy", () => ({
  MonacoEditor: () => createElement("textarea", { "aria-label": "source" }),
}));

import { DrawingEditor } from "./drawing-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  captured.props = null;
});
const empty = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});
type Change = NonNullable<ExcalidrawProps["onChange"]>;
const emit = async (elements: unknown[], scrollX = 0) =>
  act(async () => {
    captured.props?.onChange?.(
      elements as Parameters<Change>[0],
      { viewBackgroundColor: "#ffffff", scrollX } as Parameters<Change>[1],
      {},
    );
  });

it("does not dirty a scene on open or pan, saves edits, and reloads external changes", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  const onContentChange = vi.fn();
  const render = (content: string) =>
    act(async () =>
      root.render(
        createElement(DrawingEditor, {
          content,
          onContentChange,
          filePath: "drawing.excalidraw",
          projectPath: "/p",
        }),
      ),
    );
  await render(empty);
  await emit([]);
  await emit([], 100);
  expect(onContentChange).not.toHaveBeenCalled();
  const elements = [
    { id: "shape", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 1 },
  ];
  await emit(elements);
  const saved = onContentChange.mock.calls[0]?.[0];
  expect(JSON.parse(saved).elements).toEqual(elements);
  await render(saved);
  const changed = JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [{ ...elements[0], x: 50, version: 2 }],
    files: {},
  });
  await render(changed);
  expect(captured.props?.initialData).toMatchObject({ elements: [{ x: 50 }] });
  await emit([{ ...elements[0], x: 50, version: 2 }]);
  expect(onContentChange).toHaveBeenCalledTimes(1);
  expect(captured.props?.theme).toBe("dark");
  expect(captured.props?.handleKeyboardGlobally).toBe(false);
});

it("preserves malformed source and enforces read-only scenes", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  const onContentChange = vi.fn();
  const render = (content: string) =>
    act(async () =>
      root.render(
        createElement(DrawingEditor, {
          content,
          readOnly: true,
          onContentChange,
          filePath: "drawing.excalidraw",
          projectPath: "/p",
        }),
      ),
    );
  await render(empty);
  expect(captured.props?.viewModeEnabled).toBe(true);
  await emit([]);
  await emit([{ id: "shape", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 1 }]);
  expect(onContentChange).not.toHaveBeenCalled();
  await render("{broken");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("drawing.invalid");
  const source = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "markdown.source",
  );
  await act(async () => source?.click());
  expect(container.querySelector("textarea")).not.toBeNull();
});
