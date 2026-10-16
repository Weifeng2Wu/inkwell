"use client";

import { WarningIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/features/i18n";

type ErrorType = "port_in_use" | "not_installed" | "generic";

type Props = {
  open: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
  onKillPort?: (port: number) => Promise<void>;
};

function parseErrorType(error: string): { type: ErrorType; port?: number } {
  const portMatch = error.match(/Port (\d+) is already in use/);
  if (portMatch?.[1]) {
    return { type: "port_in_use", port: parseInt(portMatch[1], 10) };
  }
  if (error.includes("not installed") || error.includes("not found")) {
    return { type: "not_installed" };
  }
  return { type: "generic" };
}

export function OpenCodeErrorDialog({ open, error, onClose, onRetry, onKillPort }: Props) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [killing, setKilling] = useState(false);

  const { type: errorType, port } = parseErrorType(error);

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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Silently ignore clipboard errors
    }
  }, [error]);

  const handleKillPort = useCallback(async () => {
    if (!port || !onKillPort) return;
    setKilling(true);
    try {
      await onKillPort(port);
      onRetry();
    } catch {
      setKilling(false);
    }
  }, [port, onKillPort, onRetry]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-dialog-title"
    >
      <div className="absolute inset-0 bg-black/45" onClick={onClose} aria-hidden="true" />

      <div
        ref={dialogRef}
        className="relative bg-background border border-border w-full max-w-md mx-4 rounded-lg shadow-2xl"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 id="error-dialog-title" className="text-sm font-medium">
            {t("agent.errorTitle")}
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
              <WarningIcon className="size-5 text-error" />
            </div>
            <div className="flex-1 min-w-0">
              {errorType === "port_in_use" && (
                <p className="text-sm text-foreground mb-2">
                  {t("agent.portInUse", { port: port ?? "" })}
                </p>
              )}
              {errorType === "not_installed" && (
                <p className="text-sm text-foreground mb-2">
                  {t("agent.opencodeNotInstalledPrompt")}
                </p>
              )}
              {errorType === "generic" && (
                <p className="text-sm text-foreground mb-2">{t("agent.failedToStartOpenCode")}</p>
              )}
            </div>
          </div>

          <div className="mt-3 relative">
            <div className="bg-surface-secondary border border-border rounded-md p-3 text-xs font-mono break-all max-h-32 overflow-y-auto">
              {error}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="btn btn-sm absolute top-2 right-2 bg-background"
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>

          {errorType === "port_in_use" && onKillPort && (
            <div className="mt-4 p-3 rounded-lg border border-border bg-surface-secondary">
              <p className="text-xs text-muted mb-2">
                {t("agent.askKillPortPrompt", { port: port ?? "" })}
              </p>
              <button
                type="button"
                onClick={handleKillPort}
                disabled={killing}
                className="btn btn-primary btn-sm w-full"
              >
                {killing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner className="size-3" />
                    {t("agent.killingProcess")}
                  </span>
                ) : (
                  t("agent.killPortAndRestart", { port: port ?? "" })
                )}
              </button>
            </div>
          )}

          {errorType === "not_installed" && (
            <div className="mt-4 p-3 rounded-lg border border-border bg-surface-secondary">
              <p className="text-xs text-muted mb-2">{t("agent.chooseInstallMethod")}</p>
              <div className="space-y-2">
                <code className="block text-xs font-mono bg-background p-2 border border-border rounded-md">
                  npm i -g opencode-ai@latest
                </code>
                <code className="block text-xs font-mono bg-background p-2 border border-border rounded-md">
                  brew install sst/tap/opencode
                </code>
              </div>
            </div>
          )}

          <p className="mt-4 text-xs text-muted">{t("agent.copyErrorHelpText")}</p>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button type="button" onClick={onClose} className="btn btn-sm">
            {t("latex.dismiss")}
          </button>
          {errorType !== "port_in_use" && (
            <button type="button" onClick={onRetry} className="btn btn-primary btn-sm">
              {t("common.retry")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
