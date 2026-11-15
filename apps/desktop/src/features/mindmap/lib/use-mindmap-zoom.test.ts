// @vitest-environment jsdom
import { act, createElement, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useMindmapZoom } from "./use-mindmap-zoom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("zooms at the pointer with Ctrl/Cmd, leaves normal scrolling alone and enforces limits", async () => {
  let view = { scale: 1, offset: { x: 40, y: -20 } };
  function Harness({ enabled }: { enabled: boolean }) {
    const stage = useRef<HTMLDivElement>(null);
    const [current, setCurrent] = useState(view);
    view = current;
    useMindmapZoom(stage, enabled, current, setCurrent);
    return createElement("div", { ref: stage }, createElement("input"));
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Harness, { enabled: true })));
    const stage = container.firstElementChild as HTMLDivElement;
    stage.getBoundingClientRect = () => new DOMRect(100, 80, 800, 600);
    const scroll = async (options: WheelEventInit, target: Element = stage) => {
      const event = new WheelEvent("wheel", {
        clientX: 700,
        clientY: 480,
        deltaY: -100,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      await act(async () => {
        target.dispatchEvent(event);
      });
      return event;
    };
    expect((await scroll({})).defaultPrevented).toBe(false);
    expect(view.scale).toBe(1);
    expect((await scroll({ ctrlKey: true })).defaultPrevented).toBe(true);
    expect(view.scale).toBeGreaterThan(1);
    expect((200 - view.offset.x) / view.scale).toBeCloseTo(160);
    expect((100 - view.offset.y) / view.scale).toBeCloseTo(120);
    await scroll({ metaKey: true, deltaY: 100 });
    expect(view.scale).toBeCloseTo(1);
    expect(view.offset.x).toBeCloseTo(40);
    for (let index = 0; index < 10; index++)
      await scroll({ ctrlKey: true, deltaY: -20, deltaMode: 1 });
    expect(view.scale).toBe(3);
    for (let index = 0; index < 20; index++)
      await scroll({ ctrlKey: true, deltaY: 1, deltaMode: 2 });
    expect(view.scale).toBe(0.1);
    const input = stage.querySelector("input");
    if (!input) throw new Error("Missing input");
    expect((await scroll({ ctrlKey: true }, input)).defaultPrevented).toBe(false);
    await act(async () => root.render(createElement(Harness, { enabled: false })));
    expect((await scroll({ ctrlKey: true })).defaultPrevented).toBe(false);
    expect(view.scale).toBe(0.1);
  } finally {
    await act(async () => root.unmount());
  }
});
