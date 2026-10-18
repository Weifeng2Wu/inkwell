import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACADEMIC_CONFIG } from "./academic-config";
import { apiKeyScope, readAgentApiKey, writeAgentApiKey } from "./agent-api-key-store";
import { useAcademicAgent } from "./use-academic-agent";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const hooks = vi.hoisted(() => ({
  cursor: 0,
  changed: false,
  slots: new Map<number, unknown>(),
  effects: new Map<number, { dependencies: unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index))
      hooks.slots.set(
        index,
        typeof initial === "function" ? Reflect.apply(initial, undefined, []) : initial,
      );
    return [
      hooks.slots.get(index),
      (next: unknown) => {
        const previous = hooks.slots.get(index);
        const value =
          typeof next === "function" ? Reflect.apply(next, undefined, [previous]) : next;
        if (!Object.is(value, previous)) {
          hooks.slots.set(index, value);
          hooks.changed = true;
        }
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index)) hooks.slots.set(index, { current: initial });
    return hooks.slots.get(index);
  },
  useEffect(effect: () => (() => void) | undefined, dependencies: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.effects.get(index);
    if (
      !previous ||
      dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))
    ) {
      hooks.pending.push(() => {
        previous?.cleanup?.();
        hooks.effects.set(index, { dependencies, cleanup: effect() });
      });
    }
  },
}));

vi.mock("@/features/i18n", () => ({ useI18n: () => ({ locale: "en" }) }));
vi.mock("@/features/settings", () => ({ parseLayoutImage: vi.fn() }));
vi.mock("./agent-api-key-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-api-key-store")>()),
  readAgentApiKey: vi.fn(),
  writeAgentApiKey: vi.fn(),
}));

const storage = new Map<string, string>();
const credentials = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => {
  storage.set(key, value);
});

function renderAgent(directory?: string, enabled = true): ReturnType<typeof useAcademicAgent> {
  const renderHook = useAcademicAgent;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    hooks.cursor = 0;
    hooks.changed = false;
    const agent = renderHook({ directory, enabled });
    for (const effect of hooks.pending.splice(0)) effect();
    if (!hooks.changed) return agent;
  }
  throw new Error("Agent settings did not settle.");
}

async function settleAgent(directory?: string) {
  let agent = renderAgent(directory);
  await vi.waitFor(() => {
    agent = renderAgent(directory);
    expect(agent.apiKeyLoading).toBe(false);
    expect(agent.settingsSaved || agent.settingsSaveError !== null).toBe(true);
  });
  return agent;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(open).mockReset();
  hooks.slots.clear();
  hooks.effects.clear();
  hooks.pending = [];
  storage.clear();
  credentials.clear();
  vi.mocked(readAgentApiKey)
    .mockReset()
    .mockImplementation(async (scope) => credentials.get(scope) ?? null);
  vi.mocked(writeAgentApiKey)
    .mockReset()
    .mockImplementation(async (scope, value) => {
      credentials.set(scope, value);
    });
  setItem.mockReset().mockImplementation((key, value) => {
    storage.set(key, value);
  });
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem });
});

