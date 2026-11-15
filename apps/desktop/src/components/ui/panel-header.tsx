"use client";

import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";

/** The first row of a sidebar panel: its title, and its actions on the right. */
export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-9 flex-shrink-0 items-center justify-between gap-2 border-b border-border pl-3 pr-1.5">
      <h2 className="truncate text-xs font-medium text-foreground">{title}</h2>
      {children && <div className="flex flex-shrink-0 items-center gap-0.5">{children}</div>}
    </div>
  );
}

type ActionProps = {
  /** What the action does; also its accessible name. */
  label: string;
  /** Keyboard shortcut, already formatted for the platform. */
  keys?: string;
  onClick: () => void;
  disabled?: boolean;
  /** For toggles: whether the option is on. */
  pressed?: boolean;
  children: ReactNode;
};

/** A compact icon button for panel headers and list rows, with a tooltip. */
export function PanelAction({ label, keys, onClick, disabled, pressed, children }: ActionProps) {
  return (
    <Tooltip label={label} keys={keys}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={`flex size-6 items-center justify-center rounded-md transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
          pressed
            ? "bg-accent-hover text-accent"
            : "text-muted hover:bg-surface-secondary hover:text-foreground"
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
