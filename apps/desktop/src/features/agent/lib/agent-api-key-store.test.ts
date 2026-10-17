import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACADEMIC_CONFIG } from "./academic-config";
import { apiKeyScope, maskApiKey, readAgentApiKey, writeAgentApiKey } from "./agent-api-key-store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("secure API key storage", () => {
  it("shows only the first and last four characters", () => {
    expect(maskApiKey("sk-fixture-secret-1234")).toBe("sk-f***1234");
    expect(maskApiKey("")).toBe("");
    for (const key of ["a", "short", "12345678"]) expect(maskApiKey(key)).toBe("***");
  });
  it("scopes keys by endpoint and protocol, not model or project", () => {
    const scope = apiKeyScope(DEFAULT_ACADEMIC_CONFIG);
    expect(apiKeyScope({ ...DEFAULT_ACADEMIC_CONFIG, model: "other" })).toBe(scope);
    expect(apiKeyScope({ ...DEFAULT_ACADEMIC_CONFIG, baseUrl: "https://API.OPENAI.COM/v1/" })).toBe(
      scope,
    );
    expect(
      apiKeyScope({ ...DEFAULT_ACADEMIC_CONFIG, baseUrl: "https://other.example/v1" }),
    ).not.toBe(scope);
    expect(apiKeyScope({ ...DEFAULT_ACADEMIC_CONFIG, protocol: "anthropic" })).not.toBe(scope);
    expect(
      apiKeyScope({ protocol: "", provider: "inkwell-imagegen", baseUrl: "https://api.openai.com/v1" }),
    ).not.toBe(scope);
  });
  it("reads and writes exclusively through the secure IPC commands", async () => {
    const scope = apiKeyScope(DEFAULT_ACADEMIC_CONFIG);
    vi.mocked(invoke).mockResolvedValueOnce("fixture-key");
    expect(await readAgentApiKey(scope)).toBe("fixture-key");
    expect(invoke).toHaveBeenCalledWith("agent_api_key_read", { scope });
    await writeAgentApiKey("scope", "fixture-new-key");
    expect(invoke).toHaveBeenCalledWith("agent_api_key_write", {
      scope: "scope",
      apiKey: "fixture-new-key",
    });
  });
  it("does not read credentials for an unfinished or invalid endpoint", async () => {
    for (const baseUrl of [
      "",
      "https://",
      "example.com",
      "file:///tmp/key",
      "https://user:secret@example.com",
    ]) {
      expect(
        await readAgentApiKey(apiKeyScope({ ...DEFAULT_ACADEMIC_CONFIG, baseUrl })),
      ).toBeNull();
    }
    expect(invoke).not.toHaveBeenCalled();
  });
  it("never falls back to plaintext storage outside the desktop app", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(await readAgentApiKey("scope")).toBeNull();
    await expect(writeAgentApiKey("scope", "fixture-key")).rejects.toThrow("desktop app");
    expect(invoke).not.toHaveBeenCalled();
  });
});
