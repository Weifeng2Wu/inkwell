import { appStorage } from "@/lib/storage/app-storage";
import type { ExternalAgentId, LaunchOverride } from "./external-agent-catalog";

const KEY = "inkwell-acp-consent-v1";
const scope = (agent: ExternalAgentId, launch?: LaunchOverride) =>
  JSON.stringify([agent, launch?.command ?? null, launch?.args ?? []]);

function approvals(): string[] {
  try {
    const value: unknown = JSON.parse(appStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string").slice(-100)
      : [];
  } catch {
    return [];
  }
}

export function hasAcpConsent(agent: ExternalAgentId, launch?: LaunchOverride) {
  return approvals().includes(scope(agent, launch));
}

export function rememberAcpConsent(agent: ExternalAgentId, launch?: LaunchOverride) {
  const key = scope(agent, launch);
  appStorage.setItem(
    KEY,
    JSON.stringify([...approvals().filter((entry) => entry !== key), key].slice(-100)),
  );
}
