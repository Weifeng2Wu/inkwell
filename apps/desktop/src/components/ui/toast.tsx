"use client";

import { CheckIcon, InfoIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/features/i18n";

type ToastType = "success" | "error" | "info";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  /** One follow-up such as Undo or View. Running it dismisses the toast. */
  action?: ToastAction;
  /** Milliseconds before the toast leaves. Defaults to 3s, or 6s with an action. */
  duration?: number;
};

type Toast = {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  duration: number;
};

type ToastContextType = {
  toast: (message: string, type?: ToastType, options?: ToastOptions) => void;
  dismiss: (id: string) => void;
};

export const TOAST_DURATION = 3000;
export const TOAST_ACTION_DURATION = 6000;

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info", options?: ToastOptions) => {
    const id = Math.random().toString(36).substring(2, 9);
    const action = options?.action;
    const duration = options?.duration ?? (action ? TOAST_ACTION_DURATION : TOAST_DURATION);
    setToasts((prev) => [...prev, { id, message, type, action, duration }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);

  // The countdown stops while the pointer or keyboard focus is on the toast.
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - started));
    };
  }, [paused, onDismiss, toast.id]);

  const pause = () => setPaused(true);
  const resume = () => setPaused(false);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the countdown
    <div
      role={toast.type === "error" ? "alert" : "status"}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      className="motion-rise pointer-events-auto flex max-w-[360px] items-start gap-2.5 rounded-lg border border-border bg-background p-3 shadow-lg"
    >
      <div className="mt-0.5 shrink-0">{getIcon(toast.type)}</div>
      <p className="min-w-0 flex-1 break-words text-[13px] text-foreground leading-snug">
        {toast.message}
      </p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          className="shrink-0 rounded px-1.5 font-medium text-[13px] text-accent leading-snug transition-colors hover:bg-accent/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="mt-0.5 shrink-0 text-muted transition-colors hover:text-foreground"
        aria-label={t("common.dismiss")}
      >
        <XIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function getIcon(type: ToastType) {
  switch (type) {
    case "success":
      return <CheckIcon size={16} className="text-success" aria-hidden />;
    case "error":
      return <WarningCircleIcon size={16} className="text-error" aria-hidden />;
    case "info":
      return <InfoIcon size={16} className="text-muted" aria-hidden />;
  }
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
