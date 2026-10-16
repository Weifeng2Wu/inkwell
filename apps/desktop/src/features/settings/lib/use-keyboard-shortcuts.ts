"use client";

import { useSyncExternalStore } from "react";
import { appStorage } from "@/lib/storage/app-storage";
import {
  DEFAULT_SHORTCUTS,
  parseShortcutBindings,
  SHORTCUT_STORAGE_KEY,
  type ShortcutBindings,
  type ShortcutId,
  shortcutConflict,
  validShortcut,
} from "./keyboard-shortcuts";

const changed = "inkwell-shortcuts-changed";
let cachedRaw: string | null | undefined;
let cachedBindings = DEFAULT_SHORTCUTS;

function snapshot() {
  try {
    const raw = appStorage.getItem(SHORTCUT_STORAGE_KEY);
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedBindings = parseShortcutBindings(raw);
    }
  } catch {
    return cachedBindings;
  }
  return cachedBindings;
}

function subscribe(notify: () => void) {
  window.addEventListener(changed, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(changed, notify);
    window.removeEventListener("storage", notify);
  };
}

function save(bindings: ShortcutBindings) {
  appStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(bindings));
  window.dispatchEvent(new Event(changed));
}

export function useKeyboardShortcuts() {
  const bindings = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_SHORTCUTS);
  return {
    bindings,
    updateShortcut(id: ShortcutId, binding: string) {
      const current = snapshot();
      if (!validShortcut(binding, id) || shortcutConflict(current, id, binding)) return false;
      save({ ...current, [id]: binding });
      return true;
    },
    resetShortcuts() {
      save({ ...DEFAULT_SHORTCUTS });
    },
  };
}
