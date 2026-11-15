"use client";

import { useEffect, useId, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/features/i18n";
import { CLOUD_INTERVALS, type CloudConfig, DEFAULT_CLOUD_CONFIG } from "../lib/cloud-backup";
import type { CloudBackupController } from "../lib/use-cloud-backup";

export function CloudBackupSettings({ controller }: { controller: CloudBackupController }) {
  const { t, locale } = useI18n();
  const id = useId();
  const saved = controller.status?.config;
  const [config, setConfig] = useState(saved ?? DEFAULT_CLOUD_CONFIG);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const serialized = JSON.stringify(saved);
  useEffect(() => {
    if (serialized) setConfig(JSON.parse(serialized) as CloudConfig);
  }, [serialized]);
  const changedKeys = Boolean(accessKeyId || secretAccessKey || sessionToken);
  const dirty = JSON.stringify(config) !== serialized || changedKeys;
  const ready = controller.status?.hasCredentials && !dirty && !controller.running;
  const update = (value: Partial<CloudConfig>) =>
    setConfig((previous) => ({ ...previous, ...value }));
  const date = (value: string) => new Date(value).toLocaleString(locale);
  if (!controller.available)
    return <p className="text-sm text-muted">{t("cloudBackup.desktopOnly")}</p>;
  return (
    <div className="space-y-5">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await controller.save(
            config,
            changedKeys ? { accessKeyId, secretAccessKey, sessionToken } : undefined,
          );
          if (result) {
            setConfig(result.config);
            setAccessKeyId("");
            setSecretAccessKey("");
            setSessionToken("");
          }
        }}
      >
        <fieldset disabled={controller.running} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-xs" htmlFor={`${id}-provider`}>
            {t("cloudBackup.provider")}
            <select
              id={`${id}-provider`}
              className="settings-control w-full"
              value={config.provider}
              onChange={(event) =>
                update({
                  provider: event.target.value === "r2" ? "r2" : "s3",
                  region: event.target.value === "r2" ? "auto" : "us-east-1",
                })
              }
            >
              <option value="r2">{t("cloudBackup.r2")}</option>
              <option value="s3">{t("cloudBackup.s3")}</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-xs" htmlFor={`${id}-region`}>
            {t("cloudBackup.region")}
            <input
              id={`${id}-region`}
              className="settings-control w-full"
              value={config.region}
              disabled={config.provider === "r2"}
              required
              onChange={(event) => update({ region: event.target.value })}
            />
          </label>
          <label className="grid gap-1.5 text-xs sm:col-span-2" htmlFor={`${id}-endpoint`}>
            {t("cloudBackup.endpoint")}
            <input
              id={`${id}-endpoint`}
              className="settings-control w-full"
              type="url"
              value={config.endpoint}
              required
              placeholder={t(
                config.provider === "r2" ? "cloudBackup.r2Endpoint" : "cloudBackup.s3Endpoint",
              )}
              onChange={(event) => update({ endpoint: event.target.value.trim() })}
            />
          </label>
          {(["bucket", "prefix"] as const).map((field) => (
            <label key={field} className="grid gap-1.5 text-xs" htmlFor={`${id}-${field}`}>
              {t(`cloudBackup.${field}`)}
              <input
                id={`${id}-${field}`}
                className="settings-control w-full"
                required
                value={config[field]}
                onChange={(event) => update({ [field]: event.target.value.trim() })}
              />
            </label>
          ))}
          {(
            [
              { field: "accessKeyId", value: accessKeyId, change: setAccessKeyId },
              { field: "secretAccessKey", value: secretAccessKey, change: setSecretAccessKey },
              { field: "sessionToken", value: sessionToken, change: setSessionToken },
            ] as const
          ).map(({ field, value, change }) => (
            <label key={field} className="grid gap-1.5 text-xs" htmlFor={`${id}-${field}`}>
              {t(`cloudBackup.${field}`)}
              <input
                id={`${id}-${field}`}
                type="password"
                className="settings-control w-full"
                autoComplete="off"
                spellCheck={false}
                value={value}
                onChange={(event) => change(event.target.value)}
              />
            </label>
          ))}
          {controller.status?.hasCredentials &&
            saved?.endpoint === config.endpoint &&
            saved?.bucket === config.bucket && (
              <p className="self-end text-xs text-muted">{t("cloudBackup.credentialsSaved")}</p>
            )}
          <div className="flex items-center justify-between gap-4 sm:col-span-2">
            <label htmlFor={`${id}-automatic`} className="text-sm">
              {t("cloudBackup.automatic")}
            </label>
            <Switch
              id={`${id}-automatic`}
              checked={config.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </div>
          <label className="grid gap-1.5 text-xs" htmlFor={`${id}-interval`}>
            {t("cloudBackup.interval")}
            <select
              id={`${id}-interval`}
              className="settings-control w-full"
              value={config.intervalMinutes}
              onChange={(event) => update({ intervalMinutes: Number(event.target.value) })}
            >
              {CLOUD_INTERVALS.map((count) => (
                <option key={count} value={count}>
                  {t("settings.units.minutes", { count })}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={
              controller.running || !dirty || (changedKeys && (!accessKeyId || !secretAccessKey))
            }
          >
            {t("cloudBackup.save")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!ready}
            onClick={() => void controller.testConnection()}
          >
            {t("cloudBackup.test")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!ready || !controller.projectPath}
            onClick={() => void controller.backupNow()}
          >
            {t("cloudBackup.backupNow")}
          </button>
          {dirty && <span className="text-xs text-muted">{t("cloudBackup.saveFirst")}</span>}
        </div>
      </form>
      {!controller.projectPath && (
        <p className="text-xs text-muted">{t("cloudBackup.openProject")}</p>
      )}
      <div className="space-y-2 text-xs" aria-live="polite">
        {controller.running && (
          <p className="text-muted">
            {t(
              controller.operation
                ? `cloudBackup.progress.${controller.operation}`
                : "cloudBackup.loading",
            )}
          </p>
        )}
        {controller.error && (
          <p role="alert" className="text-error">
            {t(controller.error)}
          </p>
        )}
        {controller.notice && <p className="text-success">{t(controller.notice)}</p>}
        {controller.lastBackup && (
          <>
            <p className="text-muted">
              {t("cloudBackup.lastBackup", {
                date: date(controller.lastBackup.createdAt),
                count: controller.lastBackup.fileCount,
              })}
            </p>
            {controller.lastBackup.skippedCount > 0 && (
              <p className="text-muted">
                {t("cloudBackup.skipped", { count: controller.lastBackup.skippedCount })}
              </p>
            )}
          </>
        )}
        {controller.restoredDirectory && (
          <p className="break-all text-success">
            {t("cloudBackup.restored", { path: controller.restoredDirectory })}
          </p>
        )}
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">{t("cloudBackup.history")}</h3>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!ready}
            onClick={() => void controller.refreshHistory()}
          >
            {t("cloudBackup.refresh")}
          </button>
        </div>
        {controller.history.length === 0 ? (
          <p className="text-xs text-muted">{t("cloudBackup.historyHint")}</p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-border">
            {controller.history.map((snapshot) => (
              <li key={snapshot.key} className="flex min-h-12 items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{snapshot.project}</p>
                  <p className="text-xs text-muted">{date(snapshot.createdAt)}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm shrink-0"
                  disabled={!ready}
                  onClick={() => void controller.restore(snapshot.key)}
                >
                  {t("cloudBackup.restore")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
