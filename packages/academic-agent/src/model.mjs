import { parseCustomHeaders, mergeCustomHeaders } from "./custom-headers.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveModelCapabilities } from "./model-capabilities.mjs";

export const PROTOCOLS = {
  openai: { api: "openai-completions", baseUrl: "https://api.openai.com/v1" },
  anthropic: { api: "anthropic-messages", baseUrl: "https://api.anthropic.com" },
  gemini: {
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
};

function providerApiKey(command, protocol) {
  const environmentKeys = {
    openai: ["OPENAI_API_KEY"],
    anthropic: ["ANTHROPIC_API_KEY"],
    gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  };
  return command.apiKey || environmentKeys[protocol]?.map((key) => process.env[key]).find(Boolean);
}

export async function listModels(command, signal, catalog = []) {
  const { protocol, baseUrl } = validateModelConfig({ ...command, model: "model-discovery" });
  if (!protocol) throw new Error("Select an API protocol before fetching models.");
  const apiKey = providerApiKey(command, protocol);
  const headers = { Accept: "application/json" };
  if (apiKey) {
    if (protocol === "anthropic") headers["x-api-key"] = apiKey;
    else if (protocol === "gemini") headers["x-goog-api-key"] = apiKey;
    else headers.Authorization = `Bearer ${apiKey}`;
  }
  if (protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";
  const root = protocol === "anthropic" && !baseUrl.endsWith("/v1") ? `${baseUrl}/v1` : baseUrl;
  const models = new Set();
  const capabilities = Object.create(null);
  let cursor;
  const seenCursors = new Set();
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${root}/models`);
    if (cursor) url.searchParams.set(protocol === "gemini" ? "pageToken" : "after_id", cursor);
    const response = await fetch(url, {
      headers: mergeCustomHeaders(headers, command.customHeaders),
      signal,
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Model listing failed (HTTP ${response.status}).`);
    if (!response.body) throw new Error("Empty model listing response.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_048_576) throw new Error("Model listing response is too large.");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const entries = protocol === "gemini" ? body?.models : body?.data;
    if (!Array.isArray(entries)) throw new Error("Invalid model listing response.");
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (
        protocol === "gemini" &&
        Array.isArray(entry.supportedGenerationMethods) &&
        !entry.supportedGenerationMethods.includes("generateContent")
      )
        continue;
      const identifier =
        protocol === "gemini" && typeof entry.name === "string"
          ? entry.name.replace(/^models\//, "")
          : protocol === "gemini"
            ? undefined
            : entry.id;
      if (typeof identifier !== "string" || !identifier.trim() || identifier.length > 200) continue;
      models.add(identifier.trim());
      capabilities[identifier.trim()] = resolveModelCapabilities(
        { ...command, model: identifier.trim(), modelCapabilities: undefined },
        catalog,
        entry,
      );
      if (models.size > 5000) throw new Error("Too many models returned.");
    }
    cursor =
      protocol === "gemini"
        ? body.nextPageToken
        : protocol === "anthropic" && body.has_more
          ? body.last_id
          : undefined;
    if (protocol === "anthropic" && body.has_more && !cursor)
      throw new Error("Invalid model listing pagination.");
    if (!cursor) return { models: [...models].sort(), capabilities: { ...capabilities } };
    if (typeof cursor !== "string" || cursor.length > 2048 || seenCursors.has(cursor))
      throw new Error("Invalid model listing pagination.");
    seenCursors.add(cursor);
  }
  throw new Error("Too many model listing pages.");
}

export function validateModelConfig(command) {
  parseCustomHeaders(command.customHeaders);
  if (typeof command.model !== "string" || !command.model.trim() || command.model.length > 200)
    throw new Error("Enter a model name in Agent settings.");
  if (
    command.apiKey !== undefined &&
    (typeof command.apiKey !== "string" || command.apiKey.length > 16_384)
  )
    throw new Error("Invalid API key.");
  if (
    command.personalPrompt !== undefined &&
    (typeof command.personalPrompt !== "string" || command.personalPrompt.length > 16_384)
  )
    throw new Error("Personal preference prompt must be a string of at most 16384 characters.");
  const protocol = command.protocol ?? "";
  if (protocol !== "" && !Object.hasOwn(PROTOCOLS, protocol))
    throw new Error("Unsupported API protocol.");
  if (
    protocol === "" &&
    (typeof command.provider !== "string" ||
      !command.provider.trim() ||
      command.provider.length > 100)
  )
    throw new Error("Enter a provider in Agent settings.");
  let baseUrl;
  if (protocol) {
    if (command.baseUrl !== undefined && typeof command.baseUrl !== "string")
      throw new Error("Invalid Base URL.");
    baseUrl = command.baseUrl?.trim() || PROTOCOLS[protocol].baseUrl;
    const parsed = new URL(baseUrl);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      baseUrl.length > 2048
    )
      throw new Error(
        "Base URL must be an HTTP(S) API endpoint without credentials, query, or fragment.",
      );
    if (
      parsed.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
      throw new Error("Use HTTPS for remote API endpoints. HTTP is allowed only for localhost.");
    baseUrl = baseUrl.replace(/\/+$/, "");
  }
  const answerLanguage = command.answerLanguage ?? "zh";
  if (!["zh", "en", "ko"].includes(answerLanguage))
    throw new Error("Unsupported response language.");
  return {
    protocol,
    baseUrl,
    personalPrompt: (command.personalPrompt ?? "").trim(),
    answerLanguage,
  };
}

export function responseLanguagePrompt(answerLanguage) {
  const languages = { zh: "Chinese", en: "English", ko: "Korean" };
  return `Respond in ${languages[answerLanguage]}. This response language takes precedence over language preferences in personal prompts or conversation history. Preserve code, LaTeX commands, file paths, and quoted source text in their original form. Do not translate manuscript content unless the task requests it.`;
}

export async function createModelRuntime(sdk, dataDirectory, signal) {
  const agentDirectory =
    process.env.INKWELL_AGENT_AUTH_DIR ?? path.join(dataDirectory, "credentials");
  await mkdir(agentDirectory, { recursive: true });
  return sdk.ModelRuntime.create({
    authPath: path.join(agentDirectory, "auth.json"),
    modelsPath: path.join(agentDirectory, "models.json"),
    signal,
  });
}

export async function resolveModel(sdk, command, dataDirectory, signal) {
  const config = validateModelConfig(command);
  const runtime = await createModelRuntime(sdk, dataDirectory, signal);
  const capabilities = resolveModelCapabilities(command, runtime.getModels());
  const provider = config.protocol ? "inkwell-custom" : command.provider;
  if (config.protocol)
    runtime.registerProvider(provider, {
      api: PROTOCOLS[config.protocol].api,
      baseUrl: config.baseUrl,
      models: [
        {
          id: command.model.trim(),
          name: command.model.trim(),
          reasoning: capabilities.reasoning.supported === true,
          input: capabilities.vision.supported === true ? ["text", "image"] : ["text"],
          contextWindow: 32_768,
          maxTokens: 4096,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
  const apiKey = providerApiKey(command, config.protocol);
  if (apiKey) await runtime.setRuntimeApiKey(provider, apiKey);
  let model = runtime.getModel(provider, command.model.trim());
  if (!model) throw new Error("Unknown provider/model. Check Agent settings.");
  if (!config.protocol) {
    model = {
      ...model,
      ...(capabilities.vision.source === "manual"
        ? {
            input: capabilities.vision.supported === true ? ["text", "image"] : ["text"],
          }
        : {}),
      ...(capabilities.reasoning.source === "manual"
        ? {
            reasoning: capabilities.reasoning.supported === true,
          }
        : {}),
    };
  }
  model = { ...model, headers: mergeCustomHeaders(model.headers, command.customHeaders) };
  signal?.throwIfAborted();
  return {
    runtime,
    model,
    personalPrompt: config.personalPrompt,
    answerLanguage: config.answerLanguage,
    languagePrompt: responseLanguagePrompt(config.answerLanguage),
  };
}
