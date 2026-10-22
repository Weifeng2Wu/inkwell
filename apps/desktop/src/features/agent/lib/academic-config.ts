import { appStorage } from "@/lib/storage/app-storage";
import { readCapabilityProfiles } from "../../../../../../packages/academic-agent/src/model-capabilities.mjs";
import type { AcademicConfig } from "./academic-client";

export const DEFAULT_ACADEMIC_CONFIG: AcademicConfig = {
  provider: "inkwell-custom",
  protocol: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  imageGeneration: { baseUrl: "https://api.openai.com/v1", model: "" },
  webSearch: { baseUrl: "https://api.tavily.com" },
  personalPrompt: "",
  answerLanguage: "zh",
  skillIds: [],
  permissionMode: "ask",
};

function headerConfig(value: object): { customHeaders?: string } {
  return "customHeaders" in value && typeof value.customHeaders === "string"
    ? { customHeaders: value.customHeaders }
    : {};
}

export function readConfig(storageKey: string): AcademicConfig {
  try {
    const value: unknown = JSON.parse(
      appStorage.getItem(storageKey) ?? appStorage.getItem("inkwell-agent-config-v1:") ?? "null",
    );
    if (
      value &&
      typeof value === "object" &&
      "provider" in value &&
      typeof value.provider === "string" &&
      "model" in value &&
      typeof value.model === "string" &&
      "skillIds" in value &&
      Array.isArray(value.skillIds) &&
      value.skillIds.every((identifier: unknown) => typeof identifier === "string")
    ) {
      return {
        provider: value.provider,
        protocol:
          "protocol" in value &&
          (value.protocol === "openai" ||
            value.protocol === "anthropic" ||
            value.protocol === "gemini")
            ? value.protocol
            : "",
        baseUrl: "baseUrl" in value && typeof value.baseUrl === "string" ? value.baseUrl : "",
        model: value.model,
        ...headerConfig(value),
        ...("modelCapabilities" in value
          ? { modelCapabilities: readCapabilityProfiles(value.modelCapabilities) }
          : {}),
        imageGeneration:
          "imageGeneration" in value &&
          value.imageGeneration &&
          typeof value.imageGeneration === "object" &&
          "baseUrl" in value.imageGeneration &&
          typeof value.imageGeneration.baseUrl === "string" &&
          "model" in value.imageGeneration &&
          typeof value.imageGeneration.model === "string"
            ? {
                baseUrl: value.imageGeneration.baseUrl,
                model: value.imageGeneration.model,
                ...headerConfig(value.imageGeneration),
              }
            : DEFAULT_ACADEMIC_CONFIG.imageGeneration,
        webSearch:
          "webSearch" in value &&
          value.webSearch &&
          typeof value.webSearch === "object" &&
          "baseUrl" in value.webSearch &&
          typeof value.webSearch.baseUrl === "string"
            ? { baseUrl: value.webSearch.baseUrl, ...headerConfig(value.webSearch) }
            : DEFAULT_ACADEMIC_CONFIG.webSearch,
        personalPrompt:
          "personalPrompt" in value && typeof value.personalPrompt === "string"
            ? value.personalPrompt
            : "",
        skillIds: value.skillIds,
        answerLanguage:
          "answerLanguage" in value &&
          (value.answerLanguage === "en" || value.answerLanguage === "ko")
            ? value.answerLanguage
            : "zh",
        permissionMode:
          "permissionMode" in value
            ? value.permissionMode === "ask" || value.permissionMode === "auto"
              ? value.permissionMode
              : "restricted"
            : "allowRead" in value &&
                value.allowRead === true &&
                "allowEdits" in value &&
                value.allowEdits === true
              ? "ask"
              : "restricted",
      };
    }
  } catch {}
  return DEFAULT_ACADEMIC_CONFIG;
}
