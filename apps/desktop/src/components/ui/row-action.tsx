"use client";

import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";

type Props = {
  /** What the action does; also its accessible name. */
  label: string;
  /** Keyboard shortcut, already formatted for the platform. */
  keys?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
};

/**
 * An icon button on a list row, with a tooltip. It is not a tab stop: a row offers the same
 * action from its keyboard shortcut or its context menu, so a list stays one tab stop.
 */
export function RowAction({ label, keys, onClick, disabled, children }: Props) {
  return (
    <Tooltip label={label} keys={keys}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-tertiary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
      >
        {children}
      </button>
    </Tooltip>
  );
}
