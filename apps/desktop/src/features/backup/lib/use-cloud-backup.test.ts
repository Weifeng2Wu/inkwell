// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CloudStatus, DEFAULT_CLOUD_CONFIG } from "./cloud-backup";
import { type CloudBackupController, useCloudBackup } from "./use-cloud-backup";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const result = {
  key: "snapshot",
  createdAt: "2026-11-15T12:00:00Z",
  project: "project",
  fileCount: 1,
  totalBytes: 10,
  uploadedFiles: 1,
  unchanged: false,
  skipped: [],
  skippedCount: 0,
};
const calls = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(
      ([, args]) => (args as { request: { type: string } }).request.type === "backup",
    );
let controller: CloudBackupController;
let args: Parameters<typeof useCloudBackup>[0];
let status: CloudStatus;
let root: ReturnType<typeof createRoot>;
const render = (updates: Partial<typeof args> = {}) =>
  act(async () => {
    args = { ...args, ...updates };
    root.render(createElement(Harness));
  });
const advance = (minutes: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(minutes * 60_000);
  });
function Harness() {
  controller = useCloudBackup(args);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  status = {
    config: { ...DEFAULT_CLOUD_CONFIG, enabled: true },
    hasCredentials: true,
    lastBackup: null,
  };
  vi.mocked(invoke).mockImplementation(async (_command, options) => {
    const request = (options as { request: { type: string } }).request;
    return request.type === "status" ? status : result;
  });
  args = { projectPath: "/project", busy: false, flush: vi.fn(async () => {}) };
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("cloud backup scheduling", () => {
  it("skips scheduled work while a manual upload is already running", async () => {
    let complete: ((value: typeof result) => void) | undefined;
    const uploading = new Promise<typeof result>((resolve) => {
      complete = resolve;
    });
    vi.mocked(invoke).mockImplementation(async (_command, options) =>
      (options as { request: { type: string } }).request.type === "backup" ? uploading : status,
    );
    await render();
    let task: Promise<unknown> | undefined;
    await act(async () => {
      task = controller.backupNow();
    });
    await advance(30);
    expect(calls()).toHaveLength(1);
    await act(async () => {
      complete?.(result);
      await task;
    });
    expect(calls()).toHaveLength(1);
    expect(controller.running).toBe(false);
  });
  it("defaults to thirty minutes, saves buffers and defers while editing is busy", async () => {
    await render({ busy: true });
    await advance(30);
    expect(calls()).toHaveLength(0);
    await render({ busy: false });
    expect(args.flush).toHaveBeenCalledOnce();
    expect(calls()).toHaveLength(1);
    expect(calls()[0]?.[1]).toEqual({ request: { type: "backup", projectPath: "/project" } });
    expect(controller.notice).toBe("cloudBackup.backedUp");
  });

  it("does not schedule when disabled or without an open project", async () => {
    status.config.enabled = false;
    await render();
    await advance(120);
    expect(calls()).toHaveLength(0);
    status.config.enabled = true;
    await render({ projectPath: null });
    await advance(120);
    expect(calls()).toHaveLength(0);
    expect(args.flush).not.toHaveBeenCalled();
  });

  it("serializes manual backups and never uploads if the project changes during saving", async () => {
    let resolve: (() => void) | undefined;
    const saving = new Promise<void>((done) => {
      resolve = done;
    });
    await render({ flush: () => saving });
    let task: Promise<unknown> | undefined;
    await act(async () => {
      task = controller.backupNow();
    });
    await act(async () => {
      expect(await controller.backupNow()).toBeNull();
    });
    await render({ projectPath: "/other" });
    await act(async () => {
      resolve?.();
      await task;
    });
    await advance(0.1);
    expect(calls()).toHaveLength(0);
    expect(controller.notice).toBeNull();
    expect(controller.lastBackup).toBeNull();
  });

  it("reports save and network failures without an unhandled rejection or console overlay", async () => {
    await render({
      flush: async () => {
        throw new Error("unsaved");
      },
    });
    await act(async () => {
      await controller.backupNow();
    });
    expect(controller.error).toBe("cloudBackup.errors.flush");
    expect(calls()).toHaveLength(0);
    await render({ flush: async () => {} });
    vi.mocked(invoke).mockImplementation(async (_command, options) => {
      if ((options as { request: { type: string } }).request.type === "backup")
        throw "CLOUD_NETWORK";
      return status;
    });
    await advance(30);
    expect(controller.error).toBe("cloudBackup.errors.network");
    expect(controller.running).toBe(false);
  });
});
