/** Daemon lifecycle as reported by the `opencode_status` command. */
export interface OpenCodeStatus {
  running: boolean;
  port: number;
  installed: boolean;
}

/**
 * UI-level daemon lifecycle. It separates "not installed" from "stopped", which the raw
 * status cannot express and which the panel needs in order to offer the right action.
 */
export type OpenCodeDaemonStatus = "stopped" | "starting" | "running" | "unavailable";
