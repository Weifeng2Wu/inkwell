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

export function AgentConnectionSettings({
  agent,
  selection,
}: {
  agent?: AcademicAgentController;
  selection?: AgentSelectionController;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"builtin" | "external">(() =>
    selection?.selected && selection.selected !== "builtin" ? "external" : "builtin",
  );
  const selected = selection?.selected;
  useEffect(() => {
    if (selected === undefined) return;
    setMode(selected === "builtin" ? "builtin" : "external");
  }, [selected]);
  if (!agent || !selection) return null;
  return (
    <div data-tour="agent-config" className="space-y-5">
      <div
        role="radiogroup"
        aria-label={t("agent.kind.label")}
        className="grid gap-3 sm:grid-cols-2"
      >
        {(["builtin", "external"] as const).map((kind) => (
          <label
            key={kind}
            className={`relative cursor-pointer rounded-lg border p-4 text-left transition-colors focus-within:outline-2 focus-within:outline-accent ${mode === kind ? "border-accent bg-accent/10" : "border-border hover:bg-accent-hover"}`}
          >
            <input
              type="radio"
              name="settings-agent-mode"
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              aria-label={t(`agent.kind.${kind}`)}
              checked={mode === kind}
              onChange={() => {
                setMode(kind);
                if (kind === "builtin") selection.setSelected("builtin");
              }}
            />
            {kind === "builtin" ? (
              <RobotIcon className="mb-2 size-5 text-accent" aria-hidden="true" />
            ) : (
              <TerminalIcon className="mb-2 size-5 text-accent" aria-hidden="true" />
            )}
            {mode === kind && (
              <CheckIcon className="absolute top-4 right-4 size-4 text-accent" aria-hidden="true" />
            )}
            <span className="block text-sm font-semibold">{t(`agent.kind.${kind}`)}</span>
            <span className="mt-1 block text-xs leading-5 text-muted">
              {t(`agent.kind.${kind}Hint`)}
            </span>
          </label>
        ))}
      </div>
      {mode === "builtin" && <AcademicAgentSettings agent={agent} showPreferences={false} />}
      {mode === "external" && <ExternalAgentSettings selection={selection} />}
      <AcademicAgentSettings agent={agent} external />
    </div>
  );
}
