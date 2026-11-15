"use client";

import { useCallback, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/features/i18n";
import { useModalDialog } from "./use-modal-dialog";

interface InputDialogProps {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  validator?: (value: string) => string | null; // Returns error message or null
}

export function InputDialog({
  title,
  placeholder = "",
  defaultValue = "",
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  validator,
}: InputDialogProps) {
  const { t } = useI18n();
  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const errorId = useId();

  const handleConfirm = useCallback(() => {
    const errorMsg = validator?.(value);
    if (errorMsg) {
      setError(errorMsg);
      inputRef.current?.focus();
      return;
    }
    onConfirm(value);
  }, [value, validator, onConfirm]);

  const panelRef = useModalDialog<HTMLDivElement>({
    onCancel,
    onConfirm: handleConfirm,
    initialFocus: inputRef,
  });

  // Select the suggested value so typing replaces it. A file name keeps its extension.
  const selectOnFocus = useRef(true);
  const handleFocus = useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    if (!selectOnFocus.current) return;
    selectOnFocus.current = false;
    const input = event.currentTarget;
    const isFileName = /^[^\s,/\\]+\.[A-Za-z0-9]{1,8}$/.test(input.value);
    const compound = /\.(?:mindmap\.md|poster\.json)$/i.exec(input.value);
    input.setSelectionRange(
      0,
      compound?.index ?? (isFileName ? input.value.lastIndexOf(".") : input.value.length),
    );
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="motion-fade absolute inset-0 bg-black/45" onClick={onCancel} aria-hidden />

      <div
        ref={panelRef}
        className="motion-pop relative z-10 w-full max-w-sm rounded-lg border border-border bg-background text-foreground shadow-2xl"
      >
        <div className="px-5 pt-4">
          <h3 id={titleId} className="font-medium text-sm">
            {title}
          </h3>
        </div>

        <div className="px-5 pt-3 pb-4">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            onFocus={handleFocus}
            placeholder={placeholder}
            aria-labelledby={titleId}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoComplete="off"
            spellCheck={false}
            className={`w-full rounded-md border bg-background px-3 py-2 text-[13px] outline-none transition-colors ${
              error ? "border-error focus:border-error" : "border-border focus:border-accent"
            }`}
          />
          {error && (
            <p id={errorId} role="alert" className="motion-fade mt-2 text-[12px] text-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-border border-t px-5 py-3">
          <button type="button" onClick={onCancel} className="btn btn-sm btn-secondary">
            {resolvedCancelLabel}
          </button>
          <button type="button" onClick={handleConfirm} className="btn btn-sm btn-primary">
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
