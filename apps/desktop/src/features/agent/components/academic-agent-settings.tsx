"use client";

import { useId, useState } from "react";
import { errorMessage, LOCALES, useI18n } from "@/features/i18n";
import { apiKeyScope } from "../lib/agent-api-key-store";
import { formatModelDiscoveryError, withModelProtocol } from "../lib/model-discovery";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import { useAutomaticModels } from "../lib/use-automatic-models";
import { AgentApiKeyInput } from "./agent-api-key-input";
import { CustomHeadersInput } from "./custom-headers-input";
import { ModelPicker, selectModel } from "./model-picker";
import { ServiceModelInput } from "./service-model-input";

export function AcademicAgentSettings({
  agent,
  external = false,
  showPreferences = true,
}: {
  agent: AcademicAgentController;
  external?: boolean;
  showPreferences?: boolean;
}) {
  const fieldId = useId();
  const { t } = useI18n();
  const {
    directory,
    config,
    setConfig,
    apiKey,
    apiKeyLoading,
    setApiKey,
    session,
    dirty,
    error,
    testConnection,
    testingConnection,
    connectionTestError,
    connectionTest,
    fetchModels,
    testWebSearch,
  } = agent;
  const [testingImageApi, setTestingImageApi] = useState(false);
  const [imageApiTest, setImageApiTest] = useState<{ endpoint: string; count: number } | null>(
    null,
  );
  const [imageApiError, setImageApiError] = useState<string | null>(null);
  const [testingWebSearch, setTestingWebSearch] = useState(false);
  const [webSearchTested, setWebSearchTested] = useState<string | null>(null);
  const [webSearchError, setWebSearchError] = useState<{ scope: string; message: string } | null>(
    null,
  );
  const searchTestScope = JSON.stringify([directory, config.webSearch, agent.webSearchApiKey]);
  const models = useAutomaticModels({
    enabled: !external,
    directory,
    config,
    apiKey,
    apiKeyLoading,
    working: false,
    errorLabel: t("agent.settings.modelsFailed"),
    fetchModels,
    onDiscovered: (result) =>
      setConfig((current) => selectModel(current, current.model, result.capabilities)),
  });
  const heading = t(external ? "agent.settings.sharedHeading" : "agent.settings.modelHeading");
  const inputClass = "settings-control mt-1 w-full";
  const selectRowClass =
    "grid grid-cols-1 items-center gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_16rem]";
  const selectClass = "settings-control settings-select";
  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-background p-5 shadow-sm"
      aria-label={heading}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <h3 className="text-sm font-semibold">{heading}</h3>
      </div>
      <fieldset className="space-y-4">
        {!external && (
          <div className="space-y-4">
            <label className={selectRowClass} htmlFor={`${fieldId}-protocol`}>
              <span>{t("agent.settings.protocol")}</span>
              <select
                id={`${fieldId}-protocol`}
                className={selectClass}
                value={config.protocol}
                onChange={(event) => {
                  const protocol = event.target.value;
                  if (protocol !== "openai" && protocol !== "anthropic" && protocol !== "gemini")
                    return;
                  setConfig(withModelProtocol(config, protocol));
                }}
              >
                {!config.protocol && (
                  <option value="" disabled hidden>
                    {t("agent.settings.chooseProtocol")}
                  </option>
                )}
                <option value="openai">{t("agent.settings.openaiCompatible")}</option>
                <option value="anthropic">{t("agent.settings.anthropicCompatible")}</option>
                <option value="gemini">{t("agent.settings.geminiCompatible")}</option>
              </select>
            </label>
            {config.protocol ? (
              <label className="block text-xs" htmlFor={`${fieldId}-base-url`}>
                {t("agent.settings.baseUrl")}
                <input
                  id={`${fieldId}-base-url`}
                  type="url"
                  className={inputClass}
                  value={config.baseUrl}
                  maxLength={2048}
                  onChange={(event) => setConfig({ ...config, baseUrl: event.target.value })}
                />
              </label>
            ) : (
              <label className="block text-xs" htmlFor={`${fieldId}-provider`}>
                {t("agent.settings.provider")}
                <input
                  id={`${fieldId}-provider`}
                  className={inputClass}
                  value={config.provider}
                  onChange={(event) => setConfig({ ...config, provider: event.target.value })}
                />
              </label>
            )}
            <ModelPicker
              inputId={`${fieldId}-model`}
              label={t("agent.settings.model")}
              config={config}
              onChange={setConfig}
              models={models.models}
              discovered={models.capabilities}
              loading={models.loading}
              discoveryFailed={!!models.error}
              webSearchAvailable={Boolean(agent.webSearchApiKey.trim())}
            />
            <label className="block text-xs" htmlFor={`${fieldId}-key`}>
              {t("agent.settings.apiKey")}
              <AgentApiKeyInput
                key={apiKeyScope(config)}
                id={`${fieldId}-key`}
                className={inputClass}
                value={apiKey}
                loading={apiKeyLoading}
                placeholder={apiKeyLoading ? t("agent.settings.keyLoading") : ""}
                onCommit={setApiKey}
              />
            </label>
            <CustomHeadersInput
              value={config.customHeaders}
              onChange={(customHeaders) => setConfig({ ...config, customHeaders })}
            />

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => testConnection(config, apiKey)}
                  disabled={testingConnection || apiKeyLoading || !config.model.trim()}
                >
                  {t(
                    testingConnection ? "agent.settings.testing" : "agent.settings.testConnection",
                  )}
                </button>
              </div>
              {connectionTest && (
                <p role="status" className="text-xs text-success">
                  {t("agent.settings.testSuccess", { ms: connectionTest.milliseconds })}
                </p>
              )}
              {connectionTestError && (
                <p role="alert" className="text-xs text-error">
                  {connectionTestError}
                </p>
              )}
              {models.loading && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("agent.settings.modelsLoading")}
                </p>
              )}
              {models.models?.length === 0 && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("agent.settings.modelsEmpty")}
                </p>
              )}
              {models.error && (
                <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
                  {models.error}
                </p>
              )}
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <div>
                <h4 className="text-xs font-semibold">{t("agent.settings.imageGeneration")}</h4>
              </div>
              <label className="block text-xs" htmlFor={`${fieldId}-image-base-url`}>
                {t("agent.settings.imageBaseUrl")}
                <input
                  id={`${fieldId}-image-base-url`}
                  type="url"
                  className={inputClass}
                  value={config.imageGeneration.baseUrl}
                  maxLength={2048}
                  placeholder="https://api.openai.com/v1"
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      imageGeneration: { ...config.imageGeneration, baseUrl: event.target.value },
                    })
                  }
                />
              </label>

              <label className="block text-xs" htmlFor={`${fieldId}-image-model`}>
                {t("agent.settings.imageModel")}
                <ServiceModelInput
                  id={`${fieldId}-image-model`}
                  baseUrl={config.imageGeneration.baseUrl}
                  customHeaders={config.imageGeneration.customHeaders}
                  apiKey={agent.imageGenerationApiKey}
                  loading={agent.imageGenerationApiKeyLoading}
                  value={config.imageGeneration.model}
                  onChange={(model) =>
                    setConfig({ ...config, imageGeneration: { ...config.imageGeneration, model } })
                  }
                />
              </label>
              <label className="block text-xs" htmlFor={`${fieldId}-image-key`}>
                {t("agent.settings.imageKey")}
                <AgentApiKeyInput
                  key={apiKeyScope({
                    protocol: "",
                    provider: "inkwell-imagegen",
                    baseUrl: config.imageGeneration.baseUrl,
                  })}
                  id={`${fieldId}-image-key`}
                  className={inputClass}
                  value={agent.imageGenerationApiKey}
                  loading={agent.imageGenerationApiKeyLoading}
                  placeholder={
                    agent.imageGenerationApiKeyLoading
                      ? t("agent.settings.keyLoading")
                      : t("agent.settings.imageKeyPlaceholder")
                  }
                  onCommit={agent.setImageGenerationApiKey}
                />
              </label>
              <CustomHeadersInput
                value={config.imageGeneration.customHeaders}
                onChange={(customHeaders) =>
                  setConfig({
                    ...config,
                    imageGeneration: { ...config.imageGeneration, customHeaders },
                  })
                }
              />
              <div className="space-y-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={
                    testingImageApi ||
                    agent.imageGenerationApiKeyLoading ||
                    !config.imageGeneration.baseUrl.trim() ||
                    !config.imageGeneration.model.trim() ||
                    !agent.imageGenerationApiKey.trim()
                  }
                  onClick={async () => {
                    const imageEndpoint = JSON.stringify([
                      directory,
                      config.imageGeneration.baseUrl,
                      config.imageGeneration.model,
                      config.imageGeneration.customHeaders,
                      agent.imageGenerationApiKey,
                    ]);
                    setTestingImageApi(true);
                    setImageApiError(null);
                    setImageApiTest(null);
                    try {
                      const result = await fetchModels(
                        {
                          ...config,
                          protocol: "openai",
                          provider: "inkwell-imagegen",
                          baseUrl: config.imageGeneration.baseUrl,
                          model: config.imageGeneration.model,
                          customHeaders: config.imageGeneration.customHeaders,
                        },
                        agent.imageGenerationApiKey,
                      );
                      setImageApiTest({ endpoint: imageEndpoint, count: result.models.length });
                    } catch (caught) {
                      setImageApiError(
                        formatModelDiscoveryError(
                          caught,
                          t("agent.settings.imageTestFailed"),
                          agent.imageGenerationApiKey,
                        ),
                      );
                    } finally {
                      setTestingImageApi(false);
                    }
                  }}
                >
                  {t(testingImageApi ? "agent.settings.testing" : "agent.settings.testImage")}
                </button>
                {imageApiTest &&
                  imageApiTest.endpoint ===
                    JSON.stringify([
                      directory,
                      config.imageGeneration.baseUrl,
                      config.imageGeneration.model,
                      config.imageGeneration.customHeaders,
                      agent.imageGenerationApiKey,
                    ]) && (
                    <p role="status" className="text-xs text-success">
                      {t("agent.settings.imageTestSuccess")}
                    </p>
                  )}
                {imageApiError && (
                  <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
                    {imageApiError}
                  </p>
                )}
              </div>
            </div>
            <div
              data-settings-section="search"
              className="space-y-3 rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold">{t("agent.settings.webSearch")}</h4>
                  <p className="mt-1 text-xs text-muted">
                    {t("agent.settings.webSearchDescription")}
                  </p>
                </div>
                <a
                  href="https://app.tavily.com/home"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-accent hover:underline"
                >
                  {t("agent.settings.webSearchGetKey")} ↗
                </a>
              </div>
              <label className="block text-xs" htmlFor={`${fieldId}-search-base-url`}>
                {t("agent.settings.webSearchBaseUrl")}
                <input
                  id={`${fieldId}-search-base-url`}
                  type="url"
                  className={inputClass}
                  value={config.webSearch.baseUrl}
                  maxLength={2048}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      webSearch: { ...config.webSearch, baseUrl: event.target.value },
                    })
                  }
                />
              </label>

              <label className="block text-xs" htmlFor={`${fieldId}-search-key`}>
                {t("agent.settings.webSearchKey")}
                <AgentApiKeyInput
                  key={apiKeyScope({
                    protocol: "",
                    provider: "inkwell-web-search",
                    baseUrl: config.webSearch.baseUrl,
                  })}
                  id={`${fieldId}-search-key`}
                  className={inputClass}
                  value={agent.webSearchApiKey}
                  loading={agent.webSearchApiKeyLoading}
                  placeholder={
                    agent.webSearchApiKeyLoading
                      ? t("agent.settings.keyLoading")
                      : t("agent.settings.webSearchKeyPlaceholder")
                  }
                  onCommit={agent.setWebSearchApiKey}
                />
              </label>
              <CustomHeadersInput
                value={config.webSearch.customHeaders}
                onChange={(customHeaders) =>
                  setConfig({ ...config, webSearch: { ...config.webSearch, customHeaders } })
                }
              />
              <div className="space-y-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={
                    testingWebSearch ||
                    agent.webSearchApiKeyLoading ||
                    !agent.webSearchApiKey.trim() ||
                    !config.webSearch.baseUrl.trim()
                  }
                  onClick={async () => {
                    setTestingWebSearch(true);
                    setWebSearchTested(null);
                    setWebSearchError(null);
                    try {
                      const ok = await testWebSearch();
                      if (ok) setWebSearchTested(searchTestScope);
                    } catch (caught) {
                      setWebSearchError({
                        scope: searchTestScope,
                        message: errorMessage(caught, t),
                      });
                    } finally {
                      setTestingWebSearch(false);
                    }
                  }}
                >
                  {t(testingWebSearch ? "agent.settings.testing" : "agent.settings.testWebSearch")}
                </button>
                <p className="text-xs text-muted">{t("agent.settings.webSearchTestHint")}</p>
                {webSearchTested === searchTestScope && (
                  <p role="status" className="text-xs text-success">
                    {t("agent.settings.webSearchTestSuccess")}
                  </p>
                )}
                {webSearchError?.scope === searchTestScope && (
                  <p role="alert" className="text-xs text-error">
                    {webSearchError.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        {showPreferences && (
          <>
            <label className={selectRowClass} htmlFor={`${fieldId}-permission-mode`}>
              <span>{t("agent.settings.permissionMode")}</span>
              <select
                id={`${fieldId}-permission-mode`}
                className={selectClass}
                value={config.permissionMode}
                onChange={(event) => {
                  const permissionMode = event.target.value;
                  if (
                    permissionMode === "restricted" ||
                    permissionMode === "ask" ||
                    permissionMode === "auto"
                  )
                    setConfig({ ...config, permissionMode });
                }}
              >
                <option value="restricted">{t("agent.settings.permissionRestricted")}</option>
                <option value="ask">{t("agent.settings.permissionAsk")}</option>
                <option value="auto">{t("agent.settings.permissionAuto")}</option>
              </select>
            </label>
            <label className={selectRowClass} htmlFor={`${fieldId}-answer-language`}>
              <span>{t("agent.settings.answerLanguage")}</span>
              <select
                id={`${fieldId}-answer-language`}
                className={selectClass}
                value={config.answerLanguage}
                onChange={(event) => {
                  const answerLanguage = event.target.value;
                  if (answerLanguage === "zh" || answerLanguage === "en" || answerLanguage === "ko")
                    setConfig({ ...config, answerLanguage });
                }}
              >
                {LOCALES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.nativeName}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <label className="block text-xs" htmlFor={`${fieldId}-personal-prompt`}>
                {t("agent.settings.personalPrompt")}
              </label>
              <textarea
                id={`${fieldId}-personal-prompt`}
                className={`${inputClass} h-32 min-h-32 max-h-32 resize-none`}
                value={config.personalPrompt}
                maxLength={16_384}
                placeholder={t("agent.settings.personalPromptPlaceholder")}
                onChange={(event) => setConfig({ ...config, personalPrompt: event.target.value })}
              />
            </div>
          </>
        )}
      </fieldset>
      {session && dirty && <p className="text-xs text-warning">{t("agent.dirty")}</p>}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
          {t("agent.error", { error })}
        </p>
      )}
    </section>
  );
}
