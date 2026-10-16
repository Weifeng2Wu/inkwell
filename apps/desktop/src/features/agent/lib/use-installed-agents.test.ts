import { invoke, isTauri } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentStatus } from "./external-agent-catalog";
import { AGENT_INSTALLATION_CHANGED, useInstalledAgents } from "./use-installed-agents";

const hooks = vi.hoisted(() => ({
  setStatuses: vi.fn(),
  cleanup: undefined as (() => void) | undefined,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("react", () => ({
  useState: (initial: unknown) => [initial, hooks.setStatuses],
  useEffect: (effect: () => (() => void) | undefined) => {
    hooks.cleanup = effect();
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.cleanup = undefined;
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockResolvedValue([]);
  vi.stubGlobal("window", new EventTarget());
});
afterEach(() => {
  hooks.cleanup?.();
  vi.unstubAllGlobals();
});

describe("installed Agent detection", () => {
  it("queries the desktop backend and stores the detected installation statuses", async () => {
    const statuses: AgentStatus[] = [
      {
        id: "codex",
        installed: true,
        acpReady: false,
        path: "/usr/bin/codex",
        adapterPath: null,
        installable: true,
      },
    ];
    vi.mocked(invoke).mockResolvedValue(statuses);
    expect(useInstalledAgents()).toBeNull();
    await vi.waitFor(() => expect(hooks.setStatuses).toHaveBeenCalledWith(statuses));
    expect(invoke).toHaveBeenCalledWith("external_agent_detect");
  });

  it("does not call desktop commands in a browser", () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(useInstalledAgents()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    expect(hooks.setStatuses).not.toHaveBeenCalled();
  });

  it("refreshes detected Agents after installation and removes the listener on unmount", async () => {
    useInstalledAgents();
    await vi.waitFor(() => expect(hooks.setStatuses).toHaveBeenCalledWith([]));
    window.dispatchEvent(new Event(AGENT_INSTALLATION_CHANGED));
    expect(invoke).toHaveBeenCalledTimes(2);
    hooks.cleanup?.();
    window.dispatchEvent(new Event(AGENT_INSTALLATION_CHANGED));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("does not replace a refreshed result with a slower earlier detection", async () => {
    let resolveFirst: ((statuses: AgentStatus[]) => void) | undefined;
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<AgentStatus[]>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    useInstalledAgents();
    window.dispatchEvent(new Event(AGENT_INSTALLATION_CHANGED));
    await vi.waitFor(() => expect(hooks.setStatuses).toHaveBeenCalledWith([]));
    hooks.setStatuses.mockClear();
    resolveFirst?.([]);
    await Promise.resolve();
    expect(hooks.setStatuses).not.toHaveBeenCalled();
  });

  it("keeps failed detection distinct from an empty installed Agent list", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Detection failed"));
    useInstalledAgents();
    await vi.waitFor(() => expect(hooks.setStatuses).toHaveBeenCalledWith(null));
  });

  it("ignores detection results after unmounting", async () => {
    let resolveDetection: ((statuses: AgentStatus[]) => void) | undefined;
    vi.mocked(invoke).mockReturnValue(
      new Promise<AgentStatus[]>((resolve) => {
        resolveDetection = resolve;
      }),
    );
    useInstalledAgents();
    hooks.cleanup?.();
    resolveDetection?.([]);
    await Promise.resolve();
    expect(hooks.setStatuses).not.toHaveBeenCalled();
  });
});
