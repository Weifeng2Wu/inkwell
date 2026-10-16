import { appStorage } from "@/lib/storage/app-storage";
/** Persisted selection of the agent and model used for AI-assisted actions. */

export const OPENCODE_STORAGE_KEY_AGENT = "opencode-selected-agent";
export const OPENCODE_STORAGE_KEY_MODEL = "opencode-selected-model";

export interface PreferredOpenCodeConfig {
  agent?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
}

/**
 * Reads the agent and model the user last selected in the chat panel.
 *
 * Returns an empty config when running on the server or when the stored value is
 * unreadable, so callers always get a usable object instead of handling null.
 */
export function getPreferredOpenCodeConfig(): PreferredOpenCodeConfig {
  if (typeof window === "undefined") return {};

  let agent: string | undefined;
  let model:
    | {
        providerID: string;
        modelID: string;
      }
    | undefined;

  try {
    const savedAgent = appStorage.getItem(OPENCODE_STORAGE_KEY_AGENT);
    if (savedAgent) {
      agent = savedAgent;
    }

    const savedModelRaw = appStorage.getItem(OPENCODE_STORAGE_KEY_MODEL);
    if (savedModelRaw) {
      const savedModel = JSON.parse(savedModelRaw) as {
        providerId?: unknown;
        modelId?: unknown;
      };
      if (typeof savedModel.providerId === "string" && typeof savedModel.modelId === "string") {
        model = {
          providerID: savedModel.providerId,
          modelID: savedModel.modelId,
        };
      }
    }
  } catch {
    return {};
  }

  return { agent, model };
}
