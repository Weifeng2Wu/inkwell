import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appStorage } from "@/lib/storage/app-storage";
import { QUICK_START_KEY, readQuickStart, saveQuickStart } from "./quick-start-state";

vi.mock("@/lib/storage/app-storage", () => ({
  appStorage: { getItem: vi.fn(), setItem: vi.fn() },
}));

beforeEach(() => vi.mocked(appStorage.getItem).mockReturnValue(null));
afterEach(() => vi.clearAllMocks());

describe("quick start progress", () => {
  it("opens on the first launch and recovers from malformed saved data", () => {
    expect(readQuickStart()).toEqual({ step: 0, completed: false, dismissed: false });
    vi.mocked(appStorage.getItem).mockReturnValue("invalid");
    expect(readQuickStart().step).toBe(0);
  });

  it("resumes the saved step and preserves explicit dismissal and completion", () => {
    for (const state of [
      { step: 3, completed: false, dismissed: false },
      { step: 2, completed: false, dismissed: true },
      { step: 5, completed: true, dismissed: false },
    ]) {
      saveQuickStart(state);
      expect(appStorage.setItem).toHaveBeenLastCalledWith(
        QUICK_START_KEY,
        JSON.stringify({ ...state, version: 2 }),
      );
      vi.mocked(appStorage.getItem).mockReturnValue(JSON.stringify({ ...state, version: 2 }));
      expect(readQuickStart()).toEqual(state);
    }
  });

  it("keeps stored steps within the guide and rejects non-boolean completion flags", () => {
    vi.mocked(appStorage.getItem).mockReturnValue('{"step":99,"version":2,"completed":"false"}');
    expect(readQuickStart()).toEqual({ step: 7, completed: false, dismissed: false });
    vi.mocked(appStorage.getItem).mockReturnValue('{"step":-1}');
    expect(readQuickStart().step).toBe(0);
  });

  it("migrates old configuration steps to the matching tour step", () => {
    vi.mocked(appStorage.getItem).mockReturnValue('{"step":3,"dismissed":true}');
    expect(readQuickStart()).toEqual({ step: 5, completed: false, dismissed: true });
  });

  it("reports storage failures to the caller so closing can be retried", () => {
    vi.mocked(appStorage.setItem).mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => saveQuickStart({ step: 3, completed: false, dismissed: true })).toThrow(
      "disk full",
    );
  });
});
