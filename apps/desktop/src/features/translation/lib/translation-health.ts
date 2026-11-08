import type { TranslationConfig, TranslationProvider } from "./translation";

export type TranslationHealth = {
  status: "idle" | "unconfigured" | "testing" | "available" | "failed";
  checkedAt?: number;
  errorKey?: string;
};

const idle: TranslationHealth = { status: "idle" };
const listeners = new Set<() => void>();
const results = new Map<
  TranslationProvider,
  { config: string; token: symbol; health: TranslationHealth }
>();

// Only public configuration is fingerprinted. No credentials or excerpts are retained.
function fingerprint(config: TranslationConfig) {
  let endpoint = "invalid-endpoint";
  try {
    const url = new URL(config.baseUrl.trim());
    if (!url.username && !url.password && !url.search && !url.hash)
      endpoint = url.toString().replace(/\/+$/, "");
  } catch {
    // An unfinished/invalid URL must not retain accidentally pasted credentials.
  }
  return JSON.stringify([
    config.provider,
    endpoint,
    config.source,
    config.target,
    config.model.trim(),
    config.region.trim(),
  ]);
}
function notify() {
  for (const listener of listeners) listener();
}
export function subscribeTranslationHealth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function readTranslationHealth(config: TranslationConfig): TranslationHealth {
  const result = results.get(config.provider);
  return result?.config === fingerprint(config) ? result.health : idle;
}
export function invalidateTranslationHealth(config: TranslationConfig) {
  results.delete(config.provider);
  notify();
}
export function beginTranslationHealth(config: TranslationConfig) {
  const token = Symbol();
  results.set(config.provider, {
    config: fingerprint(config),
    token,
    health: { status: "testing" },
  });
  notify();
  const finish = (status: TranslationHealth["status"], errorKey?: string) => {
    const current = results.get(config.provider);
    // An old request, edited credential or edited configuration cannot relight the lamp.
    if (current?.token !== token) return;
    current.health = {
      status,
      ...(status === "available" || status === "failed" ? { checkedAt: Date.now() } : {}),
      ...(errorKey ? { errorKey } : {}),
    };
    notify();
  };
  return Object.assign(finish, { isCurrent: () => results.get(config.provider)?.token === token });
}
