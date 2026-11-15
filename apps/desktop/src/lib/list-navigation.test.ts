// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  eventRow,
  isMenuKey,
  listMoveIndex,
  listRows,
  moveRowFocus,
  typedCharacter,
} from "./list-navigation";

const plain = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe("listMoveIndex", () => {
  it("moves one row at a time and stops at both ends", () => {
    expect(listMoveIndex("ArrowDown", -1, 3)).toBe(0);
    expect(listMoveIndex("ArrowDown", 1, 3)).toBe(2);
    expect(listMoveIndex("ArrowDown", 2, 3)).toBe(2);
    expect(listMoveIndex("ArrowUp", 1, 3)).toBe(0);
    expect(listMoveIndex("ArrowUp", 0, 3)).toBe(0);
    expect(listMoveIndex("ArrowUp", -1, 3)).toBe(0);
  });

  it("jumps to the first and last row", () => {
    expect(listMoveIndex("Home", 2, 3)).toBe(0);
    expect(listMoveIndex("End", 0, 3)).toBe(2);
  });

  it("ignores other keys and empty lists", () => {
    expect(listMoveIndex("Enter", 0, 3)).toBeNull();
    expect(listMoveIndex("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("moveRowFocus", () => {
  const list = () => {
    const container = document.createElement("div");
    container.innerHTML = [
      "<button data-list-row>a</button>",
      "<p>skip</p>",
      "<button data-list-row><span>b</span></button>",
      "<div inert><button data-list-row>collapsed</button></div>",
      "<button data-list-row>c</button>",
    ].join("");
    document.body.append(container);
    return container;
  };
  const press = (container: HTMLElement, target: Element, key: string, shiftKey = false) => {
    const preventDefault = vi.fn();
    const handled = moveRowFocus({
      ...plain,
      key,
      shiftKey,
      target,
      currentTarget: container,
      preventDefault,
    });
    return { handled, prevented: preventDefault.mock.calls.length > 0 };
  };

  it("lists rows in order and leaves out collapsed parts", () => {
    const container = list();
    expect(listRows(container).map((row) => row.textContent)).toEqual(["a", "b", "c"]);
    expect(eventRow(container.querySelector("span"))?.textContent).toBe("b");
    expect(eventRow(container.querySelector("p"))).toBeNull();
    expect(eventRow(null)).toBeNull();
    container.remove();
  });

  it("focuses the neighbouring row, also from an element inside a row", () => {
    const container = list();
    const rows = listRows(container);
    const inner = container.querySelector("span");
    if (!inner) throw new Error("Missing inner element");
    expect(press(container, inner, "ArrowDown")).toEqual({ handled: true, prevented: true });
    expect(document.activeElement).toBe(rows[2]);
    press(container, rows[2] ?? container, "Home");
    expect(document.activeElement).toBe(rows[0]);
    press(container, rows[0] ?? container, "End");
    expect(document.activeElement).toBe(rows[2]);
    container.remove();
  });

  it("leaves other keys and modified arrows alone", () => {
    const container = list();
    const first = container.querySelector("button");
    if (!first) throw new Error("Missing row");
    first.focus();
    expect(press(container, first, "Enter")).toEqual({ handled: false, prevented: false });
    expect(press(container, first, "ArrowDown", true)).toEqual({
      handled: false,
      prevented: false,
    });
    expect(document.activeElement).toBe(first);
    container.remove();
  });
});

describe("typedCharacter", () => {
  it("returns printable characters, including AltGr combinations", () => {
    expect(typedCharacter({ ...plain, key: "a" })).toBe("a");
    expect(typedCharacter({ ...plain, key: "A", shiftKey: true })).toBe("A");
    expect(typedCharacter({ ...plain, key: "注" })).toBe("注");
    expect(typedCharacter({ ...plain, key: "@", ctrlKey: true, altKey: true })).toBe("@");
  });

  it("ignores shortcuts, control keys and the space bar", () => {
    expect(typedCharacter({ ...plain, key: "c", ctrlKey: true })).toBeNull();
    expect(typedCharacter({ ...plain, key: "c", metaKey: true })).toBeNull();
    expect(typedCharacter({ ...plain, key: "c", altKey: true })).toBeNull();
    expect(typedCharacter({ ...plain, key: "Enter" })).toBeNull();
    expect(typedCharacter({ ...plain, key: " " })).toBeNull();
  });
});

describe("isMenuKey", () => {
  it("accepts the menu key and Shift+F10 only", () => {
    expect(isMenuKey({ ...plain, key: "ContextMenu" })).toBe(true);
    expect(isMenuKey({ ...plain, key: "F10", shiftKey: true })).toBe(true);
    expect(isMenuKey({ ...plain, key: "F10" })).toBe(false);
    expect(isMenuKey({ ...plain, key: "Enter" })).toBe(false);
  });
});
