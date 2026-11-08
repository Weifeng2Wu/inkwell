import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSLATION_CONFIG,
  selectTranslationProvider,
  TRANSLATION_PROVIDERS,
  type TranslationProvider,
} from "./translation";
import { invalidateTranslationHealth, readTranslationHealth } from "./translation-health";
import { probeTranslationChannels } from "./translation-probe";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, isTauri: () => true }));
vi.mock("@/lib/storage/app-storage", () => ({ appStorage: { getItem: () => null } }));
beforeEach(() => {
  mock.invoke.mockReset();
  for (const provider of Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[])
    invalidateTranslationHealth(selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, provider));
  mock.invoke.mockImplementation(async (command: string) =>
    command === "agent_api_key_read" ? null : "你好",
  );
});

describe("automatic translation probes", () => {
  it("checks keyless channels without reading paper content or credentials for those channels", async () => {
    const configs = [
      DEFAULT_TRANSLATION_CONFIG,
      selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "transmart"),
    ];
    await probeTranslationChannels(configs, new AbortController().signal);
    expect(mock.invoke).toHaveBeenCalledTimes(2);
    for (const config of configs) {
      expect(mock.invoke).toHaveBeenCalledWith("translation_request", {
        config,
        text: "Hello world.",
      });
      expect(readTranslationHealth(config).status).toBe("available");
    }
  });
  it("skips missing keys, endpoints and models without making a translation request", async () => {
    const configs = (
      ["google", "deepl", "azure", "tencent", "volcano", "deepl-web", "llm"] as const
    ).map((provider) => selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, provider));
    await probeTranslationChannels(configs, new AbortController().signal);
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(0);
    for (const config of configs) expect(readTranslationHealth(config).status).toBe("unconfigured");
  });
  it("tests configured official services using only settings and a short sample, never passing the key in translation IPC", async () => {
    const config = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "google");
    mock.invoke.mockImplementation(async (command: string) =>
      command === "agent_api_key_read" ? "test-only-credential" : "你好",
    );
    await probeTranslationChannels([config], new AbortController().signal);
    expect(mock.invoke).toHaveBeenCalledWith("translation_request", {
      config,
      text: "Hello world.",
    });
    expect(readTranslationHealth(config).status).toBe("available");
  });
  it("records failures in the lamp without returning a test translation or leaking raw errors", async () => {
    mock.invoke.mockRejectedValue(new Error("TRANSLATION_HTTP 429"));
    await expect(
      probeTranslationChannels([DEFAULT_TRANSLATION_CONFIG], new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG)).toMatchObject({
      status: "failed",
      errorKey: "translation.quotaError",
    });
  });
  it("limits a batch to two simultaneous requests and stops queued requests on cancellation", async () => {
    const configs = (["google-free", "transmart", "deeplx"] as const).map((provider) =>
      selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, provider),
    );
    const finish: ((value: string) => void)[] = [];
    mock.invoke.mockImplementation(() => new Promise<string>((resolve) => finish.push(resolve)));
    const controller = new AbortController();
    const result = probeTranslationChannels(configs, controller.signal);
    await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(2));
    controller.abort();
    await result;
    for (const resolve of finish) resolve("late");
    expect(mock.invoke).toHaveBeenCalledTimes(2);
    for (const config of configs) expect(readTranslationHealth(config).status).toBe("idle");
  });
  it("skips a stale configuration even when credential preflight completes later", async () => {
    const config = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "google");
    let finish: ((key: string) => void) | undefined;
    let current = true;
    mock.invoke.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const result = probeTranslationChannels([config], new AbortController().signal, () => current);
    await vi.waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(1));
    current = false;
    invalidateTranslationHealth(config);
    finish?.("test-only-credential");
    await result;
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(0);
    expect(readTranslationHealth(config).status).toBe("idle");
  });
});
