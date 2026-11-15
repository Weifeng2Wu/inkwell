// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphPoint } from "./graph-layout";
import { useGraphAnimation } from "./use-graph-animation";

describe("knowledge graph motion", () => {
  let container: HTMLDivElement;
  let root: Root;
  let result: ReturnType<typeof useGraphAnimation>;
  let layout: Map<string, GraphPoint>;
  let overrides: Map<string, GraphPoint>;
  let reducedMotion: boolean;
  let hidden: boolean;
  let now: number;
  let nextFrame: number;
  let frames: Map<number, FrameRequestCallback>;
  let preferenceListeners: Set<() => void>;

  function Probe() {
    result = useGraphAnimation(layout, overrides);
    return null;
  }

  async function render() {
    await act(async () => root.render(createElement(StrictMode, null, createElement(Probe))));
  }

  async function advance(milliseconds: number) {
    now += milliseconds;
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () => {
      for (const callback of callbacks) callback(now);
    });
  }

  async function changePreference(reduce: boolean) {
    await act(async () => {
      reducedMotion = reduce;
      for (const listener of preferenceListeners) listener();
    });
  }

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    reducedMotion = false;
    hidden = false;
    now = 0;
    nextFrame = 0;
    frames = new Map();
    preferenceListeners = new Set();
    layout = new Map([
      ["first.md", { x: 200, y: 200 }],
      ["second.md", { x: 700, y: 500 }],
    ]);
    overrides = new Map();
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        nextFrame += 1;
        frames.set(nextFrame, callback);
        return nextFrame;
      }),
    );
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((frame: number) => frames.delete(frame)),
    );
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return reducedMotion;
      },
      addEventListener: (_event: string, listener: () => void) => preferenceListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        preferenceListeners.delete(listener),
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("eases nodes into place and stops scheduling frames once settled", async () => {
    await render();
    const initial = result.positions.get("first.md")?.x ?? 0;
    expect(result.motionEnabled).toBe(true);
    expect(initial).toBeGreaterThan(200);
    expect(frames.size).toBe(1);
    await advance(160);
    expect(result.positions.get("first.md")?.x).toBeGreaterThan(200);
    expect(result.positions.get("first.md")?.x).toBeLessThan(initial);
    await advance(400);
    expect(result.positions).toEqual(layout);
    expect(frames.size).toBe(0);
    await render();
    expect(frames.size).toBe(0);
  });

  it("retargets from the visible positions when filtering interrupts a transition", async () => {
    await render();
    await advance(100);
    const previous = result.positions.get("first.md");
    layout = new Map([
      ["first.md", { x: 650, y: 250 }],
      ["third.md", { x: 800, y: 400 }],
    ]);
    await render();
    expect(result.positions.get("first.md")).toEqual(previous);
    expect(result.positions.has("second.md")).toBe(false);
    expect(result.positions.has("third.md")).toBe(true);
    expect(frames.size).toBe(1);
    await advance(500);
    expect(result.positions).toEqual(layout);
    expect(frames.size).toBe(0);
  });

  it("follows dragged positions immediately and animates their reset", async () => {
    await render();
    await advance(500);
    const dragged = { x: 820, y: 570 };
    overrides = new Map([["first.md", dragged]]);
    await render();
    expect(result.positions.get("first.md")).toEqual(dragged);
    expect(frames.size).toBe(0);
    overrides = new Map();
    await render();
    expect(result.positions.get("first.md")).toEqual(dragged);
    await advance(150);
    expect(result.positions.get("first.md")?.x).toBeLessThan(dragged.x);
    expect(result.positions.get("first.md")?.x).toBeGreaterThan(200);
    await advance(400);
    expect(result.positions).toEqual(layout);
  });

  it("holds a grabbed node in place while the remaining nodes finish entering", async () => {
    await render();
    await advance(100);
    const grabbed = result.positions.get("first.md") ?? { x: 0, y: 0 };
    overrides = new Map([["first.md", grabbed]]);
    await render();
    await advance(500);
    expect(result.positions.get("first.md")).toEqual(grabbed);
    expect(result.positions.get("second.md")).toEqual(layout.get("second.md"));
    expect(frames.size).toBe(0);
    overrides = new Map();
    await render();
    await advance(500);
    expect(result.positions).toEqual(layout);
  });

  it("preserves exact fractional target coordinates when a transition ends", async () => {
    layout = new Map([["first.md", { x: 0.123456789, y: 0.987654321 }]]);
    await render();
    await advance(500);
    expect(result.positions.get("first.md")).toBe(layout.get("first.md"));
    overrides = new Map();
    await render();
    expect(frames.size).toBe(0);
  });

  it("settles immediately when reduced motion is enabled, including live changes", async () => {
    reducedMotion = true;
    await render();
    expect(result.motionEnabled).toBe(false);
    expect(result.positions).toEqual(layout);
    expect(frames.size).toBe(0);
    await changePreference(false);
    layout = new Map([["first.md", { x: 600, y: 300 }]]);
    await render();
    expect(frames.size).toBe(1);
    await changePreference(true);
    expect(result.positions).toEqual(layout);
    expect(result.motionEnabled).toBe(false);
    expect(frames.size).toBe(0);
  });

  it("cancels frames in the background and cleans up on close", async () => {
    const removeListener = vi.spyOn(document, "removeEventListener");
    await render();
    await advance(100);
    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.motionEnabled).toBe(false);
    expect(result.positions).toEqual(layout);
    expect(frames.size).toBe(0);
    await act(async () => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.motionEnabled).toBe(true);
    expect(frames.size).toBe(0);
    layout = new Map([["first.md", { x: 700, y: 400 }]]);
    await render();
    expect(frames.size).toBe(1);
    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
    expect(preferenceListeners.size).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
