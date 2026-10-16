import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri: () => true }));

describe("system font discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    invoke.mockReset();
  });

  it("loads sorted, deduplicated font families through native IPC", async () => {
    invoke.mockResolvedValue(["Zephyr", "Arial", "Arial"]);
    const { loadSystemFonts } = await import("./use-system-fonts");
    expect(await loadSystemFonts()).toEqual(["Arial", "Zephyr"]);
    expect(invoke).toHaveBeenCalledWith("list_system_fonts");
  });

  it("shares discovery across selectors and settings remounts", async () => {
    invoke.mockResolvedValue(["Arial"]);
    const { loadSystemFonts } = await import("./use-system-fonts");
    await Promise.all([loadSystemFonts(), loadSystemFonts()]);
    await loadSystemFonts();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("allows a failed discovery to be retried", async () => {
    invoke.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce(["Arial"]);
    const { loadSystemFonts } = await import("./use-system-fonts");
    await expect(loadSystemFonts()).rejects.toThrow("Unavailable");
    expect(await loadSystemFonts()).toEqual(["Arial"]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
