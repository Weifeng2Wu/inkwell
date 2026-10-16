import { afterEach, describe, expect, it, vi } from "vitest";
import { chatHistoryKey, readChatHistory } from "./external-chat-history";

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
});
