"use client";

import { ArrowClockwiseIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useLatexInstaller } from "@/features/latex";

type QuickInstallStatus = "idle" | "checking" | "installing" | "success" | "error" | "no_texdist";

interface SynctexInstallDialogProps {
  open: boolean;
  onClose: () => void;
  onInstallComplete: () => void;
}

export function SynctexInstallDialog({
  open,
  onClose,
  onInstallComplete,
}: SynctexInstallDialogProps) {
  // Quick install state (tlmgr install synctex)
  const [quickStatus, setQuickStatus] = useState<QuickInstallStatus>("idle");
  const [quickError, setQuickError] = useState<string | null>(null);

  // Full distribution install (fallback)
  const {
    distributions,
    progress,
    result,
    fetchDistributions,
    install,
    openDownloadPage,
    reset: resetInstaller,
    isInstalling,
  } = useLatexInstaller();

  const showFullInstaller = quickStatus === "no_texdist";

  // Reset state when dialog opens
  useEffect(() => {
    if (!open) return;
    setQuickStatus("idle");
    setQuickError(null);
    resetInstaller();
  }, [open, resetInstaller]);

  // User-triggered quick install via tlmgr
  const handleQuickInstall = useCallback(async () => {
    setQuickStatus("checking");
    try {
      const hasTexDist = await invoke<boolean>("latex_install_synctex");
      if (hasTexDist) {
        setQuickStatus("success");
      } else {
        // No TeX distribution found, fall back to full installer
        setQuickStatus("no_texdist");
        fetchDistributions();
      }
    } catch (err) {
      setQuickError(String(err));
      setQuickStatus("error");
    }
  }, [fetchDistributions]);

  const handleRetryQuick = useCallback(() => {
    setQuickStatus("idle");
    setQuickError(null);
  }, []);

  const handleRetry = useCallback(() => {
    resetInstaller();
    onInstallComplete();
  }, [resetInstaller, onInstallComplete]);

  const handleClose = useCallback(() => {
    setQuickStatus("idle");
    setQuickError(null);
    resetInstaller();
    onClose();
  }, [resetInstaller, onClose]);

  const handleInstall = async (distributionId: string) => {
    await install(distributionId);
  };

  const handleOpenDownload = (url: string) => {
    openDownloadPage(url);
  };

  const isBusy = quickStatus === "checking" || quickStatus === "installing" || isInstalling;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/45 z-[9999]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] bg-background border border-border rounded-lg shadow-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
          onPointerDownOutside={(e) => {
            if (isBusy) e.preventDefault();
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <WarningIcon className="size-5 text-warning" />
              <Dialog.Title className="text-base font-bold tracking-tight">
                SyncTeX Not Available
              </Dialog.Title>
            </div>
            {!isBusy && (
              <Dialog.Close
                className="p-1.5 hover:bg-accent-hover transition-colors border border-transparent hover:border-border"
                aria-label="Close"
              >
                <XIcon className="size-4" />
              </Dialog.Close>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <p className="text-sm text-foreground-secondary leading-relaxed">
              SyncTeX is required for PDF-to-source navigation but was not found on your system.
            </p>

            <AnimatePresence mode="wait">
              {/* Idle: waiting for user confirmation */}
              {quickStatus === "idle" && (
                <motion.div
                  key="quick-idle"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4"
                >
                  <button
                    type="button"
                    onClick={handleQuickInstall}
                    className="btn btn-sm bg-success text-success-foreground border-success  transition-all"
                  >
                    Install SyncTeX
                  </button>
                  <p className="text-xs text-muted mt-2">
                    Will run{" "}
                    <code className="bg-accent-hover px-1 py-0.5">tlmgr install synctex</code> to
                    install the missing package.
                  </p>
                </motion.div>
              )}

              {/* Quick install: checking / installing */}
              {(quickStatus === "checking" || quickStatus === "installing") && (
                <motion.div
                  key="quick-progress"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-3 bg-surface-secondary border border-warning/40"
                >
                  <div className="flex items-center gap-2">
                    <Spinner className="size-4" />
                    <span className="text-sm font-medium">
                      {quickStatus === "checking"
                        ? "Installing SyncTeX via tlmgr..."
                        : "Installing..."}
                    </span>
                  </div>
                  <p className="text-sm text-muted mt-1">
                    Running{" "}
                    <code className="text-xs bg-accent-hover px-1 py-0.5">
                      tlmgr install synctex
                    </code>
                  </p>
                </motion.div>
              )}

              {/* Quick install: success */}
              {quickStatus === "success" && (
                <motion.div
                  key="quick-success"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-3 bg-success/10 border border-success/30"
                >
                  <p className="text-sm text-success">SyncTeX installed successfully.</p>
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="btn btn-sm bg-success text-success-foreground border-success hover:bg-success transition-colors"
                    >
                      Retry SyncTeX
                    </button>
                    <span className="text-xs text-success">Click to navigate to source</span>
                  </div>
                </motion.div>
              )}

              {/* Quick install: error (tlmgr failed) */}
              {quickStatus === "error" && (
                <motion.div
                  key="quick-error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-4 p-3 bg-background border border-warning/40"
                >
                  <p className="text-sm text-foreground-secondary whitespace-pre-wrap">
                    {quickError}
                  </p>
                  <button
                    type="button"
                    onClick={handleRetryQuick}
                    className="mt-2 text-sm text-warning hover:text-warning underline flex items-center gap-1"
                  >
                    <ArrowClockwiseIcon className="size-3.5" />
                    Try again
                  </button>
                </motion.div>
              )}

              {/* Full installer: no TeX distribution found */}
              {showFullInstaller && (
                <motion.div
                  key="full-installer"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <p className="mt-3 text-sm text-warning">
                    No TeX distribution was found. Install one below to get SyncTeX and LaTeX
                    compilation support.
                  </p>

                  {/* Installation Progress (full distro) */}
                  {isInstalling && progress && (
                    <div className="mt-4 p-3 bg-surface-secondary border border-warning/40">
                      <div className="flex items-center gap-2">
                        <Spinner className="size-4" />
                        <span className="text-sm font-medium">{progress.stage}</span>
                      </div>
                      <p className="text-sm text-muted mt-1 break-words">{progress.message}</p>
                      {progress.progress !== null && (
                        <div className="mt-2 h-1.5 bg-warning/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-warning transition-all duration-300"
                            style={{ width: `${progress.progress * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {result && (
                    <div
                      className={`mt-4 p-3 border ${
                        result.success
                          ? "bg-success/10 border-success/30"
                          : "bg-background border-warning/40"
                      }`}
                    >
                      <p
                        className={`text-sm whitespace-pre-wrap ${
                          result.success ? "text-success" : "text-foreground-secondary"
                        }`}
                      >
                        {result.message}
                      </p>
                      {result.success && (
                        <div className="mt-3 flex items-center gap-3">
                          <button
                            type="button"
                            onClick={handleRetry}
                            className="btn btn-sm bg-success text-success-foreground border-success hover:bg-success transition-colors"
                          >
                            Retry SyncTeX
                          </button>
                          <span className="text-xs text-success">Click to navigate to source</span>
                        </div>
                      )}
                      {!result.success && (
                        <button
                          type="button"
                          onClick={resetInstaller}
                          className="mt-2 text-sm text-warning hover:text-warning underline flex items-center gap-1"
                        >
                          <ArrowClockwiseIcon className="size-3.5" />
                          Try again
                        </button>
                      )}
                    </div>
                  )}

                  {/* Distribution Options */}
                  {!isInstalling && !result && distributions.length > 0 && (
                    <div className="mt-4 space-y-2">
                      {distributions.map((dist, index) => {
                        const downloadUrl = dist.download_url;

                        return (
                          <div
                            key={dist.id}
                            className={`flex items-center justify-between gap-3 p-3 bg-background border transition-colors ${
                              index === 0
                                ? "border-success/50 hover:border-success"
                                : "border-border hover:border-accent/30"
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-sm flex items-center gap-2">
                                {dist.name}
                                {index === 0 && (
                                  <span className="text-xs px-1.5 py-0.5 bg-success/15 text-success font-normal">
                                    Recommended
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted mt-0.5">{dist.description}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {dist.install_command && (
                                <button
                                  type="button"
                                  onClick={() => handleInstall(dist.id)}
                                  className={`btn btn-sm border-2 transition-all ${
                                    index === 0
                                      ? "bg-success text-success-foreground border-success "
                                      : "bg-accent text-accent-foreground border-accent rounded-md"
                                  }`}
                                >
                                  Install
                                </button>
                              )}
                              {downloadUrl && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenDownload(downloadUrl)}
                                  className={`btn btn-sm border-2 transition-colors ${
                                    index === 0 && !dist.install_command
                                      ? "bg-success text-success-foreground border-success hover:bg-success/90"
                                      : "border-border bg-background text-muted hover:bg-accent-hover"
                                  }`}
                                >
                                  Download
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Loading distributions */}
                  {!isInstalling && !result && distributions.length === 0 && (
                    <div className="mt-4 flex items-center gap-2 text-sm text-muted">
                      <Spinner className="size-4" />
                      Loading available distributions...
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-5 py-4 border-t border-border">
            {!isBusy && (
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-2 text-sm font-medium bg-background text-foreground border border-border rounded-md"
              >
                Dismiss
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
