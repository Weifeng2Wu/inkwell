// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGraphParallax } from "./use-graph-parallax";

describe("graph pointer parallax", () => {
  let root: Root;
  let container: HTMLDivElement;
  let svg: SVGSVGElement;
  let enabled: boolean;
  let now: number;
  let nextFrame: number;
  let frames: Map<number, FrameRequestCallback>;

  function Probe() {
    useGraphParallax(svg, enabled);
    return null;
  }

  async function render() {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  }

  function pointer(type: string, options: PointerEventInit = {}, target: Element = svg) {
    const event = new MouseEvent(type, { bubbles: true, ...options });
    Object.defineProperties(event, {
      pointerId: { value: options.pointerId ?? 1 },
      pointerType: { value: options.pointerType ?? "mouse" },
    });
    target.dispatchEvent(event);
  }

  function advance(count = 1) {
    for (let index = 0; index < count; index += 1) {
      now += 16;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(now);
    }
  }

  function offset(axis: "x" | "y") {
    return Number.parseFloat(svg.style.getPropertyValue(`--graph-offset-${axis}`)) || 0;
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    enabled = true;
    now = 0;
    nextFrame = 0;
    frames = new Map();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      width: 1000,
      height: 680,
      right: 1100,
      bottom: 730,
      toJSON: () => ({}),
    });
    container = document.createElement("div");
    document.body.append(container, svg);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    svg.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("eases toward the cursor and stops updating after it settles", async () => {
    await render();
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    expect(offset("x")).toBe(0);
    advance();
    expect(offset("x")).toBeGreaterThan(0);
    expect(offset("x")).toBeLessThan(22);
    advance(40);
    expect(offset("x")).toBe(22);
    expect(offset("y")).toBe(14);
    expect(frames.size).toBe(0);
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    expect(frames.size).toBe(0);
  });

  it("returns to center on leave and ignores touch hover", async () => {
    await render();
    pointer("pointermove", { clientX: 100, clientY: 50 });
    advance(40);
    expect(offset("x")).toBe(-22);
    pointer("pointerleave");
    advance(40);
    expect(offset("x")).toBe(0);
    expect(offset("y")).toBe(0);
    pointer("pointermove", { clientX: 1100, clientY: 730, pointerType: "touch" });
    expect(frames.size).toBe(0);
  });

  it("freezes before a node captures a drag and recenters after an outside release", async () => {
    await render();
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    advance(2);
    const previous = offset("x");
    const node = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.append(node);
    node.addEventListener("pointerdown", (event) => event.stopPropagation());
    pointer("pointerdown", { buttons: 1 }, node);
    expect(frames.size).toBe(0);
    pointer("pointermove", { clientX: 100, clientY: 50, buttons: 1 });
    advance(10);
    expect(offset("x")).toBe(previous);
    pointer("pointerup", { clientX: 1200, clientY: 800 });
    advance(40);
    expect(offset("x")).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("freezes during wheel zoom and cancels motion when disabled", async () => {
    await render();
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    advance(2);
    const previous = offset("x");
    svg.dispatchEvent(new WheelEvent("wheel"));
    advance(10);
    expect(offset("x")).toBe(previous);
    expect(frames.size).toBe(0);
    pointer("pointermove", { clientX: 100, clientY: 50 });
    expect(frames.size).toBe(1);
    enabled = false;
    await render();
    expect(frames.size).toBe(0);
    expect(offset("x")).toBe(0);
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    expect(frames.size).toBe(0);
  });

  it("removes listeners and pending frames on close", async () => {
    await render();
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    advance();
    expect(frames.size).toBe(1);
    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
    expect(offset("x")).toBe(0);
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    expect(frames.size).toBe(0);
  });

  it("holds the view still while the pointer is over a node", async () => {
    await render();
    pointer("pointermove", { clientX: 1100, clientY: 730 });
    advance(2);
    const previous = offset("x");
    const node = document.createElementNS("http://www.w3.org/2000/svg", "g");
    node.setAttribute("role", "button");
    svg.append(node);
    pointer("pointermove", { clientX: 800, clientY: 500 }, node);
    advance(20);
    expect(offset("x")).toBe(previous);
    expect(frames.size).toBe(0);
  });
});
