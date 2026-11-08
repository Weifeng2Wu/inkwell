"use client";

import { Group as SelectGroup, Label as SelectLabel } from "@radix-ui/react-select";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/features/i18n";
import {
  DEFAULT_TRANSLATION_CONFIG,
  invalidateTranslationHealth,
  probeTranslationChannels,
  readTranslationConfig,
  readTranslationHealth,
  saveTranslationConfig,
  saveTranslationKey,
  selectTranslationProvider,
  subscribeTranslationHealth,
  TRANSLATION_LANGUAGES,
  TRANSLATION_PROVIDERS,
  TRANSLATION_STORAGE,
  type TranslationConfig,
  type TranslationHealth,
  type TranslationLanguage,
  type TranslationProvider,
  translationCredentialMode,
  translationKeyScope,
} from "@/features/translation";
import { flushAppStorage } from "@/lib/storage/app-storage";

function TranslationStatusLight({ health }: { health: TranslationHealth }) {
  const { t } = useI18n();
  const label = [
    t(`translation.status.${health.status}`),
    health.errorKey ? t(health.errorKey) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const colors = {
    idle: "bg-muted-foreground/40",
    unconfigured: "bg-muted-foreground/40",
    testing: "bg-accent motion-safe:animate-pulse",
    available: "bg-success",
    failed: "bg-error",
  };
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-translation-status={health.status}
      className={`inline-block size-2 shrink-0 rounded-full ${colors[health.status]}`}
    />
  );
}

function TranslationRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col justify-between gap-3 border-b border-border/40 py-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-center">
      <span className="block pr-4 text-sm font-medium text-foreground-secondary">{label}</span>
      <div className="max-w-full shrink-0 self-start sm:self-auto">{children}</div>
    </div>
  );
}
function maskCredential(value: string) {
  return value.length > 12 ? `${value.slice(0, 4)}***${value.slice(-4)}` : "********";
}
function CredentialField({
  config,
  field = "key",
  onSaved,
}: {
  config: TranslationConfig;
  field?: "key" | "secretId";
  onSaved: (config: TranslationConfig) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const [mask, setMask] = useState("");
  const [replacement, setReplacement] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const scope = (() => {
    try {
      return translationKeyScope(config, field);
    } catch {
      return "";
    }
  })();
  useEffect(() => {
    const current = ++revision.current;
    setBusy(true);
    setMask("");
    setEditing(false);
    setReplacement("");
    setError(false);
    void (
      scope && isTauri()
        ? invoke<string | null>("agent_api_key_read", { scope })
        : Promise.resolve(null)
    )
      .then((value) => {
        if (current === revision.current) setMask(value ? maskCredential(value) : "");
      })
      .catch(() => {
        if (current === revision.current) setError(true);
      })
      .finally(() => {
        if (current === revision.current) setBusy(false);
      });
    return () => {
      revision.current++;
    };
  }, [scope]);
  async function commit() {
    if (busy) return;
    setEditing(false);
    if (!replacement.trim()) return;
    const current = revision.current;
    setBusy(true);
    setError(false);
    try {
      await saveTranslationKey(config, replacement, field);
      if (current === revision.current) {
        setMask(maskCredential(replacement.trim()));
        setReplacement("");
        onSaved(config);
      }
    } catch {
      if (current === revision.current) setError(true);
    } finally {
      if (current === revision.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-1.5 border-b border-border/40 py-2">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <label htmlFor={id} className="text-sm font-medium text-foreground-secondary">
          {field === "secretId"
            ? "SecretId"
            : config.provider === "tencent"
              ? "SecretKey"
              : "API key"}
        </label>
        <input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          className="settings-control settings-select max-w-full"
          value={editing ? replacement : mask}
          placeholder={t("translation.keyPlaceholder")}
          disabled={busy || !scope || !isTauri()}
          onFocus={() => {
            setEditing(true);
            setReplacement("");
          }}
          onChange={(event) => setReplacement(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-error">
          {t("translation.vaultError")}
        </p>
      )}
    </div>
  );
}

export function TranslationSettings() {
  const { t } = useI18n();
  const id = useId();
  const [config, setConfig] = useState<TranslationConfig>(DEFAULT_TRANSLATION_CONFIG);
  const [error, setError] = useState("");
  const [, refreshHealth] = useState(0);
  const requests = useRef(new Set<AbortController>());
  const latestConfigs = useRef(new Map<TranslationProvider, TranslationConfig>());
  const pendingProbes = useRef(new Map<TranslationProvider, TranslationConfig>());
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runProbes = useCallback((configs: TranslationConfig[]) => {
    if (!isTauri()) return;
    const controller = new AbortController();
    requests.current.add(controller);
    void probeTranslationChannels(
      configs,
      controller.signal,
      (candidate) => latestConfigs.current.get(candidate.provider) === candidate,
    ).finally(() => requests.current.delete(controller));
  }, []);
  const scheduleProbes = useCallback(
    (configs: TranslationConfig[], delay = 400) => {
      for (const config of configs) {
        const snapshot = { ...config };
        latestConfigs.current.set(snapshot.provider, snapshot);
        pendingProbes.current.set(snapshot.provider, snapshot);
        invalidateTranslationHealth(snapshot);
      }
      if (probeTimer.current) clearTimeout(probeTimer.current);
      probeTimer.current = setTimeout(() => {
        const pending = [...pendingProbes.current.values()];
        pendingProbes.current.clear();
        probeTimer.current = null;
        runProbes(pending);
      }, delay);
    },
    [runProbes],
  );
  useEffect(() => subscribeTranslationHealth(() => refreshHealth((value) => value + 1)), []);
  useEffect(() => {
    const load = () => setConfig(readTranslationConfig());
    load();
    const initial = readTranslationConfig();
    const configs = (Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[]).map((provider) =>
      provider === initial.provider ? initial : selectTranslationProvider(initial, provider),
    );
    for (const config of configs) latestConfigs.current.set(config.provider, config);
    const initialProbe = setTimeout(() => runProbes(configs), 0);
    window.addEventListener(TRANSLATION_STORAGE, load);
    return () => {
      window.removeEventListener(TRANSLATION_STORAGE, load);
      clearTimeout(initialProbe);
      if (probeTimer.current) clearTimeout(probeTimer.current);
      probeTimer.current = null;
      pendingProbes.current.clear();
      for (const request of requests.current) request.abort();
      requests.current.clear();
    };
  }, [runProbes]);
  function update(patch: Partial<TranslationConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    setError("");
    const languagesChanged = config.source !== next.source || config.target !== next.target;
    if (languagesChanged) {
      scheduleProbes(
        (Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[]).map((provider) =>
          provider === next.provider ? next : selectTranslationProvider(next, provider),
        ),
      );
    } else if (JSON.stringify(next) !== JSON.stringify(config)) {
      scheduleProbes([next]);
    }
    try {
      saveTranslationConfig(next);
      void flushAppStorage().catch(() => setError(t("translation.saveError")));
    } catch {
      setError(t("translation.configError"));
    }
  }
  const credentialMode = translationCredentialMode(config.provider);
  const modelProvider = config.provider === "llm";
  const health = readTranslationHealth(config);
  const configurableEndpoint = ["llm", "deeplx", "volcano", "deepl-web"].includes(config.provider);
  const controls = "settings-control settings-select max-w-full";
  const docs = {
    deepl: "https://www.deepl.com/pro-api",
    azure: "https://learn.microsoft.com/azure/ai-services/translator/quickstart-text-rest-api",
    google: "https://cloud.google.com/translate/docs/setup",
    tencent: "https://console.cloud.tencent.com/cam/capi",
  };
  const docsUrl = config.provider in docs ? docs[config.provider as keyof typeof docs] : undefined;
  return (
    <section
      aria-label={t("translation.title")}
      className="mb-5 rounded-lg border border-border bg-background p-5 shadow-sm"
    >
      <div className="mb-4 border-b border-border pb-3">
        <h3 className="text-sm font-semibold tracking-tight">{t("translation.title")}</h3>
      </div>
      <div className="space-y-4">
        <TranslationRow label={t("translation.provider")}>
          <Select
            value={config.provider}
            onValueChange={(provider) =>
              update(selectTranslationProvider(config, provider as TranslationProvider))
            }
          >
            <SelectTrigger
              id={`${id}-provider`}
              data-translation-provider
              aria-label={t("translation.provider")}
              className={controls}
            >
              <SelectValue>
                <span className="inline-flex min-w-0 items-center gap-2">
                  <TranslationStatusLight health={health} />
                  <span className="truncate">{t(`translation.providers.${config.provider}`)}</span>
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="settings-select-content">
              {(["free", "web", "byok"] as const).map((providerGroup) => (
                <SelectGroup key={providerGroup}>
                  <SelectLabel className="px-3 pb-1 pt-2 text-xs text-muted">
                    {t(`translation.groups.${providerGroup}`)}
                  </SelectLabel>
                  {(Object.keys(TRANSLATION_PROVIDERS) as TranslationProvider[])
                    .filter((provider) => TRANSLATION_PROVIDERS[provider].group === providerGroup)
                    .map((provider) => (
                      <SelectItem
                        key={provider}
                        value={provider}
                        data-translation-option={provider}
                        textValue={t(`translation.providers.${provider}`)}
                      >
                        <span className="inline-flex items-center gap-2">
                          <TranslationStatusLight
                            health={readTranslationHealth(
                              provider === config.provider
                                ? config
                                : selectTranslationProvider(config, provider),
                            )}
                          />
                          <span>{t(`translation.providers.${provider}`)}</span>
                        </span>
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </TranslationRow>
        {(["source", "target"] as const).map((field) => (
          <TranslationRow key={field} label={t(`translation.${field}`)}>
            <select
              aria-label={t(`translation.${field}`)}
              className={controls}
              value={config[field]}
              onChange={(event) => update({ [field]: event.target.value as TranslationLanguage })}
            >
              {TRANSLATION_LANGUAGES.map((language) => (
                <option key={language} value={language}>
                  {t(`translation.languages.${language}`)}
                </option>
              ))}
            </select>
          </TranslationRow>
        ))}
        {configurableEndpoint && (
          <TranslationRow
            label={t(modelProvider ? "translation.endpoint" : "translation.serviceUrl")}
          >
            <input
              aria-label={t("translation.endpoint")}
              className={controls}
              value={config.baseUrl}
              placeholder={
                modelProvider
                  ? "http://127.0.0.1:8000/v1"
                  : config.provider === "deeplx"
                    ? "http://127.0.0.1:1188/translate"
                    : t("translation.webEndpointPlaceholder")
              }
              onChange={(event) => update({ baseUrl: event.target.value })}
            />
          </TranslationRow>
        )}
        {modelProvider && (
          <TranslationRow label={t("translation.model")}>
            <input
              aria-label={t("translation.model")}
              className={controls}
              value={config.model}
              placeholder={t("translation.modelPlaceholder")}
              onChange={(event) => update({ model: event.target.value })}
            />
          </TranslationRow>
        )}
        {config.provider === "deepl" && (
          <TranslationRow label={t("translation.endpoint")}>
            <select
              aria-label={t("translation.endpoint")}
              className={controls}
              value={config.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
            >
              <option value="https://api-free.deepl.com">DeepL API Free</option>
              <option value="https://api.deepl.com">DeepL API Pro</option>
            </select>
          </TranslationRow>
        )}
        {config.provider === "google-free" && (
          <TranslationRow label={t("translation.endpoint")}>
            <select
              aria-label={t("translation.endpoint")}
              className={controls}
              value={config.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
            >
              <option value="https://translate.googleapis.com/translate_a/single">
                translate.googleapis.com
              </option>
              <option value="https://translate.google.com/translate_a/single">
                translate.google.com
              </option>
            </select>
          </TranslationRow>
        )}
        {config.provider === "tencent" && (
          <>
            <CredentialField
              config={config}
              field="secretId"
              onSaved={(config) => scheduleProbes([config], 0)}
            />
            <TranslationRow label={t("translation.region")}>
              <select
                aria-label={t("translation.region")}
                className={controls}
                value={config.region}
                onChange={(event) => update({ region: event.target.value })}
              >
                {["ap-guangzhou", "ap-shanghai", "ap-beijing"].map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </TranslationRow>
          </>
        )}
        {config.provider === "azure" && (
          <TranslationRow label={t("translation.region")}>
            <input
              aria-label={t("translation.region")}
              className={controls}
              value={config.region}
              placeholder="global / eastasia"
              onChange={(event) => update({ region: event.target.value })}
            />
          </TranslationRow>
        )}
        {credentialMode !== "none" && (
          <CredentialField config={config} onSaved={(config) => scheduleProbes([config], 0)} />
        )}
        {docsUrl && (
          <a
            className="inline-block text-xs text-accent"
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("translation.getKey")}
          </a>
        )}
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-sm"
            disabled={health.status === "testing" || !isTauri()}
            onClick={() => scheduleProbes([config], 0)}
          >
            {t(health.status === "testing" ? "translation.testing" : "translation.test")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => update(DEFAULT_TRANSLATION_CONFIG)}
          >
            {t("translation.reset")}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
