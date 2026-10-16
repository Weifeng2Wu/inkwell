import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  displayShortcut,
  matchesShortcut,
  parseShortcutBindings,
  SHORTCUTS,
  shortcutConflict,
  shortcutFromEvent,
  validShortcut,
} from "./keyboard-shortcuts";

const event = (overrides: Partial<KeyboardEvent> = {}) => ({
  key: "b",
  code: "KeyB",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...overrides,
});

describe("custom keyboard shortcuts", () => {
  it("ships defaults without overlapping bindings", () => {
    for (const item of SHORTCUTS) {
      expect(validShortcut(item.default, item.id)).toBe(true);
      expect(shortcutConflict(DEFAULT_SHORTCUTS, item.id, item.default)).toBeUndefined();
    }
  });
  it("normalizes Ctrl and Cmd and keyboard layout differences", () => {
    expect(shortcutFromEvent(event())).toBe("Mod+B");
    expect(shortcutFromEvent(event({ ctrlKey: false, metaKey: true, key: "ㅠ" }))).toBe("Mod+B");
    expect(shortcutFromEvent(event({ key: "?", code: "Slash", shiftKey: true }))).toBe(
      "Mod+Shift+/",
    );
    expect(shortcutFromEvent(event({ key: "<", code: "Comma", shiftKey: true }))).toBe(
      "Mod+Shift+,",
    );
  });
  it("requires an exact modifier match and ignores composition", () => {
    expect(matchesShortcut(event(), "Mod+B")).toBe(true);
    expect(matchesShortcut(event({ altKey: true }), "Mod+B")).toBe(false);
    expect(matchesShortcut(event({ shiftKey: true }), "Mod+B")).toBe(false);
    expect(matchesShortcut(event({ isComposing: true }), "Mod+B")).toBe(false);
    expect(matchesShortcut(event(), "")).toBe(false);
    expect(shortcutFromEvent(event({ key: "Control", code: "ControlLeft" }))).toBeNull();
  });
  it("allows unbinding and bare Enter only for chat", () => {
    expect(validShortcut("", "bold")).toBe(true);
    expect(validShortcut("Enter", "send")).toBe(true);
    expect(validShortcut("Enter", "bold")).toBe(false);
    expect(validShortcut("B", "bold")).toBe(false);
    expect(validShortcut("Shift+Enter", "send")).toBe(false);
    expect(validShortcut("Mod+Enter", "send")).toBe(true);
  });
  it.each([
    "Mod+C",
    "Mod+V",
    "Mod+Z",
    "Mod+R",
    "Alt+F4",
    "F0",
    "F99",
    "Mod+F99",
  ])("rejects reserved or invalid %s", (binding) => {
    expect(validShortcut(binding, "bold")).toBe(false);
  });
  it("detects application and same-scope conflicts", () => {
    expect(shortcutConflict(DEFAULT_SHORTCUTS, "bold", "Mod+O")).toBe("openProject");
    expect(shortcutConflict(DEFAULT_SHORTCUTS, "bold", "Mod+I")).toBe("italic");
    expect(shortcutConflict(DEFAULT_SHORTCUTS, "comment", "Mod+B")).toBeUndefined();
  });
  it("loads customized and unbound keys while ignoring corrupt storage", () => {
    expect(parseShortcutBindings('{"bold":"Mod+Shift+U","italic":""}')).toMatchObject({
      bold: "Mod+Shift+U",
      italic: "",
    });
    expect(parseShortcutBindings("invalid")).toEqual(DEFAULT_SHORTCUTS);
    expect(parseShortcutBindings("[]")).toEqual(DEFAULT_SHORTCUTS);
    expect(parseShortcutBindings('{"bold":"Mod+V","send":42}')).toEqual(DEFAULT_SHORTCUTS);
  });
  it("sanitizes overlapping persisted shortcuts", () => {
    const bindings = parseShortcutBindings('{"bold":"Mod+O"}');
    for (const item of SHORTCUTS)
      expect(shortcutConflict(bindings, item.id, bindings[item.id])).toBeUndefined();
  });
  it("formats platform shortcut labels", () => {
    expect(displayShortcut("Mod+Shift+B", true)).toBe("⌘ + Shift + B");
    expect(displayShortcut("Mod+Enter", false)).toBe("Ctrl + Enter");
  });
});
