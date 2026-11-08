import { invoke, isTauri } from "@tauri-apps/api/core";
import { appStorage } from "@/lib/storage/app-storage";
import { beginTranslationHealth, invalidateTranslationHealth } from "./translation-health";

export const TRANSLATION_STORAGE = "inkwell-translation-v1";
const pendingCredentialWrites = new Map<string, Promise<void>>();
export const TRANSLATION_LANGUAGES = [
  "en",
  "zh-CN",
  "zh-TW",
  "ko",
  "ja",
  "fr",
  "de",
  "es",
] as const;
export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];
export type TranslationProvider =
  | "transmart"
  | "volcano"
  | "deeplx"
  | "deepl-web"
  | "google-free"
  | "deepl"
  | "azure"
  | "llm"
  | "google"
  | "tencent";
export const TRANSLATION_PROVIDERS: Record<
  TranslationProvider,
  { group: "free" | "web" | "byok"; baseUrl: string; model: string; region: string }
> = {
  "google-free": {
    group: "free",
    baseUrl: "https://translate.googleapis.com/translate_a/single",
    model: "",
    region: "",
  },
  transmart: { group: "free", baseUrl: "https://transmart.qq.com/api/imt", model: "", region: "" },
  volcano: {
    group: "web",
    baseUrl: "",
    model: "",
    region: "",
  },
  deeplx: { group: "web", baseUrl: "http://127.0.0.1:1188/translate", model: "", region: "" },
  "deepl-web": { group: "web", baseUrl: "", model: "", region: "" },
  deepl: { group: "byok", baseUrl: "https://api-free.deepl.com", model: "", region: "" },
  azure: {
    group: "byok",
    baseUrl: "https://api.cognitive.microsofttranslator.com",
    model: "",
    region: "",
  },
  llm: { group: "byok", baseUrl: "https://api.openai.com/v1", model: "", region: "" },
  google: { group: "byok", baseUrl: "https://translation.googleapis.com", model: "", region: "" },
  tencent: {
    group: "byok",
    baseUrl: "https://tmt.tencentcloudapi.com",
    model: "",
    region: "ap-guangzhou",
  },
};
export const TRANSLATION_PROFILE_STORAGE = "inkwell-translation-profiles-v1";
export function translationCredentialMode(provider: TranslationProvider) {
  return ["transmart", "volcano", "google-free", "deepl-web"].includes(provider)
    ? "none"
    : ["deeplx", "llm"].includes(provider)
      ? "optional"
      : "required";
}
export type TranslationConfig = {
  provider: TranslationProvider;
  source: TranslationLanguage;
  target: TranslationLanguage;
  baseUrl: string;
  model: string;
  region: string;
};
export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  provider: "google-free",
  source: "en",
  target: "zh-CN",
  baseUrl: TRANSLATION_PROVIDERS["google-free"].baseUrl,
  model: "",
  region: "",
};

