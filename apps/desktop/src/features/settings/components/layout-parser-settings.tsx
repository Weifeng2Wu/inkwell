"use client";

import { ArrowSquareOutIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useId, useRef, useState } from "react";
import { CustomHeadersInput } from "@/features/agent/components/custom-headers-input";
import { ServiceModelInput } from "@/features/agent/components/service-model-input";
import { SettingsDisclosure } from "@/components/ui/settings-disclosure";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/features/i18n";
import {
  DEFAULT_LAYOUT_CONFIG,
  type LayoutConfig,
  layoutKeyScope,
  layoutParserErrorKey,
  normalizeLayoutKey,
  readLayoutConfig,
  saveLayoutConfig,
  saveLayoutKey,
} from "../lib/layout-parser";

export function LayoutParserSettings() {
  const { t } = useI18n();
  const id = useId();
  const [config, setConfig] = useState<LayoutConfig>(DEFAULT_LAYOUT_CONFIG);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const revision = useRef(0);
  const credentialScope = layoutKeyScope(config);
  useEffect(() => {
    setConfig(readLayoutConfig());
  }, []);
  useEffect(() => {
    const version = ++revision.current;
    setLoading(true);
    setKey("");
    void (
      isTauri()
        ? invoke<string | null>("agent_api_key_read", { scope: credentialScope })
        : Promise.resolve(null)
    )
      .then((value) => {
        if (revision.current === version) setKey(value ?? "");
      })
      .catch(() => {
        if (revision.current === version) setError(t("layoutParser.keyError"));
      })
      .finally(() => {
        if (revision.current === version) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [credentialScope, t]);
  function update(patch: Partial<LayoutConfig>) {
    const next = { ...config, ...patch };
    setConfig(next);
    setStatus("");
    setError("");
    try {
      saveLayoutConfig(next);
    } catch {
      setError(t("layoutParser.saveError"));
    }
  }
  async function save(test: boolean) {
    if (busy || loading) return;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const apiKey = normalizeLayoutKey(key);
      if (
        !apiKey ||
        (config.provider === "custom" &&
          (!config.baseUrl.trim() || !config.model.trim() || !config.prompt.trim()))
      )
        throw new Error(t("layoutParser.missing"));
      saveLayoutConfig(config);
      await saveLayoutKey(config, apiKey);
      setKey(apiKey);
      if (test) {
        await invoke("layout_parser_request", {
          request: { type: "test", config, apiKey },
        });
        setStatus(t("layoutParser.testOk"));
      } else setStatus(t("layoutParser.saved"));
    } catch (caught) {
      const message = String(caught);
      const errorKey = layoutParserErrorKey(message);
      setError(`${t("layoutParser.failed")} ${errorKey ? t(errorKey) : message}`);
    } finally {
      setBusy(false);
    }
  }
  const keyField = (
    <div className="space-y-2">
      <label className="text-xs font-medium" htmlFor={`${id}-key`}>
        API Key
      </label>
      <input
        id={`${id}-key`}
        className="settings-control w-full"
        type="password"
        autoComplete="off"
        value={key}
        disabled={busy || loading}
        onChange={(event) => {
          setKey(event.target.value);
          setStatus("");
          setError("");
        }}
      />
    </div>
  );
  return (
    <section
      aria-label={t("layoutParser.title")}
      className="mb-5 rounded-lg border border-border bg-background p-5 shadow-sm"
    >
      <h3 className="mb-4 text-sm font-semibold">{t("layoutParser.title")}</h3>
      <fieldset disabled={busy} className="space-y-4">
        <legend className="sr-only">{t("layoutParser.provider")}</legend>
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${id}-provider`}
                checked={config.provider === "mineru"}
                onChange={() => update({ provider: "mineru" })}
              />
              MinerU
            </label>
            <a
              href="https://mineru.net/apiManage/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent"
              title={t("layoutParser.getKey")}
            >
              {t("layoutParser.getKey")}
              <ArrowSquareOutIcon className="size-3.5" aria-hidden="true" />
            </a>
          </div>
          {config.provider === "mineru" && (
            <>
              <p className="text-xs text-muted">Base URL: https://mineru.net</p>
              {keyField}
              <SettingsDisclosure title={t("layoutParser.advanced")}>
                <label
                  className="flex items-center justify-between gap-3 text-xs"
                  htmlFor={`${id}-language`}
                >
                  {t("layoutParser.language")}
                  <select
                    id={`${id}-language`}
                    className="settings-control"
                    value={config.language}
                    onChange={(event) =>
                      update({ language: event.target.value === "en" ? "en" : "ch" })
                    }
                  >
                    <option value="ch">{t("layoutParser.chineseEnglish")}</option>
                    <option value="en">{t("layoutParser.english")}</option>
                  </select>
                </label>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <label htmlFor={`${id}-ocr`}>{t("layoutParser.ocr")}</label>
                  <Switch
                    id={`${id}-ocr`}
                    checked={config.forceOcr}
                    onCheckedChange={(forceOcr) => update({ forceOcr })}
                  />
                </div>
              </SettingsDisclosure>
            </>
          )}
        </div>
        <SettingsDisclosure
          title={t("layoutParser.custom")}
          open={config.provider === "custom" ? true : undefined}
        >
          <label className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name={`${id}-provider`}
              checked={config.provider === "custom"}
              onChange={() => update({ provider: "custom" })}
            />
            {t("layoutParser.useCustom")}
          </label>
          {config.provider === "custom" && (
            <>
              {(["baseUrl", "model", "prompt"] as const).map((field) => (
                <div key={field} className="space-y-2">
                  <label className="text-xs font-medium" htmlFor={`${id}-${field}`}>
                    {t(`layoutParser.${field}`)}
                  </label>
                  {field === "prompt" ? (
                    <textarea
                      id={`${id}-${field}`}
                      className="settings-control min-h-28 w-full resize-none"
                      value={config[field]}
                      onChange={(event) => update({ [field]: event.target.value })}
                      maxLength={16384}
                    />
                  ) : field === "model" ? (
                    <ServiceModelInput
                      id={`${id}-model`}
                      baseUrl={config.baseUrl}
                      customHeaders={config.customHeaders}
                      apiKey={normalizeLayoutKey(key)}
                      loading={loading}
                      value={config.model}
                      onChange={(model) => update({ model })}
                    />
                  ) : (
                    <input
                      id={`${id}-${field}`}
                      className="settings-control w-full"
                      value={config[field]}
                      onChange={(event) => update({ [field]: event.target.value })}
                      placeholder={field === "baseUrl" ? "https://api.example.com/v1" : ""}
                    />
                  )}
                </div>
              ))}
              {keyField}
              <CustomHeadersInput
                value={config.customHeaders}
                onChange={(customHeaders) => update({ customHeaders })}
              />
            </>
          )}
        </SettingsDisclosure>
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || loading}
          onClick={() => void save(false)}
        >
          {t("layoutParser.save")}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || loading || !key.trim()}
          onClick={() => void save(true)}
        >
          {busy && <CircleNotchIcon className="size-4 animate-spin" aria-hidden="true" />}
          {t("layoutParser.test")}
        </button>
      </div>
      {status && (
        <p role="status" className="mt-3 text-xs text-success">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 break-words text-xs text-error">
          {error}
        </p>
      )}
    </section>
  );
}
