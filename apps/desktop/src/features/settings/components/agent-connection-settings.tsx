"use client";

import { CheckIcon, RobotIcon, TerminalIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  type AcademicAgentController,
  AcademicAgentSettings,
  type AgentSelectionController,
  AgentSelectionSettings,
  type ExternalAgentController,
  ExternalAgentSettings,
} from "@/features/agent";
import { useI18n } from "@/features/i18n";
import { quickStartLabels } from "@/features/onboarding/lib/labels";

export function AgentConnectionSettings({
  agent,
  selection,
  externalAgent,
  onOpenTerminal,
}: {
  agent?: AcademicAgentController;
  selection?: AgentSelectionController;
  externalAgent?: ExternalAgentController;
  onOpenTerminal?: () => void;
}) {
  const { locale } = useI18n();
  const l = quickStartLabels[locale];
  const [mode, setMode] = useState<"builtin" | "external" | null>(() =>
    selection?.selected && selection.selected !== "builtin" ? "external" : null,
  );
  if (!agent || !selection) return null;
  return (
    <div data-tour="agent-config" className="space-y-5">
      <div role="radiogroup" aria-label={l.choice} className="grid gap-3 sm:grid-cols-2">
        {(["builtin", "external"] as const).map((kind) => (
          <label
            key={kind}
            className={`relative cursor-pointer rounded-xl border p-5 text-left focus-within:outline-2 focus-within:outline-accent ${mode === kind ? "border-accent bg-accent/10" : "border-border hover:bg-accent-hover"}`}
          >
            <input
              type="radio"
              name="settings-agent-mode"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              aria-label={kind === "builtin" ? l.builtin : l.external}
              checked={mode === kind}
              onChange={() => {
                setMode(kind);
                if (kind === "builtin") selection.setSelected("builtin");
              }}
            />
            {kind === "builtin" ? (
              <RobotIcon className="mb-3 size-6 text-accent" />
            ) : (
              <TerminalIcon className="mb-3 size-6 text-accent" />
            )}
            {mode === kind && <CheckIcon className="absolute top-4 right-4 size-4 text-accent" />}
            <span className="block text-sm font-semibold">
              {kind === "builtin" ? l.builtin : l.external}
            </span>
            <span className="mt-2 block text-xs leading-6 text-muted">
              {kind === "builtin" ? l.builtinHint : l.externalHint}
            </span>
          </label>
        ))}
      </div>
      {mode === "builtin" && (
        <>
          <p className="text-xs leading-6 text-muted">{l.agentHint}</p>
          <AcademicAgentSettings agent={agent} />
        </>
      )}
      {mode === "external" && (
        <>
          <p className="text-xs leading-6 text-muted">{l.externalGuide}</p>
          <AgentSelectionSettings selection={selection} externalOnly />
          <div className="flex flex-wrap gap-3">
            {onOpenTerminal && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={!agent.directory}
                onClick={onOpenTerminal}
              >
                {l.terminal}
              </button>
            )}
            {externalAgent && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  !agent.directory ||
                  selection.selected === "builtin" ||
                  externalAgent.working ||
                  externalAgent.connected
                }
                onClick={() => void externalAgent.connect()}
              >
                {selection.selected !== "builtin" && externalAgent.connected
                  ? l.tested
                  : externalAgent.working
                    ? l.connecting
                    : l.connect}
              </button>
            )}
          </div>
          {externalAgent?.error && (
            <p role="alert" className="break-words text-xs text-error">
              {externalAgent.error}
            </p>
          )}
          <h3 className="text-sm font-medium">{l.catalog}</h3>
          <ExternalAgentSettings selection={selection} />
        </>
      )}
    </div>
  );
}
