import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGitHubAuth } from "./use-github-auth";

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effect: undefined as (() => () => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
vi.mock("react", () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], (next: unknown) => (hooks.slots[index] = next)];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => () => void) => {
    hooks.effect ??= effect;
  },
}));

const signedIn = { installed: true, authenticated: true, username: "researcher" };
const listeners = new Map<string, () => void>();

function render() {
  hooks.cursor = 0;
  const renderHook = useGitHubAuth;
  return renderHook();
}

beforeEach(() => {
  hooks.slots = [];
  hooks.effect = undefined;
  listeners.clear();
  vi.resetAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue(signedIn);
  vi.stubGlobal("window", {
    addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
    removeEventListener: (event: string) => listeners.delete(event),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("GitHub authentication detection", () => {
  it("switches saved accounts and updates the active account", async () => {
    render();
    hooks.effect?.();
    await vi.waitFor(() => expect(render().checking).toBe(false));
    const switched = { ...signedIn, username: "work-account" };
    vi.mocked(invoke).mockResolvedValueOnce(switched);
    await render().switchAccount("work-account");
    expect(invoke).toHaveBeenCalledWith("gh_auth_switch", { username: "work-account" });
    expect(render().status).toEqual(switched);
    expect(render().switching).toBeNull();
  });

  it("preserves the active account and reports a failed switch", async () => {
    render();
    hooks.effect?.();
    await vi.waitFor(() => expect(render().checking).toBe(false));
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Switch failed"));
    await render().switchAccount("work-account");
    expect(render().status).toEqual(signedIn);
    expect(render().error).toContain("Switch failed");
    expect(render().switching).toBeNull();
  });

  it("ignores stale detection and blocks overlapping switches and focus refreshes", async () => {
    let resolveStatus: ((value: unknown) => void) | undefined;
    let resolveSwitch: ((value: unknown) => void) | undefined;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    render();
    hooks.effect?.();
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSwitch = resolve;
      }),
    );
    const switching = render().switchAccount("work-account");
    expect(render().switching).toBe("work-account");
    await render().switchAccount("other-account");
    listeners.get("focus")?.();
    expect(invoke).toHaveBeenCalledTimes(2);
    const switched = { ...signedIn, username: "work-account" };
    resolveSwitch?.(switched);
    await switching;
    resolveStatus?.(signedIn);
    await Promise.resolve();
    expect(render().status).toEqual(switched);
    expect(render().checking).toBe(false);
  });

  it("detects the active account and refreshes on returning to the app", async () => {
    render();
    hooks.effect?.();
    await vi.waitFor(() => expect(render().status).toEqual(signedIn));
    expect(invoke).toHaveBeenCalledWith("gh_check");
    const signedOut = { installed: true, authenticated: false, username: "" };
    vi.mocked(invoke).mockResolvedValue(signedOut);
    listeners.get("focus")?.();
    await vi.waitFor(() => expect(render().status).toEqual(signedOut));
  });

  it("opens the existing login flow without assuming authentication completed", async () => {
    render();
    hooks.effect?.();
    await vi.waitFor(() => expect(render().checking).toBe(false));
    await render().login();
    expect(invoke).toHaveBeenCalledWith("gh_auth_login");
    expect(render().loginStarted).toBe(true);
    expect(render().launching).toBe(false);
    expect(render().status).toEqual(signedIn);
  });

  it("reports detection and login failures", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("IPC failed"));
    render();
    hooks.effect?.();
    await vi.waitFor(() => expect(render().checking).toBe(false));
    expect(render().status).toBeNull();
    expect(render().error).toContain("IPC failed");
    await render().login();
    expect(render().error).toContain("IPC failed");
    expect(render().loginStarted).toBe(false);
    expect(render().launching).toBe(false);
  });

  it("ignores pending checks after unmounting and removes the focus listener", async () => {
    let resolveStatus: ((value: unknown) => void) | undefined;
    vi.mocked(invoke).mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    render();
    const cleanup = hooks.effect?.();
    cleanup?.();
    resolveStatus?.(signedIn);
    await Promise.resolve();
    expect(render().status).toBeNull();
    expect(listeners.size).toBe(0);
  });

  it("does not invoke desktop commands in the browser", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    render();
    hooks.effect?.();
    await render().login();
    await render().install();
    await render().switchAccount("work-account");
    expect(invoke).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(render().checking).toBe(false);
  });

  it("opens the official CLI installation page and detects installation on return", async () => {
    vi.mocked(invoke).mockResolvedValue({ installed: false, authenticated: false, username: "" });
    render();
    hooks.effect?.();
    await vi.waitFor(() => expect(render().checking).toBe(false));
    await render().install();
    expect(open).toHaveBeenCalledWith("https://cli.github.com/");
    expect(render().installing).toBe(false);
    vi.mocked(invoke).mockResolvedValue(signedIn);
    listeners.get("focus")?.();
    await vi.waitFor(() => expect(render().status).toEqual(signedIn));
  });

  it("reports errors opening the installer", async () => {
    render();
    hooks.effect?.();
    await vi.waitFor(() => expect(render().checking).toBe(false));
    vi.mocked(open).mockRejectedValue(new Error("Browser failed"));
    await render().install();
    expect(render().error).toContain("Browser failed");
    expect(render().installing).toBe(false);
  });
});
