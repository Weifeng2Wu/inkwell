"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { SettingsDisclosure } from "@/components/ui/settings-disclosure";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/features/i18n";
import {
  checkForUpdates,
  getServerUpdateState,
  getUpdateState,
  initializeUpdates,
  installUpdate,
  restartAfterUpdate,
  setAutomaticUpdates,
  subscribeUpdates,
} from "../lib/app-updater";
import { updateStatusText } from "../lib/update-status";

export function AppUpdateSettings() {
  const { t } = useI18n();
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState, getServerUpdateState);
  const { version, enabled, ready, phase, release, progress, error, automatic } = state;
  useEffect(() => {
    void initializeUpdates();
  }, []);
  const working = phase === "checking" || phase === "downloading" || phase === "installing";
  const unavailableReason = !ready
    ? t("settings.updates.loading")
    : !enabled
      ? t(isTauri() ? "settings.updates.unavailable" : "settings.updates.desktopOnly")
      : undefined;
  const status = updateStatusText(phase, release?.version, t);
  const action =
    phase === "installed" ? (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => void restartAfterUpdate()}
      >
        {t("settings.updates.restart")}
      </button>
    ) : phase === "available" || phase === "downloaded" ? (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void installUpdate()}>
        {t(phase === "downloaded" ? "settings.updates.installNow" : "settings.updates.install")}
      </button>
    ) : (
      <button
        type="button"
        className="btn btn-sm"
        disabled={!enabled || working}
        aria-describedby={unavailableReason ? "app-updates-unavailable" : undefined}
        onClick={() => void checkForUpdates()}
      >
        {working ? status : t(error ? "common.retry" : "settings.updates.check")}
      </button>
    );
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-background p-5 shadow-sm"
      aria-labelledby="app-updates-title"
    >
      <div className="mb-4 border-b border-border pb-3">
        <h3 id="app-updates-title" className="text-sm font-semibold">
          {t("settings.updates.title")}
        </h3>
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground-secondary">Inkwell</p>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.current")}{" "}
              <span className="font-mono tabular-nums">{version || "—"}</span>
            </p>
          </div>
          {action}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 pr-4">
            <label
              htmlFor="automatic-updates"
              className="block text-sm font-medium text-foreground-secondary"
            >
              {t("settings.updates.automatic")}
            </label>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {t("settings.updates.automaticDesc")}
            </p>
          </div>
          <Switch
            id="automatic-updates"
            checked={automatic}
            disabled={!enabled || !ready}
            aria-describedby={unavailableReason ? "app-updates-unavailable" : undefined}
            onCheckedChange={(value) => void setAutomaticUpdates(value)}
          />
        </div>
        {(unavailableReason || status) && (
          <div role="status" aria-live="polite" className="space-y-2 text-xs text-muted-foreground">
            {unavailableReason ? (
              <p id="app-updates-unavailable">{unavailableReason}</p>
            ) : (
              <p
                className={phase === "latest" || phase === "installed" ? "text-success" : undefined}
              >
                {status}
              </p>
            )}
            {phase === "downloading" && (
              <progress
                className="h-1.5 w-full accent-accent"
                max={100}
                value={progress}
                aria-label={t("settings.updates.downloading")}
              />
            )}
          </div>
        )}
        {release?.body && (
          <SettingsDisclosure title={t("settings.updates.notes")}>
            <p className="max-h-48 select-text overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {release.body}
            </p>
          </SettingsDisclosure>
        )}
        {(phase === "available" || phase === "downloaded") && (
          <p className="text-xs text-muted-foreground">{t("settings.updates.saveFirst")}</p>
        )}
        {error && (
          <p role="alert" className="select-text break-words text-xs text-error">
            {t("settings.updates.failed", { error })}
          </p>
        )}
      </div>
    </section>
  );
}
