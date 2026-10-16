import { afterEach, describe, expect, it, vi } from "vitest";
import { createReviewToolbar } from "./review-toolbar";

class Element extends EventTarget {
  className = "";
  textContent = "";
  disabled = false;
  children: Element[] = [];
  attributes = new Map<string, string>();
  append(...children: Element[]) {
    this.children.push(...children);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

afterEach(() => vi.unstubAllGlobals());

function fixture(disabled = false) {
  vi.stubGlobal("document", { createElement: () => new Element() });
  const onDecide = vi.fn();
  const toolbar = createReviewToolbar({
    acceptLabel: "接受",
    rejectLabel: "拒绝",
    disabled,
    index: 0,
    onDecide,
  });
  return { toolbar: toolbar as unknown as Element, onDecide };
}

describe("inline review toolbar", () => {
  it("dispatches accept and reject without forwarding clicks to Monaco", () => {
    const { toolbar, onDecide } = fixture();
    for (const button of toolbar.children) {
      const click = new Event("click", { bubbles: true });
      const stop = vi.spyOn(click, "stopPropagation");
      button.dispatchEvent(click);
      expect(stop).toHaveBeenCalled();
    }
    expect(onDecide.mock.calls).toEqual([[true], [false]]);
    expect(toolbar.children[0]?.className).toContain("btn-primary");
    expect(toolbar.children[0]?.attributes.get("aria-label")).toBe("接受 1");
  });

  it("isolates pointer and keyboard events without preventing native button activation", () => {
    const { toolbar } = fixture();
    for (const type of ["pointerdown", "mousedown", "dblclick", "keydown"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const stop = vi.spyOn(event, "stopPropagation");
      toolbar.dispatchEvent(event);
      expect(stop).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("does not submit disabled actions", () => {
    const { toolbar, onDecide } = fixture(true);
    toolbar.children[0]?.dispatchEvent(new Event("click"));
    expect(onDecide).not.toHaveBeenCalled();
  });
});
