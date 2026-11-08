import {
  readTranslationKey,
  type TranslationConfig,
  translateText,
  translationCredentialMode,
  translationEndpoint,
  translationErrorKey,
} from "./translation";
import { beginTranslationHealth } from "./translation-health";

const samples = {
  en: "Hello world.",
  "zh-CN": "你好，世界。",
  "zh-TW": "你好，世界。",
  ko: "안녕하세요, 세계.",
  ja: "こんにちは、世界。",
  fr: "Bonjour le monde.",
  de: "Hallo Welt.",
  es: "Hola, mundo.",
};

async function probeChannel(
  config: TranslationConfig,
  signal: AbortSignal,
  isCurrent: (config: TranslationConfig) => boolean,
) {
  if (signal.aborted || !isCurrent(config)) return;
  const finish = beginTranslationHealth(config);
  try {
    if (!config.baseUrl.trim() || (config.provider === "llm" && !config.model.trim())) {
      finish("unconfigured");
      return;
    }
    translationEndpoint(config);
    if (translationCredentialMode(config.provider) === "required") {
      const fields =
        config.provider === "tencent" ? (["key", "secretId"] as const) : (["key"] as const);
      const configured = await Promise.all(
        fields.map(async (field) => Boolean((await readTranslationKey(config, field)).trim())),
      );
      if (signal.aborted || !finish.isCurrent() || !isCurrent(config)) return;
      if (configured.some((value) => !value)) {
        finish("unconfigured");
        return;
      }
    }
    // Yield once so a StrictMode cleanup or configuration edit can stop dispatch.
    await Promise.resolve();
    if (signal.aborted || !finish.isCurrent() || !isCurrent(config)) return;
    await translateText(samples[config.source], config, signal);
  } catch (error) {
    finish(
      signal.aborted ? "idle" : "failed",
      signal.aborted ? undefined : translationErrorKey(error, config.provider),
    );
  } finally {
    if (signal.aborted) finish("idle");
  }
}

/** Probe only a short fixed sample; never read or send a paper or editor selection. */
export async function probeTranslationChannels(
  configs: readonly TranslationConfig[],
  signal: AbortSignal,
  isCurrent: (config: TranslationConfig) => boolean = () => true,
) {
  const queue = [...configs];
  const worker = async () => {
    while (!signal.aborted) {
      const config = queue.shift();
      if (!config) return;
      await probeChannel(config, signal, isCurrent);
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
}
