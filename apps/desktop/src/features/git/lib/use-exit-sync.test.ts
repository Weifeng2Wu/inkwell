// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import type { GitBackupResult } from "@/types/git";
import { ExitSyncDialog } from "../components/exit-sync-dialog";
import { type ExitSyncController, type UseExitSyncArgs, useExitSync } from "./use-exit-sync";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

const backedUp: GitBackupResult = {
  committed: true,
  pushed: true,
  skippedLargeFiles: [],
  pushError: null,
};
const status = {
  branch: "main",
  ahead: 0,
  behind: 0,
  hasUpstream: true,
  hasCommits: true,
  changes: [],
  isRepo: true,
};

let root: Root;
let container: HTMLElement;
let controller: ExitSyncController;
let args: UseExitSyncArgs;
let responses: Record<string, (() => unknown) | undefined>;

function Harness(props: UseExitSyncArgs) {
  controller = useExitSync(props);
  return createElement(I18nProvider, null, createElement(ExitSyncDialog, { controller }));
}

async function render(updates: Partial<UseExitSyncArgs> = {}) {
  args = { ...args, ...updates };
  await act(async () => root.render(createElement(Harness, args)));
}

/** Requests a close the way the storage provider does; resolves `closed` when the window may close. */
async function requestClose(extra: Promise<unknown>[] = []) {
  const state = { closed: false };
  await act(async () => {
    const tasks: Promise<unknown>[] = [...extra];
    window.dispatchEvent(new CustomEvent("inkwell-before-close", { detail: tasks }));
    void Promise.all(tasks).then(() => {
      state.closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
  });
  return state;
}

async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const buttons = () => [...container.querySelectorAll("button")];
async function click(label: string) {
  const button = buttons().find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`No button "${label}" in: ${container.textContent}`);
  await act(async () => {
    button.click();
    await vi.advanceTimersByTimeAsync(0);
  });
}
const calls = (command: string) =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === command);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 14, 23, 5));
  responses = { git_backup: () => backedUp, git_status: () => status };
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => responses[command]?.());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  args = {
    projectPath: "/paper",
    gitPush: vi.fn(async () => ({ success: true })),
    backup: { enabled: true, push: true },
    flush: vi.fn(async () => {}),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("closing with automatic backup", () => {
  it("saves open files, backs up with the push setting, and closes without a dialog", async () => {
    const order: string[] = [];
    vi.mocked(args.flush).mockImplementation(async () => {
      order.push("flush");
    });
    responses.git_backup = () => {
      order.push("backup");
      return backedUp;
    };
    await render();
    const close = await requestClose();
    expect(order).toEqual(["flush", "backup"]);
    expect(invoke).toHaveBeenCalledWith("git_backup", {
      dir: "/paper",
      message: "Auto backup 2026-11-14 23:05",
      push: true,
    });
    expect(close.closed).toBe(true);
    expect(dialog()).toBeNull();
    expect(calls("git_fetch")).toHaveLength(0);
  });

  it("waits for other closing tasks, such as PDF notes, before committing", async () => {
    let saved: () => void = () => {};
    const notes = new Promise<void>((resolve) => {
      saved = resolve;
    });
    await render();
    const close = await requestClose([notes]);
    expect(calls("git_backup")).toHaveLength(0);
    await act(async () => {
      saved();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls("git_backup")).toHaveLength(1);
    expect(close.closed).toBe(true);
  });

  it("shows progress for a slow backup and closes when it completes", async () => {
    let release: (value: GitBackupResult) => void = () => {};
    responses.git_backup = () =>
      new Promise<GitBackupResult>((resolve) => {
        release = resolve;
      });
    await render();
    const close = await requestClose();
    expect(dialog()).toBeNull();
    await settle(600);
    expect(dialog()?.dataset.exitSync).toBe("backup-running");
    expect(container.textContent).toContain("Committing your changes");
    expect(buttons().map((button) => button.textContent)).toEqual(["Close anyway"]);
    expect(close.closed).toBe(false);
    await act(async () => {
      release(backedUp);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(close.closed).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("explains a failed backup and retries on request", async () => {
    responses.git_backup = () => Promise.reject("GIT_BACKUP_IN_PROGRESS");
    await render();
    const close = await requestClose();
    expect(close.closed).toBe(false);
    expect(dialog()?.dataset.exitSync).toBe("backup-failed");
    expect(dialog()?.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "A merge, rebase or cherry-pick is unfinished",
    );
    expect(buttons().map((button) => button.textContent)).toEqual(["Close anyway", "Retry"]);
    expect(document.activeElement?.textContent).toBe("Retry");

    await click("Retry");
    expect(calls("git_backup")).toHaveLength(2);
    expect(close.closed).toBe(false);

    responses.git_backup = () => backedUp;
    await click("Retry");
    expect(calls("git_backup")).toHaveLength(3);
    expect(close.closed).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("closes anyway after a failure when asked", async () => {
    responses.git_backup = () => Promise.reject("fatal: Unable to create index.lock");
    await render();
    const close = await requestClose();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "fatal: Unable to create index.lock",
    );
    await click("Close anyway");
    expect(close.closed).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("does not commit when open files cannot be saved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(args.flush).mockRejectedValue(new Error("disk full"));
    await render();
    const close = await requestClose();
    expect(calls("git_backup")).toHaveLength(0);
    expect(close.closed).toBe(false);
    expect(container.textContent).toContain("Unsaved changes could not be written to disk.");
  });

  it("reports a failed upload of a completed backup and retries only the push", async () => {
    responses.git_backup = () => ({
      ...backedUp,
      pushed: false,
      pushError: "Authentication failed",
    });
    vi.mocked(args.gitPush).mockResolvedValueOnce({ success: false, error: "Still offline" });
    await render();
    const close = await requestClose();
    expect(dialog()?.dataset.exitSync).toBe("backup-push-failed");
    expect(container.textContent).toContain("committed on this computer");
    expect(container.textContent).toContain("Authentication failed");

    await click("Retry");
    expect(calls("git_backup")).toHaveLength(1);
    expect(container.textContent).toContain("Still offline");
    expect(close.closed).toBe(false);
    await click("Retry");
    expect(args.gitPush).toHaveBeenCalledTimes(2);
    expect(close.closed).toBe(true);
  });

  it("closes directly when the project is not a repository", async () => {
    responses.git_backup = () => Promise.reject("GIT_BACKUP_NOT_A_REPO");
    await render();
    expect((await requestClose()).closed).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("still offers to upload pending commits when backups stay local", async () => {
    responses.git_backup = () => ({ ...backedUp, pushed: false });
    responses.git_status = () => ({ ...status, ahead: 3 });
    await render({ backup: { enabled: true, push: false } });
    const close = await requestClose();
    expect(calls("git_backup")[0]?.[1]).toMatchObject({ push: false });
    expect(dialog()?.dataset.exitSync).toBe("push");
    expect(container.textContent).toContain("There are 3 commits waiting to upload");
    await click("Close without uploading");
    expect(close.closed).toBe(true);
  });
});

describe("closing without automatic backup", () => {
  beforeEach(() => {
    args.backup = { enabled: false, push: true };
  });

  it("closes directly when nothing is waiting to upload", async () => {
    await render();
    const close = await requestClose();
    expect(calls("git_fetch")).toHaveLength(1);
    expect(calls("git_backup")).toHaveLength(0);
    expect(args.flush).not.toHaveBeenCalled();
    expect(close.closed).toBe(true);
  });

  it("closes directly without a project, upstream, or readable status", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await render({ projectPath: null });
    expect((await requestClose()).closed).toBe(true);
    expect(invoke).not.toHaveBeenCalled();

    responses.git_status = () => ({ ...status, ahead: 2, hasUpstream: false });
    await render({ projectPath: "/paper" });
    expect((await requestClose()).closed).toBe(true);

    responses.git_fetch = () => Promise.reject("offline");
    responses.git_status = () => Promise.reject("broken");
    expect((await requestClose()).closed).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("asks before closing with pending commits, and uploads on request", async () => {
    responses.git_status = () => ({ ...status, ahead: 2 });
    let finishPush: (value: { success: boolean }) => void = () => {};
    vi.mocked(args.gitPush).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPush = resolve;
        }),
    );
    await render();
    const close = await requestClose();
    expect(close.closed).toBe(false);
    expect(container.textContent).toContain("Upload pending commits?");
    expect(container.textContent).toContain("There are 2 commits waiting to upload");

    await click("Upload and close");
    expect(buttons().map((button) => [button.textContent, button.disabled])).toEqual([
      ["Close without uploading", true],
      ["Uploading…", true],
    ]);
    await act(async () => {
      finishPush({ success: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(close.closed).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("stays open when the upload fails and can close without uploading", async () => {
    responses.git_status = () => ({ ...status, ahead: 1 });
    vi.mocked(args.gitPush).mockResolvedValue({ success: false });
    await render();
    const close = await requestClose();
    await click("Upload and close");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Upload failed. The app will stay open.",
    );
    expect(close.closed).toBe(false);
    await click("Close without uploading");
    expect(close.closed).toBe(true);
  });
});

describe("close requests", () => {
  it("joins a repeated request to the dialog that is already open", async () => {
    responses.git_backup = () => Promise.reject("GIT_BACKUP_NO_IDENTITY");
    await render();
    const first = await requestClose();
    const second = await requestClose();
    expect(calls("git_backup")).toHaveLength(1);
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await click("Close anyway");
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
  });

  it("releases a pending close when unmounted", async () => {
    responses.git_backup = () => Promise.reject("GIT_BACKUP_NO_IDENTITY");
    await render();
    const close = await requestClose();
    expect(close.closed).toBe(false);
    await act(async () => root.render(null));
    await settle();
    expect(close.closed).toBe(true);
  });

  it("follows the dialog styling rules", async () => {
    responses.git_backup = () => Promise.reject("GIT_BACKUP_NO_IDENTITY");
    await render();
    await requestClose();
    expect(dialog()?.className).toContain("bg-black/45");
    const panel = dialog()?.firstElementChild;
    for (const token of ["rounded-lg", "border-border", "bg-background", "shadow-2xl"]) {
      expect(panel?.className).toContain(token);
    }
    expect(container.querySelector('[role="alert"]')?.className).toContain("text-error");
    expect(container.innerHTML).not.toContain("text-destructive");
    for (const button of buttons()) expect(button.type).toBe("button");
  });
});
