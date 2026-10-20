import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLayoutImage, parseLayoutPdf } from "@/features/settings";
import { DEFAULT_ACADEMIC_CONFIG } from "./academic-config";
import type { AcpEvent } from "./acp-client";
import { type AgentSelectionController, useAgentSelection } from "./use-agent-selection";
import { useExternalAgent } from "./use-external-agent";

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: new Map<number, unknown>(),
  effects: new Map<number, { dependencies: unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));
const transport = vi.hoisted(() => ({
  clients: [] as {
    sessionId: string | null;
    supportsImages: boolean;
    onEvent: (event: AcpEvent) => void;
    disconnect: ReturnType<typeof vi.fn>;
  }[],
  connect: vi.fn(),
  disconnect: vi.fn(),
  prompt: vi.fn(),
}));

const translations = vi.hoisted(() => ({ prefix: "" }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/features/settings", () => ({ parseLayoutImage: vi.fn(), parseLayoutPdf: vi.fn() }));
vi.mock("@/features/i18n", () => ({
  useI18n: () => {
    const prefix = translations.prefix;
    return { t: (key: string) => prefix + key };
  },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index)) hooks.slots.set(index, initial);
    return [
      hooks.slots.get(index),
      (next: unknown) => {
        const previous = hooks.slots.get(index);
        hooks.slots.set(
          index,
          typeof next === "function" ? Reflect.apply(next, undefined, [previous]) : next,
        );
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index)) hooks.slots.set(index, { current: initial });
    return hooks.slots.get(index);
  },
  useCallback(callback: unknown, dependencies: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots.get(index) as
      | { callback: unknown; dependencies: unknown[] }
      | undefined;
    if (
      !previous ||
      dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))
    ) {
      hooks.slots.set(index, { callback, dependencies });
      return callback;
    }
    return previous.callback;
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
vi.mock("./acp-client", () => ({
  sharedPrompt: vi.fn((_config: unknown, _skills: unknown, text: string) => text),
  AcpClient: class {
    sessionId: string | null = null;
    supportsImages = false;
    constructor(readonly onEvent: (event: AcpEvent) => void) {
      transport.clients.push(this);
    }
    async connect(...args: unknown[]) {
      await transport.connect(...args);
      this.sessionId = "session";
    }
    disconnect = vi.fn(async () => {
      this.sessionId = null;
      await transport.disconnect();
    });
    prompt = transport.prompt;
  },
}));

let selection: AgentSelectionController;
let directory: string | undefined;
let configReady = true;
let autoConfirm = true;
let config = { ...DEFAULT_ACADEMIC_CONFIG };
function render() {
  hooks.cursor = 0;
  const renderHook = useExternalAgent;
  const agent = renderHook({
    selection,
    directory,
    config,
    configReady,
    onPendingMessageSent: vi.fn(),
  });
  for (const effect of hooks.pending.splice(0)) effect();
  if (autoConfirm && agent.connectionConfirmation) agent.confirmConnection();
  return agent;
}
async function settle() {
  for (let step = 0; step < 3; step += 1) {
    await vi.runAllTimersAsync();
    render();
  }
  return render();
}

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.useFakeTimers();
  hooks.slots.clear();
  hooks.effects.clear();
  hooks.pending = [];
  transport.clients = [];
  translations.prefix = "";
  transport.connect.mockReset().mockResolvedValue(undefined);
  transport.disconnect.mockReset().mockResolvedValue(undefined);
  transport.prompt.mockReset().mockResolvedValue(undefined);
  selection = {
    selected: "codex",
    ready: true,
    launches: {},
    setSelected: vi.fn(),
    pendingSelection: null,
    confirmSelection: vi.fn(),
    cancelSelection: vi.fn(),
    saveLaunch: vi.fn(),
    error: null,
  };
  directory = "/project";
  configReady = true;
  autoConfirm = true;
  config = { ...DEFAULT_ACADEMIC_CONFIG };
});
afterEach(async () => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("external Agent lifecycle", () => {
  function renderSelection() {
    // Keep the real selection hook's state separate from the connection hook.
    for (let step = 0; step < 3; step += 1) {
      hooks.cursor = 10000;
      // biome-ignore lint/correctness/useHookAtTopLevel: This test harness explicitly renders the mocked hook slots.
      selection = useAgentSelection();
      for (const effect of hooks.pending.splice(0)) effect();
    }
    return selection;
  }

  it.each([
    "builtin",
    "codex",
  ] as const)("keeps the saved %s Agent and its connection when a switch is cancelled", async (original) => {
    const storage = new Map([
      ["inkwell-agent-selection-v1", JSON.stringify({ selected: original, launches: {} })],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    renderSelection();
    render();
    await settle();
    const connections = transport.connect.mock.calls.length;
    const disconnects = transport.disconnect.mock.calls.length;
    autoConfirm = false;
    selection.setSelected("claude");
    renderSelection();
    render();
    let agent = await settle();
    expect(selection.selected).toBe(original);
    expect(agent.confirmationAgent).toBe("claude");
    expect(agent.connectionConfirmation).toBe(true);
    expect(JSON.parse(storage.get("inkwell-agent-selection-v1") ?? "{}").selected).toBe(original);
    agent.cancelConnection();
    renderSelection();
    render();
    agent = await settle();
    expect(selection.selected).toBe(original);
    expect(selection.pendingSelection).toBeNull();
    expect(agent.connectionConfirmation).toBe(false);
    expect(transport.connect).toHaveBeenCalledTimes(connections);
    expect(transport.disconnect).toHaveBeenCalledTimes(disconnects);
    expect(JSON.parse(storage.get("inkwell-agent-selection-v1") ?? "{}").selected).toBe(original);
  });

  it("saves and connects the chosen Agent only after confirmation, without a second prompt", async () => {
    const write = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: write });
    autoConfirm = false;
    renderSelection();
    render();
    await settle();
    selection.setSelected("claude");
    renderSelection();
    render();
    (await settle()).confirmConnection();
    renderSelection();
    render();
    const agent = await settle();
    expect(selection.selected).toBe("claude");
    expect(selection.pendingSelection).toBeNull();
    expect(agent.connectionConfirmation).toBe(false);
    expect(agent.connected).toBe(true);
    expect(transport.connect).toHaveBeenCalledExactlyOnceWith("claude", "/project", undefined);
    expect(write).toHaveBeenLastCalledWith(
      "inkwell-agent-selection-v1",
      JSON.stringify({ selected: "claude", launches: {} }),
    );
  });

  it("does not launch ACP until the user confirms, preserving their draft", async () => {
    autoConfirm = false;
    render();
    let agent = await settle();
    expect(agent.connectionConfirmation).toBe(true);
    expect(transport.clients).toHaveLength(0);
    expect(transport.connect).not.toHaveBeenCalled();
    agent.setInput("Keep my draft");
    agent.confirmConnection();
    agent = await settle();
    expect(agent.connected).toBe(true);
    expect(agent.input).toBe("Keep my draft");
    expect(agent.connectionConfirmation).toBe(false);
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });

  it("stays disconnected after cancellation and lets the user reopen confirmation", async () => {
    autoConfirm = false;
    render();
    (await settle()).cancelConnection();
    let agent = await settle();
    expect(agent.connectionConfirmation).toBe(false);
    expect(transport.connect).not.toHaveBeenCalled();
    await agent.connect();
    agent = render();
    expect(agent.connectionConfirmation).toBe(true);
    agent.confirmConnection();
    expect((await settle()).connected).toBe(true);
  });

  it("remembers consent across projects and permission changes but asks for a different executable", async () => {
    render();
    await settle();
    autoConfirm = false;
    directory = "/other-project";
    render();
    let agent = await settle();
    expect(agent.connectionConfirmation).toBe(false);
    expect(transport.connect).toHaveBeenCalledTimes(2);
    selection = { ...selection, launches: { codex: { command: "/custom/codex", args: [] } } };
    render();
    agent = await settle();
    expect(agent.connectionConfirmation).toBe(true);
    expect(transport.connect).toHaveBeenCalledTimes(2);
    const staleApproval = agent.confirmConnection;
    config = { ...config, permissionMode: "auto" };
    render();
    staleApproval();
    agent = await settle();
    expect(agent.connectionConfirmation).toBe(true);
    expect(transport.connect).toHaveBeenCalledTimes(2);
  });

  it("reuses consent after the connection hook is remounted", async () => {
    render();
    await settle();
    for (const effect of hooks.effects.values()) effect.cleanup?.();
    await Promise.resolve();
    hooks.slots.clear();
    hooks.effects.clear();
    hooks.pending = [];
    autoConfirm = false;
    render();
    const agent = await settle();
    expect(agent.connectionConfirmation).toBe(false);
    expect(agent.connected).toBe(true);
    expect(transport.connect).toHaveBeenCalledTimes(2);
  });

  it("switches back to a previously approved Agent without showing the connection dialog", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    renderSelection();
    selection.setSelected("codex");
    renderSelection();
    render();
    let agent = await settle();
    agent.confirmConnection();
    renderSelection();
    render();
    await settle();
    selection.setSelected("builtin");
    renderSelection();
    render();
    await settle();
    autoConfirm = false;
    selection.setSelected("codex");
    renderSelection();
    expect(selection.pendingSelection).toBeNull();
    expect(selection.selected).toBe("codex");
    render();
    agent = await settle();
    expect(agent.connectionConfirmation).toBe(false);
    expect(agent.connected).toBe(true);
  });

  it("sends parsed PDF reference content to text-only ACP agents", async () => {
    vi.mocked(invoke).mockImplementation(async (command) =>
      command === "read_chat_pdf" ? [37, 80, 68, 70] : { skills: [] },
    );
    vi.mocked(parseLayoutPdf).mockResolvedValue("Paper results: accuracy 92%");
    render();
    await settle();
    expect(await render().send('Read @file:"paper.pdf"')).toBe(true);
    expect(transport.prompt).toHaveBeenCalledWith(
      expect.stringContaining("Paper results: accuracy 92%"),
      [],
    );
  });
  it("sends selected snapshots without reading the source file and clears the original draft", async () => {
    render();
    await settle();
    render().setInput("Polish this");
    const selection = {
      id: "selection-1",
      path: "intro.tex",
      text: "An unsaved selected sentence.",
      startLineNumber: 5,
      startColumn: 2,
      endLineNumber: 5,
      endColumn: 31,
    };
    vi.mocked(invoke).mockClear();
    expect(await render().send("Polish this", [], [selection])).toBe(true);
    expect(transport.prompt).toHaveBeenCalledWith(expect.stringContaining(selection.text), []);
    expect(transport.prompt).toHaveBeenCalledWith(
      expect.stringContaining('"intro.tex":5:2-5:31'),
      [],
    );
    expect(render().input).toBe("");
    expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "read_file")).toBe(false);
  });
  it("restores only the original draft after a failed send with excerpts", async () => {
    render();
    await settle();
    transport.prompt.mockRejectedValueOnce(new Error("Prompt failed"));
    render().setInput("Polish this");
    expect(
      await render().send(
        "Polish this",
        [],
        [
          {
            id: "selection-1",
            path: "intro.tex",
            text: "Selected sentence.",
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 19,
          },
        ],
      ),
    ).toBe(false);
    expect(render().input).toBe("Polish this");
  });
  it("does not prompt ACP when a referenced PDF cannot be parsed", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "read_chat_pdf") throw new Error("PDF is outside project directory");
      return { skills: [] };
    });
    render();
    await settle();
    expect(await render().send('Read @file:"paper.pdf"')).toBe(false);
    expect(transport.prompt).not.toHaveBeenCalled();
    expect(render().error).toContain("outside project");
  });
  it("window close waits for the pending conversation snapshot to be persisted", async () => {
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    const write = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => "[]", setItem: write });
    render();
    await settle();
    await render().send("Save before closing");
    render();
    const tasks: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent("inkwell-before-close", { detail: tasks }));
    await Promise.all(tasks);
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining("inkwell-external-chat-v1:"),
      expect.stringContaining("Save before closing"),
    );
  });
  it("keeps image-capable ACP sessions on their native image path", async () => {
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    vi.mocked(parseLayoutImage).mockClear();
    render();
    await settle();
    const client = transport.clients.at(-1);
    if (!client) throw new Error("Missing client");
    client.supportsImages = true;
    const image = { name: "figure.png", mimeType: "image/png", data: "eA==" };
    expect(await render().send("Read image", [image])).toBe(true);
    expect(transport.prompt).toHaveBeenCalledWith("Read image", [image]);
    expect(parseLayoutImage).not.toHaveBeenCalled();
  });
  it("routes images to the parser when ACP does not declare native image support", async () => {
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    vi.mocked(parseLayoutImage).mockResolvedValue("Figure labels: Method A, Method B");
    render();
    await settle();
    const image = { name: "figure.png", mimeType: "image/png", data: "eA==" };
    expect(await render().send("Compare the figure", [image])).toBe(true);
    expect(transport.prompt).toHaveBeenCalledWith(
      expect.stringContaining("Figure labels: Method A"),
      [],
    );
    expect(transport.prompt).toHaveBeenCalledWith(expect.stringContaining("UNTRUSTED"), []);
  });
  it("retains the draft and never prompts ACP when image parsing fails", async () => {
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    vi.mocked(parseLayoutImage).mockRejectedValue(new Error("Parser HTTP 401"));
    render();
    await settle();
    expect(
      await render().send("Read my image", [
        { name: "figure.png", mimeType: "image/png", data: "eA==" },
      ]),
    ).toBe(false);
    expect(transport.prompt).not.toHaveBeenCalled();
    expect(render().input).toBe("Read my image");
    expect(render().error).toContain("401");
    expect(render().working).toBe(false);
  });
  it("does not reconnect an old project after switching during history restoration", async () => {
    const record = {
      id: "old-project",
      title: "Old project",
      modified: "2026-10-16",
      messages: [{ id: "old", role: "user", content: "Old project text" }],
    };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify([record]), setItem: vi.fn() });
    render();
    await settle();
    let finishStop: () => void = () => {};
    transport.disconnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    expect(await render().restoreHistory(record.id)).toBe(true);
    directory = "/new-project";
    render();
    finishStop();
    await settle();
    expect(render().messages).toEqual([]);
    expect(transport.connect).toHaveBeenCalledTimes(2);
    expect(transport.connect.mock.calls.at(-1)?.[1]).toBe("/new-project");
  });
  it("opens messages without waiting for disconnect and keeps the next draft", async () => {
    const record = {
      id: "instant",
      title: "Instant",
      modified: "2026-10-16",
      messages: [{ id: "old", role: "user", content: "Previous question" }],
    };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify([record]), setItem: vi.fn() });
    render();
    await settle();
    let finishStop: () => void = () => {};
    transport.disconnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );
    const opened = render().restoreHistory(record.id);
    expect(await opened).toBe(true);
    expect(render().messages).toEqual(record.messages);
    expect(render().working).toBe(true);
    expect(render().connected).toBe(false);
    expect(transport.connect).toHaveBeenCalledTimes(1);
    render().setInput("Next draft");
    finishStop();
    await settle();
    expect(render().connected).toBe(true);
    expect(render().input).toBe("Next draft");
    expect(transport.connect).toHaveBeenCalledTimes(2);
    expect(await render().restoreHistory(record.id)).toBe(true);
    expect(transport.connect).toHaveBeenCalledTimes(2);
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });
  it("opens saved history during automatic connection and continues with its context", async () => {
    const record = {
      id: "previous-session",
      title: "Previous paper discussion",
      modified: "2026-10-16T00:00:00Z",
      messages: [
        { id: "previous-user", role: "user", content: "Remember the baseline" },
        { id: "previous-assistant", role: "assistant", content: "Baseline noted" },
      ],
    };
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify([record]),
      setItem: vi.fn(),
    });
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    let finishInitialConnection: () => void = () => {};
    transport.connect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishInitialConnection = resolve;
        }),
    );
    render();
    await settle();
    expect(render().working).toBe(true);
    expect(render().connected).toBe(false);
    expect(await render().restoreHistory(record.id)).toBe(true);
    await settle();
    expect(render().connected).toBe(true);
    expect(render().messages).toEqual(record.messages);
    finishInitialConnection();
    await settle();
    expect(await render().send("Continue the comparison")).toBe(true);
    expect(transport.prompt).toHaveBeenLastCalledWith(
      expect.stringContaining("Remember the baseline"),
      [],
    );
    expect(transport.prompt).toHaveBeenLastCalledWith(
      expect.stringContaining("Continue the comparison"),
      [],
    );
  });

  it("keeps a failed history connection readable and allows reconnecting", async () => {
    const record = {
      id: "saved-session",
      title: "Saved",
      modified: "2026-10-16T00:00:00Z",
      messages: [{ id: "saved-user", role: "user", content: "Saved question" }],
    };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify([record]), setItem: vi.fn() });
    render();
    await settle();
    transport.connect.mockRejectedValueOnce(new Error("Connection unavailable"));
    expect(await render().restoreHistory(record.id)).toBe(true);
    await settle();
    expect(render().messages).toEqual(record.messages);
    expect(render().connected).toBe(false);
    expect(render().error).toContain("Connection unavailable");
    await render().connect();
    expect(render().connected).toBe(true);
    expect(render().messages).toEqual(record.messages);
    expect(await render().restoreHistory("missing-record")).toBe(false);
  });

  it("clears a sent draft immediately and preserves the next draft after the reply", async () => {
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    render();
    await settle();
    let finish: () => void = () => {};
    transport.prompt.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render().setInput("First message");
    const sent = render().send();
    expect(render().input).toBe("");
    expect(render().working).toBe(true);
    await vi.waitFor(() => expect(transport.prompt).toHaveBeenCalledTimes(1));
    render().setInput("Next message");
    finish();
    expect(await sent).toBe(true);
    expect(render().input).toBe("Next message");
    expect(render().working).toBe(false);
  });

  it.each(["", "Next draft"])("preserves the current draft on send failure: %s", async (draft) => {
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    render();
    await settle();
    let fail: (error: Error) => void = () => {};
    transport.prompt.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    render().setInput("Failed message");
    const sent = render().send();
    expect(render().input).toBe("");
    await vi.waitFor(() => expect(transport.prompt).toHaveBeenCalledTimes(1));
    render().setInput(draft);
    fail(new Error("Request failed"));
    expect(await sent).toBe(false);
    expect(render().input).toBe(draft || "Failed message");
    expect(render().working).toBe(false);
  });

  it("saves and restores project-scoped conversation text", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.mocked(invoke).mockResolvedValue({ skills: [] });
    render();
    await settle();
    await render().send("Discuss this paper");
    render();
    const agent = await settle();
    expect(agent.history).toHaveLength(1);
    expect(agent.history[0]?.title).toBe("Discuss this paper");
    const id = agent.history[0]?.id;
    if (!id) throw new Error("Missing saved conversation");
    await agent.restoreHistory(id);
    expect(render().messages[0]?.content).toBe("Discuss this paper");
    directory = "/other";
    render();
    expect((await settle()).history).toEqual([]);
  });
  it("waits for the project's saved permission configuration", async () => {
    configReady = false;
    render();
    await settle();
    expect(transport.connect).not.toHaveBeenCalled();
    configReady = true;
    render();
    expect((await settle()).connected).toBe(true);
  });

  it("automatically connects a restored selection exactly once", async () => {
    render();
    expect((await settle()).connected).toBe(true);
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledExactlyOnceWith("codex", "/project", undefined);
  });

  it("waits for selection hydration and a project, ignoring the built-in backend", async () => {
    selection.ready = false;
    render();
    await settle();
    selection.ready = true;
    directory = undefined;
    render();
    await settle();
    directory = "/project";
    selection.selected = "builtin";
    render();
    await settle();
    expect(transport.connect).not.toHaveBeenCalled();
    selection.selected = "codex";
    render();
    expect((await settle()).connected).toBe(true);
  });

  it("waits for the old process to stop before switching agents", async () => {
    render();
    await settle();
    let release: (() => void) | undefined;
    transport.disconnect.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    selection.selected = "claude";
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledTimes(1);
    release?.();
    await settle();
    expect(transport.connect).toHaveBeenLastCalledWith("claude", "/project", undefined);
    expect(render().connected).toBe(true);
  });

  it("reconnects on permission, project and launch changes", async () => {
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledTimes(1);
    config = { ...config, permissionMode: "auto" };
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledTimes(2);
    directory = "/other";
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledTimes(3);
    selection.launches = { codex: { command: "/bin/codex-acp", args: [] } };
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledTimes(4);
    expect(transport.disconnect).toHaveBeenCalledTimes(3);
  });

  it("uses current translations without changing the connection lifecycle", async () => {
    render();
    const agent = await settle();
    const client = transport.clients[0];
    if (!client) throw new Error("Missing connected ACP client");
    client.onEvent({ type: "image_error" });
    expect(render().error).toBe("interface.generatedImageSaveError");

    translations.prefix = "ko:";
    render();
    await settle();
    client.onEvent({ type: "image_error" });
    expect(render().error).toBe("ko:interface.generatedImageSaveError");
    expect(render().connect).toBe(agent.connect);
    expect(transport.connect).toHaveBeenCalledTimes(1);
    expect(transport.disconnect).not.toHaveBeenCalled();
  });

  it("does not retry a failed connection until explicitly requested", async () => {
    transport.connect.mockRejectedValueOnce(new Error("Adapter missing"));
    render();
    expect((await settle()).error).toContain("Adapter missing");
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledTimes(1);
    await render().connect();
    expect(render().connected).toBe(true);
  });

  it("cancels the mount attempt before a Strict Mode remount", async () => {
    render();
    for (const effect of hooks.effects.values()) effect.cleanup?.();
    hooks.effects.clear();
    render();
    await settle();
    expect(transport.connect).toHaveBeenCalledTimes(1);
  });
});
