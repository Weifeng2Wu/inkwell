// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TRANSLATION_CONFIG,
  invalidateTranslationHealth,
  selectTranslationProvider,
  TRANSLATION_PROVIDERS,
  type TranslationProvider,
} from "@/features/translation";
import { TranslationSettings } from "./translation-settings";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), storage: new Map<string, string>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, isTauri: () => true }));
vi.mock("@/features/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/storage/app-storage", () => ({
  appStorage: {
    getItem: (key: string) => mock.storage.get(key) ?? null,
    setItem: (key: string, value: string) => mock.storage.set(key, value),
  },
  flushAppStorage: async () => {},
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.storage.clear();
  vi.useFakeTimers();
  mock.invoke.mockReset();
  for (const provider of Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[])
    invalidateTranslationHealth(selectTranslationProvider(DEFAULT_TRANSLATION_CONFIG, provider));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mock.invoke.mockImplementation(async (command: string) =>
    command === "agent_api_key_read" ? null : "你好",
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const render = async () => {
  await act(async () => root.render(createElement(TranslationSettings)));
};
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function storedCredentials() {
  mock.invoke.mockImplementation(async (command: string) =>
    command === "agent_api_key_read" ? "test-only-stored-credential" : "你好",
  );
}
async function change(input: HTMLSelectElement | HTMLInputElement, value: string) {
  await act(async () => {
    const prototype =
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}
function provider() {
  const select = host.querySelector<HTMLButtonElement>("[data-translation-provider]");
  if (!select) throw new Error("Missing provider");
  return select;
}
async function openChannels() {
  await act(async () =>
    provider().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
}
async function chooseChannel(channel: TranslationProvider) {
  await openChannels();
  const option = document.querySelector<HTMLElement>(`[data-translation-option="${channel}"]`);
  if (!option) throw new Error(`Missing channel ${channel}`);
  await act(async () =>
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
}
function credential() {
  const input = host.querySelector<HTMLInputElement>('input[type="password"]');
  if (!input) throw new Error("Missing credential");
  return input;
}
describe("translation settings UI", () => {
  it("automatically checks channels on opening, skips missing credentials, and removes explanatory text", async () => {
    await render();
    expect(provider().textContent).toContain("translation.providers.google-free");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    await advance();
    const calls = mock.invoke.mock.calls.filter(([command]) => command === "translation_request");
    expect(calls.map(([, args]) => args.config.provider).sort()).toEqual([
      "deeplx",
      "google-free",
      "transmart",
    ]);
    for (const [, args] of calls) expect(args.text).toBe("Hello world.");
    expect(host.textContent).not.toContain("你好");
    for (const key of ["description", "statusHint", "noKeyHint", "byokHint", "webHint", "privacy"])
      expect(host.textContent).not.toContain(`translation.${key}`);
    await openChannels();
    expect(document.querySelectorAll('[role="group"]')).toHaveLength(3);
    const options = document.querySelectorAll("[data-translation-option]");
    expect(options).toHaveLength(Object.keys(TRANSLATION_PROVIDERS).length);
    for (const option of options) {
      const lamp = option.querySelector("[data-translation-status]");
      expect(["available", "unconfigured"]).toContain(
        lamp?.getAttribute("data-translation-status"),
      );
      expect(lamp?.getAttribute("aria-label")).toMatch(/^translation.status\./);
    }
    const selected = document.querySelector<HTMLElement>('[data-translation-option="google-free"]');
    await act(async () =>
      selected?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    );
    expect(
      host.querySelectorAll(".settings-control.settings-select").length,
    ).toBeGreaterThanOrEqual(4);
    const test = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "translation.test",
    );
    if (!test) throw new Error("Missing test button");
    await act(async () => test.click());
    await advance();
    expect(mock.invoke).toHaveBeenCalledWith(
      "translation_request",
      expect.objectContaining({ text: "Hello world." }),
    );
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(4);
    expect(provider().querySelector('[data-translation-status="available"]')).not.toBeNull();
  });
  it("masks stored credentials and treats empty focus/blur as no replacement", async () => {
    storedCredentials();
    await render();
    await chooseChannel("google");
    expect(credential().value).toBe("test***tial");
    expect(host.innerHTML).not.toContain("test-only-stored-credential");
    await act(async () => credential().focus());
    expect(credential().value).toBe("");
    await act(async () => credential().blur());
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "agent_api_key_write"),
    ).toHaveLength(0);
  });
  it("saves a replacement through the dedicated scope, never preference storage", async () => {
    storedCredentials();
    await render();
    await chooseChannel("google");
    await act(async () => credential().focus());
    await change(credential(), "replacement-test-key");
    await act(async () => credential().blur());
    expect(mock.invoke).toHaveBeenCalledWith("agent_api_key_write", {
      scope: JSON.stringify(["", "translation-google-key", "https://translation.googleapis.com"]),
      apiKey: "replacement-test-key",
    });
    expect([...mock.storage.values()].join(" ")).not.toContain("replacement-test-key");
    await advance();
    expect(provider().querySelector('[data-translation-status="available"]')).not.toBeNull();
  });
  it("switching to web services hides keys while Tencent has separate credentials", async () => {
    await render();
    await chooseChannel("transmart");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    await chooseChannel("tencent");
    expect(host.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(host.textContent).toContain("SecretId");
    expect(host.textContent).toContain("SecretKey");
  });
  it("shows testing and failure lamps, then invalidates the result after editing the endpoint", async () => {
    let reject: ((reason: Error) => void) | undefined;
    mock.invoke.mockImplementation((command: string, args: { config?: { provider: string } }) =>
      command === "translation_request" && args.config?.provider === "google-free"
        ? new Promise<string>((_, fail) => {
            reject = fail;
          })
        : Promise.resolve(command === "agent_api_key_read" ? null : "你好"),
    );
    await render();
    await advance();
    expect(provider().querySelector('[data-translation-status="testing"]')).not.toBeNull();
    await act(async () => reject?.(new Error("TRANSLATION_HTTP 429")));
    expect(provider().querySelector('[data-translation-status="failed"]')).not.toBeNull();
    expect(provider().querySelector('[role="img"]')?.getAttribute("title")).toContain(
      "translation.quotaError",
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
    const endpoint = host.querySelector<HTMLSelectElement>(
      'select[aria-label="translation.endpoint"]',
    );
    if (!endpoint) throw new Error("Missing endpoint");
    await change(endpoint, "https://translate.google.com/translate_a/single");
    expect(provider().querySelector('[data-translation-status="idle"]')).not.toBeNull();
    await advance(400);
    expect(provider().querySelector('[data-translation-status="testing"]')).not.toBeNull();
    expect(mock.invoke).toHaveBeenCalledWith(
      "translation_request",
      expect.objectContaining({
        config: expect.objectContaining({
          baseUrl: "https://translate.google.com/translate_a/single",
        }),
      }),
    );
  });
  it("keeps unfinished compatible services selectable without asking for a key", async () => {
    await render();
    await chooseChannel("deepl-web");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.textContent).not.toContain("translation.deeplWebHint");
    expect(host.textContent).not.toContain("translation.configError");
    const test = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "translation.test",
    );
    await act(async () => test?.click());
    await advance(400);
    expect(provider().querySelector('[data-translation-status="unconfigured"]')).not.toBeNull();
    expect(
      mock.invoke.mock.calls.filter(
        ([command, args]) =>
          command === "translation_request" && args.config.provider === "deepl-web",
      ),
    ).toHaveLength(0);
  });
  it("does not send duplicate initial probes under StrictMode", async () => {
    await act(async () =>
      root.render(createElement(StrictMode, null, createElement(TranslationSettings))),
    );
    await advance();
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(3);
  });
  it("does not let a late automatic response relight a closed settings panel", async () => {
    const resolve: ((text: string) => void)[] = [];
    mock.invoke.mockImplementation((command: string) =>
      command === "translation_request"
        ? new Promise<string>((finish) => resolve.push(finish))
        : Promise.resolve(null),
    );
    await render();
    await advance();
    await act(async () => root.render(null));
    await act(async () => {
      for (const finish of resolve) finish("late");
    });
    expect(host.textContent).toBe("");
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(2);
  });
});
