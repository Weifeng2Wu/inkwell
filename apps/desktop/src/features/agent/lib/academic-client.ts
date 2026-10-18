import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ModelCapabilities } from "../../../../../../packages/academic-agent/src/model-capabilities.mjs";

export type { ModelCapabilities } from "../../../../../../packages/academic-agent/src/model-capabilities.mjs";
export type ModelDiscoveryResult = {
  models: string[];
  capabilities?: Record<string, ModelCapabilities>;
};

export type SkillMetadata = {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  stars?: number;
};
export type MarketSkill = SkillMetadata & {
  instructions?: string;
  installed: boolean;
  managed: boolean;
};
export type AgentCatalog = { skills: SkillMetadata[]; market: MarketSkill[]; updateError?: string };
export type GeneratedImage = {
  path: string;
  relativePath: string;
  mimeType: string;
  src?: string;
};
export type AcademicMessage = {
  role: "user" | "assistant";
  content: string;
  generatedImages?: GeneratedImage[];
};
export type ConversationSummary = {
  key: string;
  sessionId: string;
  title: string;
  created: string;
  modified: string;
  messageCount: number;
};
export type ConversationPreview = ConversationSummary & {
  messages: (AcademicMessage & { id: string })[];
};
export type AcademicConfig = {
  provider: string;
  protocol: "" | "openai" | "anthropic" | "gemini";
  baseUrl: string;
  model: string;
  modelCapabilities?: Record<string, ModelCapabilities>;
  imageGeneration: { baseUrl: string; model: string };
  webSearch: { baseUrl: string };
  personalPrompt: string;
  answerLanguage: "zh" | "en" | "ko";
  skillIds: string[];
  permissionMode: "restricted" | "ask" | "auto";
};
export type ApiKeyConfig = Pick<AcademicConfig, "protocol" | "provider" | "baseUrl"> & {
  model?: string;
};
export type SessionResult = {
  sessionId: string;
  messages: AcademicMessage[];
  tools: string[];
  supportsImages?: boolean;
  supportsWebSearch?: boolean;
};
export type EditPermission = {
  id: string;
  kind?: "python";
  path: string;
  before: string | null;
  after: string;
};
export type AcademicEvent =
  | { type: "response"; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: "text_delta"; turnId: string; text: string }
  | ({ type: "permission_request" } & EditPermission)
  | { type: "permission_resolved"; id: string }
  | { type: "tool_start" | "tool_end"; tool: string; callId: string; isError?: boolean }
  | { type: "image_generated"; path: string; relativePath: string; mimeType: string }
  | { type: "status"; status: string }
  | { type: "fatal"; error: string }
  | { type: "exit" }
  | { type: "ready"; protocolVersion: number };
type Envelope = { runtimeId: string; event: AcademicEvent };
type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class AcademicClient {
  private runtimeId: string | null = null;
  private unlisten: UnlistenFn | null = null;
  private pending = new Map<string, Pending>();
  private disposed = false;

  constructor(private onEvent: (event: AcademicEvent) => void) {}

  async connect(): Promise<AgentCatalog> {
    if (this.disposed || this.runtimeId || this.unlisten)
      throw new Error("Disconnect before reconnecting the runtime.");
    const earlyEvents: Envelope[] = [];
    this.unlisten = await listen<Envelope>("academic-agent-event", ({ payload }) => {
      if (!this.runtimeId) earlyEvents.push(payload);
      else if (payload.runtimeId === this.runtimeId) this.receive(payload.event);
    });
    try {
      if (this.disposed) throw new Error("Runtime connection was cancelled.");
      const runtimeId = await invoke<string>("academic_agent_start");
      if (this.disposed) {
        await invoke("academic_agent_stop", { runtimeId });
        throw new Error("Runtime connection was cancelled.");
      }
      this.runtimeId = runtimeId;
      for (const payload of earlyEvents)
        if (payload.runtimeId === runtimeId) {
          this.receive(payload.event);
          if (payload.event.type === "fatal") throw new Error(payload.event.error);
          if (payload.event.type === "exit")
            throw new Error("Runtime disconnected before becoming ready.");
        }
      return await this.request<AgentCatalog>("catalog");
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  private receive(event: AcademicEvent) {
    if (event.type === "response") {
      const pending = this.pending.get(event.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(event.id);
        if (event.ok) pending.resolve(event.result);
        else pending.reject(new Error(event.error ?? "Runtime command failed."));
      }
    } else if (event.type === "fatal" || event.type === "exit") {
      this.rejectPending(
        new Error(
          event.type === "fatal" ? event.error : "Runtime disconnected. Reconnect to resume.",
        ),
      );
      void this.disconnect();
    }
    this.onEvent(event);
  }

  request<Result>(type: string, payload: Record<string, unknown> = {}): Promise<Result> {
    const runtimeId = this.runtimeId;
    if (!runtimeId || this.disposed) return Promise.reject(new Error("Runtime is not connected."));
    const id = crypto.randomUUID();
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          const message =
            "Runtime request timed out. The process was stopped; reconnect and review the saved session before retrying.";
          reject(new Error(message));
          this.receive({ type: "fatal", error: message });
        },
        type === "prompt"
          ? 600_000
          : type === "format_skill_generate"
            ? 185_000
            : type === "git_commit"
              ? 95_000
              : 60_000,
      );
      this.pending.set(id, { resolve: (value) => resolve(value as Result), reject, timer });
      void invoke("academic_agent_command", { runtimeId, request: { ...payload, type, id } }).catch(
        (error: unknown) => {
          if (!this.pending.has(id)) return;
          clearTimeout(timer);
          this.pending.delete(id);
          const failure = error instanceof Error ? error : new Error(String(error));
          reject(failure);
          this.receive({ type: "fatal", error: failure.message });
        },
      );
    });
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async disconnect() {
    this.disposed = true;
    this.rejectPending(new Error("Runtime connection closed."));
    this.unlisten?.();
    this.unlisten = null;
    const runtimeId = this.runtimeId;
    this.runtimeId = null;
    if (runtimeId) await invoke("academic_agent_stop", { runtimeId }).catch(() => {});
  }
}
