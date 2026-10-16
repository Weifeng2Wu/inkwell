"use client";

import dynamic from "next/dynamic";

export const AcademicAgentPanel = dynamic(
  () => import("./components/academic-agent-panel").then((module) => module.AcademicAgentPanel),
  { ssr: false },
);

export { AcademicAgentSettings } from "./components/academic-agent-settings";
export { AgentReviewPanel } from "./components/agent-review-panel";
export {
  AgentSelectionSettings,
  ExternalAgentSettings,
} from "./components/external-agent-settings";
export { SkillsSettings } from "./components/skills-settings";
export { useAgentReview } from "./lib/use-agent-review";
export const ExternalAgentPanel = dynamic(
  () => import("./components/external-agent-panel").then((module) => module.ExternalAgentPanel),
  { ssr: false },
);
export { DEFAULT_ACADEMIC_CONFIG } from "./lib/academic-config";
export { academicLabels } from "./lib/academic-labels";
export { type AcademicAgentController, useAcademicAgent } from "./lib/use-academic-agent";
export { type AgentSelectionController, useAgentSelection } from "./lib/use-agent-selection";
export type { ExternalAgentController } from "./lib/use-external-agent";
export { useExternalAgent } from "./lib/use-external-agent";