// Allowlist fields on both read and write: secrets must never enter settings storage.
export function normalizeTranslationConfig(value: unknown): TranslationConfig {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const language = (input: unknown, fallback: TranslationLanguage) =>
    TRANSLATION_LANGUAGES.find((item) => item === input) ?? fallback;
  const provider =
    (Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[]).find(
      (item) => item === data.provider,
    ) ?? DEFAULT_TRANSLATION_CONFIG.provider;
  const preset = TRANSLATION_PROVIDERS[provider];
  // Retired/unknown providers migrate to keyless defaults, never their old endpoint/model.
  const known = provider === data.provider;
  return {
    provider,
    source: language(data.source, "en"),
    target: language(data.target, "zh-CN"),
    baseUrl: known && typeof data.baseUrl === "string" ? data.baseUrl : preset.baseUrl,
    model: known && typeof data.model === "string" ? data.model : preset.model,
    region: known && typeof data.region === "string" ? data.region : preset.region,
  };
}
export function readTranslationConfig(): TranslationConfig {
  try {
    return normalizeTranslationConfig(JSON.parse(appStorage.getItem(TRANSLATION_STORAGE) ?? "{}"));
  } catch {
    return { ...DEFAULT_TRANSLATION_CONFIG };
  }
}
export function saveTranslationConfig(config: TranslationConfig) {
  const normalized = normalizeTranslationConfig(config);
  const previous = readTranslationConfig();
  if (
    previous.provider === normalized.provider &&
    JSON.stringify(previous) !== JSON.stringify(normalized)
  )
    invalidateTranslationHealth(normalized);
  validateStoredEndpoint(normalized);
  const profiles = readTranslationProfiles();
  profiles[normalized.provider] = normalized;
  appStorage.setItem(TRANSLATION_PROFILE_STORAGE, JSON.stringify(profiles));
  appStorage.setItem(TRANSLATION_STORAGE, JSON.stringify(normalized));
  window.dispatchEvent(new Event(TRANSLATION_STORAGE));
}
function readTranslationProfiles(): Partial<Record<TranslationProvider, TranslationConfig>> {
  const profiles: Partial<Record<TranslationProvider, TranslationConfig>> = {};
  try {
    const value: unknown = JSON.parse(appStorage.getItem(TRANSLATION_PROFILE_STORAGE) ?? "{}");
    if (value && typeof value === "object")
      for (const provider of Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[]) {
        if (!(provider in value)) continue;
        const config = normalizeTranslationConfig({
          ...(value as Record<string, object>)[provider],
          provider,
        });
        try {
          validateStoredEndpoint(config);
          profiles[provider] = config;
        } catch {
          /* Reject corrupt profiles. */
        }
      }
  } catch {
    /* Empty profile registry. */
  }
  return profiles;
}
function validateStoredEndpoint(config: TranslationConfig) {
  // An empty configurable endpoint is an unfinished setup, not a corrupt preference.
  if (["volcano", "deepl-web"].includes(config.provider) && !config.baseUrl.trim()) return;
  translationEndpoint(config);
}
export function selectTranslationProvider(
  config: TranslationConfig,
  provider: TranslationProvider,
): TranslationConfig {
  const saved = readTranslationProfiles()[provider];
  const preset = TRANSLATION_PROVIDERS[provider];
  return {
    provider,
    source: config.source,
    target: config.target,
    baseUrl: saved?.baseUrl ?? preset.baseUrl,
    model: saved?.model ?? preset.model,
    region: saved?.region ?? preset.region,
  };
}
export function translationEndpoint(config: TranslationConfig) {
  if (!config.baseUrl.trim()) throw new Error("TRANSLATION_ENDPOINT");
  const url = new URL(config.baseUrl.trim());
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("TRANSLATION_CONFIG");
  const fixed = ["google", "tencent", "transmart", "azure"].includes(config.provider);
  if (
    fixed &&
    url.toString().replace(/\/+$/, "") !== TRANSLATION_PROVIDERS[config.provider].baseUrl
  )
    throw new Error("TRANSLATION_CONFIG");
  if (
    config.provider === "volcano" &&
    !["/crx/translate/v1", "/web/translate/v1"].includes(url.pathname.replace(/\/+$/, ""))
  )
    throw new Error("TRANSLATION_CONFIG");
  if (config.provider === "deepl-web" && url.pathname.replace(/\/+$/, "") !== "/jsonrpc")
    throw new Error("TRANSLATION_CONFIG");
  if (
    config.provider === "deepl" &&
    !["https://api-free.deepl.com", "https://api.deepl.com"].includes(
      url.toString().replace(/\/+$/, ""),
    )
  )
    throw new Error("TRANSLATION_CONFIG");
  if (
    config.provider === "google-free" &&
    ![
      "https://translate.googleapis.com/translate_a/single",
      "https://translate.google.com/translate_a/single",
    ].includes(url.toString().replace(/\/+$/, ""))
  )
    throw new Error("TRANSLATION_CONFIG");
  return url.toString().replace(/\/+$/, "");
}
export function translationKeyScope(config: TranslationConfig, field: "key" | "secretId" = "key") {
  return JSON.stringify([
    "",
    `translation-${config.provider}-${field}`,
    translationEndpoint(config),
  ]);
}
export async function readTranslationKey(
  config: TranslationConfig,
  field: "key" | "secretId" = "key",
) {
  if (!isTauri() || translationCredentialMode(config.provider) === "none") return "";
  const scope = translationKeyScope(config, field);
  await pendingCredentialWrites.get(scope);
  return (
    (await invoke<string | null>("agent_api_key_read", {
      scope,
    })) ?? ""
  );
}
export async function saveTranslationKey(
  config: TranslationConfig,
  key: string,
  field: "key" | "secretId" = "key",
) {
  const replacement = (
    field === "key" && ["llm", "deeplx"].includes(config.provider)
      ? key.trim().replace(/^Bearer\s+/i, "")
      : key
  ).trim();
  if (!replacement || translationCredentialMode(config.provider) === "none") return;
  const scope = translationKeyScope(config, field);
  invalidateTranslationHealth(config);
  const operation = (pendingCredentialWrites.get(scope) ?? Promise.resolve()).then(() =>
    invoke<void>("agent_api_key_write", { scope, apiKey: replacement }),
  );
  pendingCredentialWrites.set(scope, operation);
  try {
    await operation;
  } finally {
    if (pendingCredentialWrites.get(scope) === operation) pendingCredentialWrites.delete(scope);
  }
}
export function translationErrorKey(error: unknown, provider?: TranslationProvider) {
  const message = String(error);
  if (/TRANSLATION_ENDPOINT/.test(message)) return "translation.endpointRequired";
  if (/TRANSLATION_QUOTA|HTTP 429/.test(message)) return "translation.quotaError";
  if (
    /HTTP 401|HTTP 403/.test(message) &&
    provider &&
    translationCredentialMode(provider) === "none"
  )
    return "translation.webUnavailable";
  if (/HTTP 401|HTTP 403|AuthFailure|TRANSLATION_KEY/.test(message)) return "translation.keyError";
  if (/TRANSLATION_CONFIG|TRANSLATION_LANGUAGE/.test(message)) return "translation.configError";
  if (/TRANSLATION_TOO_LONG/.test(message)) return "translation.tooLong";
  if (/TRANSLATION_TIMEOUT/.test(message)) return "translation.timeout";
  if (/TRANSLATION_CANCELLED/.test(message)) return "translation.cancelled";
  if (/TRANSLATION_TRUNCATED/.test(message)) return "translation.truncated";
  return "translation.failed";
}
export async function translateText(
  text: string,
  config = readTranslationConfig(),
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("TRANSLATION_CANCELLED");
  const finish = beginTranslationHealth(config);
  try {
    const result = await requestTranslation(text, config, signal);
    finish("available");
    return result;
  } catch (error) {
    finish(
      signal?.aborted ? "idle" : "failed",
      signal?.aborted ? undefined : translationErrorKey(error, config.provider),
    );
    throw error;
  }
}
async function requestTranslation(
  text: string,
  config: TranslationConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error("TRANSLATION_CANCELLED");
  if (!isTauri()) throw new Error("TRANSLATION_DESKTOP_REQUIRED");
  translationEndpoint(config);
  if (config.source === config.target) throw new Error("TRANSLATION_LANGUAGE");
  // Cancellation discards the result immediately; native HTTP work may finish remotely.
  const operation = (async () => {
    // Clicking Test blurs the key field first. Wait for that credential commit
    // so the native request cannot race it and read an old or missing key.
    if (translationCredentialMode(config.provider) !== "none") {
      const fields =
        config.provider === "tencent" ? (["key", "secretId"] as const) : (["key"] as const);
      const writes = fields
        .map((field) => pendingCredentialWrites.get(translationKeyScope(config, field)))
        .filter((write) => write !== undefined);
      if (writes.length) {
        try {
          await Promise.all(writes);
        } catch {
          throw new Error("TRANSLATION_KEY");
        }
      }
    }
    if (signal?.aborted) throw new Error("TRANSLATION_CANCELLED");
    return invoke<string>("translation_request", {
      config: normalizeTranslationConfig(config),
      text,
    });
  })();
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error("TRANSLATION_CANCELLED"));
    signal.addEventListener("abort", cancel, { once: true });
    operation
      .then((result) => (signal.aborted ? cancel() : resolve(result)), reject)
      .finally(() => signal.removeEventListener("abort", cancel));
    if (signal.aborted) cancel();
  });
}
