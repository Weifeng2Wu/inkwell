// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitBackupResult } from "@/types/git";
import { type GitBackupController, type UseGitBackupArgs, useGitBackup } from "./use-git-backup";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const MINUTE = 60_000;
const done: GitBackupResult = {
  committed: true,
  pushed: false,
  skippedLargeFiles: [],
  pushError: null,
};

let root: Root;
let container: HTMLElement;
let controller: GitBackupController;
let args: UseGitBackupArgs;

function Harness(props: UseGitBackupArgs) {
  controller = useGitBackup(props);
  return null;
}

async function render(updates: Partial<UseGitBackupArgs> = {}) {
  args = { ...args, ...updates };
  await act(async () => root.render(createElement(Harness, args)));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const backupCalls = () =>
  vi.mocked(invoke).mock.calls.filter(([command]) => command === "git_backup");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 14, 23, 5));
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(done);
  container = document.createElement("div");
  root = createRoot(container);
  args = {
    projectPath: "/paper",
    isRepo: true,
    enabled: true,
    intervalMinutes: 10,
    push: true,
    busy: false,
    flush: vi.fn(async () => {}),
    onDone: vi.fn(),
    onError: vi.fn(),
    onLargeFilesSkipped: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scheduled backups", () => {
  it("flushes open files, then commits at each interval with a dated message", async () => {
    const order: string[] = [];
    vi.mocked(args.flush).mockImplementation(async () => {
      order.push("flush");
    });
    vi.mocked(invoke).mockImplementation(async () => {
      order.push("backup");
      return done;
    });
    await render();
    expect(controller.lastBackupAt).toBeNull();
    await advance(10 * MINUTE - 1);
    expect(backupCalls()).toHaveLength(0);
    await advance(1);
    expect(order).toEqual(["flush", "backup"]);
    expect(invoke).toHaveBeenCalledWith("git_backup", {
      dir: "/paper",
      message: "Auto backup 2026-11-14 23:15",
      push: true,
    });
    expect(args.onDone).toHaveBeenCalledWith(done);
    expect(controller.lastBackupAt).toBe(Date.now());
    expect(controller.running).toBe(false);
    await advance(10 * MINUTE);
    expect(backupCalls()).toHaveLength(2);
  });

  it("does nothing while disabled, without a project, or outside a repository", async () => {
    await render({ enabled: false });
    await advance(60 * MINUTE);
    await render({ enabled: true, isRepo: false });
    await advance(60 * MINUTE);
    await render({ isRepo: true, projectPath: null });
    await advance(60 * MINUTE);
    expect(backupCalls()).toHaveLength(0);
    expect(args.flush).not.toHaveBeenCalled();
  });

  it("uses the latest arguments without restarting the countdown", async () => {
    await render();
    await advance(9 * MINUTE);
    const flush = vi.fn(async () => {});
    const onDone = vi.fn();
    await render({ push: false, flush, onDone, onError: vi.fn() });
    await advance(MINUTE);
    expect(backupCalls()).toHaveLength(1);
    expect(backupCalls()[0]?.[1]).toMatchObject({ push: false });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("restarts the countdown when the interval changes", async () => {
    await render();
    await advance(4 * MINUTE);
    await render({ intervalMinutes: 5 });
    await advance(4 * MINUTE);
    expect(backupCalls()).toHaveLength(0);
    await advance(MINUTE);
    expect(backupCalls()).toHaveLength(1);
  });

  it("runs while the window is hidden", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    try {
      await render();
      await advance(10 * MINUTE);
      expect(backupCalls()).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("skips an interval while the previous backup is still running", async () => {
    let release: (value: GitBackupResult) => void = () => {};
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve as (value: GitBackupResult) => void;
        }),
    );
    await render();
    await advance(10 * MINUTE);
    expect(controller.running).toBe(true);
    await advance(10 * MINUTE);
    expect(backupCalls()).toHaveLength(1);
    await act(async () => release(done));
    expect(controller.running).toBe(false);
    await advance(10 * MINUTE);
    expect(backupCalls()).toHaveLength(2);
  });

  it("waits while the caller is busy and backs up as soon as it is free", async () => {
    await render({ busy: true });
    await advance(25 * MINUTE);
    expect(backupCalls()).toHaveLength(0);
    await render({ busy: false });
    expect(backupCalls()).toHaveLength(1);
    // Nothing was pending, so a later busy period changes nothing.
    await render({ busy: true });
    await render({ busy: false });
    expect(backupCalls()).toHaveLength(1);
  });

  it("reports a repeated error once, and again after it changes or clears", async () => {
    vi.mocked(invoke).mockRejectedValue("GIT_BACKUP_IN_PROGRESS");
    await render();
    await advance(30 * MINUTE);
    expect(backupCalls()).toHaveLength(3);
    expect(args.onError).toHaveBeenCalledTimes(1);
    expect(args.onError).toHaveBeenCalledWith("GIT_BACKUP_IN_PROGRESS");
    expect(controller.lastError).toBe("GIT_BACKUP_IN_PROGRESS");
    expect(controller.lastBackupAt).toBeNull();
    expect(args.onDone).not.toHaveBeenCalled();

    vi.mocked(invoke).mockRejectedValue("GIT_BACKUP_NO_IDENTITY");
    await advance(10 * MINUTE);
    expect(args.onError).toHaveBeenCalledTimes(2);

    vi.mocked(invoke).mockResolvedValue(done);
    await advance(10 * MINUTE);
    expect(controller.lastError).toBeNull();
    vi.mocked(invoke).mockRejectedValue("GIT_BACKUP_NO_IDENTITY");
    await advance(10 * MINUTE);
    expect(args.onError).toHaveBeenCalledTimes(3);
  });

  it("does not commit when open files cannot be saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(args.flush).mockRejectedValue(new Error("disk full"));
    await render();
    await advance(10 * MINUTE);
    expect(backupCalls()).toHaveLength(0);
    expect(args.onError).toHaveBeenCalledWith("GIT_BACKUP_FLUSH_FAILED");
  });

  it("reports the same skipped large files once", async () => {
    const skipped = { ...done, skippedLargeFiles: ["papers/huge.pdf"] };
    vi.mocked(invoke).mockResolvedValue(skipped);
    await render();
    await advance(30 * MINUTE);
    expect(args.onDone).toHaveBeenCalledTimes(3);
    expect(args.onLargeFilesSkipped).toHaveBeenCalledTimes(1);
    expect(args.onLargeFilesSkipped).toHaveBeenCalledWith(["papers/huge.pdf"]);
    vi.mocked(invoke).mockResolvedValue({
      ...done,
      skippedLargeFiles: ["a.bin", "papers/huge.pdf"],
    });
    await advance(10 * MINUTE);
    expect(args.onLargeFilesSkipped).toHaveBeenCalledTimes(2);
  });
});

