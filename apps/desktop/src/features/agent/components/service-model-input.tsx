"use client";

import { invoke } from "@tauri-apps/api/core";
import { useId } from "react";
import { useI18n } from "@/features/i18n";
import type { ModelDiscoveryResult } from "../lib/academic-client";
import { DEFAULT_ACADEMIC_CONFIG } from "../lib/academic-config";
import { useAutomaticModels } from "../lib/use-automatic-models";

export function ServiceModelInput({
  id,
  baseUrl,
  customHeaders,
  apiKey,
  loading,
  value,
  onChange,
}: {
  id: string;
  baseUrl: string;
  customHeaders?: string;
  apiKey: string;
  loading: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const { t } = useI18n();
  const models = useAutomaticModels({
    enabled: true,
    directory: "settings",
    apiKey,
    apiKeyLoading: loading,
    working: false,
    config: { ...DEFAULT_ACADEMIC_CONFIG, baseUrl, customHeaders, model: value },
    errorLabel: t("agent.settings.serviceModelsFailed"),
    fetchModels: (config, key) =>
      invoke<ModelDiscoveryResult>("academic_api_request", {
        request: { ...config, apiKey: key, type: "list_models" },
      }),
    onDiscovered: () => {},
  });
  return (
    <>
      <input
        id={id}
        className="settings-control mt-1 w-full"
        list={listId}
        value={value}
        maxLength={200}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {models.models?.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      {models.loading && (
        <p role="status" className="text-xs text-muted">
          {t("agent.settings.modelsLoading")}
        </p>
      )}
      {models.models && (
        <p role="status" className="text-xs text-muted">
          {t("agent.settings.modelsAvailable", { count: models.models.length })}
        </p>
      )}
      {models.error && (
        <p role="status" className="break-words text-xs text-muted">
          {models.error}
        </p>
      )}
    </>
  );
}
