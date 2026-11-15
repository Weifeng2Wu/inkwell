// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/features/i18n", () => ({
  useI18n: () => ({ locale: "en", t: (key: string) => key }),
  formatNumber: (value: number) => String(value),
}));
vi.mock("@/features/settings", () => ({ shortcutLabel: (value: string) => value }));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/features/editor/components/lazy", () => ({
  MonacoEditor: (props: { content?: string; onContentChange?: (content: string) => void }) =>
    createElement("textarea", {
      "aria-label": "source",
      value: props.content ?? "",
      onChange: (event: { target: { value: string } }) =>
        props.onContentChange?.(event.target.value),
    }),
}));

import { PosterDocumentEditor } from "./poster-document-editor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
});

const source = JSON.stringify({
  version: 2,
  title: "Verified title",
  width: 841,
  height: 1189,
  columns: 3,
  background: "#ffffff",
  sections: [
    {
      id: "evidence",
      title: "Evidence",
      blocks: [{ id: "claim", type: "text", text: "A supported claim." }],
    },
  ],
});

function setup(content = source, readOnly = false) {
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  const onContentChange = vi.fn();
  const render = (text = content) =>
    act(async () =>
      root.render(
        createElement(PosterDocumentEditor, {
          filePath: "poster.poster.json",
          projectPath: "/p",
          content: text,
          onContentChange,
          readOnly,
        }),
      ),
    );
  const button = (label: string) => {
    const found = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label || item.getAttribute("aria-label") === label,
    );
    if (!found) throw new Error(label);
    return found;
  };
  return { container, render, button, onContentChange };
}

it("opens structured input in the freeform canvas and persists v1 only after an edit", async () => {
  const { container, render, button, onContentChange } = setup();
  await render();
  expect(container.querySelector('svg[aria-label="Verified title"]')).not.toBeNull();
  expect(container.querySelector("textarea")).toBeNull();
  expect(onContentChange).not.toHaveBeenCalled();
  await act(async () => button("Add text").click());
  const edited = onContentChange.mock.lastCall?.[0];
  const document = JSON.parse(edited);
  expect(document.version).toBe(1);
  expect(document.sections).toBeUndefined();
  expect(
    document.elements.some((element: { text?: string }) => element.text === "A supported claim."),
  ).toBe(true);
  await render(edited);
  await act(async () => button("Undo").click());
  expect(onContentChange).toHaveBeenLastCalledWith(source);
  await render(source);
  expect(container.querySelector('svg[aria-label="Verified title"]')).not.toBeNull();
});

it("keeps source editing mounted while repairing invalid JSON", async () => {
  const { container, render, button, onContentChange } = setup();
  await render();
  await act(async () => button("Source").click());
  const editor = container.querySelector('textarea[aria-label="source"]');
  await render('{"version":2,');
  expect(container.querySelector('textarea[aria-label="source"]')).toBe(editor);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(onContentChange).not.toHaveBeenCalled();
  await render(source);
  expect(container.querySelector('textarea[aria-label="source"]')).toBe(editor);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("creates one freeform format and preserves read-only content", async () => {
  const fresh = setup("");
  await fresh.render();
  await act(async () => fresh.button("Create poster").click());
  expect(JSON.parse(fresh.onContentChange.mock.lastCall?.[0]).version).toBe(1);
  const readonly = setup(source, true);
  await readonly.render();
  expect(readonly.button("Add text").disabled).toBe(true);
  expect(readonly.onContentChange).not.toHaveBeenCalled();
});
