import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AcademicClient, type AcademicEvent } from "./academic-client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

type Envelope = { runtimeId: string; event: AcademicEvent };
let emit: (envelope: Envelope) => void;
const unlisten = vi.fn();
const requests: { type: string; id: string }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    emit = (payload) => callback({ event: "academic-agent-event", id: 1, payload });
    return unlisten;
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "academic_agent_start") return "runtime-fixture";
    if (command === "academic_agent_command") {
      const { request } = args as { request: { type: string; id: string } };
      requests.push(request);
      if (request.type === "catalog") {
        queueMicrotask(() =>
          emit({
            runtimeId: "runtime-fixture",
            event: {
              type: "response",
              id: request.id,
              ok: true,
              result: { skills: [], market: [] },
            },
          }),
        );
      }
    }
    return undefined;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Academic runtime IPC client", () => {
  it("loads an empty catalog and cleans up its listener/process", async () => {
    const client = new AcademicClient(() => {});
    expect(await client.connect()).toEqual({ skills: [], market: [] });
    await client.disconnect();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("academic_agent_stop", { runtimeId: "runtime-fixture" });
  });

  it("correlates responses and ignores events from another runtime", async () => {
    const client = new AcademicClient(() => {});
    await client.connect();
    const pending = client.request<string>("prompt", { text: "Fixture" });
    const request = requests.at(-1);
    expect(request).toBeDefined();
    if (!request) throw new Error("Missing request");
    emit({
      runtimeId: "stale-runtime",
      event: { type: "response", id: request.id, ok: true, result: "wrong" },
    });
    emit({
      runtimeId: "runtime-fixture",
      event: { type: "response", id: request.id, ok: true, result: "correct" },
    });
    expect(await pending).toBe("correct");
    await client.disconnect();
  });

  it("rejects pending work when disconnected", async () => {
    const client = new AcademicClient(() => {});
    await client.connect();
    const pending = expect(client.request("prompt", { text: "Fixture" })).rejects.toThrow("closed");
    await client.disconnect();
    await pending;
  });

  it("preserves a startup failure that arrives before start returns", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "academic_agent_start") {
        emit({
          runtimeId: "runtime-fixture",
          event: { type: "fatal", error: "SDK fixture failed" },
        });
        return "runtime-fixture";
      }
      return undefined;
    });
    const client = new AcademicClient(() => {});
    await expect(client.connect()).rejects.toThrow("SDK fixture failed");
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("stops the process when a request times out instead of leaving invisible work", async () => {
    const client = new AcademicClient(() => {});
    await client.connect();
    vi.useFakeTimers();
    const pending = expect(client.request("prompt", { text: "Fixture" })).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(600_000);
    await pending;
    expect(invoke).toHaveBeenCalledWith("academic_agent_stop", { runtimeId: "runtime-fixture" });
  });

  it("allows format extraction to finish after the normal utility timeout", async () => {
    const client = new AcademicClient(() => {});
    await client.connect();
    vi.useFakeTimers();
    const pending = client.request<{ text: string }>("format_skill_generate", { text: "Rules" });
    const request = requests.at(-1);
    if (!request) throw new Error("Missing request");
    expect(request.type).toBe("format_skill_generate");
    await vi.advanceTimersByTimeAsync(100_000);
    expect(invoke).not.toHaveBeenCalledWith("academic_agent_stop", {
      runtimeId: "runtime-fixture",
    });
    emit({
      runtimeId: "runtime-fixture",
      event: { type: "response", id: request.id, ok: true, result: { text: '{"rules":[]}' } },
    });
    await expect(pending).resolves.toEqual({ text: '{"rules":[]}' });
    await client.disconnect();
  });

  it("does not start a process if disconnected while listener registration is pending", async () => {
    let register: ((value: typeof unlisten) => void) | undefined;
    vi.mocked(listen).mockImplementation(
      () =>
        new Promise((resolve) => {
          register = resolve;
        }),
    );
    const client = new AcademicClient(() => {});
    const pending = expect(client.connect()).rejects.toThrow("cancelled");
    await client.disconnect();
    register?.(unlisten);
    await pending;
    expect(invoke).not.toHaveBeenCalledWith("academic_agent_start");
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("marks transport failures as fatal and stops the process", async () => {
    const onEvent = vi.fn();
    const client = new AcademicClient(onEvent);
    await client.connect();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "academic_agent_command") throw new Error("Broken transport");
      return undefined;
    });
    await expect(client.request("prompt", { text: "Fixture" })).rejects.toThrow("Broken transport");
    expect(onEvent).toHaveBeenCalledWith({ type: "fatal", error: "Broken transport" });
    expect(invoke).toHaveBeenCalledWith("academic_agent_stop", { runtimeId: "runtime-fixture" });
  });
});
