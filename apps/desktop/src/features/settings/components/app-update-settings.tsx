"use client";

import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
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
      ? isTauri() ? labels.unavailable : labels.desktop
      : undefined;
  return (
    <section
      className="border border-border rounded-lg bg-background p-5 mb-5 shadow-sm"
      aria-labelledby="app-updates-title"
    >
      <h3 id="app-updates-title" className="text-sm font-semibold">
        {labels.title}
      </h3>
      <p className="text-xs text-muted mt-1">{labels.description}</p>
      <p className="text-xs mt-4">
        {version ? `${labels.current}: ${version}` : ready ? labels.desktop : labels.loading}
      </p>
      {unavailableReason && (
        <p id="app-updates-unavailable" role="status" className="text-xs text-muted mt-2">
          {unavailableReason}
        </p>
      )}
      <div className="flex items-center justify-between gap-4 mt-4">
        <div>
          <label htmlFor="automatic-updates" className="text-sm">
            {labels.automatic}
          </label>
          <p id="automatic-updates-description" className="text-xs text-muted mt-1">
            {labels.automaticDescription}
          </p>
        </div>
        <Switch
          id="automatic-updates"
          aria-describedby={`automatic-updates-description${unavailableReason ? " app-updates-unavailable" : ""}`}
          title={unavailableReason}
          checked={automatic}
          disabled={!enabled}
          onCheckedChange={(value) => void setAutomaticUpdates(value)}
        />
      </div>
      <div role="status" aria-live="polite" className="text-xs mt-3 space-y-2">
        {phase !== "idle" && (
          <p>
            {labels[phase]}
            {phase === "available" && release ? `: ${release.version}` : ""}
          </p>
        )}
        {phase === "downloading" && (
          <progress className="w-full" max={100} value={progress} aria-label={labels.downloading} />
        )}
      </div>
      {release?.body && (
        <p className="whitespace-pre-wrap text-xs text-muted mt-3 max-h-48 overflow-auto select-text">
          {release.body}
        </p>
      )}
      {["available", "downloaded"].includes(phase) && (
        <p className="text-xs text-muted mt-3">{labels.save}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-error mt-3 select-text">
          {labels.failed} {error}
        </p>
      )}
      <div className="mt-4">
        {phase === "installed" ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void restartAfterUpdate()}
          >
            {labels.restart}
          </button>
        ) : phase === "available" || phase === "downloaded" ? (
          <button type="button" className="btn btn-primary" onClick={() => void installUpdate()}>
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
        )}
      </div>
    </section>
  );
}
