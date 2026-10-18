import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ApiKeyConfig } from "./academic-client";

export function apiKeyScope(config: ApiKeyConfig): string {
  let endpoint = config.baseUrl.trim().replace(/\/+$/, "");
  try {
    endpoint = new URL(endpoint).toString().replace(/\/+$/, "");
  } catch {}
  return JSON.stringify([config.protocol, config.protocol ? "" : config.provider, endpoint]);
}

export function maskApiKey(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export async function readAgentApiKey(scope: string): Promise<string | null> {
  if (!isTauri()) return null;
  const [protocol, provider, endpoint]: unknown[] = JSON.parse(scope);
  if (!protocol && typeof provider === "string" && provider.trim() && endpoint === "")
    return invoke<string | null>("agent_api_key_read", { scope });
  try {
    if (typeof endpoint !== "string") return null;
    const url = new URL(endpoint);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
  } catch {
    return null;
  }
  return invoke<string | null>("agent_api_key_read", { scope });
}

export async function writeAgentApiKey(scope: string, apiKey: string): Promise<void> {
  if (!isTauri()) throw new Error("Local API key storage requires the desktop app.");
  await invoke("agent_api_key_write", { scope, apiKey });
}
