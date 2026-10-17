import { appStorage } from "@/lib/storage/app-storage";

export const QUICK_START_KEY = "inkwell-quick-start-v1";
export const QUICK_START_STEPS = 8;
export interface QuickStartState {
  step: number;
  completed: boolean;
  dismissed: boolean;
}
export function readQuickStart(): QuickStartState {
  try {
    const value = JSON.parse(appStorage.getItem(QUICK_START_KEY) ?? "null");
    const legacySteps = [0, 2, 4, 5, 6, 6];
    const step = value?.version === 2 ? value?.step : (legacySteps[value?.step] ?? 0);
    return {
      step: Number.isInteger(step) ? Math.max(0, Math.min(QUICK_START_STEPS - 1, step)) : 0,
      completed: value?.completed === true,
      dismissed: value?.dismissed === true,
    };
  } catch {
    return { step: 0, completed: false, dismissed: false };
  }
}
export function saveQuickStart(state: QuickStartState) {
  appStorage.setItem(QUICK_START_KEY, JSON.stringify({ ...state, version: 2 }));
}
