"use client";

import { CheckIcon, RobotIcon, TerminalIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import {
  type AcademicAgentController,
  AcademicAgentSettings,
  type AgentSelectionController,
  ExternalAgentSettings,
} from "@/features/agent";
import { useI18n } from "@/features/i18n";
import { quickStartLabels } from "@/features/onboarding/lib/labels";

export function AgentConnectionSettings({
  agent,
  selection,
}: {
  agent?: AcademicAgentController;
  selection?: AgentSelectionController;
}) {
  const { locale } = useI18n();
  const l = quickStartLabels[locale];
  const [mode, setMode] = useState<"builtin" | "external">(() =>
    selection?.selected && selection.selected !== "builtin" ? "external" : "builtin",
  );
  useEffect(() => {
    if (!selection) return;
    setMode(selection.selected === "builtin" ? "builtin" : "external");
  }, [selection?.selected]);
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
      <AcademicAgentSettings agent={agent} external />
      {mode === "builtin" && (
        <>
          <p className="text-xs leading-6 text-muted">{l.agentHint}</p>
          <AcademicAgentSettings agent={agent} showPreferences={false} />
        </>
      )}
      {mode === "external" && (
        <>
          <h3 className="text-sm font-medium">{l.catalog}</h3>
          <ExternalAgentSettings selection={selection} />
        </>
      )}
    </div>
  );
}
