import type { Monaco } from "@monaco-editor/react";
import { describe, expect, it } from "vitest";
import { monacoShortcut } from "./shortcut-keybinding";

describe("Monaco custom shortcut mapping", () => {
  const monaco = {
    KeyCode: { KeyB: 1, KeyU: 2, Slash: 3, Comma: 4, Enter: 5 },
    KeyMod: { CtrlCmd: 256, Alt: 512, Shift: 1024 },
  } as unknown as Monaco;
  it("maps custom combinations and punctuation to Monaco key codes", () => {
    expect(monacoShortcut(monaco, "Mod+Shift+U")).toEqual([256 | 1024 | 2]);
    expect(monacoShortcut(monaco, "Mod+/")).toEqual([256 | 3]);
    expect(monacoShortcut(monaco, "Alt+Enter")).toEqual([512 | 5]);
  });
  it("does not register disabled or unsupported bindings", () => {
    expect(monacoShortcut(monaco, "")).toEqual([]);
    expect(monacoShortcut(monaco, "Unknown")).toEqual([]);
  });
});
