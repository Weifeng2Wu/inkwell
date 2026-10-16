import type { AcademicConfig } from "./academic-client";

const PROTOCOL_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

export function withModelProtocol(
  config: AcademicConfig,
  protocol: Exclude<AcademicConfig["protocol"], "">,
): AcademicConfig {
  const endpoint = config.baseUrl.trim().replace(/\/+$/, "");
  const isDefaultEndpoint = Object.values(PROTOCOL_URLS).includes(endpoint);
  return {
    ...config,
    protocol,
    provider: "inkwell-custom",
    baseUrl: !endpoint || isDefaultEndpoint ? PROTOCOL_URLS[protocol] : config.baseUrl,
  };
}

export function formatModelDiscoveryError(error: unknown, fallback: string, apiKey: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  let detail = message.trim();
  if (apiKey) detail = detail.replaceAll(apiKey, "[redacted]");
  detail = detail.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1000);
  return detail ? `${fallback}\n${detail}` : fallback;
}
