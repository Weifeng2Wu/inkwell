"use client";

import { useId, useState } from "react";
import { useI18n } from "@/features/i18n";
import { apiKeyScope } from "../lib/agent-api-key-store";
import { externalAgentLabels } from "../lib/external-agent-labels";
import { modelCapabilityLabels } from "../lib/model-capability-labels";
import { formatModelDiscoveryError, withModelProtocol } from "../lib/model-discovery";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import { useAutomaticModels } from "../lib/use-automatic-models";
import { AgentApiKeyInput } from "./agent-api-key-input";
import { ModelPicker, selectModel } from "./model-picker";

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
  const { locale } = useI18n();
  const externalLabels = externalAgentLabels(locale);
  const {
    labels,
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
    errorLabel: labels.modelsFailed,
    fetchModels,
    onDiscovered: (result) =>
      setConfig((current) => selectModel(current, current.model, result.capabilities)),
  });
  const inputClass = "settings-control mt-1 w-full";
  const selectRowClass =
    "grid grid-cols-1 items-center gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_16rem]";
  const selectClass = "settings-control settings-select";
  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-background p-5 shadow-sm"
      aria-label={external ? externalLabels.shared : labels.settings}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <h3 className="text-sm font-semibold">
          {external ? externalLabels.shared : labels.settings}
        </h3>
      </div>
      <fieldset className="space-y-4">
        {!external && (
          <div className="space-y-4">
            <label className={selectRowClass} htmlFor={`${fieldId}-protocol`}>
              <span>{labels.protocol}</span>
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
                    {labels.protocol}
                  </option>
                )}
                <option value="openai">{labels.openaiCompatible}</option>
                <option value="anthropic">{labels.anthropicCompatible}</option>
                <option value="gemini">{labels.geminiCompatible}</option>
              </select>
            </label>
            {config.protocol ? (
              <label className="block text-xs" htmlFor={`${fieldId}-base-url`}>
                {labels.baseUrl}
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
                {labels.provider}
                <input
                  id={`${fieldId}-provider`}
                  className={inputClass}
                  value={config.provider}
                  onChange={(event) => setConfig({ ...config, provider: event.target.value })}
                />
              </label>
            )}
            <label className="block text-xs" htmlFor={`${fieldId}-key`}>
              {labels.key}
              <AgentApiKeyInput
                key={apiKeyScope(config)}
                id={`${fieldId}-key`}
                className={inputClass}
                value={apiKey}
                loading={apiKeyLoading}
                placeholder={apiKeyLoading ? labels.keyLoading : ""}
                onCommit={setApiKey}
              />
            </label>
            <ModelPicker
              inputId={`${fieldId}-model`}
              label={labels.model}
              locale={locale}
              config={config}
              onChange={setConfig}
              models={models.models}
              discovered={models.capabilities}
              loading={models.loading}
              discoveryFailed={!!models.error}
              webSearchAvailable={Boolean(agent.webSearchApiKey.trim())}
            />
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => testConnection(config, apiKey)}
                  disabled={testingConnection || apiKeyLoading || !config.model.trim()}
                >
                  {testingConnection ? labels.testingImageGeneration : labels.testConnection}
                </button>
              </div>
              {connectionTest && (
                <p role="status" className="text-xs text-success">
                  {labels.testSuccess} · {connectionTest.milliseconds} ms
                </p>
              )}
              {connectionTestError && (
                <p role="alert" className="text-xs text-error">
                  {connectionTestError}
                </p>
              )}
              {models.loading && (
                <p role="status" className="text-xs text-muted-foreground">
                  {modelCapabilityLabels[locale].loading}
                </p>
              )}
              {models.models?.length === 0 && (
                <p role="status" className="text-xs text-muted-foreground">
                  {labels.modelsEmpty}
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
                <h4 className="text-xs font-semibold">{labels.imageGeneration}</h4>
              </div>
              <label className="block text-xs" htmlFor={`${fieldId}-image-base-url`}>
                {labels.imageGenerationBaseUrl}
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
                {labels.imageGenerationModel}
                <input
                  id={`${fieldId}-image-model`}
                  className={inputClass}
                  value={config.imageGeneration.model}
                  maxLength={200}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      imageGeneration: { ...config.imageGeneration, model: event.target.value },
                    })
                  }
                />
              </label>
              <label className="block text-xs" htmlFor={`${fieldId}-image-key`}>
                {labels.imageGenerationKey}
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
                      ? labels.keyLoading
                      : labels.imageGenerationKeyHint
                  }
                  onCommit={agent.setImageGenerationApiKey}
                />
              </label>
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
                        },
                        agent.imageGenerationApiKey,
                      );
                      setImageApiTest({ endpoint: imageEndpoint, count: result.models.length });
                    } catch (caught) {
                      setImageApiError(
                        formatModelDiscoveryError(
                          caught,
                          labels.imageGenerationTestFailed,
                          agent.imageGenerationApiKey,
                        ),
                      );
                    } finally {
                      setTestingImageApi(false);
                    }
                  }}
                >
                  {testingImageApi ? labels.testingImageGeneration : labels.testImageGeneration}
                </button>
                {imageApiTest &&
                  imageApiTest.endpoint ===
                    JSON.stringify([
                      directory,
                      config.imageGeneration.baseUrl,
                      config.imageGeneration.model,
                      agent.imageGenerationApiKey,
                    ]) && (
                    <p role="status" className="text-xs text-success">
                      {labels.imageGenerationTestSuccess}
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
                  <h4 className="text-xs font-semibold">{labels.webSearch}</h4>
                  <p className="mt-1 text-xs text-muted">{labels.webSearchDescription}</p>
                </div>
                <a
                  href="https://app.tavily.com/home"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-accent hover:underline"
                >
                  {labels.webSearchGetKey} ↗
                </a>
              </div>
              <label className="block text-xs" htmlFor={`${fieldId}-search-base-url`}>
                {labels.webSearchBaseUrl}
                <input
                  id={`${fieldId}-search-base-url`}
                  type="url"
                  className={inputClass}
                  value={config.webSearch.baseUrl}
                  maxLength={2048}
                  onChange={(event) =>
                    setConfig({ ...config, webSearch: { baseUrl: event.target.value } })
                  }
                />
              </label>
              <label className="block text-xs" htmlFor={`${fieldId}-search-key`}>
                {labels.webSearchKey}
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
                    agent.webSearchApiKeyLoading ? labels.keyLoading : labels.webSearchKeyHint
                  }
                  onCommit={agent.setWebSearchApiKey}
                />
              </label>
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
                      setWebSearchError({ scope: searchTestScope, message: String(caught) });
                    } finally {
                      setTestingWebSearch(false);
                    }
                  }}
                >
                  {testingWebSearch ? labels.testingWebSearch : labels.testWebSearch}
                </button>
                <p className="text-xs text-muted">{labels.webSearchTestHint}</p>
                {webSearchTested === searchTestScope && (
                  <p role="status" className="text-xs text-success">
                    {labels.webSearchTestSuccess}
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
              <span>{labels.permissions}</span>
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
                <option value="restricted">{labels.permissionRestricted}</option>
                <option value="ask">{labels.permissionAsk}</option>
                <option value="auto">{labels.permissionAuto}</option>
              </select>
            </label>
            <label className={selectRowClass} htmlFor={`${fieldId}-answer-language`}>
              <span>{labels.answerLanguage}</span>
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
                <option value="zh">中文</option>
                <option value="en">English</option>
                <option value="ko">한국어</option>
              </select>
            </label>
            <div className="space-y-1">
              <label className="block text-xs" htmlFor={`${fieldId}-personal-prompt`}>
                {labels.personalPrompt}
              </label>
              <textarea
                id={`${fieldId}-personal-prompt`}
                className={`${inputClass} h-32 min-h-32 max-h-32 resize-none`}
                value={config.personalPrompt}
                maxLength={16_384}
                placeholder={labels.personalPromptPlaceholder}
                onChange={(event) => setConfig({ ...config, personalPrompt: event.target.value })}
              />
            </div>
          </>
        )}
      </fieldset>
      {session && dirty && <p className="text-xs text-warning">{labels.dirty}</p>}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
          {labels.error}: {error}
        </p>
      )}
    </section>
  );
}
