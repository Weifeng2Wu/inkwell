import { invoke } from "@tauri-apps/api/core";

const keys = new Set([
  "editor-settings",
  "latex-settings",
  "recent-projects",
  "sidebarWidth",
  "rightPanelWidth",
  "terminalHeight",
  "inkwell-agent-selection-v1",
  "inkwell-layout-parser-v1",
  "inkwell-quick-start-v1",
  "inkwell-keyboard-shortcuts-v1",
  "inkwell-locale",
  "opencode-selected-agent",
  "opencode-selected-model",
  "theme",
]);
const prefixes = [
  "inkwell-agent-config-v1:",
  "inkwell-external-chat-v1:",
  "inkwell-conversation-archive-v1:",
];
const cache = new Map<string, string>();
const pending = new Map<string, string | null>();
let initialized = false;
let initializing: Promise<void> | undefined;
let saving: Promise<void> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function desktopStorage() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function browserStorage() {
  return typeof localStorage !== "undefined" ? localStorage : window.localStorage;
}

export function storageRequest<Result>(request: Record<string, unknown>): Promise<Result> {
  return invoke<Result>("app_storage_request", { request });
}

export function storedPanelWidth(key: string, minimum: number, maximum: number) {
  try {
    if (typeof window === "undefined") return 280;
    const value = Number(appStorage.getItem(key));
    return Number.isFinite(value) && value >= minimum && value <= maximum ? value : 280;
  } catch {
    return 280;
  }
}

export async function initializeAppStorage() {
  if (!desktopStorage() || initialized) return;
  if (initializing) return initializing;
  initializing = (async () => {
    type Bootstrap = { settings: Record<string, string>; migratedKeys?: string[] };
    let result = await storageRequest<Bootstrap>({ type: "bootstrap" });
    const migrated = new Set(result.migratedKeys ?? []);
    const entries: [string, string][] = [];
    let storage: Storage | undefined;
    try {
      storage = browserStorage();
    } catch {}
    for (let index = 0; storage && index < storage.length; index += 1) {
      const key = storage.key(index);
      if (
        !key ||
        migrated.has(key) ||
        (!keys.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)))
      )
        continue;
      const value = storage.getItem(key);
      if (value !== null) entries.push([key, value]);
    }
    if (entries.length) result = await storageRequest<Bootstrap>({ type: "bootstrap", entries });
    cache.clear();
    for (const [key, value] of Object.entries(result.settings)) cache.set(key, value);
    initialized = true;
    const theme = cache.get("theme");
    try {
      if (theme) storage?.setItem("theme", theme);
    } catch {}
  })();
  try {
    await initializing;
  } finally {
    initializing = undefined;
  }
}

export async function flushAppStorage(): Promise<void> {
  if (timer) clearTimeout(timer);
  if (saving) await saving;
  if (!pending.size) return;
  const entries = [...pending];
  const operation = storageRequest({ type: "settings_write", entries }).then(() => {
    for (const [key, value] of entries) if (pending.get(key) === value) pending.delete(key);
  });
  saving = operation;
  try {
    await operation;
  } finally {
    saving = undefined;
  }
  if (pending.size) await flushAppStorage();
}

function scheduleWrite() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushAppStorage().catch((error: unknown) => {
      window.dispatchEvent(new CustomEvent("inkwell-storage-error", { detail: String(error) }));
    });
  }, 80);
}

export const appStorage = {
  getItem(key: string): string | null {
    if (!desktopStorage()) return browserStorage().getItem(key);
    if (!initialized) throw new Error("Application database is not ready.");
    return cache.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    if (!desktopStorage()) {
      browserStorage().setItem(key, value);
      return;
    }
    if (!initialized) throw new Error("Application database is not ready.");
    cache.set(key, value);
    pending.set(key, value);
    scheduleWrite();
  },
  removeItem(key: string) {
    if (!desktopStorage()) {
      browserStorage().removeItem(key);
      return;
    }
    if (!initialized) throw new Error("Application database is not ready.");
    cache.delete(key);
    pending.set(key, null);
    scheduleWrite();
  },
};
