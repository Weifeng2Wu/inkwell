import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSLATION_CONFIG,
  normalizeTranslationConfig,
  readTranslationConfig,
  readTranslationKey,
  saveTranslationConfig,
  saveTranslationKey,
  selectTranslationProvider,
  TRANSLATION_PROVIDERS,
  TRANSLATION_STORAGE,
  type TranslationConfig,
  translateText,
  translationEndpoint,
  translationErrorKey,
  translationKeyScope,
} from "./translation";
import { invalidateTranslationHealth, readTranslationHealth } from "./translation-health";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), storage: new Map<string, string>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, isTauri: () => true }));
vi.mock("@/lib/storage/app-storage", () => ({
  appStorage: {
    getItem: (key: string) => mock.storage.get(key) ?? null,
    setItem: (key: string, value: string) => mock.storage.set(key, value),
  },
}));
beforeEach(() => {
  mock.invoke.mockReset();
  mock.storage.clear();
  for (const provider of Object.keys(TRANSLATION_PROVIDERS) as TranslationConfig["provider"][])
    invalidateTranslationHealth(selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, provider));
  vi.stubGlobal("window", new EventTarget());
});

describe("translation configuration", () => {
  it("waits for a key-field blur commit before starting a translation test", async () => {
    let finish: (() => void) | undefined;
    mock.invoke.mockImplementation((command: string) =>
      command === "agent_api_key_write"
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve("你好"),
    );
    const google = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "google");
    const saving = saveTranslationKey(google, "test-only-replacement");
    await Promise.resolve();
    const translating = translateText("Hello", google);
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(0);
    finish?.();
    await saving;
    await expect(translating).resolves.toBe("你好");
    expect(mock.invoke.mock.calls.map(([command]) => command)).toEqual([
      "agent_api_key_write",
      "translation_request",
    ]);
  });
  it("migrates retired providers to keyless Google and preserves each active provider's profile", () => {
    expect(
      normalizeTranslationConfig({
        provider: "retired",
        baseUrl: "https://old.example",
        model: "old-model",
      }),
    ).toEqual(DEFAULT_TRANSLATION_CONFIG);
    const llm = {
      ...DEFAULT_TRANSLATION_CONFIG,
      provider: "llm" as const,
      baseUrl: "https://example.com/v1",
      model: "my-model",
    };
    saveTranslationConfig(llm);
    const azure = selectTranslationProvider(llm, "azure");
    saveTranslationConfig({ ...azure, region: "eastasia" });
    expect(selectTranslationProvider(azure, "llm")).toMatchObject({
      baseUrl: llm.baseUrl,
      model: llm.model,
    });
    expect(selectTranslationProvider(llm, "azure").region).toBe("eastasia");
  });
  it("defaults to keyless Google without reading or writing any credential", async () => {
    expect(readTranslationConfig()).toEqual(DEFAULT_TRANSLATION_CONFIG);
    expect(DEFAULT_TRANSLATION_CONFIG.provider).toBe("google-free");
    mock.invoke.mockResolvedValue(null);
    expect(await readTranslationKey(DEFAULT_TRANSLATION_CONFIG)).toBe("");
    await saveTranslationKey(DEFAULT_TRANSLATION_CONFIG, "test-only-unused");
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("preserves an existing explicit Google Cloud selection and its endpoint scope", () => {
    const google = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "google");
    saveTranslationConfig(google);
    expect(readTranslationConfig()).toEqual(google);
    expect(translationKeyScope(google)).toBe(
      JSON.stringify(["", "translation-google-key", "https://translation.googleapis.com"]),
    );
  });
  it("persists unfinished web setup without inventing a usable endpoint", async () => {
    for (const provider of ["volcano", "deepl-web"] as const) {
      const config = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, provider);
      expect(config.baseUrl).toBe("");
      saveTranslationConfig(config);
      expect(readTranslationConfig()).toEqual(config);
      await expect(translateText("Hello", config)).rejects.toThrow("TRANSLATION_ENDPOINT");
    }
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("keeps DeepLX and DeepL web protocols separate and validates configurable web URLs", () => {
    const web = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "deepl-web");
    expect(translationEndpoint({ ...web, baseUrl: "https://translate.example/jsonrpc" })).toBe(
      "https://translate.example/jsonrpc",
    );
    expect(() =>
      translationEndpoint({ ...web, baseUrl: "https://translate.example/translate" }),
    ).toThrow("TRANSLATION_CONFIG");
    const volcano = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "volcano");
    expect(
      translationEndpoint({ ...volcano, baseUrl: "https://translate.example/crx/translate/v1" }),
    ).toBe("https://translate.example/crx/translate/v1");
    expect(() =>
      translationEndpoint({
        ...volcano,
        baseUrl: "https://user:secret@translate.example/crx/translate/v1",
      }),
    ).toThrow("TRANSLATION_CONFIG");
  });
  it("allowlists persisted fields so credentials cannot enter preferences", () => {
    const extra = {
      ...DEFAULT_TRANSLATION_CONFIG,
      apiKey: "test-only-key",
      secretId: "test-only-id",
      secretKey: "test-only-secret",
    };
    saveTranslationConfig(extra);
    const stored = mock.storage.get(TRANSLATION_STORAGE);
    expect(stored).not.toContain("test-only");
    expect(JSON.parse(stored ?? "")).toEqual(DEFAULT_TRANSLATION_CONFIG);
    expect(normalizeTranslationConfig({ provider: "bad", target: "bad" })).toEqual(
      DEFAULT_TRANSLATION_CONFIG,
    );
  });
  it("never puts embedded URL credentials into storage", () => {
    for (const baseUrl of [
      "https://user:secret@example.com",
      "https://example.com?key=secret",
      "http://remote.example/v1",
    ]) {
      expect(() =>
        saveTranslationConfig({ ...DEFAULT_TRANSLATION_CONFIG, provider: "llm", baseUrl }),
      ).toThrow("TRANSLATION_CONFIG");
    }
    expect(mock.storage.size).toBe(0);
  });
  it("scopes credentials separately by translation service and endpoint", () => {
    const llm = { ...DEFAULT_TRANSLATION_CONFIG, provider: "llm" as const };
    expect(translationKeyScope(llm)).toContain("translation-llm-key");
    expect(translationKeyScope(llm)).not.toEqual(
      translationKeyScope({ ...llm, baseUrl: "https://other.example/v1" }),
    );
    const tencent = selectTranslationProvider(llm, "tencent");
    expect(translationKeyScope(tencent)).not.toEqual(translationKeyScope(tencent, "secretId"));
  });
  it("empty credential edits preserve stored keys; replacements use credential IPC only", async () => {
    const llm = { ...DEFAULT_TRANSLATION_CONFIG, provider: "llm" as const };
    await saveTranslationKey(llm, " ");
    expect(mock.invoke).not.toHaveBeenCalled();
    await saveTranslationKey(llm, "Bearer test-only-key");
    expect(mock.invoke).toHaveBeenCalledWith("agent_api_key_write", {
      scope: translationKeyScope(llm),
      apiKey: "test-only-key",
    });
    expect(mock.storage.size).toBe(0);
  });
  it("request IPC contains only settings and explicit selected text, not keys", async () => {
    mock.invoke.mockResolvedValue("你好");
    expect(await translateText("Hello")).toBe("你好");
    expect(mock.invoke).toHaveBeenCalledWith("translation_request", {
      config: DEFAULT_TRANSLATION_CONFIG,
      text: "Hello",
    });
  });
  it("rejects cancellation immediately and ignores a later native result", async () => {
    let finish: ((value: string) => void) | undefined;
    mock.invoke.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const result = translateText("Hello", DEFAULT_TRANSLATION_CONFIG, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow("TRANSLATION_CANCELLED");
    finish?.("late response");
    const calls = mock.invoke.mock.calls.length;
    await expect(
      translateText("Hello", DEFAULT_TRANSLATION_CONFIG, controller.signal),
    ).rejects.toThrow("TRANSLATION_CANCELLED");
    expect(mock.invoke.mock.calls.length).toBe(calls);
  });
  it("maps safe provider errors to useful localized messages", () => {
    expect(translationErrorKey("TRANSLATION_HTTP 429")).toBe("translation.quotaError");
    expect(translationErrorKey("TRANSLATION_HTTP 401")).toBe("translation.keyError");
    expect(translationErrorKey("TRANSLATION_HTTP 403", "google-free")).toBe(
      "translation.webUnavailable",
    );
    expect(translationErrorKey("TRANSLATION_HTTP 403", "google")).toBe("translation.keyError");
    expect(translationErrorKey("TRANSLATION_ENDPOINT", "volcano")).toBe(
      "translation.endpointRequired",
    );
    expect(translationErrorKey("TRANSLATION_KEY")).toBe("translation.keyError");
  });
  it("updates channel health from actual requests, including sanitized failure reasons", async () => {
    let finish: ((result: string) => void) | undefined;
    mock.invoke.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG).status).toBe("idle");
    const result = translateText("Hello");
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG).status).toBe("testing");
    finish?.("你好");
    await result;
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG)).toMatchObject({
      status: "available",
      checkedAt: expect.any(Number),
    });
    mock.invoke.mockRejectedValue(new Error("TRANSLATION_HTTP 429"));
    await expect(translateText("Hello")).rejects.toThrow("429");
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG)).toMatchObject({
      status: "failed",
      errorKey: "translation.quotaError",
    });
  });
  it("does not allow an older request or an aborted request to relight the lamp", async () => {
    const resolvers: ((result: string) => void)[] = [];
    mock.invoke.mockImplementation(() => new Promise<string>((resolve) => resolvers.push(resolve)));
    const older = translateText("first");
    const controller = new AbortController();
    const newer = translateText("second", DEFAULT_TRANSLATION_CONFIG, controller.signal);
    controller.abort();
    await expect(newer).rejects.toThrow("TRANSLATION_CANCELLED");
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG).status).toBe("idle");
    resolvers[0]?.("older result");
    await older;
    resolvers[1]?.("discarded result");
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG).status).toBe("idle");
  });
  it("invalidates health after endpoint or credential edits and ignores in-flight stale success", async () => {
    let finish: ((result: string) => void) | undefined;
    mock.invoke.mockImplementation((command: string) =>
      command === "translation_request"
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(),
    );
    saveTranslationConfig(DEFAULT_TRANSLATION_CONFIG);
    const result = translateText("Hello");
    saveTranslationConfig({
      ...DEFAULT_TRANSLATION_CONFIG,
      baseUrl: "https://translate.google.com/translate_a/single",
    });
    finish?.("stale");
    await result;
    expect(readTranslationHealth(DEFAULT_TRANSLATION_CONFIG).status).toBe("idle");
    const google = selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, "google");
    mock.invoke.mockResolvedValue("你好");
    await translateText("Hello", google);
    expect(readTranslationHealth(google).status).toBe("available");
    await saveTranslationKey(google, "test-only-replacement");
    expect(readTranslationHealth(google).status).toBe("idle");
  });
});
