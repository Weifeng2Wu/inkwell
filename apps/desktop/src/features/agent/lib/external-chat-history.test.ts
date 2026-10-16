import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chatHistoryKey,
  listChatHistory,
  loadChatRecord,
  readChatHistory,
  saveChatRecord,
} from "./external-chat-history";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());
describe("external conversation storage", () => {
  it("isolates projects and providers without ambiguous key separators", () => {
    expect(chatHistoryKey("/project", "codex")).not.toBe(chatHistoryKey("/other", "codex"));
    expect(chatHistoryKey("/project", "codex")).not.toBe(chatHistoryKey("/project", "claude"));
  });
  it("loads valid text conversations and filters malformed records", () => {
    const record = {
      id: "chat",
      title: "Paper",
      modified: "2026-10-16",
      messages: [{ id: "1", role: "user", content: "Hello" }],
    };
    vi.stubGlobal("localStorage", {
      getItem: () =>
        JSON.stringify([record, { ...record, messages: [{ role: "system", content: "ignore" }] }]),
    });
    expect(readChatHistory("key")).toEqual([record]);
  });
  it("surfaces corrupt storage rather than silently overwriting it", () => {
    vi.stubGlobal("localStorage", { getItem: () => "invalid JSON" });
    expect(() => readChatHistory("key")).toThrow();
  });
  it("desktop lists metadata and fetches bodies only for the opened conversation", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const readBrowser = vi.fn(() => {
      throw new Error("Desktop must not read browser history");
    });
    vi.stubGlobal("localStorage", { getItem: readBrowser });
    const summary = {
      id: "saved",
      title: "Paper",
      modified: "2026-10-17",
      messages: [],
      messageCount: 12,
    };
    vi.mocked(invoke)
      .mockResolvedValueOnce([summary])
      .mockResolvedValueOnce({
        ...summary,
        messages: [{ id: "message", role: "user", content: "Hello" }],
      });
    const key = chatHistoryKey("/project", "codex");
    expect(await listChatHistory(key)).toEqual([summary]);
    expect(invoke).toHaveBeenLastCalledWith("app_storage_request", {
      request: {
        type: "conversation_list",
        scope: JSON.stringify(["/project", "codex"]),
        offset: 0,
        limit: 200,
      },
    });
    expect((await loadChatRecord(key, "saved")).messages).toHaveLength(1);
    expect(readBrowser).not.toHaveBeenCalled();
  });
  it("desktop saves one conversation rather than rewriting all histories", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.mocked(invoke).mockResolvedValueOnce({ ok: true });
    const record = { id: "saved", title: "Paper", modified: "2026-10-17", messages: [] };
    await saveChatRecord(chatHistoryKey("/project", "claude"), record);
    expect(invoke).toHaveBeenLastCalledWith("app_storage_request", {
      request: { type: "conversation_save", scope: JSON.stringify(["/project", "claude"]), record },
    });
  });
});
