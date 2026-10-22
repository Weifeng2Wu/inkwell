import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { appStorage, flushAppStorage } from "@/lib/storage/app-storage";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "latest"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "installed";
export interface UpdateState {
  version: string;
  enabled: boolean;
  ready: boolean;
  automatic: boolean;
  phase: UpdatePhase;
  release: { version: string; body?: string } | null;
  progress?: number;
  error: string;
}
const initial: UpdateState = {
  version: "",
  enabled: false,
  ready: false,
  automatic: false,
  phase: "idle",
  release: null,
  error: "",
};
let state = initial;
let pending: Update | null = null;
let busy = false;
let initialization: Promise<void> | undefined;
const listeners = new Set<() => void>();
const preferenceKey = "inkwell-auto-update-v1";
function patch(change: Partial<UpdateState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}
export const subscribeUpdates = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getUpdateState = () => state;
export const getServerUpdateState = () => initial;

export function initializeUpdates() {
  if (initialization) return initialization;
  initialization = (async () => {
    if (!isTauri()) {
      patch({ ready: true });
      return;
    }
    try {
      const [version, enabled] = await Promise.all([
        getVersion(),
        invoke<boolean>("app_updates_enabled"),
      ]);
      patch({
        version,
        enabled,
        automatic: appStorage.getItem(preferenceKey) === "true",
        ready: true,
      });
    } catch (cause) {
      patch({ ready: true, error: String(cause) });
    }
  })();
  return initialization;
}

export async function setAutomaticUpdates(automatic: boolean) {
  try {
    appStorage.setItem(preferenceKey, String(automatic));
    await flushAppStorage();
    patch({ automatic, error: "" });
    if (automatic) void checkForUpdates(true);
  } catch (cause) {
    patch({ error: String(cause) });
  }
}

export async function checkForUpdates(automatic = false) {
  if (busy || !state.enabled || ["downloaded", "installed"].includes(state.phase)) return;
  busy = true;
  patch({ error: "", phase: "checking", release: null });
  try {
    await pending?.close();
    pending = null;
    pending = await check({ timeout: 30_000 });
    patch({
      release: pending ? { version: pending.version, body: pending.body } : null,
      phase: pending ? "available" : "latest",
    });
  } catch (cause) {
    patch({ error: String(cause), phase: "idle" });
  } finally {
    busy = false;
  }
  if (automatic && state.automatic && state.phase === "available") await downloadUpdate();
}

export async function downloadUpdate() {
  if (busy || !pending || state.phase !== "available") return;
  busy = true;
  patch({ error: "", phase: "downloading", progress: undefined });
  let total = 0;
  let received = 0;
  try {
    await pending.download(
      (event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          received = 0;
        }
        if (event.event === "Progress") received += event.data.chunkLength;
        patch({ progress: total ? Math.min(100, (received / total) * 100) : undefined });
      },
      { timeout: 300_000 },
    );
    patch({ phase: "downloaded" });
  } catch (cause) {
    await pending.close().catch(() => {});
    pending = null;
    patch({ error: String(cause), phase: "idle", release: null });
  } finally {
    busy = false;
  }
}

export async function installUpdate() {
  if (state.phase === "available") await downloadUpdate();
  if (busy || !pending || state.phase !== "downloaded") return;
  busy = true;
  patch({ error: "", phase: "installing" });
  try {
    await saveBeforeUpdate();
    await pending.install();
    patch({ phase: "installed" });
  } catch (cause) {
    patch({ error: String(cause), phase: "downloaded" });
  } finally {
    busy = false;
  }
}

export async function restartAfterUpdate() {
  try {
    await saveBeforeUpdate();
    await invoke("restart_after_update");
  } catch (cause) {
    patch({ error: String(cause) });
  }
}

async function saveBeforeUpdate() {
  if (typeof window !== "undefined") {
    const tasks: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent("inkwell-before-close", { detail: tasks }));
    await Promise.all(tasks);
  }
  await flushAppStorage();
}
