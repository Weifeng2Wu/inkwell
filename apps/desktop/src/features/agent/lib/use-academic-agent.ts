"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import {
  AcademicClient,
  type AcademicConfig,
  type AcademicMessage,
  type AgentCatalog,
  type ConversationPreview,
  type ConversationSummary,
  type EditPermission,
  type MarketSkill,
  type SessionResult,
  type SkillMetadata,
} from "./academic-client";
import { readConfig } from "./academic-config";
import { academicLabels } from "./academic-labels";
import type { ChatImage } from "./chat-input";
import { prepareChatVision } from "./chat-vision";
import { useAgentApiKey } from "./use-agent-api-key";

type DisplayMessage = AcademicMessage & { id: string };
function displayMessages(messages: AcademicMessage[]): DisplayMessage[] {
  return messages.map((message) => ({ ...message, id: crypto.randomUUID() }));
}

export function useAcademicAgent({
  directory,
  pendingMessage,
  onPendingMessageSent,
  enabled = true,
  beforeTurn,
  afterTurn,
}: {
  directory?: string;
  pendingMessage?: string | null;
  onPendingMessageSent?: () => void;
  enabled?: boolean;
  beforeTurn?: () => Promise<void>;
  afterTurn?: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const labels = academicLabels[locale];
  const storageKey = `inkwell-agent-config-v1:${directory ?? ""}`;
  const [config, setConfig] = useState(() => readConfig(storageKey));
  const [persistedConfig, setPersistedConfig] = useState<string | null>(null);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const [loadedDirectory, setLoadedDirectory] = useState(directory);
  const { apiKey, setApiKey, apiKeyLoading, apiKeySaved, apiKeyError } = useAgentApiKey(config);
  const settingsSaveError =
    configSaveError ??
    (!enabled
      ? null
      : apiKeyError === "load"
        ? labels.keyLoadFailed
        : apiKeyError === "save"
          ? labels.keySaveFailed
          : null);
  const [catalog, setCatalog] = useState<SkillMetadata[]>([]);
  const [market, setMarket] = useState<MarketSkill[]>([]);
  const [connectionTest, setConnectionTest] = useState<{
    configuration: string;
    milliseconds: number;
  } | null>(null);
  const utilityOperation = useRef<symbol | null>(null);
  const [connected, setConnected] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyPreview, setHistoryPreview] = useState<ConversationPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [session, setSession] = useState<SessionResult | null>(null);
  const [configured, setConfigured] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [permissions, setPermissions] = useState<EditPermission[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState("");
  const clientRef = useRef<AcademicClient | null>(null);
  const receivedPending = useRef<string | null>(null);
  const streamingId = useRef<string | null>(null);
  const visionAbort = useRef<AbortController | null>(null);
  const lifecycle = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const configuration = JSON.stringify({ ...config, apiKey });
  const dirty = configured !== configuration;
  const settingsSaved =
    loadedDirectory === directory &&
    persistedConfig === JSON.stringify(config) &&
    (!enabled || apiKeySaved) &&
    !settingsSaveError;

  useEffect(() => {
    const storedConfig = readConfig(storageKey);
    setConfig(storedConfig);
    setPersistedConfig(null);
    setConfigSaveError(null);
    setLoadedDirectory(directory);
    setCatalog([]);
    setMarket([]);
    setConnectionTest(null);
    utilityOperation.current = null;
    setConnected(false);
    setConversations([]);
    setHistoryPreview(null);
    setWorking(false);
    setSession(null);
    setConfigured("");
    setMessages([]);
    setPermissions([]);
    setInput("");
    setError(null);
    setActivity("");
    receivedPending.current = null;
    streamingId.current = null;
    return () => {
      visionAbort.current?.abort();
      lifecycle.current += 1;
      const client = clientRef.current;
      clientRef.current = null;
      void client?.disconnect();
    };
  }, [directory, storageKey]);

  useEffect(() => {
    setConnected(false);
    setSession(null);
    setWorking(false);
    setPermissions([]);
    if (!enabled) {
      visionAbort.current?.abort();
      lifecycle.current += 1;
      const client = clientRef.current;
      clientRef.current = null;
      void client?.disconnect();
    }
  }, [enabled]);

  useEffect(() => {
    if (loadedDirectory !== directory) return;
    try {
      const serialized = JSON.stringify(config);
      localStorage.setItem(storageKey, serialized);
      setPersistedConfig(serialized);
      setConfigSaveError(null);
    } catch (caught) {
      setConfigSaveError(String(caught));
    }
  }, [config, directory, loadedDirectory, storageKey]);

  useEffect(() => {
    if (!enabled || !pendingMessage) {
      receivedPending.current = null;
      return;
    }
    if (receivedPending.current === pendingMessage) return;
    receivedPending.current = pendingMessage;
    setInput((current) => (current ? `${current}\n\n${pendingMessage}` : pendingMessage));
    onPendingMessageSent?.();
  }, [enabled, pendingMessage, onPendingMessageSent]);

  async function connect() {
    if (!directory || working) return;
    if (!enabledRef.current) {
      setWorking(true);
      setError(null);
      try {
        const result = await invoke<AgentCatalog>("agent_shared_skills", {
          request: { type: "catalog" },
        });
        setCatalog(result.skills);
        setMarket(result.market);
        setConnected(true);
      } catch (caught) {
        setError(String(caught));
      } finally {
        setWorking(false);
      }
      return;
    }
    setWorking(true);
    setError(null);
    const generation = lifecycle.current;
    await clientRef.current?.disconnect();
    if (generation !== lifecycle.current) return;
    const client = new AcademicClient((event) => {
      if (clientRef.current !== client) return;
      if (event.type === "text_delta") {
        setMessages((current) =>
          current.map((message) =>
            message.id === streamingId.current
              ? { ...message, content: message.content + event.text }
              : message,
          ),
        );
      } else if (event.type === "permission_request") {
        setPermissions((current) => [...current, event]);
      } else if (event.type === "permission_resolved") {
        setPermissions((current) => current.filter((permission) => permission.id !== event.id));
      } else if (event.type === "tool_start" || event.type === "tool_end") {
        setActivity(`${event.tool}${event.isError ? " · error" : ""}`);
      } else if (event.type === "status") setActivity(event.status);
      else if (event.type === "fatal" || event.type === "exit") {
        setConnected(false);
        setSession(null);
        setPermissions([]);
        setWorking(false);
        setError(event.type === "fatal" ? event.error : "Runtime disconnected.");
      }
    });
    clientRef.current = client;
    try {
      const { skills, market } = await client.connect();
      if (clientRef.current === client) {
        setCatalog(skills);
        setMarket(market);
        setConfig((current) => ({
          ...current,
          skillIds: current.skillIds.filter((identifier) =>
            skills.some((skill) => skill.id === identifier),
          ),
        }));
        setConnected(true);
        return client;
      }
    } catch (caught) {
      if (clientRef.current === client) setError(String(caught));
    } finally {
      if (clientRef.current === client) setWorking(false);
    }
  }

  async function requestOperation<Result>(
    type: string,
    payload: Record<string, unknown>,
    needsModel = true,
  ): Promise<Result> {
    if (["market_change", "skill_import", "skill_import_github", "skill_preview"].includes(type))
      return invoke<Result>("agent_shared_skills", {
        request: { ...payload, type: type === "market_change" ? "skill_install" : type },
      });
    if (!directory) throw new Error(labels.openProject);
    if (!enabledRef.current) {
      throw new Error("The built-in Agent is disabled while an external Agent is selected.");
    }
    if (needsModel || type === "test_connection" || type === "list_models") {
      if (apiKeyLoading) throw new Error(labels.keyLoading);
      if (apiKeyError === "load") throw new Error(labels.keyLoadFailed);
    }
    if (working || utilityOperation.current) throw new Error(labels.busy);
    if (needsModel && (!config.model.trim() || (!config.protocol && !config.provider.trim())))
      throw new Error(labels.configureModel);
    const operation = Symbol(type);
    utilityOperation.current = operation;
    let client: AcademicClient | null | undefined;
    try {
      client = clientRef.current ?? (await connect());
      if (!client || clientRef.current !== client || utilityOperation.current !== operation)
        throw new Error(labels.connectionFailed);
      setWorking(true);
      setError(null);
      const result = await client.request<Result>(type, payload);
      if (clientRef.current !== client) throw new Error(labels.connectionFailed);
      return result;
    } finally {
      if (utilityOperation.current === operation) {
        utilityOperation.current = null;
        if (client && clientRef.current === client) setWorking(false);
      }
    }
  }

  async function generateCommitMessage(text: string) {
    const result = await requestOperation<{ text: string }>("git_commit", {
      ...config,
      apiKey,
      text,
    });
    return result.text;
  }

  async function generateFormatSkill(text: string) {
    const result = await requestOperation<{ text: string }>("format_skill_generate", {
      ...config,
      apiKey,
      text,
    });
    return result.text;
  }

  async function testConnection(testConfig: AcademicConfig = config, testKey = apiKey) {
    setConnectionTest(null);
    const started = Date.now();
    try {
      await requestOperation("test_connection", { ...testConfig, apiKey: testKey }, false);
      setConnectionTest({
        configuration: JSON.stringify({ ...testConfig, apiKey: testKey }),
        milliseconds: Date.now() - started,
      });
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function fetchModels(modelConfig: AcademicConfig, modelKey: string) {
    return requestOperation<{ models: string[] }>(
      "list_models",
      { ...modelConfig, apiKey: modelKey },
      false,
    );
  }

  async function changeSkill(skillId: string, install: boolean) {
    try {
      const result = await requestOperation<AgentCatalog>(
        "market_change",
        { skillId, install },
        false,
      );
      setCatalog(result.skills);
      setMarket(result.market);
      setConfig((current) => ({
        ...current,
        skillIds: current.skillIds.filter((id) => result.skills.some((skill) => skill.id === id)),
      }));
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function refreshSkills() {
    try {
      const result = await invoke<AgentCatalog>("agent_shared_skills", {
        request: { type: "catalog" },
      });
      setCatalog(result.skills);
      setMarket(result.market);
      if (result.updateError) setError(result.updateError);
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function uploadSkill(mode: boolean | "zip") {
    try {
      setError(null);
      const { open } = await import("@tauri-apps/plugin-dialog");
      const sourcePath = await open({
        directory: mode === true,
        multiple: false,
        filters:
          mode === true
            ? undefined
            : [{ name: "Skill", extensions: [mode === "zip" ? "zip" : "md"] }],
      });
      if (!sourcePath || typeof sourcePath !== "string") return;
      const result = await requestOperation<AgentCatalog>("skill_import", { sourcePath }, false);
      setCatalog(result.skills);
      setMarket(result.market);
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function importGitHubSkill(url: string) {
    try {
      setError(null);
      const result = await requestOperation<AgentCatalog>(
        "skill_import_github",
        { url: url.trim() },
        false,
      );
      setCatalog(result.skills);
      setMarket(result.market);
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function previewSkill(skillId: string) {
    const result = await requestOperation<{ instructions: string }>(
      "skill_preview",
      { skillId },
      false,
    );
    return result.instructions;
  }

  async function loadHistory() {
    try {
      const result = await requestOperation<{ sessions: ConversationSummary[] }>(
        "history_list",
        {},
        false,
      );
      setConversations(result.sessions);
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function previewConversation(sessionKey: string) {
    setHistoryPreview(null);
    try {
      const result = await requestOperation<ConversationPreview>(
        "history_read",
        { sessionKey },
        false,
      );
      setHistoryPreview(result);
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function renameConversation(sessionKey: string, title: string) {
    try {
      const result = await requestOperation<{ sessions: ConversationSummary[] }>(
        "history_rename",
        { sessionKey, title },
        false,
      );
      setConversations(result.sessions);
      setHistoryPreview((current) =>
        current?.key === sessionKey ? { ...current, title: title.trim() } : current,
      );
      return true;
    } catch (caught) {
      setError(String(caught));
      return false;
    }
  }

  async function deleteConversation(sessionKey: string) {
    try {
      const result = await requestOperation<{
        sessions: ConversationSummary[];
        deletedCurrent: boolean;
      }>("history_delete", { sessionKey }, false);
      setConversations(result.sessions);
      setHistoryPreview((current) => (current?.key === sessionKey ? null : current));
      if (result.deletedCurrent) {
        setSession(null);
        setConfigured("");
        setMessages([]);
        setPermissions([]);
        setActivity("");
      }
      return true;
    } catch (caught) {
      setError(String(caught));
      return false;
    }
  }

  async function configure(resume: boolean, sessionKey?: string) {
    try {
      const result = await requestOperation<SessionResult>("configure", {
        ...config,
        apiKey,
        resume,
        ...(sessionKey ? { sessionKey } : {}),
      });
      setSession(result);
      setConfigured(configuration);
      setMessages(displayMessages(result.messages));
      setPermissions([]);
      setActivity("");
      setInput("");
      return true;
    } catch (caught) {
      setError(String(caught));
      return false;
    }
  }

  async function send(draft = input.trim(), images: ChatImage[] = []) {
    const client = clientRef.current;
    if (
      !enabledRef.current ||
      !client ||
      !session ||
      dirty ||
      working ||
      visionAbort.current ||
      !draft.trim()
    )
      return false;
    const text = draft.trim();
    const assistantId = crypto.randomUUID();
    streamingId.current = assistantId;
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: text },
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setInput("");
    setWorking(true);
    setError(null);
    const abort = new AbortController();
    visionAbort.current = abort;
    try {
      const prepared = await prepareChatVision(
        text,
        images,
        session.supportsImages === true,
        labels.visionConfigMissing,
        abort.signal,
      );
      if (clientRef.current !== client || !enabledRef.current)
        throw new Error("Agent session changed.");
      abort.signal.throwIfAborted();
      await beforeTurn?.();
      abort.signal.throwIfAborted();
      const result = await client.request<{ messages: AcademicMessage[] }>("prompt", {
        text: prepared.text,
        ...(prepared.images.length ? { images: prepared.images } : {}),
      });
      if (clientRef.current === client) setMessages(displayMessages(result.messages));
      return true;
    } catch (caught) {
      if (clientRef.current === client) setError(String(caught));
      if (clientRef.current === client) setInput((current) => current || text);
      return false;
    } finally {
      if (visionAbort.current === abort) visionAbort.current = null;
      await afterTurn?.().catch((caught: unknown) => setError(String(caught)));
      if (clientRef.current === client) {
        setWorking(false);
        setPermissions([]);
        streamingId.current = null;
      }
    }
  }

  async function permission(id: string, allow: boolean) {
    try {
      await clientRef.current?.request("permission", { permissionId: id, allow });
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function stop() {
    visionAbort.current?.abort();
    try {
      await clientRef.current?.request("abort");
    } catch (caught) {
      setError(String(caught));
    }
  }

  async function disconnect() {
    visionAbort.current?.abort();
    const client = clientRef.current;
    clientRef.current = null;
    await client?.disconnect();
    setConnected(false);
    setSession(null);
    setWorking(false);
    setPermissions([]);
  }

  return {
    labels,
    directory,
    config,
    configReady: loadedDirectory === directory,
    setConfig,
    apiKey,
    apiKeyLoading,
    settingsSaved,
    settingsSaveError,
    fetchModels,
    setApiKey,
    catalog,
    market,
    testConnection,
    changeSkill,
    refreshSkills,
    uploadSkill,
    importGitHubSkill,
    previewSkill,
    conversations,
    historyPreview,
    setHistoryPreview,
    loadHistory,
    previewConversation,
    renameConversation,
    deleteConversation,
    generateCommitMessage,
    generateFormatSkill,
    connectionTest:
      connectionTest?.configuration === JSON.stringify({ ...config, apiKey })
        ? connectionTest
        : null,
    connected,
    working,
    session,
    dirty,
    messages,
    permissions,
    input,
    setInput,
    error: error ?? settingsSaveError,
    activity,
    streaming: working && streamingId.current !== null,
    connect,
    disconnect,
    configure,
    send,
    permission,
    stop,
  };
}

export type AcademicAgentController = ReturnType<typeof useAcademicAgent>;
