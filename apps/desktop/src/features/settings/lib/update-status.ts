import type { UpdatePhase } from "./app-updater";

/** The status line for an update phase, naming the version when one is known. */
export function updateStatusText(
  phase: UpdatePhase,
  version: string | undefined,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (phase === "idle") return "";
  if (version && (phase === "available" || phase === "downloaded" || phase === "installed"))
    return t(`settings.updates.${phase}Version`, { version });
  return t(`settings.updates.${phase}`);
}
