import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.mocked(invoke).mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setupDesktop(entries: [string, string][] = []) {
  const values = new Map(entries);
  const storage = {
    length: values.size,
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  const window = Object.assign(new EventTarget(), {
    __TAURI_INTERNALS__: {},
    localStorage: storage,
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("localStorage", storage);
  return { values, window };
}

describe("SQLite settings adapter", () => {
  it("hydrates database values before reads and imports only owned keys without deleting originals", async () => {
    const { values } = setupDesktop([
      ["theme", "dark"],
      ["unrelated-token", "private"],
    ]);
    vi.mocked(invoke).mockResolvedValue({ settings: { theme: "nord", "editor-settings": "{}" } });
    const { appStorage, initializeAppStorage } = await import("./app-storage");
    expect(() => appStorage.getItem("theme")).toThrow(/not ready/);
    await Promise.all([initializeAppStorage(), initializeAppStorage()]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith("app_storage_request", {
      request: { type: "bootstrap", entries: [["theme", "dark"]] },
    });
    expect(appStorage.getItem("theme")).toBe("nord");
    expect(values.get("unrelated-token")).toBe("private");
  });

  it("batches writes and retains failed changes for retry instead of falling back to stale browser data", async () => {
    setupDesktop();
    vi.mocked(invoke).mockResolvedValueOnce({ settings: {} });
    const { appStorage, initializeAppStorage, flushAppStorage } = await import("./app-storage");
    await initializeAppStorage();
    appStorage.setItem("editor-settings", "first");
    appStorage.setItem("editor-settings", "latest");
    appStorage.removeItem("recent-projects");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    await expect(flushAppStorage()).rejects.toThrow("disk full");
    expect(appStorage.getItem("editor-settings")).toBe("latest");
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true });
    await flushAppStorage();
    expect(invoke).toHaveBeenLastCalledWith("app_storage_request", {
      request: {
        type: "settings_write",
        entries: [
          ["editor-settings", "latest"],
          ["recent-projects", null],
        ],
      },
    });
  });

  it("does not lose newer writes that arrive while a batch is saving", async () => {
    setupDesktop();
    vi.mocked(invoke).mockResolvedValueOnce({ settings: {} });
    const { appStorage, initializeAppStorage, flushAppStorage } = await import("./app-storage");
    await initializeAppStorage();
    let complete: (value: unknown) => void = () => {};
    vi.mocked(invoke)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue({ ok: true });
    appStorage.setItem("theme", "light");
    const saving = flushAppStorage();
    appStorage.setItem("theme", "dark");
    complete({ ok: true });
    await saving;
    expect(invoke).toHaveBeenLastCalledWith("app_storage_request", {
      request: { type: "settings_write", entries: [["theme", "dark"]] },
    });
  });

  it("retries failed initialization and never exposes default desktop state on failure", async () => {
    setupDesktop();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("locked"));
    const { appStorage, initializeAppStorage } = await import("./app-storage");
    await expect(initializeAppStorage()).rejects.toThrow("locked");
    expect(() => appStorage.setItem("theme", "dark")).toThrow(/not ready/);
    vi.mocked(invoke).mockResolvedValueOnce({ settings: { theme: "light" } });
    await initializeAppStorage();
    expect(appStorage.getItem("theme")).toBe("light");
  });
  it("does not reread migrated conversation payloads on later desktop launches", async () => {
    const key = 'inkwell-external-chat-v1:["/project","codex"]';
    setupDesktop([[key, "large old payload"]]);
    const read = vi.spyOn(localStorage, "getItem");
    vi.mocked(invoke).mockResolvedValueOnce({ settings: {}, migratedKeys: [key] });
    const { initializeAppStorage } = await import("./app-storage");
    await initializeAppStorage();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalledWith(key);
  });
});
