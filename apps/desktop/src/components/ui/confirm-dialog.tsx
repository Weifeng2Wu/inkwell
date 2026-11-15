"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/features/i18n";
import { useModalDialog } from "./use-modal-dialog";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** The action cannot be undone: focus starts on Cancel and the confirm button warns. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");
  const titleId = useId();
  const messageId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useModalDialog<HTMLDivElement>({
    onCancel,
    onConfirm,
    initialFocus: danger ? cancelRef : confirmRef,
  });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
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

        <div className="px-5 pt-2 pb-4">
          <p id={messageId} className="whitespace-pre-line break-words text-[13px] text-muted">
            {message}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-border border-t px-5 py-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="btn btn-sm btn-secondary"
          >
            {resolvedCancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`btn btn-sm ${danger ? "btn-danger" : "btn-primary"}`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
