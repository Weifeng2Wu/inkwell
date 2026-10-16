import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ACADEMIC_CONFIG } from "./academic-config";
import {
  AcpClient,
  authenticationMethods,
  automaticPermission,
  rpcErrorMessage,
  sharedPrompt,
} from "./acp-client";
import { EXTERNAL_AGENTS, isAgentSelection, parseLaunch } from "./external-agent-catalog";

const transport = vi.hoisted(() => ({
  listener: null as null | ((event: { payload: unknown }) => void),
  invoke: vi.fn(),
  unlisten: vi.fn(),
  readOnly: true,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: transport.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, listener: (event: { payload: unknown }) => void) => {
    transport.listener = listener;
    return transport.unlisten;
  }),
}));

function emit(message: unknown, runtimeId = "runtime") {
  transport.listener?.({ payload: { runtimeId, message } });
}

beforeEach(() => {
  transport.readOnly = true;
  transport.invoke
    .mockReset()
    .mockImplementation(async (name: string, args?: { message?: Record<string, unknown> }) => {
      if (name === "external_agent_start") return "runtime";
      const message = args?.message;
      if (
        name === "external_agent_send" &&
        message &&
        typeof message.id === "number" &&
        typeof message.method === "string"
      ) {
        const result =
          message.method === "initialize"
            ? { protocolVersion: 1 }
            : message.method === "session/new"
              ? {
                  sessionId: "session",
                  modes: { availableModes: transport.readOnly ? [{ id: "read-only" }] : [] },
                }
              : {};
        queueMicrotask(() => emit({ jsonrpc: "2.0", id: message.id, result }));
      }
    });
  transport.unlisten.mockClear();
});
afterEach(() => vi.useRealTimers());

function mockAuthentication(
  methods: unknown[],
  options: {
    errorCode?: number;
    rejectAuth?: boolean;
    stillRequired?: boolean;
    signedIn?: boolean;
  } = {},
) {
  const fallback = transport.invoke.getMockImplementation();
  let authenticated = options.signedIn ?? false;
  transport.invoke.mockImplementation(
    async (name: string, args?: { message?: Record<string, unknown> }) => {
      const message = args?.message;
      if (name !== "external_agent_send" || typeof message?.id !== "number")
        return fallback?.(name, args);
      const reply = (value: Record<string, unknown>) =>
        queueMicrotask(() => emit({ jsonrpc: "2.0", id: message.id, ...value }));
      if (message.method === "initialize") {
        reply({ result: { protocolVersion: 1, authMethods: methods } });
      } else if (message.method === "session/new" && (!authenticated || options.stillRequired)) {
        reply({ error: { code: options.errorCode ?? -32000, message: "Authentication required" } });
      } else if (message.method === "authenticate") {
        authenticated = !options.rejectAuth;
        reply(
          options.rejectAuth
            ? { error: { code: -32603, message: "Sign-in rejected" } }
            : { result: {} },
        );
      } else return fallback?.(name, args);
    },
  );
}

