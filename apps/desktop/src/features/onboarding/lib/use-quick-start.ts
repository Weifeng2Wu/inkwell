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
