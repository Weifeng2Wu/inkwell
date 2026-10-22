"use client";

import { invoke } from "@tauri-apps/api/core";
import { useId } from "react";
import { useI18n } from "@/features/i18n";
import { DEFAULT_ACADEMIC_CONFIG } from "../lib/academic-config";
import type { ModelDiscoveryResult } from "../lib/academic-client";
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
  const { locale } = useI18n();
  const models = useAutomaticModels({
    enabled: true,
    directory: "settings",
    apiKey,
    apiKeyLoading: loading,
    working: false,
    config: { ...DEFAULT_ACADEMIC_CONFIG, baseUrl, customHeaders, model: value },
    errorLabel:
      locale === "zh"
        ? "获取模型列表失败，可手动填写模型名称。"
        : locale === "ko"
          ? "모델 목록을 가져오지 못했습니다. 모델 이름을 직접 입력하세요."
          : "Could not fetch models. Enter a model name manually.",
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
          {locale === "zh"
            ? "正在获取模型列表…"
            : locale === "ko"
              ? "모델 목록 로딩 중…"
              : "Loading models…"}
        </p>
      )}
      {models.models && (
        <p role="status" className="text-xs text-muted">
          {locale === "zh"
            ? `已获取 ${models.models.length} 个模型，可输入筛选或手动填写。`
            : locale === "ko"
              ? `모델 ${models.models.length}개를 가져왔습니다. 검색하거나 직접 입력하세요.`
              : `${models.models.length} models available. Type to filter or enter a name manually.`}
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
