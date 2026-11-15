"use client";

import {
  BooksIcon,
  FilesIcon,
  GearIcon,
  GitBranchIcon,
  GraphIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  SparkleIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";

export const SIDEBAR_VIEWS = ["files", "search", "outline", "library", "git"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];

type Toggle = { active: boolean; keys?: string; onToggle: () => void };
type Props = {
  /** The view shown in the sidebar, or null while the sidebar is hidden. */
  view: SidebarView | null;
  /** Called with the clicked view; the shell hides the sidebar when it is already shown. */
  onSelect: (view: SidebarView) => void;
  /** Shortcut labels for the views that have one. */
  keys: Partial<Record<SidebarView, string>>;
  gitChanges: number;
  graph: Toggle;
  terminal: Toggle;
  agent: Toggle;
  settings: Toggle;
  reducedMotion: boolean;
};

const VIEW_ICONS: Record<SidebarView, typeof FilesIcon> = {
  files: FilesIcon,
  search: MagnifyingGlassIcon,
  outline: ListBulletsIcon,
  library: BooksIcon,
  git: GitBranchIcon,
};

function RailButton({
  label,
  keys,
  active,
  indicator,
  badge,
  onClick,
  tour,
  children,
}: {
  label: string;
  keys?: string;
  active: boolean;
  /** Slides to the active sidebar view. */
  indicator?: ReactNode;
  badge?: number;
  onClick: () => void;
  tour?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} keys={keys} side="right" className="relative flex w-full justify-center">
      {active && indicator}
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        data-tour={tour}
        onClick={onClick}
        className={`relative flex size-8 items-center justify-center rounded-md transition-colors duration-150 ${
          active
            ? "bg-accent-hover text-accent"
            : "text-muted hover:bg-surface-secondary hover:text-foreground"
        }`}
      >
        {children}
        {badge ? (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] font-medium leading-4 text-accent-foreground">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

/** The vertical bar that switches sidebar views and toggles the other panels. */
export function ActivityRail({
  view,
  onSelect,
  keys,
  gitChanges,
  graph,
  terminal,
  agent,
  settings,
  reducedMotion,
}: Props) {
  const { t } = useI18n();
  const indicator = (
    <motion.span
      layoutId="activity-rail-indicator"
      transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
      className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-accent"
    />
  );
  const icon = "size-[18px]";
  return (
    <nav
      aria-label={t("workbench.rail")}
      className="flex w-11 flex-shrink-0 flex-col items-center justify-between border-r border-border py-2"
    >
      <div className="flex w-full flex-col items-center gap-1">
        {SIDEBAR_VIEWS.map((id) => {
          const Icon = VIEW_ICONS[id];
          return (
            <RailButton
              key={id}
              label={t(`workbench.views.${id}`)}
              keys={keys[id]}
              active={view === id}
              indicator={indicator}
              badge={id === "git" ? gitChanges : undefined}
              onClick={() => onSelect(id)}
            >
              <Icon className={icon} aria-hidden="true" />
            </RailButton>
          );
        })}
      </div>
      <div className="flex w-full flex-col items-center gap-1">
        <RailButton label={t("workbench.graph")} active={graph.active} onClick={graph.onToggle}>
          <GraphIcon className={icon} aria-hidden="true" />
        </RailButton>
        <RailButton
          label={t("workbench.terminal")}
          keys={terminal.keys}
          active={terminal.active}
          onClick={terminal.onToggle}
        >
          <TerminalWindowIcon className={icon} aria-hidden="true" />
        </RailButton>
        <RailButton
          label={t("workbench.agent")}
          keys={agent.keys}
          active={agent.active}
          onClick={agent.onToggle}
        >
          <SparkleIcon className={icon} aria-hidden="true" />
        </RailButton>
        <RailButton
          label={t("workbench.settings")}
          keys={settings.keys}
          active={settings.active}
          onClick={settings.onToggle}
          tour="settings"
        >
          <GearIcon className={icon} aria-hidden="true" />
        </RailButton>
      </div>
    </nav>
  );
}
