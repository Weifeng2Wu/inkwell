"use client";

import {
  ArrowClockwiseIcon,
  CheckIcon,
  DownloadSimpleIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import {
  EXTERNAL_AGENTS,
  type ExternalAgentId,
  isAgentSelection,
} from "../lib/external-agent-catalog";
import { externalAgentLabels } from "../lib/external-agent-labels";
import type { AgentSelectionController } from "../lib/use-agent-selection";
import { AGENT_INSTALLATION_CHANGED, useInstalledAgents } from "../lib/use-installed-agents";
import { AgentLogo } from "./agent-logo";

export function AgentSelectionSettings({
  selection,
  externalOnly = false,
}: {
  selection: AgentSelectionController;
  externalOnly?: boolean;
}) {
  const { locale } = useI18n();
  const labels = externalAgentLabels(locale);
  const id = useId();
  const statuses = useInstalledAgents();
  const installedAgents = EXTERNAL_AGENTS.filter((agent) =>
    statuses?.some((status) => status.id === agent.id && status.installed),
  );
  const selected = installedAgents.some((agent) => agent.id === selection.selected)
    ? selection.selected
    : "builtin";

  useEffect(() => {
    if (selection.ready && statuses !== null && selected !== selection.selected) {
      selection.setSelected("builtin");
    }
  }, [selection.ready, selection.selected, selection.setSelected, selected, statuses]);

  return (
    <section className="mb-5 space-y-3 rounded-lg border border-border bg-background p-5 shadow-sm">
      <label htmlFor={id} className="block text-sm font-semibold">
        {labels.select}
      </label>
      <select
        id={id}
        className="settings-control settings-select w-full"
        value={externalOnly && selected === "builtin" ? "" : selected}
        disabled={!selection.ready}
        onChange={(event) => {
          if (isAgentSelection(event.target.value)) selection.setSelected(event.target.value);
        }}
      >
        {externalOnly ? (
          <option value="" disabled>
            {locale === "zh"
              ? "选择已安装的第三方 Agent"
              : locale === "ko"
                ? "설치된 외부 Agent 선택"
                : "Choose an installed third-party Agent"}
          </option>
        ) : (
          <option value="builtin">{labels.builtin}</option>
        )}
        {installedAgents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      {selection.error && (
        <p role="alert" className="text-xs text-error">
          {selection.error}
        </p>
      )}
    </section>
  );
}

export function ExternalAgentSettings({ selection }: { selection: AgentSelectionController }) {
  const { locale } = useI18n();
  const labels = externalAgentLabels(locale);
  const statuses = useInstalledAgents();
  const [installing, setInstalling] = useState<ExternalAgentId | null>(null);
  const [failedAgent, setFailedAgent] = useState<ExternalAgentId | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const installLock = useRef(false);
  const desktop = isTauri();

  async function install(agentId: ExternalAgentId) {
    if (!desktop || installLock.current || !window.confirm(labels.confirmInstall)) return;
    if (agentId === "zcode" && !window.confirm(labels.community)) return;
    installLock.current = true;
    setInstalling(agentId);
    setFailedAgent(null);
    setOutput([]);
    setError(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ agentId: string; text: string }>(
        "external-agent-install",
        ({ payload }) => {
          if (payload.agentId === agentId) {
            setOutput((current) => [...current.slice(-119), payload.text.slice(0, 2000)]);
          }
        },
      );
      await invoke("external_agent_install", { agentId });
      if (selection.launches[agentId]) selection.saveLaunch(agentId, null);
    } catch (caught) {
      setFailedAgent(agentId);
      setError(String(caught));
    } finally {
      unlisten?.();
      installLock.current = false;
      setInstalling(null);
      window.dispatchEvent(new Event(AGENT_INSTALLATION_CHANGED));
    }
  }

  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
      aria-label={labels.title}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h3 className="text-sm font-semibold">{labels.title}</h3>
        <button
          type="button"
          className="toolbar-icon-button text-muted hover:text-foreground"
          aria-label={labels.refresh}
          title={labels.refresh}
          disabled={!desktop || installing !== null}
          onClick={() => window.dispatchEvent(new Event(AGENT_INSTALLATION_CHANGED))}
        >
          <ArrowClockwiseIcon size={16} aria-hidden="true" />
        </button>
      </div>
      <ul className="divide-y divide-border/60">
        {EXTERNAL_AGENTS.map((entry) => {
          const status = statuses?.find((candidate) => candidate.id === entry.id);
          const pending = installing === entry.id;
          const failed = failedAgent === entry.id;
          const ready = Boolean(status?.installed && status.acpReady);
          const checking = desktop && !status;
          const unavailable = !desktop || Boolean(status && !status.installable);
          const disabled = ready || installing !== null || checking || unavailable;
          const text = pending
            ? labels.installing
            : ready
              ? labels.installed
              : failed
                ? labels.retryInstall
                : checking
                  ? labels.checking
                  : unavailable
                    ? labels.unavailable
                    : status?.installed
                      ? labels.finishSetup
                      : labels.install;
          const Icon =
            pending || checking
              ? SpinnerGapIcon
              : ready
                ? CheckIcon
                : failed
                  ? ArrowClockwiseIcon
                  : DownloadSimpleIcon;
          return (
            <li
              key={entry.id}
              className={`flex min-w-0 items-center gap-3 px-5 py-3.5 transition-colors ${ready ? "bg-success/5" : "hover:bg-surface/50"}`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-surface text-foreground">
                <AgentLogo id={entry.id} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
              {ready ? (
                <span
                  role="status"
                  aria-label={`${labels.installed} · ${entry.name}`}
                  className="inline-flex min-h-8 min-w-28 shrink-0 items-center justify-center gap-1.5 rounded-full border border-success/30 bg-success/15 px-3 py-1.5 text-xs font-semibold text-success"
                >
                  <CheckIcon size={16} weight="bold" aria-hidden="true" />
                  {labels.installed}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void install(entry.id)}
                  aria-label={`${text} · ${entry.name}`}
                  aria-busy={pending || checking}
                  title={
                    !desktop
                      ? labels.desktopOnly
                      : unavailable && !ready
                        ? labels.unsupportedInstall
                        : undefined
                  }
                  className={`inline-flex min-h-8 min-w-28 shrink-0 items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${pending || checking ? "border-border bg-surface-secondary text-muted" : failed ? "border-error/30 bg-error/5 text-error hover:bg-error/10" : unavailable ? "border-border text-muted-foreground" : "border-accent bg-accent text-accent-foreground hover:bg-accent-dark shadow-sm"} ${disabled ? "cursor-default" : "cursor-pointer"}`}
                >
                  <Icon
                    size={14}
                    aria-hidden="true"
                    className={
                      pending || checking ? "animate-spin motion-reduce:animate-none" : undefined
                    }
                  />
                  {text}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p
          role="alert"
          className="border-t border-border px-5 py-3 text-xs text-error whitespace-pre-wrap break-words"
        >
          {error}
        </p>
      )}
      {output.length > 0 && (
        <details className="border-t border-border px-5 py-3">
          <summary className="cursor-pointer text-xs text-muted">{labels.installDetails}</summary>
          <pre
            className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface p-3 font-mono text-xs"
            aria-live="polite"
          >
            {output.join("\n")}
          </pre>
        </details>
      )}
    </section>
  );
}
