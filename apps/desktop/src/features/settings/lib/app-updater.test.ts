import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
  invoke: vi.fn(),
  check: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  flush: vi.fn(),
}));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: mocks.getVersion }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@/lib/storage/app-storage", () => ({
  appStorage: { getItem: mocks.getItem, setItem: mocks.setItem },
  flushAppStorage: mocks.flush,
}));

function release() {
  return {
    version: "0.2.0",
    body: "Release notes",
    close: vi.fn().mockResolvedValue(undefined),
    download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.getVersion.mockResolvedValue("0.1.5");
  mocks.invoke.mockResolvedValue(true);
  mocks.getItem.mockReturnValue(null);
  mocks.flush.mockResolvedValue(undefined);
});

describe("application updater", () => {
  it("provides the same complete update controls in all supported languages", async () => {
    const { updateLabels } = await import("./update-labels");
    for (const labels of Object.values(updateLabels)) {
      expect(Object.keys(labels).sort()).toEqual(Object.keys(updateLabels.en).sort());
      expect(Object.values(labels).every((value) => value.trim().length > 0)).toBe(true);
    }
  });
  it("initializes once and keeps automatic updates off by default", async () => {
    const updater = await import("./app-updater");
    await Promise.all([updater.initializeUpdates(), updater.initializeUpdates()]);
    expect(updater.getUpdateState()).toMatchObject({
      enabled: true,
      ready: true,
      automatic: false,
      version: "0.1.5",
    });
    expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it("persists the opt-in and downloads without installing", async () => {
    const update = release();
    mocks.check.mockResolvedValue(update);
    const updater = await import("./app-updater");
    await updater.initializeUpdates();
    await updater.setAutomaticUpdates(true);
    await vi.waitFor(() => expect(updater.getUpdateState().phase).toBe("downloaded"));
    expect(mocks.setItem).toHaveBeenCalledWith("inkwell-auto-update-v1", "true");
    expect(update.install).not.toHaveBeenCalled();
    await updater.checkForUpdates(true);
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await updater.installUpdate();
    expect(update.install).toHaveBeenCalledOnce();
    expect(updater.getUpdateState().phase).toBe("installed");
  });
  it("never installs a failed download or invalid signature and supports retry", async () => {
    const update = release();
    update.download.mockRejectedValueOnce(new Error("signature verification failed"));
    mocks.check.mockResolvedValue(update);
    const updater = await import("./app-updater");
    await updater.initializeUpdates();
    await updater.checkForUpdates();
    await updater.installUpdate();
    expect(update.install).not.toHaveBeenCalled();
    expect(updater.getUpdateState()).toMatchObject({
      phase: "idle",
      error: "Error: signature verification failed",
    });
    expect(update.close).toHaveBeenCalledOnce();
    await updater.checkForUpdates();
    await updater.installUpdate();
    expect(updater.getUpdateState().phase).toBe("installed");
  });
  it("prevents duplicate concurrent checks", async () => {
    let resolve!: (value: null) => void;
    mocks.check.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const updater = await import("./app-updater");
    await updater.initializeUpdates();
    const first = updater.checkForUpdates();
    await updater.checkForUpdates();
    await vi.waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(1));
    resolve(null);
    await first;
    expect(updater.getUpdateState().phase).toBe("latest");
  });
  it("retains a downloaded update if installation fails", async () => {
    const update = release();
    update.install.mockRejectedValueOnce(new Error("permission denied"));
    mocks.check.mockResolvedValue(update);
    const updater = await import("./app-updater");
    await updater.initializeUpdates();
    await updater.checkForUpdates();
    await updater.installUpdate();
    expect(updater.getUpdateState().phase).toBe("downloaded");
    await updater.installUpdate();
    expect(update.download).toHaveBeenCalledOnce();
    expect(updater.getUpdateState().phase).toBe("installed");
  });
  it("does not enable automation when persistence fails", async () => {
    mocks.flush.mockRejectedValueOnce(new Error("disk full"));
    const updater = await import("./app-updater");
    await updater.initializeUpdates();
    await updater.setAutomaticUpdates(true);
    expect(updater.getUpdateState()).toMatchObject({ automatic: false, error: "Error: disk full" });
    expect(mocks.check).not.toHaveBeenCalled();
  });
});
