"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useI18n } from "@/features/i18n";
import {
  checkForUpdates,
  getServerUpdateState,
  getUpdateState,
  initializeUpdates,
  installUpdate,
  restartAfterUpdate,
  subscribeUpdates,
} from "../lib/app-updater";
import { updateLabels } from "../lib/update-labels";

export function AutomaticUpdates() {
  const { locale } = useI18n();
  const labels = updateLabels[locale];
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState, getServerUpdateState);
  useEffect(() => {
    let active = true;
    const check = () => {
      if (active && getUpdateState().automatic) void checkForUpdates(true);
    };
    void initializeUpdates().then(check);
    const interval = setInterval(check, 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);
  if (state.phase !== "downloaded" && state.phase !== "installed") return null;
  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={labels.title}
      className="fixed bottom-5 right-5 z-[60] max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
    >
      <p className="text-sm font-medium">
        {state.phase === "downloaded" ? labels.downloaded : labels.installed}{" "}
        {state.release?.version}
      </p>
      <p className="text-xs text-muted mt-2">{labels.save}</p>
      {state.error && (
        <p role="alert" className="text-xs text-error mt-2">
          {labels.failed} {state.error}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary mt-3"
        onClick={() => void (state.phase === "installed" ? restartAfterUpdate() : installUpdate())}
      >
        {state.phase === "installed" ? labels.restart : labels.installNow}
      </button>
    </aside>
  );
}
