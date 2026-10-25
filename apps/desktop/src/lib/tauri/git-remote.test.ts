import { invoke } from "@tauri-apps/api/core";
import { describe, expect, it, vi } from "vitest";
import { fetchGitRemote } from "./git-remote";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("remote refresh coordination", () => {
  it("shares a pending fetch for the same project and allows other projects", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    let complete!: () => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    const first = fetchGitRemote("/project-a");
    expect(fetchGitRemote("/project-a")).toBe(first);
    await fetchGitRemote("/project-b");
    expect(invoke).toHaveBeenCalledTimes(2);
    complete();
    await first;
    await fetchGitRemote("/project-a");
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("returns the failure to all callers and permits retry", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Authentication failed"));
    const first = fetchGitRemote("/offline");
    const second = fetchGitRemote("/offline");
    await expect(first).rejects.toThrow("Authentication failed");
    await expect(second).rejects.toThrow("Authentication failed");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await expect(fetchGitRemote("/offline")).resolves.toBeUndefined();
  });
});
