// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { ConfirmDialog } from "./confirm-dialog";
import { ContextMenu, type ContextMenuItem, nextEnabledIndex } from "./context-menu";
import { InputDialog } from "./input-dialog";
import { TOAST_ACTION_DURATION, TOAST_DURATION, ToastProvider, useToast } from "./toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

function render(node: ReactNode) {
  act(() => root.render(createElement(I18nProvider, null, node)));
}

function press(key: string, target: EventTarget = document.activeElement ?? document.body) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function click(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function button(name: string) {
  return Array.from(document.querySelectorAll("button")).find((b) => b.textContent === name);
}

beforeEach(() => {
  opener = document.createElement("button");
  host = document.createElement("div");
  document.body.append(opener, host);
  opener.focus();
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("ContextMenu", () => {
  const setup = () => {
    const run = { open: vi.fn(), rename: vi.fn(), paste: vi.fn(), remove: vi.fn() };
    const onClose = vi.fn();
    const items: ContextMenuItem[] = [
      { label: "Open", onClick: run.open },
      { label: "Rename", onClick: run.rename, keys: "F2" },
      { label: "Paste", onClick: run.paste, disabled: true },
      { label: "Delete", onClick: run.remove, danger: true, separator: true },
    ];
    render(createElement(ContextMenu, { x: 10, y: 10, items, onClose }));
    const active = () =>
      document.querySelector('[role="menuitem"][data-active="true"]')?.textContent;
    return { run, onClose, active };
  };

  it("skips disabled items and wraps", () => {
    const items = [{}, { disabled: true }, {}];
    expect(nextEnabledIndex(items, 0, 1)).toBe(2);
    expect(nextEnabledIndex(items, 2, 1)).toBe(0);
    expect(nextEnabledIndex(items, 0, -1)).toBe(2);
    expect(nextEnabledIndex([{ disabled: true }], -1, 1)).toBe(-1);
  });

  it("takes focus, renders shortcut hints and separators", () => {
    setup();
    expect(document.activeElement?.getAttribute("role")).toBe("menu");
    expect(document.querySelector("kbd.kbd-quiet")?.textContent).toBe("F2");
    expect(document.querySelectorAll("[role=menu] hr")).toHaveLength(1);
  });

  it("moves with arrows, Home and End and runs the active item with Enter", () => {
    const { run, onClose, active } = setup();
    press("ArrowDown");
    expect(active()).toBe("Open");
    press("ArrowDown");
    press("ArrowDown");
    expect(active()).toContain("Delete");
    press("ArrowDown");
    expect(active()).toBe("Open");
    press("ArrowUp");
    expect(active()).toContain("Delete");
    press("Home");
    expect(active()).toBe("Open");
    press("End");
    expect(active()).toContain("Delete");
    press("ArrowUp");
    expect(active()).toContain("Rename");
    const enter = press("Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(run.rename).toHaveBeenCalledTimes(1);
    expect(run.paste).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without running anything and returns focus when unmounted", () => {
    const { run, onClose } = setup();
    press("Enter");
    expect(onClose).not.toHaveBeenCalled();
    press("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(Object.values(run).every((fn) => fn.mock.calls.length === 0)).toBe(true);
    render(null);
    expect(document.activeElement).toBe(opener);
  });
});

describe("dialogs", () => {
  it("ConfirmDialog: Enter confirms, Escape cancels, focus returns", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      createElement(ConfirmDialog, { title: "Delete?", message: "Gone.", onConfirm, onCancel }),
    );
    const buttons = Array.from(document.querySelectorAll("[role=alertdialog] button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Cancel", "Confirm"]);
    expect(document.activeElement).toBe(buttons[1]);
    // Enter on a focused button is left to the button itself.
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(press("Enter", document.body).defaultPrevented).toBe(true);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    press("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    render(null);
    expect(document.activeElement).toBe(opener);
  });

  it("ConfirmDialog: a dangerous action starts on Cancel and Tab stays inside", () => {
    const props = { title: "Delete?", message: "Gone.", onConfirm: vi.fn(), onCancel: vi.fn() };
    render(createElement(ConfirmDialog, { ...props, danger: true }));
    expect(document.activeElement?.textContent).toBe("Cancel");
    press("Tab");
    // jsdom does not move focus on Tab; the trap only acts at the edges.
    button("Confirm")?.focus();
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe("Cancel");
  });

  it("InputDialog: selects the name, validates on Enter, cancels on Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const validator = (value: string) => (value === "notes.md" ? "Taken" : null);
    render(
      createElement(InputDialog, {
        title: "Rename",
        defaultValue: "notes.md",
        validator,
        onConfirm,
        onCancel,
      }),
    );
    const input = document.querySelector("input");
    expect(document.activeElement).toBe(input);
    expect([input?.selectionStart, input?.selectionEnd]).toEqual([0, 5]);
    press("Enter");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Taken");
    click(button("Confirm"));
    expect(onConfirm).not.toHaveBeenCalled();
    button("Cancel")?.focus();
    press("Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("toast", () => {
  let api: ReturnType<typeof useToast>;
  function Capture() {
    api = useToast();
    return null;
  }
  const text = () => document.body.textContent ?? "";

  beforeEach(() => {
    vi.useFakeTimers();
    render(createElement(ToastProvider, null, createElement(Capture)));
  });

  it("dismisses itself and stays compatible with the two-argument call", () => {
    act(() => api.toast("Saved", "success"));
    expect(text()).toContain("Saved");
    act(() => vi.advanceTimersByTime(TOAST_DURATION + 10));
    expect(text()).not.toContain("Saved");
  });

  it("runs the action once and closes", () => {
    const undo = vi.fn();
    act(() => api.toast("Moved", "info", { action: { label: "Undo", onClick: undo } }));
    act(() => vi.advanceTimersByTime(TOAST_DURATION + 10));
    expect(text()).toContain("Moved");
    click(button("Undo"));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Moved");
    act(() => vi.advanceTimersByTime(TOAST_ACTION_DURATION));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("pauses while hovered and resumes afterwards", () => {
    act(() => api.toast("Copied"));
    const item = document.querySelector('[role="status"]');
    act(() => vi.advanceTimersByTime(TOAST_DURATION - 500));
    // React derives mouseenter from mouseover.
    act(() => {
      item?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    act(() => vi.advanceTimersByTime(TOAST_DURATION * 5));
    expect(text()).toContain("Copied");
    act(() => {
      item?.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    act(() => vi.advanceTimersByTime(1100));
    expect(text()).not.toContain("Copied");
  });
});
