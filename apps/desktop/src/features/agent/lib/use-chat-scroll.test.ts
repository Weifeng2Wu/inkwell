import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatScroll } from "./use-chat-scroll";

const hooks = vi.hoisted(() => ({
  effect: undefined as (() => (() => void) | undefined) | undefined,
  cleanup: undefined as (() => void) | undefined,
}));

vi.mock("react", () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | undefined) => {
    hooks.effect = effect;
  },
}));

class Viewport extends EventTarget {
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 200;
}

let viewport: Viewport;
let resized: () => void;
let mutated: () => void;
let scrollToBottom: () => void;
let frames: Map<number, FrameRequestCallback>;
let sequence: number;
const disconnectResize = vi.fn();
const disconnectMutations = vi.fn();

function flush() {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
}

function scrollTo(top: number) {
  viewport.scrollTop = top;
  viewport.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  sequence = 0;
  hooks.cleanup = undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++sequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = vi.fn();
      disconnect = disconnectResize;
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutated = callback;
      }
      observe = vi.fn();
      disconnect = disconnectMutations;
    },
  );
  const scroll = useChatScroll("project:session");
  scrollToBottom = scroll.scrollToBottom;
  viewport = new Viewport();
  scroll.viewport.current = viewport as unknown as HTMLDivElement;
  scroll.content.current = {} as HTMLDivElement;
  hooks.cleanup = hooks.effect?.();
});

afterEach(() => {
  hooks.cleanup?.();
  vi.unstubAllGlobals();
});

describe("chat scroll following", () => {
  it("opens at the bottom and follows streaming text and late layout changes", () => {
    flush();
    expect(viewport.scrollTop).toBe(800);
    viewport.scrollHeight = 1200;
    mutated();
    resized();
    expect(frames.size).toBe(1);
    flush();
    expect(viewport.scrollTop).toBe(1000);
    viewport.scrollHeight = 1400;
    resized();
    flush();
    expect(viewport.scrollTop).toBe(1200);
  });

  it("pauses immediately on upward scrolling, even close to the bottom", () => {
    flush();
    scrollTo(790);
    viewport.scrollHeight = 1500;
    mutated();
    resized();
    flush();
    expect(viewport.scrollTop).toBe(790);
  });

  it("returns to the bottom when the user sends a message after reading older content", () => {
    flush();
    scrollTo(300);
    scrollToBottom();
    flush();
    expect(viewport.scrollTop).toBe(800);
    viewport.scrollHeight = 1200;
    mutated();
    flush();
    expect(viewport.scrollTop).toBe(1000);
  });

  it("cancels an already queued update when the user wheels upward", () => {
    flush();
    viewport.scrollHeight = 1200;
    mutated();
    const wheel = new Event("wheel");
    Object.defineProperty(wheel, "deltaY", { value: -100 });
    viewport.dispatchEvent(wheel);
    flush();
    expect(viewport.scrollTop).toBe(800);
  });

  it("does not resume until the user scrolls down near the bottom", () => {
    flush();
    scrollTo(300);
    scrollTo(500);
    viewport.scrollHeight = 1200;
    mutated();
    flush();
    expect(viewport.scrollTop).toBe(500);
    scrollTo(970);
    flush();
    expect(viewport.scrollTop).toBe(1000);
    viewport.scrollHeight = 1400;
    mutated();
    flush();
    expect(viewport.scrollTop).toBe(1200);
  });

  it("follows when new messages make a short conversation overflow", () => {
    viewport.scrollHeight = 150;
    flush();
    expect(viewport.scrollTop).toBe(0);
    viewport.scrollHeight = 500;
    resized();
    flush();
    expect(viewport.scrollTop).toBe(300);
  });

  it("removes observers, queued work and input listeners on cleanup", () => {
    hooks.cleanup?.();
    expect(disconnectResize).toHaveBeenCalledOnce();
    expect(disconnectMutations).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    scrollTo(400);
    expect(frames.size).toBe(0);
  });
});