describe("shared skill imports", () => {
  it.each([false, true, "zip"] as const)("imports %s without a project or model", async (mode) => {
    const agent = await settleAgent();
    vi.mocked(open).mockResolvedValue("/imports/skill.zip");
    vi.mocked(invoke).mockResolvedValue({ skills: [], market: [] });
    await agent.uploadSkill(mode);
    expect(open).toHaveBeenCalledWith({
      directory: mode === true,
      multiple: false,
      filters:
        mode === true
          ? undefined
          : [{ name: "Skill", extensions: [mode === "zip" ? "zip" : "md"] }],
    });
    expect(invoke).toHaveBeenCalledWith("agent_shared_skills", {
      request: { type: "skill_import", sourcePath: "/imports/skill.zip" },
    });
  });

  it("imports a GitHub URL without a project or model", async () => {
    const agent = await settleAgent();
    vi.mocked(invoke).mockResolvedValue({ skills: [], market: [] });
    await agent.importGitHubSkill(" https://github.com/example/writing ");
    expect(invoke).toHaveBeenCalledWith("agent_shared_skills", {
      request: { type: "skill_import_github", url: "https://github.com/example/writing" },
    });
  });

  it("does not submit an import after the file picker is cancelled", async () => {
    const agent = await settleAgent();
    vi.mocked(open).mockResolvedValue(null);
    vi.mocked(invoke).mockClear();
    await agent.uploadSkill("zip");
    expect(invoke).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("independent API checks", () => {
  it("runs image discovery and search while the model check is pending without starting chat", async () => {
    let agent = await settleAgent("/project");
    agent.setConfig({ ...agent.config, model: "fixture-model" });
    agent.setWebSearchApiKey("fixture-search-key");
    agent = await settleAgent("/project");
    let finishModel: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      expect(command).toBe("academic_api_request");
      const request = (args as { request: { type: string } }).request;
      if (request.type === "test_connection") {
        await new Promise<void>((resolve) => {
          finishModel = resolve;
        });
        return { ok: true };
      }
      if (request.type === "list_models") return { models: ["fixture-image"] };
      if (request.type === "test_web_search") throw new Error("Search HTTP 401");
      throw new Error("Unexpected request");
    });
    const modelCheck = agent.testConnection();
    agent = renderAgent("/project");
    expect(agent.testingConnection).toBe(true);
    expect(agent.working).toBe(false);
    expect(await agent.fetchModels(agent.config, "image-key")).toEqual({
      models: ["fixture-image"],
    });
    await expect(agent.testWebSearch()).rejects.toThrow("Search HTTP 401");
    agent = renderAgent("/project");
    expect(agent.error).toBeNull();
    expect(agent.testingConnection).toBe(true);
    finishModel?.();
    await modelCheck;
    agent = renderAgent("/project");
    expect(agent.testingConnection).toBe(false);
    expect(agent.connectionTest).not.toBeNull();
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("keeps model test failures separate from chat and allows retry", async () => {
    let agent = await settleAgent();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Model HTTP 401"));
    await agent.testConnection();
    agent = renderAgent();
    expect(agent.connectionTestError).toContain("Model HTTP 401");
    expect(agent.error).toBeNull();
    expect(agent.testingConnection).toBe(false);
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true });
    await agent.testConnection();
    agent = renderAgent();
    expect(agent.connectionTestError).toBeNull();
    expect(agent.connectionTest).not.toBeNull();
  });
});

describe("Agent settings auto-save", () => {
  it("does not dispatch built-in model requests while an external Agent is selected", async () => {
    const agent = renderAgent("/project", false);
    await expect(agent.generateCommitMessage("Commit changes")).rejects.toThrow("disabled");
    expect(await agent.configure(false)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads shared skills without starting the built-in runtime in external mode", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ skills: [], market: [] });
    const agent = renderAgent("/project", false);
    await agent.connect();
    expect(invoke).toHaveBeenCalledExactlyOnceWith("agent_shared_skills", {
      request: { type: "catalog" },
    });
  });

  it("keeps preferences, skills and permission mode when changing the execution backend", () => {
    let agent = renderAgent("/project");
    const config = {
      ...agent.config,
      personalPrompt: "Preserve LaTeX",
      answerLanguage: "en" as const,
      skillIds: ["shared-skill"],
      permissionMode: "ask" as const,
    };
    agent.setConfig(config);
    agent = renderAgent("/project", false);
    expect(agent.config).toEqual(config);
    agent = renderAgent("/project", true);
    expect(agent.config).toEqual(config);
  });

  it("automatically persists changed settings and reports success", async () => {
    let agent = await settleAgent("/project");
    agent.setConfig({ ...agent.config, model: "updated-model", permissionMode: "auto" });
    agent = await settleAgent("/project");
    expect(JSON.parse(storage.get("inkwell-agent-config-v1:/project") ?? "null")).toMatchObject({
      model: "updated-model",
      permissionMode: "auto",
    });
    expect(agent.settingsSaved).toBe(true);
    expect(agent.settingsSaveError).toBeNull();
  });

  it("saves API keys in credential storage, never localStorage", async () => {
    let agent = await settleAgent("/project");
    agent.setApiKey("fixture-secure-key");
    expect(renderAgent("/project").settingsSaved).toBe(false);
    agent = await settleAgent("/project");
    expect(agent.apiKey).toBe("fixture-secure-key");
    expect(credentials.get(apiKeyScope(agent.config))).toBe("fixture-secure-key");
    expect([...storage.values()].join("")).not.toContain("fixture-secure-key");
  });

  it("loads another project without overwriting its settings and reuses the endpoint credential", async () => {
    const otherConfig = { ...DEFAULT_ACADEMIC_CONFIG, model: "other-model" };
    storage.set("inkwell-agent-config-v1:/other", JSON.stringify(otherConfig));
    const agent = await settleAgent("/project");
    agent.setConfig({ ...agent.config, model: "first-model" });
    agent.setApiKey("fixture-secure-key");
    await settleAgent("/project");
    setItem.mockClear();
    const other = await settleAgent("/other");
    expect(other.config).toEqual(otherConfig);
    expect(other.apiKey).toBe("fixture-secure-key");
    expect(
      setItem.mock.calls.every(
        ([key, value]) =>
          key === "inkwell-agent-config-v1:/other" && JSON.parse(value).model === "other-model",
      ),
    ).toBe(true);
  });

  it("reports storage errors without lighting the saved indicator and recovers on the next edit", async () => {
    let agent = await settleAgent("/project");
    setItem.mockImplementation(() => {
      throw new Error("Storage full");
    });
    agent.setConfig({ ...agent.config, model: "failed-model" });
    agent = await settleAgent("/project");
    expect(agent.settingsSaved).toBe(false);
    expect(agent.settingsSaveError).toContain("Storage full");
    expect(agent.error).toContain("Storage full");
    setItem.mockImplementation((key, value) => {
      storage.set(key, value);
    });
    agent.setConfig({ ...agent.config, model: "recovered-model" });
    agent = await settleAgent("/project");
    expect(agent.settingsSaved).toBe(true);
    expect(agent.settingsSaveError).toBeNull();
  });

  it("saves settings without a project and uses them as defaults for a new project", async () => {
    let agent = await settleAgent();
    agent.setConfig({ ...agent.config, model: "default-model" });
    agent = await settleAgent();
    expect(agent.settingsSaved).toBe(true);
    expect(JSON.parse(storage.get("inkwell-agent-config-v1:") ?? "null").model).toBe(
      "default-model",
    );
    agent = await settleAgent("/new-project");
    expect(agent.config.model).toBe("default-model");
  });

  it("restores the saved credential after reopening the app", async () => {
    const scope = apiKeyScope(DEFAULT_ACADEMIC_CONFIG);
    credentials.set(scope, "fixture-restart-key");
    const agent = await settleAgent("/project");
    expect(agent.apiKey).toBe("fixture-restart-key");
    expect(writeAgentApiKey).not.toHaveBeenCalled();
  });

  it("never carries a credential to another endpoint", async () => {
    let agent = await settleAgent("/project");
    agent.setApiKey("fixture-first-key");
    agent = await settleAgent("/project");
    agent.setConfig({ ...agent.config, baseUrl: "https://other.example/v1" });
    expect(renderAgent("/project").apiKey).toBe("");
    agent = await settleAgent("/project");
    expect(agent.apiKey).toBe("");
    expect(credentials.size).toBe(1);
  });

  it("overwrites a credential and ignores blank input instead of deleting it", async () => {
    let agent = await settleAgent("/project");
    agent.setApiKey("fixture-first-key");
    agent = await settleAgent("/project");
    agent.setApiKey("fixture-replacement-key");
    agent = await settleAgent("/project");
    agent.setApiKey("");
    agent = await settleAgent("/project");
    expect(agent.apiKey).toBe("fixture-replacement-key");
    expect(credentials.get(apiKeyScope(agent.config))).toBe("fixture-replacement-key");
  });

  it("reports credential failures without exposing the key or lighting the saved indicator", async () => {
    vi.mocked(writeAgentApiKey).mockRejectedValueOnce(new Error("fixture-secret-from-error"));
    let agent = await settleAgent("/project");
    agent.setApiKey("fixture-unsaved-key");
    agent = await settleAgent("/project");
    expect(agent.settingsSaved).toBe(false);
    expect(agent.settingsSaveError).toBe(agent.labels.keySaveFailed);
    expect(agent.error).not.toContain("fixture-secret-from-error");
    expect(credentials.size).toBe(0);
  });

  it("allows replacing a credential after a vault read failure", async () => {
    vi.mocked(readAgentApiKey).mockRejectedValueOnce(new Error("Vault locked"));
    let agent = await settleAgent("/project");
    expect(agent.settingsSaved).toBe(false);
    expect(agent.settingsSaveError).toBe(agent.labels.keyLoadFailed);
    agent.setApiKey("fixture-recovered-key");
    agent = await settleAgent("/project");
    expect(agent.settingsSaved).toBe(true);
    expect(credentials.get(apiKeyScope(agent.config))).toBe("fixture-recovered-key");
  });

  it("ignores a late credential read from a previous endpoint", async () => {
    let finishRead: ((value: string | null) => void) | undefined;
    vi.mocked(readAgentApiKey).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const agent = renderAgent("/project");
    await vi.waitFor(() => expect(finishRead).toBeDefined());
    agent.setConfig({ ...agent.config, baseUrl: "https://other.example/v1" });
    await settleAgent("/project");
    finishRead?.("fixture-wrong-endpoint-key");
    await Promise.resolve();
    const current = await settleAgent("/project");
    expect(current.apiKey).toBe("");
    expect(current.settingsSaved).toBe(true);
  });

  it("allows overwriting while credential loading is pending and ignores the stale read", async () => {
    let finishRead: ((value: string | null) => void) | undefined;
    vi.mocked(readAgentApiKey).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const agent = renderAgent("/project");
    await vi.waitFor(() => expect(finishRead).toBeDefined());
    agent.setApiKey("fixture-replacement-key");
    await settleAgent("/project");
    finishRead?.("fixture-old-key");
    await Promise.resolve();
    expect((await settleAgent("/project")).apiKey).toBe("fixture-replacement-key");
  });

  it("serializes overlapping replacements so the newest key wins", async () => {
    let finishWrite: (() => void) | undefined;
    vi.mocked(writeAgentApiKey).mockImplementationOnce(
      (scope, value) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            credentials.set(scope, value);
            resolve();
          };
        }),
    );
    let agent = await settleAgent("/project");
    agent.setApiKey("fixture-first-key");
    await vi.waitFor(() => expect(finishWrite).toBeDefined());
    agent = renderAgent("/project");
    agent.setApiKey("fixture-newest-key");
    finishWrite?.();
    agent = await settleAgent("/project");
    expect(agent.apiKey).toBe("fixture-newest-key");
    expect(credentials.get(apiKeyScope(agent.config))).toBe("fixture-newest-key");
    expect(writeAgentApiKey).toHaveBeenCalledTimes(2);
  });
});
