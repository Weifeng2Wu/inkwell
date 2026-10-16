"use client";

import { WarningIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef } from "react";
import { useI18n } from "@/features/i18n";

type Props = {
  open: boolean;
  onClose: () => void;
  onRestart: () => void;
};

export function OpenCodeDisconnectedDialog({ open, onClose, onRestart }: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;

    const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    firstElement?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [open]);

  const handleRestart = useCallback(() => {
    onRestart();
    onClose();
  }, [onRestart, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        className="relative bg-background border border-border w-full max-w-sm mx-4 rounded-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="dialog-title" className="text-sm font-medium">
            {t("agent.disconnectedTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="toolbar-icon-button"
            aria-label={t("common.close")}
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <WarningIcon className="size-5 text-muted" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-foreground">{t("agent.disconnectedMessage")}</p>
              <p className="text-xs text-muted mt-2">{t("agent.disconnectedDesc")}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button type="button" onClick={onClose} className="btn btn-sm">
            {t("latex.dismiss")}
          </button>
          <button type="button" onClick={handleRestart} className="btn btn-primary btn-sm">
            {t("agent.restartOpencode")}
          </button>
        </div>
      </div>
    </div>
  );
}