describe("ACP authentication", () => {
  it("preserves failing method, error code and adapter details", () => {
    expect(
      rpcErrorMessage("session/new", {
        code: -32603,
        message: "Internal error",
        data: { details: "Could not find default localharness binary." },
      }),
    ).toBe(
      "ACP session/new failed (-32603): Internal error\nCould not find default localharness binary.",
    );
  });
  it("redacts sensitive diagnostic values and limits error size", () => {
    const message = rpcErrorMessage("authenticate", {
      code: -32603,
      message: "Internal error",
      data: {
        details:
          "token=private-token api_key=private-key Bearer private-bearer https://example.com/?code=private-code " +
          "x".repeat(3000),
      },
    });
    for (const secret of ["private-token", "private-key", "private-bearer", "private-code"])
      expect(message).not.toContain(secret);
    expect(message.length).toBeLessThanOrEqual(2048);
  });
  const methods = [{ id: "google-login", name: "Sign in with Google" }];
  const requests = () =>
    transport.invoke.mock.calls
      .filter(([name]) => name === "external_agent_send")
      .map(([, args]) => args.message.method);

  it("uses an existing adapter login without prompting", async () => {
    mockAuthentication(methods, { signedIn: true });
    const choose = vi.fn();
    const client = new AcpClient(vi.fn(), () => "ask", choose);
    await client.connect("antigravity", "/project");
    expect(choose).not.toHaveBeenCalled();
    expect(requests()).not.toContain("authenticate");
    await client.disconnect();
  });

  it("offers advertised methods, authenticates on consent, then retries the session", async () => {
    mockAuthentication(methods);
    const choose = vi.fn(async () => "google-login");
    const client = new AcpClient(vi.fn(), () => "restricted", choose);
    await client.connect("antigravity", "/project");
    expect(choose).toHaveBeenCalledWith(methods, expect.any(AbortSignal));
    expect(requests()).toEqual([
      "initialize",
      "session/new",
      "authenticate",
      "session/new",
      "session/set_mode",
    ]);
    expect(transport.invoke).toHaveBeenCalledWith(
      "external_agent_send",
      expect.objectContaining({
        message: expect.objectContaining({
          method: "authenticate",
          params: { methodId: "google-login" },
        }),
      }),
    );
    expect(client.sessionId).toBe("session");
    await client.disconnect();
  });

  it("does not send credentials or retry after cancelled authentication", async () => {
    mockAuthentication(methods);
    const client = new AcpClient(
      vi.fn(),
      () => "ask",
      async () => null,
    );
    await expect(client.connect("antigravity", "/project")).rejects.toThrow("cancelled");
    expect(requests()).not.toContain("authenticate");
    expect(transport.invoke).toHaveBeenCalledWith("external_agent_stop", { runtimeId: "runtime" });
  });

  it("rejects unadvertised authentication methods", async () => {
    mockAuthentication(methods);
    const client = new AcpClient(
      vi.fn(),
      () => "ask",
      async () => "not-advertised",
    );
    await expect(client.connect("antigravity", "/project")).rejects.toThrow(
      "Invalid ACP authentication",
    );
    expect(requests()).not.toContain("authenticate");
  });

  it("does not authenticate terminal methods without terminal capabilities", async () => {
    const choose = vi.fn();
    mockAuthentication([{ id: "terminal", name: "CLI login", type: "terminal" }]);
    const client = new AcpClient(vi.fn(), () => "ask", choose);
    await expect(client.connect("antigravity", "/project")).rejects.toThrow(
      "no supported in-app sign-in",
    );
    expect(choose).not.toHaveBeenCalled();
    expect(
      authenticationMethods([
        null,
        {},
        { id: "future", name: "Future", type: "unknown" },
        ...methods,
      ]),
    ).toEqual(methods);
  });

  it("does not treat unrelated protocol errors as authentication failures", async () => {
    mockAuthentication(methods, { errorCode: -32603 });
    const choose = vi.fn();
    const client = new AcpClient(vi.fn(), () => "ask", choose);
    await expect(client.connect("antigravity", "/project")).rejects.toThrow(
      "Authentication required",
    );
    expect(choose).not.toHaveBeenCalled();
  });

  it("does not loop when the adapter rejects authentication or still requires it", async () => {
    for (const options of [{ rejectAuth: true }, { stillRequired: true }]) {
      transport.invoke.mockClear();
      mockAuthentication(methods, options);
      const client = new AcpClient(
        vi.fn(),
        () => "ask",
        async () => "google-login",
      );
      await expect(client.connect("antigravity", "/project")).rejects.toThrow(
        "rejectAuth" in options ? "Sign-in rejected" : "still requires authentication",
      );
      expect(requests().filter((method) => method === "authenticate")).toHaveLength(1);
    }
  });

  it("cancels pending sign-in selection on disconnect", async () => {
    mockAuthentication(methods);
    let offered: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      offered = resolve;
    });
    const client = new AcpClient(
      vi.fn(),
      () => "ask",
      (_methods, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve(null), { once: true });
          offered();
        }),
    );
    const connecting = client.connect("antigravity", "/project");
    const rejected = expect(connecting).rejects.toThrow("cancelled");
    await ready;
    await client.disconnect();
    await rejected;
    expect(requests()).not.toContain("authenticate");
  });
});

