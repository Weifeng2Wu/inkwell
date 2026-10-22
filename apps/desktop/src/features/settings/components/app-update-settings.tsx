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
import { updateLabels } from "../lib/update-labels";

export function AppUpdateSettings() {
  const { locale } = useI18n();
  const labels = updateLabels[locale];
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState, getServerUpdateState);
  const { version, enabled, ready, phase, release, progress, error, automatic } = state;
  useEffect(() => {
    void initializeUpdates();
  }, []);
  const working = ["checking", "downloading", "installing"].includes(phase);
  const unavailableReason = !ready
    ? labels.loading
    : !enabled
      ? isTauri()
        ? labels.unavailable
        : labels.desktop
      : undefined;
  const action =
    phase === "installed" ? (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => void restartAfterUpdate()}
      >
        {labels.restart}
      </button>
    ) : phase === "available" || phase === "downloaded" ? (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => void installUpdate()}>
        {phase === "downloaded" ? labels.installNow : labels.install}
      </button>
    ) : (
      <button
        type="button"
        className="btn btn-sm"
        disabled={!enabled || working}
        aria-describedby={unavailableReason ? "app-updates-unavailable" : undefined}
        title={unavailableReason}
        onClick={() => void checkForUpdates()}
      >
        {working
          ? labels[phase as "checking" | "downloading" | "installing"]
          : error
            ? labels.retry
            : labels.check}
      </button>
    );
  return (
    <section
      className="mb-5 rounded-lg border border-border bg-background p-5 shadow-sm"
      aria-labelledby="app-updates-title"
    >
      <div className="mb-4 border-b border-border pb-3">
        <h3 id="app-updates-title" className="text-sm font-semibold">
          {labels.title}
        </h3>
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground-secondary">Inkwell</p>
            <p className="text-xs text-muted-foreground">
              {labels.current} <span className="font-mono tabular-nums">{version || "—"}</span>
            </p>
          </div>
          {action}
        </div>
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="automatic-updates"
            className="text-sm font-medium text-foreground-secondary"
          >
            {labels.automatic}
          </label>
          <Switch
            id="automatic-updates"
            checked={automatic}
            disabled={!enabled || !ready}
            aria-describedby={unavailableReason ? "app-updates-unavailable" : undefined}
            title={unavailableReason}
            onCheckedChange={(value) => void setAutomaticUpdates(value)}
          />
        </div>
        {(unavailableReason || phase !== "idle") && (
          <div role="status" aria-live="polite" className="space-y-2 text-xs text-muted-foreground">
            {unavailableReason ? (
              <p id="app-updates-unavailable">{unavailableReason}</p>
            ) : (
              phase !== "idle" && (
                <p
                  className={
                    phase === "latest" || phase === "installed" ? "text-success" : undefined
                  }
                >
                  {labels[phase]}
                  {phase === "available" && release ? ` · ${release.version}` : ""}
                </p>
              )
            )}
            {phase === "downloading" && (
              <progress
                className="h-1.5 w-full accent-accent"
                max={100}
                value={progress}
                aria-label={labels.downloading}
              />
            )}
          </div>
        )}
        {release?.body && (
          <SettingsDisclosure title={labels.notes}>
            <p className="max-h-48 select-text overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {release.body}
            </p>
          </SettingsDisclosure>
        )}
        {["available", "downloaded"].includes(phase) && (
          <p className="text-xs text-muted-foreground">{labels.save}</p>
        )}
        {error && (
          <p role="alert" className="select-text break-words text-xs text-error">
            {labels.failed} {error}
          </p>
        )}
      </div>
    </section>
  );
}
