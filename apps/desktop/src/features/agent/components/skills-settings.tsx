"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/features/i18n";
import type { AcademicAgentController } from "../lib/use-academic-agent";
import type { AgentSelectionController } from "../lib/use-agent-selection";
import type { ExternalAgentController } from "../lib/use-external-agent";
import { FormatSkillBuilder } from "./format-skill-builder";
import { SkillsMarket } from "./skills-market";

export function SkillsSettings({
  agent,
  selection,
  externalAgent,
}: {
  agent: AcademicAgentController;
  selection?: AgentSelectionController;
  externalAgent?: ExternalAgentController;
}) {
  const { t } = useI18n();
  const { labels, session, dirty, error } = agent;
  const currentAgent = useRef(agent);
  currentAgent.current = agent;

  useEffect(() => {
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || currentAgent.current.working) return;
      refreshing = true;
      try {
        await currentAgent.current.refreshSkills();
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(() => void refresh(), 15 * 60 * 1000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <section
      className="space-y-4 rounded-lg border border-border bg-background p-5 shadow-sm"
      aria-label={t("settings.categories.skills")}
    >
      <FormatSkillBuilder
        key={JSON.stringify([agent.directory, selection?.selected])}
        agent={agent}
        selection={selection}
        externalAgent={externalAgent}
      />
      <SkillsMarket agent={agent} />
      {session && dirty && <p className="text-xs text-warning">{labels.dirty}</p>}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-error">
          {labels.error}: {error}
        </p>
      )}
    </section>
  );
}
