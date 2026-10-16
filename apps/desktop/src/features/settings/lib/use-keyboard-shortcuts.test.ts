import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SHORTCUTS, SHORTCUT_STORAGE_KEY } from "./keyboard-shortcuts";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

afterEach(() => vi.unstubAllGlobals());

function controller() {
  const captured: { current?: ReturnType<typeof useKeyboardShortcuts> } = {};
  function Probe() {
    captured.current = useKeyboardShortcuts();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  if (!captured.current) throw new Error("Shortcut controller missing");
  return captured.current;
}

describe("shortcut persistence", () => {
  it("saves edits, broadcasts updates and resets only keyboard preferences", () => {
    const storage = new Map<string, string>([["editor-settings", "keep"]]);
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
      dispatchEvent,
    });
    const shortcuts = controller();
    expect(shortcuts.updateShortcut("bold", "Mod+Shift+U")).toBe(true);
    expect(JSON.parse(storage.get(SHORTCUT_STORAGE_KEY) ?? "{}").bold).toBe("Mod+Shift+U");
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(shortcuts.updateShortcut("italic", "Mod+Shift+U")).toBe(false);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(shortcuts.updateShortcut("send", "")).toBe(true);
    shortcuts.resetShortcuts();
    expect(JSON.parse(storage.get(SHORTCUT_STORAGE_KEY) ?? "{}")).toEqual(DEFAULT_SHORTCUTS);
    expect(storage.get("editor-settings")).toBe("keep");
  });
  it("propagates storage errors instead of reporting a saved edit", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error("Storage full");
        },
      },
      dispatchEvent,
    });
    expect(() => controller().updateShortcut("bold", "Mod+Shift+U")).toThrow("Storage full");
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
