import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelDiscoveryResult } from "./academic-client";
import { DEFAULT_ACADEMIC_CONFIG } from "./academic-config";
import { useAutomaticModels } from "./use-automatic-models";

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: new Map<number, unknown>(),
  effects: new Map<number, { dependencies: unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index)) hooks.slots.set(index, initial);
    return [hooks.slots.get(index), (next: unknown) => hooks.slots.set(index, next)];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index)) hooks.slots.set(index, { current: initial });
    return hooks.slots.get(index);
  },
  useEffect(effect: () => (() => void) | undefined, dependencies: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.effects.get(index);
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      hooks.pending.push(() => {
        previous?.cleanup?.();
        hooks.effects.set(index, { dependencies, cleanup: effect() });
      });
    }
  },
}));

const fetchModels =
  vi.fn<(config: typeof DEFAULT_ACADEMIC_CONFIG, key: string) => Promise<ModelDiscoveryResult>>();
const onDiscovered = vi.fn();
let options: Parameters<typeof useAutomaticModels>[0];
function render() {
  hooks.cursor = 0;
  const renderHook = useAutomaticModels;
  const result = renderHook(options);
  for (const effect of hooks.pending.splice(0)) effect();
  return result;
}
function unmount() {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
}
beforeEach(() => {
  vi.useFakeTimers();
  hooks.slots.clear();
  hooks.effects.clear();
  hooks.pending = [];
  fetchModels.mockReset().mockResolvedValue({ models: ["first"] });
  onDiscovered.mockReset();
  options = {
    enabled: true,
    directory: "/project",
    config: { ...DEFAULT_ACADEMIC_CONFIG },
    apiKey: "test-key",
    apiKeyLoading: false,
    working: false,
    errorLabel: "Failed",
    fetchModels,
    onDiscovered,
  };
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe("automatic model discovery", () => {
  it("loads once after credentials are ready and debounces endpoint edits", async () => {
    expect(render().loading).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    options.config = { ...options.config, baseUrl: "https://another.example/v1" };
    render();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchModels).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(fetchModels).toHaveBeenCalledExactlyOnceWith(options.config, "test-key");
    expect(render().models).toEqual(["first"]);
    expect(onDiscovered).toHaveBeenCalledOnce();
    render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchModels).toHaveBeenCalledOnce();
  });
  it("does not load for incomplete credentials, invalid URLs or external agents", async () => {
    for (const change of [
      { apiKey: "" },
      { apiKeyLoading: true },
      { enabled: false },
      { directory: undefined },
      { config: { ...DEFAULT_ACADEMIC_CONFIG, baseUrl: "https://" } },
    ]) {
      const original = options;
      options = { ...original, ...change };
      expect(render().loading).toBe(false);
      await vi.advanceTimersByTimeAsync(600);
      options = original;
    }
    expect(fetchModels).not.toHaveBeenCalled();
  });
  it("supports local endpoints without an API key", async () => {
    options.apiKey = "";
    options.config = { ...options.config, baseUrl: "http://localhost:1234/v1" };
    render();
    await vi.advanceTimersByTimeAsync(500);
    expect(render().models).toEqual(["first"]);
  });
  it("waits for ongoing work without restarting when its own request changes the busy flag", async () => {
    options.working = true;
    render();
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchModels).not.toHaveBeenCalled();
    options.working = false;
    render();
    await vi.advanceTimersByTimeAsync(500);
    options.working = true;
    render();
    options.working = false;
    render();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchModels).toHaveBeenCalledOnce();
    expect(render().models).toEqual(["first"]);
  });
  it("discards old endpoint responses even after switching back to the first endpoint", async () => {
    let finish!: (result: ModelDiscoveryResult) => void;
    fetchModels.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await vi.advanceTimersByTimeAsync(500);
    const first = options.config;
    options.config = { ...first, baseUrl: "https://second.example/v1" };
    render();
    options.config = first;
    render();
    finish({ models: ["stale"] });
    await Promise.resolve();
    expect(render().models).toBeNull();
    expect(onDiscovered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(render().models).toEqual(["first"]);
  });
  it("exposes a bounded error without credentials and does not retry in a loop", async () => {
    fetchModels.mockRejectedValue(new Error("bad test-key"));
    render();
    await vi.advanceTimersByTimeAsync(500);
    expect(render().error).toBe("Failed\nbad [redacted]");
    expect(render().loading).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchModels).toHaveBeenCalledOnce();
  });
  it("ignores responses after settings are unmounted", async () => {
    let finish!: (result: ModelDiscoveryResult) => void;
    fetchModels.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render();
    await vi.advanceTimersByTimeAsync(500);
    unmount();
    finish({ models: ["late"] });
    await Promise.resolve();
    expect(onDiscovered).not.toHaveBeenCalled();
  });
});
