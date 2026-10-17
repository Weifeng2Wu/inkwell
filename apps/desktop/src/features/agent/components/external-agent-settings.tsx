"use client";

import {
  ArrowClockwiseIcon,
  CheckIcon,
  DownloadSimpleIcon,
  SpinnerGapIcon,
} from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    statuses?.some((status) => status.id === agent.id && status.installed && status.acpReady),
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
      <Select
        value={selected}
        onValueChange={(value) => {
          if (isAgentSelection(value)) selection.setSelected(value);
        }}
        disabled={!selection.ready}
      >
        <SelectTrigger id={id} className="settings-control w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!externalOnly && (
            <SelectItem value="builtin">
              <span className="inline-flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded border border-border/60 bg-surface text-xs text-accent">
                  In
                </span>
                {labels.builtin}
              </span>
            </SelectItem>
          )}
          {installedAgents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>
              <span className="inline-flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded border border-border/60 bg-surface">
                  <AgentLogo id={agent.id} className="size-4" />
                </span>
                {agent.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
  const [installProgress, setInstallProgress] = useState<number | null>(null);
  const [failedAgent, setFailedAgent] = useState<ExternalAgentId | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmAgent, setConfirmAgent] = useState<ExternalAgentId | null>(null);
  const installLock = useRef(false);
  const desktop = isTauri();

  async function install(agentId: ExternalAgentId) {
    if (!desktop || installLock.current) return;
    installLock.current = true;
    setInstalling(agentId);
    setInstallProgress(0);
    setFailedAgent(null);
    setOutput([]);
    setError(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ agentId: string; text: string; progress?: number }>(
        "external-agent-install",
        ({ payload }) => {
          if (payload.agentId === agentId) {
            if (typeof payload.progress === "number") setInstallProgress(payload.progress);
            setOutput((current) => [...current.slice(-119), payload.text.slice(0, 2000)]);
          }
        },
      );
      await invoke("external_agent_install", { agentId });
      selection.setSelected(agentId);
      if (selection.launches[agentId]) selection.saveLaunch(agentId, null);
    } catch (caught) {
      setFailedAgent(agentId);
      setError(String(caught));
    } finally {
      unlisten?.();
      installLock.current = false;
      setInstalling(null);
      setInstallProgress(null);
      window.dispatchEvent(new Event(AGENT_INSTALLATION_CHANGED));
    }
  }

  async function uninstall(agentId: ExternalAgentId) {
    if (!desktop || installLock.current) return;
    if (
      !window.confirm(
        `${EXTERNAL_AGENTS.find((entry) => entry.id === agentId)?.name ?? agentId}: ${labels.uninstallConfirm}`,
      )
    )
      return;
    installLock.current = true;
    setInstalling(agentId);
    setError(null);
    try {
      await invoke("external_agent_uninstall", { agentId });
    } catch (caught) {
      setFailedAgent(agentId);
      setError(String(caught));
    } finally {
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
          const removableAcp = ["pi", "claude", "codex", "zcode", "antigravity"].includes(entry.id);
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
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    role="status"
                    aria-label={`${labels.installed} · ${entry.name}`}
                    className="inline-flex min-h-8 min-w-28 items-center justify-center gap-1.5 rounded-md border border-success/30 bg-success/15 px-3 py-1.5 text-xs font-semibold text-success"
                  >
                    <CheckIcon size={16} weight="bold" aria-hidden="true" />
                    {labels.installed}
                  </span>
                  {removableAcp ? (
                    <button
                      type="button"
                      className="btn btn-sm min-h-8 min-w-28"
                      disabled={installing !== null}
                      onClick={() => void uninstall(entry.id)}
                    >
                      {labels.uninstall}
                    </button>
                  ) : (
                    <span className="text-xs text-muted">{labels.acpBundled}</span>
                  )}
                </div>
              ) : status?.installed ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="btn btn-sm min-h-8 min-w-28"
                    disabled={disabled}
                    onClick={() => void install(entry.id)}
                  >
                    {labels.finishSetup}
                  </button>
                  {removableAcp && (
                    <button
                      type="button"
                      className="btn btn-sm min-h-8 min-w-28"
                      disabled={installing !== null}
                      onClick={() => void uninstall(entry.id)}
                    >
                      {labels.uninstall}
                    </button>
                  )}
                </div>
              ) : (
                <span
                  role={pending ? "progressbar" : undefined}
                  aria-valuemin={pending ? 0 : undefined}
                  aria-valuemax={pending ? 100 : undefined}
                  aria-valuenow={
                    pending && installProgress !== null
                      ? Math.round(installProgress * 100)
                      : undefined
                  }
                  className={`inline-flex shrink-0 rounded-md p-0.5 text-accent ${pending && installProgress === null ? "animate-spin motion-reduce:animate-none" : ""}`}
                  style={
                    pending
                      ? {
                          background:
                            installProgress === null
                              ? "conic-gradient(currentColor 0deg, transparent 70deg, currentColor 120deg, transparent 220deg, currentColor 360deg)"
                              : `conic-gradient(currentColor ${Math.max(2, Math.round(installProgress * 360))}deg, transparent 0deg)`,
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setConfirmAgent(entry.id)}
                    aria-label={`${text} · ${entry.name}`}
                    aria-busy={pending || checking}
                    title={
                      !desktop
                        ? labels.desktopOnly
                        : unavailable && !ready
                          ? labels.unsupportedInstall
                          : undefined
                    }
                    className={`inline-flex min-h-8 min-w-28 items-center justify-center gap-1.5 rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors ${pending || checking ? "border-border bg-surface-secondary text-muted" : failed ? "border-error/30 bg-error/5 text-error hover:bg-error/10" : unavailable ? "border-border text-muted-foreground" : "border-accent bg-accent text-accent-foreground hover:bg-accent-dark shadow-sm"} ${disabled ? "cursor-default" : "cursor-pointer"}`}
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
                </span>
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
      <Dialog.Root
        open={confirmAgent !== null}
        onOpenChange={(open) => !open && setConfirmAgent(null)}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[9999] bg-black/45 backdrop-blur-[1px]" />
          <Dialog.Content
            role="dialog"
            aria-describedby="external-agent-install-description"
            className="fixed left-1/2 top-1/2 z-[10000] w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-5 text-foreground shadow-2xl focus:outline-none"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent">
                <DownloadSimpleIcon size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-base font-semibold">
                  {labels.installConfirmTitle}
                </Dialog.Title>
                <Dialog.Description
                  id="external-agent-install-description"
                  className="mt-2 text-sm leading-relaxed text-muted-foreground"
                >
                  {confirmAgent
                    ? `${EXTERNAL_AGENTS.find((agent) => agent.id === confirmAgent)?.name ?? "Agent"}: ${labels.confirmInstall}${confirmAgent === "zcode" ? ` ${labels.community}` : ""}`
                    : labels.confirmInstall}
                </Dialog.Description>
              </div>
              <Dialog.Close
                type="button"
                className="toolbar-icon-button -mr-1 -mt-1 text-muted hover:text-foreground"
                aria-label={labels.cancel}
              >
                <span aria-hidden="true">×</span>
              </Dialog.Close>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close type="button" className="btn btn-sm">
                {labels.cancel}
              </Dialog.Close>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  if (confirmAgent) void install(confirmAgent);
                  setConfirmAgent(null);
                }}
              >
                {labels.continueInstall}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
