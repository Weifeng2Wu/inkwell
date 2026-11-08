"use client";

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import { type TranslationConfig, translateText, translationErrorKey } from "@/features/translation";

export function PdfTranslationPanel({
  text,
  config,
  onSave,
  onClose,
  writable,
  top = 56,
}: {
  text: string;
  config: TranslationConfig;
  onSave: (translation: string) => Promise<void>;
  onClose: () => void;
  writable: boolean;
  top?: number;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt is an explicit user retry of the same excerpt
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    setResult("");
    setSaved(false);
    void translateText(text, config, current.signal)
      .then((value) => {
        if (!current.signal.aborted) setResult(value);
      })
      .catch((caught) => {
        if (!current.signal.aborted) setError(translationErrorKey(caught, config.provider));
      })
      .finally(() => {
        if (!current.signal.aborted) setBusy(false);
      });
    return () => {
      current.abort();
    };
  }, [text, config, attempt]);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(result);
      if (mounted.current) setSaved(true);
    } catch {
      if (mounted.current) setError("pdfReading.saveFailed");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <section
      role="dialog"
      aria-label={t("translation.result")}
      className="absolute bottom-3 right-3 z-30 flex w-[26rem] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-lg"
      style={{ top }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div>
          <h3 className="text-sm font-medium">{t("translation.result")}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {t(`translation.providers.${config.provider}`)} · {config.source} → {config.target}
          </p>
        </div>
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={t("common.close")}
          disabled={saving}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <details className="rounded-md bg-surface-secondary p-3" open>
          <summary className="cursor-pointer text-xs font-medium text-muted">
            {t("translation.original")}
          </summary>
          <p className="mt-2 select-text whitespace-pre-wrap text-xs leading-relaxed text-foreground-secondary">
            {text}
          </p>
        </details>
        <div className="text-sm leading-relaxed" aria-live="polite">
          {busy ? (
            <p className="text-muted">{t("translation.translating")}</p>
          ) : (
            <p className="select-text whitespace-pre-wrap">{result}</p>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-error">
            {t(error)}
          </p>
        )}
        {saved && (
          <p role="status" className="text-xs text-success">
            {t("translation.savedNote")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-t border-border p-3">
        {busy ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              controller.current?.abort();
              setBusy(false);
              setError("translation.cancelled");
            }}
          >
            {t("translation.stop")}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!result || !writable || saving || saved}
              onClick={() => void save()}
            >
              {t("translation.saveNote")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!result}
              onClick={() => {
                void navigator.clipboard
                  .writeText(result)
                  .catch(() => setError("translation.failed"));
              }}
            >
              {t("translation.copy")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={saving}
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("translation.retry")}
            </button>
          </>
        )}
        <button
          type="button"
          className="text-xs text-muted hover:text-accent"
          disabled={saving}
          onClick={() => {
            onClose();
            window.dispatchEvent(new Event("inkwell-open-translation-settings"));
          }}
        >
          {t("translation.settings")}
        </button>
      </div>
    </section>
  );
}
