// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useMindmapPan } from "./use-mindmap-pan";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose();
});

function setup() {
  const select = vi.fn();
  function Harness() {
    const stage = useRef<HTMLDivElement>(null);
    const pan = useMindmapPan(stage, true);
    return createElement(
      "div",
      {},
      createElement(
        "div",
        {
          ref: stage,
          ...pan.handlers,
          "data-testid": "stage",
          "data-offset": `${pan.offset.x},${pan.offset.y}`,
          style: { cursor: pan.cursor },
        },
        createElement("button", { type: "button", onClick: select }, "Node"),
        createElement("input", { "aria-label": "Label" }),
      ),
      createElement("button", { type: "button", onClick: pan.reset }, "Fit"),
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanup.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return { container, root, Harness, select };
}

it("pans from a node in screen pixels, suppresses selection and resets with fit", async () => {
  const { container, root, Harness, select } = setup();
  await act(async () => root.render(createElement(Harness)));
  const stage = container.querySelector<HTMLDivElement>('[data-testid="stage"]');
  const node = stage?.querySelector("button");
  if (!stage || !node) throw new Error("Missing stage");
  stage.setPointerCapture = vi.fn();
  stage.hasPointerCapture = vi.fn(() => true);
  stage.releasePointerCapture = vi.fn();
  node.focus();
  const keydown = new KeyboardEvent("keydown", {
    code: "Space",
    key: " ",
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    node.dispatchEvent(keydown);
  });
  expect(keydown.defaultPrevented).toBe(true);
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    return event;
  };
  await act(async () => {
    node.dispatchEvent(pointer("pointerdown", 50, 60));
  });
  await act(async () => {
    stage.dispatchEvent(pointer("pointermove", 170, 20));
  });
  expect(stage.dataset.offset).toBe("120,-40");
  expect(stage.style.cursor).toBe("grabbing");
  await act(async () => {
    stage.dispatchEvent(pointer("pointerup", 170, 20));
    node.click();
  });
  expect(select).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
  });
  expect(stage.style.cursor).toBe("");
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Fit")
      ?.click();
  });
  expect(stage.dataset.offset).toBe("0,0");
  const input = stage.querySelector("input");
  input?.focus();
  const typing = new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true });
  await act(async () => {
    input?.dispatchEvent(typing);
  });
  expect(typing.defaultPrevented).toBe(false);
  node.focus();
  await act(async () => {
    node.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true, cancelable: true }),
    );
    window.dispatchEvent(new Event("blur"));
  });
  expect(stage.style.cursor).toBe("");
});
