"use client";

import { DownloadSimpleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useI18n } from "@/features/i18n";
import { useGitHubAuth } from "../lib/use-github-auth";

export function GitHubAuthSettings() {
  const { t } = useI18n();
  const auth = useGitHubAuth();
  const prefix = "settings.gitSection";
  const statusKey = auth.checking
    ? "checking"
    : auth.status === null
      ? "unknown"
      : !auth.status.installed
        ? "cliMissing"
        : auth.status.authenticated
          ? "authenticated"
          : "signedOut";

  return (
    <div className="space-y-3 border-b border-border/40 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h4 className="text-sm font-medium text-foreground-secondary">GitHub</h4>
          <p role="status" className="break-words text-xs text-muted-foreground">
            {t(`${prefix}.${statusKey}`)}
            {!auth.checking && auth.status?.authenticated && auth.status.username && (
              <span className="ml-2 font-medium text-foreground">@{auth.status.username}</span>
            )}
          </p>
        </div>
        {auth.status?.installed === false && (
          <button
            type="button"
            className="inline-flex min-h-8 min-w-28 shrink-0 items-center justify-center gap-1.5 rounded-md border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-dark disabled:cursor-default disabled:border-border disabled:bg-surface-secondary disabled:text-muted"
            disabled={auth.checking || auth.installing}
            aria-label={t(`${prefix}.installCli`)}
            aria-busy={auth.installing}
            onClick={() => void auth.install()}
          >
            {auth.installing ? (
              <SpinnerGapIcon
                size={14}
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <DownloadSimpleIcon size={14} aria-hidden="true" />
            )}
            {t(`${prefix}.install`)}
          </button>
        )}
        {auth.status?.installed && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-sm"
              disabled={auth.checking || auth.launching || !!auth.switching}
              onClick={() => void auth.refresh()}
            >
              {t(`${prefix}.refreshAuth`)}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={auth.checking || auth.launching || !!auth.switching}
              onClick={() => void auth.login()}
            >
              {t(`${prefix}.${auth.status.authenticated ? "addAccount" : "login"}`)}
            </button>
          </div>
        )}
      </div>
      {auth.status?.installed && (
        <ul aria-label={t(`${prefix}.savedAccounts`)} className="space-y-2">
          {auth.status.accounts?.map((account) => (
            <li
              key={account.username}
              className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2"
            >
              <div className="min-w-0 text-xs">
                <span className="break-words font-medium text-foreground">@{account.username}</span>
                <span className="ml-2 text-muted-foreground">
                  {account.active ? t(`${prefix}.activeAccount`) : ""}
                  {!account.authenticated ? ` ${t(`${prefix}.accountExpired`)}` : ""}
                </span>
              </div>
              {!account.active && (
                <button
                  type="button"
                  className="btn btn-sm shrink-0"
                  aria-label={`${t(`${prefix}.switchAccount`)} @${account.username}`}
                  aria-busy={auth.switching === account.username}
                  disabled={
                    auth.checking || auth.launching || !!auth.switching || !account.authenticated
                  }
                  onClick={() => void auth.switchAccount(account.username)}
                >
                  {t(
                    `${prefix}.${auth.switching === account.username ? "switchingAccount" : "switchAccount"}`,
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {auth.error && (
        <p role="alert" className="break-words text-xs text-error">
          {auth.error}
        </p>
      )}
    </div>
  );
}