describe("external Agent catalog", () => {
  it("lists all ten requested agents and validates saved selections", () => {
    expect(EXTERNAL_AGENTS).toHaveLength(10);
    expect(isAgentSelection("builtin")).toBe(true);
    expect(isAgentSelection("codex")).toBe(true);
    expect(isAgentSelection("not-an-agent")).toBe(false);
  });
  it("parses explicit argument arrays without a shell command string", () => {
    expect(parseLaunch(" /path/agent ", '["--acp", "space in argument"]')).toEqual({
      command: "/path/agent",
      args: ["--acp", "space in argument"],
    });
    expect(parseLaunch("", "bad JSON")).toBeNull();
    expect(() => parseLaunch("/agent", '"--acp"')).toThrow();
    expect(() => parseLaunch("/agent", "[1]")).toThrow();
  });
});

describe("shared preferences and permissions", () => {
  const options = [
    { optionId: "once", name: "Once", kind: "allow_once" },
    { optionId: "always", name: "Always", kind: "allow_always" },
  ];
  it("rejects restricted requests, asks in ask mode, and only automatically approves once", () => {
    expect(automaticPermission("restricted", options)).toBeNull();
    expect(automaticPermission("ask", options)).toBeUndefined();
    expect(automaticPermission("auto", options)).toBe("once");
    expect(automaticPermission("auto", options.slice(1))).toBeNull();
  });
  it("includes language, preferences, skills and policy, but never the built-in model credentials", () => {
    const prompt = sharedPrompt(
      {
        ...DEFAULT_ACADEMIC_CONFIG,
        personalPrompt: "Be concise",
        answerLanguage: "ko",
        model: "private-model",
        baseUrl: "private-endpoint",
      },
      [{ instructions: "Preserve citations" }],
      "My task",
    );
    expect(prompt).toContain("Korean");
    expect(prompt).toContain("Be concise");
    expect(prompt).toContain("Preserve citations");
    expect(prompt).toContain("restricted");
    expect(prompt).toContain("My task");
    expect(prompt).toContain("review copy");
    expect(prompt).toContain("only the user can accept or reject");
    expect(prompt).toContain("Discussion, questions, planning");
    expect(prompt).not.toContain("private-model");
    expect(prompt).not.toContain("private-endpoint");
  });
});

