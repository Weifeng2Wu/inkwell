// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { buildMarkdownGraph } from "../lib/markdown-links";
import { MarkdownGraphModal } from "./markdown-graph-modal";

it("anchors wheel zoom to the displayed scene after portal mount and clamps its range", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(
          I18nProvider,
          null,
          createElement(MarkdownGraphModal, {
            graph: buildMarkdownGraph(new Map([["note.md", ""]])),
            isLoading: false,
            onClose: vi.fn(),
            onOpenFile: vi.fn(),
          }),
        ),
      ),
    );
    const canvas = document.querySelector('svg[role="group"]');
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(canvas?.querySelector("[data-graph-scene]"), "getScreenCTM", {
      value: () => ({ inverse: () => ({ offsetX: 24, offsetY: -10 }) }),
    });
    Object.defineProperty(canvas, "createSVGPoint", {
      value: () => ({
        x: 0,
        y: 0,
        matrixTransform(matrix: { offsetX: number; offsetY: number }) {
          return { x: this.x - matrix.offsetX, y: this.y - matrix.offsetY };
        },
      }),
    });
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -100,
      clientX: 500,
      clientY: 340,
    });
    await act(async () => {
      canvas?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(canvas?.querySelector("[data-graph-camera]")?.getAttribute("transform")).toBe(
      `translate(${476 - 476 * Math.exp(0.3)} ${350 - 350 * Math.exp(0.3)}) scale(${Math.exp(0.3)})`,
    );
    expect(canvas?.querySelector("[data-graph-camera]")?.getAttribute("transform")).toContain(
      `scale(${Math.exp(0.3)})`,
    );
    await act(async () => {
      for (let step = 0; step < 30; step += 1)
        canvas?.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 }));
    });
    expect(canvas?.querySelector("[data-graph-camera]")?.getAttribute("transform")).toContain(
      "scale(5)",
    );
    await act(async () => {
      for (let step = 0; step < 30; step += 1)
        canvas?.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 }));
    });
    expect(canvas?.querySelector("[data-graph-camera]")?.getAttribute("transform")).toContain(
      "scale(0.2)",
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
