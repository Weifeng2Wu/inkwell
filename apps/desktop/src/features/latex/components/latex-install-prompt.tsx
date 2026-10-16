"use client";

import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/features/i18n";
import { useLatexInstaller } from "@/features/latex";

interface LaTeXInstallPromptProps {
  onRefreshCompilers?: () => void;
}

export function LaTeXInstallPrompt({ onRefreshCompilers }: LaTeXInstallPromptProps) {
  const { t } = useI18n();
  const {
    distributions,
    progress,
    result,
    fetchDistributions,
    install,
    openDownloadPage,
    reset,
    isInstalling,
  } = useLatexInstaller();

  useEffect(() => {
    fetchDistributions();
  }, [fetchDistributions]);

  const handleInstall = async (distributionId: string) => {
    await install(distributionId);
  };

  const handleOpenDownload = (url: string) => {
    openDownloadPage(url);
  };

  const handleRefresh = useCallback(() => {
    onRefreshCompilers?.();
    reset();
  }, [onRefreshCompilers, reset]);

  return (
    <div className="bg-warning/10 border border-warning/40 p-4">
      <div className="flex items-start gap-3">
        {/* Warning Icon */}
        <WarningIcon className="size-6 text-warning flex-shrink-0 mt-0.5" />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-warning">{t("latex.notDetectedTitle")}</h3>
              <p className="text-sm text-warning mt-1">
                {t("latex.notDetectedDesc")}
              </p>
            </div>
            {!isInstalling && !result && (
              <button
                type="button"
                onClick={handleRefresh}
                className="flex-shrink-0 p-1.5 text-warning hover:bg-warning/15 transition-colors"
                title={t("latex.compilerDetectionRefresh")}
              >
                <ArrowClockwiseIcon className="size-4" />
              </button>
            )}
          </div>

          {/* Installation Progress */}
          <AnimatePresence mode="wait">
            {isInstalling && progress && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 p-3 bg-background border border-warning/40"
              >
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
              </motion.div>
            )}

            {result && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={`mt-3 p-3 border ${
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
                      onClick={handleRefresh}
                      className="btn btn-sm bg-success text-success-foreground border-success hover:bg-success transition-colors"
                    >
                      {t("latex.refreshCompilers")}
                    </button>
                    <span className="text-xs text-success">
                      {t("latex.clickToDetect")}
                    </span>
                  </div>
                )}
                {!result.success && (
                  <button
                    type="button"
                    onClick={reset}
                    className="mt-2 text-sm text-warning hover:text-warning underline"
                  >
                    {t("latex.tryAgain")}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

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
                        : "border-warning/30 hover:border-warning/60"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2">
                        {dist.name}
                        {index === 0 && (
                          <span className="text-xs px-1.5 py-0.5 bg-success/15 text-success font-normal">
                            {t("latex.recommended")}
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
                              : "bg-accent text-accent-foreground border-accent "
                          }`}
                        >
                          {t("latex.install")}
                        </button>
                      )}
                      {downloadUrl && (
                        <button
                          type="button"
                          onClick={() => handleOpenDownload(downloadUrl)}
                          className={`btn btn-sm border-2 transition-colors ${
                            index === 0 && !dist.install_command
                              ? "bg-success text-success-foreground border-success hover:bg-success/90"
                              : "border-warning text-warning hover:bg-warning/10"
                          }`}
                        >
                          {t("latex.download")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Loading state */}
          {!isInstalling && !result && distributions.length === 0 && (
            <div className="mt-4 flex items-center gap-2 text-sm text-warning">
              <Spinner className="size-4" />
              {t("latex.loadingDistributions")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
