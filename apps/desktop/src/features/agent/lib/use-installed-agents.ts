"use client";

import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { AgentStatus } from "./external-agent-catalog";

export const AGENT_INSTALLATION_CHANGED = "inkwell-agent-installation-changed";

export function useInstalledAgents() {
  const [statuses, setStatuses] = useState<AgentStatus[] | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let request = 0;
    const detect = () => {
      const version = ++request;
      void invoke<AgentStatus[]>("external_agent_detect")
        .then((detected) => {
          if (!cancelled && version === request) setStatuses(detected);
        })
        .catch(() => {
          if (!cancelled && version === request) setStatuses(null);
        });
    };
    detect();
    window.addEventListener(AGENT_INSTALLATION_CHANGED, detect);
    return () => {
      cancelled = true;
      window.removeEventListener(AGENT_INSTALLATION_CHANGED, detect);
    };
  }, []);

  return statuses;
}
