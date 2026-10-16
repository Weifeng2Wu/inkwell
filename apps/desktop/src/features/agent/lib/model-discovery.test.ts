import { describe, expect, it } from "vitest";
import { DEFAULT_ACADEMIC_CONFIG } from "./academic-config";
import { formatModelDiscoveryError, withModelProtocol } from "./model-discovery";

describe("model discovery settings", () => {
  it.each(["openai", "anthropic", "gemini"] as const)(
    "preserves a custom endpoint when choosing %s",
    (protocol) => {
      const config = { ...DEFAULT_ACADEMIC_CONFIG, baseUrl: "https://example.com/v1" };
      expect(withModelProtocol(config, protocol)).toMatchObject({
        protocol,
        baseUrl: config.baseUrl,
      });
      expect(config.protocol).toBe("openai");
    },
  );

  it("switches built-in and empty endpoints to the selected protocol default", () => {
    for (const baseUrl of ["", "  ", DEFAULT_ACADEMIC_CONFIG.baseUrl + "/"]) {
      expect(withModelProtocol({ ...DEFAULT_ACADEMIC_CONFIG, baseUrl }, "anthropic").baseUrl).toBe(
        "https://api.anthropic.com",
      );
    }
  });

  it("shows HTTP errors without exposing credentials", () => {
    expect(
      formatModelDiscoveryError(new Error("Model listing failed (HTTP 401)."), "Failed", ""),
    ).toBe("Failed\nModel listing failed (HTTP 401).");
    const message = formatModelDiscoveryError(
      new Error("key=fixture-secret Authorization: Bearer other-secret"),
      "Failed",
      "fixture-secret",
    );
    expect(message).not.toContain("fixture-secret");
    expect(message).not.toContain("other-secret");
    expect(message).toContain("[redacted]");
  });

  it("handles string and unknown errors and bounds diagnostic length", () => {
    expect(formatModelDiscoveryError("Runtime unavailable", "Failed", "")).toContain(
      "Runtime unavailable",
    );
    expect(formatModelDiscoveryError({}, "Failed", "")).toBe("Failed");
    expect(formatModelDiscoveryError("x".repeat(2000), "Failed", "")).toHaveLength(1007);
  });
});
