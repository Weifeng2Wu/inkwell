/** @typedef {{ supported: boolean | null, source: "provider" | "catalog" | "manual" | "unknown" | "runtime" }} ModelCapability */
/** @typedef {{ vision: ModelCapability, web: ModelCapability, reasoning: ModelCapability }} ModelCapabilities */
/** @typedef {{ protocol?: string, provider?: string, baseUrl?: string, model?: string, modelCapabilities?: Record<string, ModelCapabilities> }} CapabilityConfig */

/** @param {CapabilityConfig} config */
export function modelCapabilityScope(config) {
  const defaults = {
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
  };
  return JSON.stringify([
    config.protocol || config.provider || "",
    (config.baseUrl?.trim() || defaults[config.protocol] || "").replace(/\/+$/, ""),
    config.model?.trim() || "",
  ]);
}

/** @param {unknown} value @returns {value is ModelCapability} */
function validCapability(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    "supported" in value &&
    (value.supported === null || typeof value.supported === "boolean") &&
    "source" in value &&
    typeof value.source === "string" &&
    ["provider", "catalog", "manual", "unknown", "runtime"].includes(value.source)
  );
}

/** @param {unknown} value @returns {Record<string, ModelCapabilities>} */
export function readCapabilityProfiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(-256)
      .flatMap(([scope, profile]) => {
        if (!profile || !validCapability(profile.vision) || !validCapability(profile.reasoning))
          return [];
        return [
          [
            scope,
            {
              vision: profile.vision,
              reasoning: profile.reasoning,
              web: { supported: false, source: "runtime" },
            },
          ],
        ];
      }),
  );
}

/** @param {boolean | null} supported @param {ModelCapability["source"]} source @returns {ModelCapability} */
const capability = (supported, source) => ({
  supported,
  source: supported === null ? "unknown" : source,
});

/**
 * Exact catalog matches only. Unknown aliases stay unknown; model names are never guessed.
 * @param {CapabilityConfig} config
 * @param {Array<{id: string, provider?: string, input?: string[], reasoning?: boolean}>} catalog
 * @param {Record<string, any>} metadata
 * @returns {ModelCapabilities}
 */
export function resolveModelCapabilities(config, catalog = [], metadata = {}) {
  const id = config.model?.trim();
  const matches = catalog.filter((model) => model.id === id);
  const preferred =
    { openai: "openai", anthropic: "anthropic", gemini: "google" }[config.protocol || ""] ||
    config.provider;
  const direct = matches.filter((model) => model.provider === preferred);
  const candidates = direct.length ? direct : matches;
  const consensus = (values) =>
    values.length && values.every((value) => typeof value === "boolean" && value === values[0])
      ? values[0]
      : null;
  const inputs =
    metadata.architecture?.input_modalities ?? metadata.input_modalities ?? metadata.input;
  const vision =
    typeof metadata.capabilities?.vision === "boolean"
      ? metadata.capabilities.vision
      : Array.isArray(inputs)
        ? inputs.includes("image")
        : null;
  const reasoning =
    typeof metadata.reasoning === "boolean"
      ? metadata.reasoning
      : typeof metadata.capabilities?.thinking?.supported === "boolean"
        ? metadata.capabilities.thinking.supported
        : typeof metadata.capabilities?.reasoning === "boolean"
          ? metadata.capabilities.reasoning
          : null;
  const saved = config.modelCapabilities?.[modelCapabilityScope(config)];
  const resolve = (key, reported, known) => {
    if (validCapability(saved?.[key]) && saved[key].source === "manual") return saved[key];
    if (reported !== null) return capability(reported, "provider");
    if (validCapability(saved?.[key]) && saved[key].source === "provider") return saved[key];
    if (known !== null) return capability(known, "catalog");
    if (validCapability(saved?.[key])) return saved[key];
    return capability(null, "unknown");
  };
  return {
    vision: resolve(
      "vision",
      vision,
      consensus(
        candidates.map((model) =>
          Array.isArray(model.input) ? model.input.includes("image") : null,
        ),
      ),
    ),
    reasoning: resolve(
      "reasoning",
      reasoning,
      consensus(candidates.map((model) => model.reasoning)),
    ),
    // A model's tool-calling support does not give this assistant a web search tool.
    web: capability(false, "runtime"),
  };
}
