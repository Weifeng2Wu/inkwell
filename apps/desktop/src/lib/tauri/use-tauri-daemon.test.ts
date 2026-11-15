// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "@/types/git";
import { useTauriDaemon } from "./use-tauri-daemon";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => false }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const interval = 120_000;
const networkError = "fatal: unable to access remote: Empty reply from server\n";
const status: GitStatus = {
  isRepo: true,
  branch: "main",
  remote: "https://example.com/paper.git",
  ahead: 1,
  behind: 0,
  hasUpstream: true,
  hasCommits: true,
  changes: [{ path: "notes.md", status: "modified", staged: false }],
};

let root: Root;
let current: ReturnType<typeof useTauriDaemon> | null = null;
let fetchRemote: ReturnType<typeof vi.fn<() => Promise<void>>>;

function daemon() {
  if (!current) throw new Error("Daemon has not mounted");
  return current;
}

function Harness({ enabled = true }: { enabled?: boolean }) {
  current = useTauriDaemon({ gitAutoFetchEnabled: enabled, gitAutoFetchIntervalMs: interval });
  return null;
}

async function render(enabled = true) {
  await act(async () => root.render(createElement(Harness, { enabled })));
}

async function openProject(path = "/paper") {
  await act(async () => {
    await daemon().setProject(path);
  });
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function focus() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchRemote = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "git_status") return status;
    if (command === "git_fetch") return fetchRemote();
    if (["get_file_tree", "git_log", "git_graph"].includes(command)) return [];
    return undefined;
  });
  current = null;
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("background remote refresh", () => {
  it("retains local changes and reports a failed fetch without a console error", async () => {
    fetchRemote.mockRejectedValueOnce(networkError);
    await render();
    await openProject();

    expect(fetchRemote).toHaveBeenCalledTimes(1);
    expect(daemon().gitRemoteError).toBe(networkError);
    expect(daemon().gitStatus).toEqual(status);
    expect(daemon().gitInfo?.isDirty).toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("backs off after failures, bounds the delay and resets it after recovery", async () => {
    fetchRemote.mockRejectedValue(networkError);
    await render();
    await openProject();

    for (const delay of [2 * interval, 4 * interval, 15 * 60_000, 15 * 60_000]) {
      const count = fetchRemote.mock.calls.length;
      await advance(delay - 1);
      await focus();
      expect(fetchRemote).toHaveBeenCalledTimes(count);
      await advance(1);
      expect(fetchRemote).toHaveBeenCalledTimes(count + 1);
    }

    fetchRemote.mockResolvedValue(undefined);
    await advance(15 * 60_000);
    expect(daemon().gitRemoteError).toBeNull();
    const count = fetchRemote.mock.calls.length;
    await focus();
    await advance(interval - 1);
    expect(fetchRemote).toHaveBeenCalledTimes(count);
    await advance(1);
    expect(fetchRemote).toHaveBeenCalledTimes(count + 1);
  });

  it("allows manual retry during backoff and preserves manual failure feedback", async () => {
    fetchRemote.mockRejectedValue(networkError);
    await render();
    await openProject();
    await act(async () => {
      expect(await daemon().refreshGitStatus(true)).toEqual({
        success: false,
        error: networkError,
      });
    });
    expect(fetchRemote).toHaveBeenCalledTimes(2);
    expect(daemon().gitRemoteError).toBe(networkError);

    fetchRemote.mockResolvedValue(undefined);
    await act(async () => {
      expect(await daemon().refreshGitStatus(true)).toEqual({ success: true });
    });
    expect(fetchRemote).toHaveBeenCalledTimes(3);
    expect(daemon().gitRemoteError).toBeNull();
    expect(daemon().isRefreshingGit).toBe(false);
  });

  it("skips offline and hidden windows, then resumes when usable", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    await render();
    await openProject();
    await focus();
    await advance(interval * 2);
    expect(fetchRemote).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchRemote).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("hidden");
    await advance(interval);
    await focus();
    expect(fetchRemote).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue("visible");
    await focus();
    expect(fetchRemote).toHaveBeenCalledTimes(2);
    await focus();
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it("ignores a pending failure after changing projects", async () => {
    let fail: (reason: unknown) => void = () => {};
    fetchRemote.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    await render();
    await openProject();
    await focus();
    expect(fetchRemote).toHaveBeenCalledTimes(1);
    await openProject("/other-paper");
    expect(fetchRemote).toHaveBeenCalledTimes(2);

    await act(async () => fail(networkError));
    expect(daemon().projectPath).toBe("/other-paper");
    expect(daemon().gitRemoteError).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
    await advance(interval);
    expect(fetchRemote).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledWith("git_fetch", { dir: "/other-paper" });
  });

  it("stops automatic retries when disabled", async () => {
    fetchRemote.mockRejectedValue(networkError);
    await render();
    await openProject();
    await render(false);
    await advance(30 * 60_000);
    await focus();
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });
});
