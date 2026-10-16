export const SHORTCUTS = [
  { id: "openProject", category: "workspace", scope: "app", default: "Mod+O" },
  { id: "closeTab", category: "workspace", scope: "app", default: "Mod+W" },
  { id: "settings", category: "workspace", scope: "app", default: "Mod+," },
  { id: "sidebar", category: "workspace", scope: "app", default: "Mod+Shift+E" },
  { id: "terminal", category: "workspace", scope: "app", default: "Mod+J" },
  { id: "compile", category: "latex", scope: "app", default: "Mod+Shift+B" },
  { id: "comment", category: "latex", scope: "latex", default: "Mod+/" },
  { id: "bold", category: "markdown", scope: "markdown", default: "Mod+B" },
  { id: "italic", category: "markdown", scope: "markdown", default: "Mod+I" },
  { id: "link", category: "markdown", scope: "markdown", default: "Mod+K" },
  { id: "send", category: "chat", scope: "chat", default: "Enter" },
] as const;

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
export type ShortcutBindings = Record<ShortcutId, string>;
export const SHORTCUT_STORAGE_KEY = "inkwell-keyboard-shortcuts-v1";
export const DEFAULT_SHORTCUTS = Object.fromEntries(
  SHORTCUTS.map((item) => [item.id, item.default]),
) as ShortcutBindings;

type KeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing"
>;

export function shortcutFromEvent(event: KeyEvent): string | null {
  if (
    event.isComposing ||
    ["Control", "Meta", "Alt", "Shift", "Dead", "Unidentified"].includes(event.key)
  )
    return null;
  let key = event.key;
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit\d$/.test(event.code)) key = event.code.slice(5);
  else if (event.code === "Slash") key = "/";
  else if (event.code === "Comma") key = ",";
  else if (key.length === 1) key = key.toUpperCase();
  return [
    event.ctrlKey || event.metaKey ? "Mod" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

export function matchesShortcut(event: KeyEvent, binding: string): boolean {
  return Boolean(binding) && shortcutFromEvent(event) === binding;
}

export function validShortcut(binding: string, id: ShortcutId): boolean {
  if (!binding) return true;
  const functionKey = /(?:^|\+)F(\d+)$/.exec(binding);
  if (functionKey && (Number(functionKey[1]) < 1 || Number(functionKey[1]) > 12)) return false;
  if (id === "send" && binding === "Enter") return true;
  if (!/^(Mod\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|,|\/|Enter|F\d{1,2})$/.test(binding)) return false;
  if (!binding.includes("Mod+") && !binding.includes("Alt+") && !/^F\d{1,2}$/.test(binding))
    return false;
  return ![
    "Mod+R",
    "Mod+Shift+R",
    "Mod+L",
    "Mod+T",
    "Mod+N",
    "Mod+Q",
    "Mod+C",
    "Mod+V",
    "Mod+X",
    "Mod+Z",
    "Mod+Shift+Z",
    "Mod+A",
    "Mod+S",
    "Mod+F",
    "Mod+H",
    "Mod+P",
    "Mod+Y",
    "F5",
    "F11",
    "F12",
    "Alt+F4",
    "Mod+Alt+Q",
  ].includes(binding);
}

export function shortcutConflict(
  bindings: ShortcutBindings,
  id: ShortcutId,
  binding: string,
): ShortcutId | undefined {
  if (!binding) return;
  const selected = SHORTCUTS.find((item) => item.id === id);
  return SHORTCUTS.find(
    (item) =>
      item.id !== id &&
      bindings[item.id] === binding &&
      (item.scope === "app" || selected?.scope === "app" || item.scope === selected?.scope),
  )?.id;
}

export function parseShortcutBindings(raw: string | null): ShortcutBindings {
  const result = { ...DEFAULT_SHORTCUTS };
  if (!raw) return result;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return result;
    for (const item of SHORTCUTS) {
      const binding = (parsed as Record<string, unknown>)[item.id];
      if (typeof binding === "string" && validShortcut(binding, item.id)) result[item.id] = binding;
    }
    for (const item of SHORTCUTS) {
      if (shortcutConflict(result, item.id, result[item.id])) result[item.id] = "";
    }
  } catch {
    return result;
  }
  return result;
}

export function displayShortcut(binding: string, mac: boolean): string {
  return binding
    .split("+")
    .map((key) => (key === "Mod" ? (mac ? "⌘" : "Ctrl") : key))
    .join(" + ");
}
