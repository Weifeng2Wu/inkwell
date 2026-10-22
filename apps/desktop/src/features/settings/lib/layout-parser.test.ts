import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAYOUT_CONFIG,
  layoutKeyScope,
  layoutParserErrorKey,
  normalizeLayoutKey,
  parseLayoutImage,
  readLayoutConfig,
  saveLayoutConfig,
  saveLayoutKey,
} from "./layout-parser";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
let saved: string | null;
beforeEach(() => {
  saved = null;
  vi.mocked(invoke).mockReset();
  vi.stubGlobal("localStorage", {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      saved = value;
    },
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
describe("shared layout parser configuration", () => {
  it.each([
    ["MinerU HTTP 401: rejected", "unauthorized"],
    ["MinerU authentication failed (A0202)", "unauthorized"],
    ["MinerU authentication failed (A0211)", "unauthorized"],
    ["Parser HTTP 403: denied", "forbidden"],
    ["Parser HTTP 429: quota", "rateLimited"],
    ["Parser HTTP 503: unavailable", "serviceUnavailable"],
    ["TimeoutError: request timed out", "timedOut"],
    ["TypeError: fetch failed", "networkError"],
  ])("maps %s to an actionable message", (message, key) => {
    expect(layoutParserErrorKey(message)).toBe(`layoutParser.${key}`);
  });
  it("preserves unrecognized parsing failures", () => {
    expect(layoutParserErrorKey("Invalid MinerU upload response.")).toBeUndefined();
  });
  it("saves the token without a pasted Authorization prefix", async () => {
    await saveLayoutKey(DEFAULT_LAYOUT_CONFIG, "  Bearer mineru-token  ");
    expect(invoke).toHaveBeenCalledWith("agent_api_key_write", {
      scope: layoutKeyScope(DEFAULT_LAYOUT_CONFIG),
      apiKey: "mineru-token",
    });
    expect(normalizeLayoutKey("  bare-token  ")).toBe("bare-token");
  });
  it("stores preferences separately and reads the parsing key through the credential command", async () => {
    saveLayoutConfig(DEFAULT_LAYOUT_CONFIG);
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "agent_api_key_read" ? "parser-key" : { text: "Extracted labels" },
    );
    const result = await parseLayoutImage(
      { name: "screenshot", mimeType: "image/png", data: "eA==" },
      "configure",
    );
    expect(result).toBe("Extracted labels");
    expect(saved).not.toContain("parser-key");
    expect(invoke).toHaveBeenCalledWith("agent_api_key_read", {
      scope: layoutKeyScope(DEFAULT_LAYOUT_CONFIG),
    });
    expect(invoke).toHaveBeenCalledWith("layout_parser_request", {
      request: expect.objectContaining({
        apiKey: "parser-key",
        name: "screenshot.png",
        images: ["data:image/png;base64,eA=="],
      }),
    });
  });
  it("blocks missing configuration before uploading images", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(
      parseLayoutImage({ name: "x.png", mimeType: "image/png", data: "eA==" }, "configure first"),
    ).rejects.toThrow("configure first");
    expect(invoke).not.toHaveBeenCalledWith("layout_parser_request", expect.anything());
  });
  it("uses the custom parsing provider without falling back to MinerU", async () => {
    saveLayoutConfig({
      ...DEFAULT_LAYOUT_CONFIG,
      provider: "custom",
      baseUrl: "https://vision.example/v1",
      model: "vision-model",
    });
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "agent_api_key_read" ? "vision-key" : { text: "Chart" },
    );
    await parseLayoutImage({ name: "x.webp", mimeType: "image/webp", data: "eA==" }, "configure");
    expect(invoke).toHaveBeenCalledWith("layout_parser_request", {
      request: expect.objectContaining({
        config: expect.objectContaining({ provider: "custom", model: "vision-model" }),
        apiKey: "vision-key",
      }),
    });
    expect(readLayoutConfig().provider).toBe("custom");
  });
  it("rejects unsupported formats and empty parser results", async () => {
    await expect(
      parseLayoutImage({ name: "x.svg", mimeType: "image/svg+xml", data: "eA==" }, "configure"),
    ).rejects.toThrow("Invalid");
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "agent_api_key_read" ? "key" : { text: "" },
    );
    await expect(
      parseLayoutImage({ name: "x.png", mimeType: "image/png", data: "eA==" }, "configure"),
    ).rejects.toThrow("no readable");
  });
});