describe("manual backups", () => {
  it("runs when automatic backup is off and the caller is busy", async () => {
    await render({ enabled: false, busy: true, push: false });
    let result: GitBackupResult | null = null;
    await act(async () => {
      result = await controller.backupNow();
    });
    expect(result).toEqual(done);
    expect(invoke).toHaveBeenCalledWith("git_backup", {
      dir: "/paper",
      message: "Auto backup 2026-11-14 23:05",
      push: false,
    });
    expect(controller.lastBackupAt).toBe(Date.now());
  });

  it("returns null without a repository", async () => {
    await render({ isRepo: false });
    await act(async () => {
      expect(await controller.backupNow()).toBeNull();
    });
    expect(backupCalls()).toHaveLength(0);
  });

  it("always reports errors and skipped files, and shares a running backup", async () => {
    vi.mocked(invoke).mockRejectedValue("GIT_BACKUP_IN_PROGRESS");
    await render();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await act(async () => {
        expect(await controller.backupNow()).toBeNull();
      });
    }
    expect(args.onError).toHaveBeenCalledTimes(2);

    vi.mocked(invoke).mockResolvedValue({ ...done, skippedLargeFiles: ["huge.bin"] });
    await act(async () => {
      const [first, second] = await Promise.all([controller.backupNow(), controller.backupNow()]);
      expect(first).toBe(second);
    });
    expect(backupCalls()).toHaveLength(3);
    await act(async () => {
      await controller.backupNow();
    });
    expect(args.onLargeFilesSkipped).toHaveBeenCalledTimes(2);
  });
});

describe("project changes", () => {
  it("resets state and ignores a backup that finishes for the previous project", async () => {
    await render();
    await act(async () => {
      await controller.backupNow();
    });
    expect(controller.lastBackupAt).not.toBeNull();

    let release: (value: GitBackupResult) => void = () => {};
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve as (value: GitBackupResult) => void;
        }),
    );
    let pending: Promise<GitBackupResult | null> = Promise.resolve(null);
    await act(async () => {
      pending = controller.backupNow();
    });
    expect(controller.running).toBe(true);
    vi.mocked(args.onDone).mockClear();

    await render({ projectPath: "/thesis" });
    expect(controller.lastBackupAt).toBeNull();
    expect(controller.running).toBe(false);
    await act(async () => {
      release(done);
      await pending;
    });
    expect(args.onDone).not.toHaveBeenCalled();
    expect(controller.lastBackupAt).toBeNull();

    // The new project has its own full interval.
    await advance(10 * MINUTE);
    expect(backupCalls().at(-1)?.[1]).toMatchObject({ dir: "/thesis" });
  });
});
