import type { Monaco } from "@monaco-editor/react";

export function monacoShortcut(monaco: Monaco, binding: string): number[] {
  if (!binding) return [];
  const parts = binding.split("+");
  const key = parts.pop() ?? "";
  const name = /^[A-Z]$/.test(key)
    ? `Key${key}`
    : /^\d$/.test(key)
      ? `Digit${key}`
      : key === "/"
        ? "Slash"
        : key === ","
          ? "Comma"
          : key;
  const keycode = monaco.KeyCode[name as keyof typeof monaco.KeyCode];
  if (typeof keycode !== "number") return [];
  return [
    keycode |
      (parts.includes("Mod") ? monaco.KeyMod.CtrlCmd : 0) |
      (parts.includes("Alt") ? monaco.KeyMod.Alt : 0) |
      (parts.includes("Shift") ? monaco.KeyMod.Shift : 0),
  ];
}
