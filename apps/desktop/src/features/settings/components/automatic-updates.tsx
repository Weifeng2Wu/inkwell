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
import { updateStatusText } from "../lib/update-status";

export function AutomaticUpdates() {
  const { t } = useI18n();
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
      aria-label={t("settings.updates.title")}
      className="motion-rise fixed bottom-5 right-5 z-[60] max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
    >
      <p className="text-sm font-medium">
        {updateStatusText(state.phase, state.release?.version, t)}
      </p>
      {state.phase === "downloaded" && (
        <p className="mt-2 text-xs text-muted">{t("settings.updates.saveFirst")}</p>
      )}
      {state.error && (
        <p role="alert" className="mt-2 text-xs text-error">
          {t("settings.updates.failed", { error: state.error })}
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm mt-3"
        onClick={() => void (state.phase === "installed" ? restartAfterUpdate() : installUpdate())}
      >
        {t(
          state.phase === "installed" ? "settings.updates.restart" : "settings.updates.installNow",
        )}
      </button>
    </aside>
  );
}
