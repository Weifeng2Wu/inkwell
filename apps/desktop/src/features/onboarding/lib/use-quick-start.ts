"use client";

import { useEffect, useState } from "react";
import { QUICK_START_STEPS, readQuickStart, saveQuickStart } from "./quick-start-state";

export function useQuickStart(workspaceReady: boolean) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [saveError, setSaveError] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Read launch state once; loading a workspace only enables Next.
  useEffect(() => {
    const saved = readQuickStart();
    setStep(workspaceReady ? saved.step : 0);
    setVisible(!saved.completed && !saved.dismissed);
  }, []);

  function navigate(next: number) {
    if (!workspaceReady && next > 0) return;
    try {
      saveQuickStart({ step: next, completed: false, dismissed: false });
      setSaveError(false);
      setStep(next);
    } catch {
      setSaveError(true);
    }
  }
  function close(completed = false) {
    try {
      saveQuickStart({ step, completed, dismissed: !completed });
      setSaveError(false);
      setVisible(false);
    } catch {
      setSaveError(true);
    }
  }
  function open() {
    const saved = readQuickStart();
    const next = workspaceReady ? (saved.completed ? 1 : saved.step) : 0;
    setStep(next);
    setVisible(true);
    setSaveError(false);
  }
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
        return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        if (step === QUICK_START_STEPS - 1) close(true);
        else navigate(step + 1);
      } else if (["p", "b"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        navigate(Math.max(0, step - 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, step, workspaceReady]);
  return {
    visible,
    step,
    saveError,
    open,
    close,
    next: () => (step === QUICK_START_STEPS - 1 ? close(true) : navigate(step + 1)),
    back: () => navigate(Math.max(0, step - 1)),
  };
}