describe("ACP transport isolation", () => {
  it("does not silently drop images when an adapter lacks vision support", async () => {
    const client = new AcpClient(vi.fn(), () => "ask");
    await client.connect("codex", "/project");
    await expect(
      client.prompt("Look", [{ name: "x.png", mimeType: "image/png", data: "eA==" }]),
    ).rejects.toThrow("does not support image");
    await client.disconnect();
  });
  it("sends images as ACP image blocks for vision-capable adapters", async () => {
    const client = new AcpClient(vi.fn(), () => "ask");
    await client.connect("codex", "/project");
    client.supportsImages = true;
    await client.prompt("Look", [{ name: "x.png", mimeType: "image/png", data: "eA==" }]);
    expect(transport.invoke).toHaveBeenCalledWith(
      "external_agent_send",
      expect.objectContaining({
        message: expect.objectContaining({
          method: "session/prompt",
          params: expect.objectContaining({
            prompt: [
              { type: "text", text: "Look" },
              { type: "image", mimeType: "image/png", data: "eA==" },
            ],
          }),
        }),
      }),
    );
    await client.disconnect();
  });
  it("closes the process and reports disconnection if the initialize request times out", async () => {
    vi.useFakeTimers();
    transport.invoke.mockImplementation(async (name: string) =>
      name === "external_agent_start" ? "runtime" : undefined,
    );
    const onEvent = vi.fn();
    const client = new AcpClient(onEvent, () => "ask");
    const connecting = client.connect("codex", "/project");
    const rejected = expect(connecting).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(onEvent).toHaveBeenCalledWith({ type: "exit" });
    expect(transport.invoke).toHaveBeenCalledWith("external_agent_stop", { runtimeId: "runtime" });
  });
  it("initializes ACP, selects read-only, and never invokes the built-in runtime", async () => {
    const client = new AcpClient(vi.fn(), () => "restricted");
    await client.connect("codex", "/project");
    const calls = transport.invoke.mock.calls;
    expect(calls.map(([name]) => name)).not.toContain("academic_agent_start");
    expect(
      calls.some(
        ([name, args]) =>
          name === "external_agent_send" && args.message.method === "session/set_mode",
      ),
    ).toBe(true);
    await client.disconnect();
    expect(transport.unlisten).toHaveBeenCalled();
    expect(transport.invoke).toHaveBeenCalledWith("external_agent_stop", { runtimeId: "runtime" });
  });
  it("fails closed when restricted mode is unsupported", async () => {
    transport.readOnly = false;
    const client = new AcpClient(vi.fn(), () => "restricted");
    await expect(client.connect("opencode", "/project")).rejects.toThrow("read-only");
    expect(transport.invoke).toHaveBeenCalledWith("external_agent_stop", { runtimeId: "runtime" });
  });
  it("streams only messages belonging to the selected runtime and session", async () => {
    const onEvent = vi.fn();
    const client = new AcpClient(onEvent, () => "ask");
    await client.connect("pi", "/project");
    const update = {
      method: "session/update",
      params: {
        sessionId: "session",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } },
      },
    };
    emit(update, "other-runtime");
    emit({ ...update, params: { ...update.params, sessionId: "other-session" } });
    expect(onEvent).not.toHaveBeenCalled();
    emit(update);
    expect(onEvent).toHaveBeenCalledWith({ type: "text", text: "Hello" });
    await client.disconnect();
  });
  it("presents one-time permissions and rejects persistent approval", async () => {
    const onEvent = vi.fn();
    const client = new AcpClient(onEvent, () => "ask");
    await client.connect("claude", "/project");
    emit({
      id: "permission",
      method: "session/request_permission",
      params: {
        sessionId: "session",
        toolCall: { title: "Write manuscript" },
        options: [
          { optionId: "always", name: "Always", kind: "allow_always" },
          { optionId: "once", name: "Once", kind: "allow_once" },
        ],
      },
    });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "permission" }));
    await expect(client.respondPermission("permission", "always")).rejects.toThrow("one-time");
    await client.respondPermission("permission", "once");
    expect(transport.invoke).toHaveBeenCalledWith(
      "external_agent_send",
      expect.objectContaining({
        message: {
          jsonrpc: "2.0",
          id: "permission",
          result: { outcome: { outcome: "selected", optionId: "once" } },
        },
      }),
    );
    await client.disconnect();
  });
  it("cancels permission requests when stopping a turn", async () => {
    const client = new AcpClient(vi.fn(), () => "ask");
    await client.connect("claude", "/project");
    emit({
      id: "approval",
      method: "session/request_permission",
      params: { sessionId: "session", options: [] },
    });
    await client.cancel();
    expect(transport.invoke).toHaveBeenCalledWith(
      "external_agent_send",
      expect.objectContaining({
        message: { jsonrpc: "2.0", id: "approval", result: { outcome: { outcome: "cancelled" } } },
      }),
    );
    await client.disconnect();
  });
  it("rejects unsupported filesystem requests rather than granting hidden capabilities", async () => {
    const client = new AcpClient(vi.fn(), () => "auto");
    await client.connect("kimi", "/project");
    emit({ id: "read", method: "fs/read_text_file", params: { path: "/secret" } });
    await Promise.resolve();
    expect(transport.invoke).toHaveBeenCalledWith(
      "external_agent_send",
      expect.objectContaining({
        message: expect.objectContaining({ error: expect.objectContaining({ code: -32601 }) }),
      }),
    );
    await client.disconnect();
  });
  it("stops a process started after connection cancellation", async () => {
    let start: ((value: string) => void) | undefined;
    transport.invoke.mockImplementation((name: string) =>
      name === "external_agent_start"
        ? new Promise<string>((resolve) => {
            start = resolve;
          })
        : Promise.resolve(),
    );
    const client = new AcpClient(vi.fn(), () => "ask");
    const connecting = client.connect("grok", "/project");
    await vi.waitFor(() => expect(start).toBeDefined());
    const disconnecting = client.disconnect();
    let stopped = false;
    void disconnecting.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    start?.("late-runtime");
    await expect(connecting).rejects.toThrow("cancelled");
    await disconnecting;
    expect(stopped).toBe(true);
    expect(transport.invoke).toHaveBeenCalledWith("external_agent_stop", {
      runtimeId: "late-runtime",
    });
    expect(
      transport.invoke.mock.calls.filter(([name]) => name === "external_agent_stop"),
    ).toHaveLength(1);
  });
});
