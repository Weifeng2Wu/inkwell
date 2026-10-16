"use client";

import { useEffect, useState } from "react";
import { appStorage } from "@/lib/storage/app-storage";
import {
  type AgentSelection,
  isAgentSelection,
  type LaunchOverride,
} from "./external-agent-catalog";

const STORAGE_KEY = "inkwell-agent-selection-v1";

export function useAgentSelection() {
  const [selected, setSelected] = useState<AgentSelection>("builtin");
  const [launches, setLaunches] = useState<Record<string, LaunchOverride>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(appStorage.getItem(STORAGE_KEY) ?? "null");
      if (stored && typeof stored === "object") {
        if ("selected" in stored && isAgentSelection(stored.selected)) setSelected(stored.selected);
        if ("launches" in stored && stored.launches && typeof stored.launches === "object") {
          const valid: Record<string, LaunchOverride> = {};
          for (const [id, launch] of Object.entries(stored.launches)) {
            if (
              isAgentSelection(id) &&
              id !== "builtin" &&
              launch &&
              typeof launch === "object" &&
              "command" in launch &&
              typeof launch.command === "string" &&
              "args" in launch &&
              Array.isArray(launch.args) &&
              launch.args.every((arg: unknown) => typeof arg === "string")
            )
              valid[id] = { command: launch.command, args: launch.args };
          }
          setLaunches(valid);
        }
      }
    } catch (caught) {
      setError(String(caught));
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      appStorage.setItem(STORAGE_KEY, JSON.stringify({ selected, launches }));
      setError(null);
    } catch (caught) {
      setError(String(caught));
    }
  }, [selected, launches, ready]);

  function saveLaunch(id: string, launch: LaunchOverride | null) {
    setLaunches((current) => {
      const next = { ...current };
      if (launch) next[id] = launch;
      else delete next[id];
      return next;
    });
  }

  return { selected, setSelected, launches, saveLaunch, ready, error };
}

export type AgentSelectionController = ReturnType<typeof useAgentSelection>;
