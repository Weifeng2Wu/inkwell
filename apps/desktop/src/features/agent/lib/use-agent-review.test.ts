import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentReview } from "./use-agent-review";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: new Map<number, unknown>(),
  effects: new Map<number, unknown[]>(),
  pending: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index)) hooks.slots.set(index, initial);
    return [
      hooks.slots.get(index),
      (value: unknown) =>
        hooks.slots.set(
          index,
          typeof value === "function"
            ? Reflect.apply(value, undefined, [hooks.slots.get(index)])
            : value,
        ),
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!hooks.slots.has(index)) hooks.slots.set(index, { current: initial });
    return hooks.slots.get(index);
  },
  useEffect(effect: () => void, dependencies: unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.effects.get(index);
    if (!previous || dependencies.some((value, position) => value !== previous[position])) {
      hooks.effects.set(index, dependencies);
      hooks.pending.push(effect);
    }
  },
}));

const change = { path: "paper.tex", before: "Original", after: "Proposed" };
const applied = vi.fn();
let buffer = "Original";
function render(directory = "/project") {
  hooks.cursor = 0;
  const renderHook = useAgentReview;
  const review = renderHook({
    directory,
    buffers: () => [{ path: "paper.tex", content: buffer }],
    onApplied: applied,
  });
  for (const effect of hooks.pending.splice(0)) effect();
  return review;
}

beforeEach(() => {
  hooks.slots.clear();
  hooks.effects.clear();
  hooks.pending = [];
  buffer = "Original";
  applied.mockReset();
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command) => (command === "agent_review_changes" ? [] : undefined));
});

describe("Agent review lifecycle", () => {
  it("retains pending suggestions when leaving review and returning to the file", async () => {
    const review = render();
    vi.mocked(invoke).mockResolvedValueOnce([change]);
    await review.afterTurn();
    render().setOpen(false);
    expect(render().changes).toEqual([change]);
    render().setOpen(true);
    expect(render().open).toBe(true);
    expect(render().changes).toEqual([change]);
    expect(applied).not.toHaveBeenCalled();
  });

  it("ignores duplicate decisions until the active request completes", async () => {
    const review = render();
    await Promise.resolve();
    let finish: (() => void) | undefined;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(invoke).mockClear();
    const first = review.decide(change, true);
    await review.decide(change, false);
    expect(invoke).toHaveBeenCalledTimes(1);
    finish?.();
    await first;
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it("snapshots live editor buffers before a turn and collects proposals without saving originals", async () => {
    const review = render();
    await review.beforeTurn();
    expect(invoke).toHaveBeenCalledWith("agent_review_prepare", {
      buffers: [{ path: "paper.tex", content: "Original" }],
    });
    vi.mocked(invoke).mockResolvedValueOnce([change]);
    await review.afterTurn();
    const updated = render();
    expect(updated.changes).toEqual([change]);
    expect(updated.open).toBe(true);
    expect(applied).not.toHaveBeenCalled();
    await updated.decide(change, true);
    expect(invoke).toHaveBeenCalledWith("agent_review_resolve", {
      path: "paper.tex",
      expected: "Original",
      proposed: "Proposed",
      content: "Proposed",
      accept: true,
    });
    expect(applied).toHaveBeenCalledWith("paper.tex", "Proposed");
  });

  it("rejects proposals without updating editor contents", async () => {
    const review = render();
    await review.decide(change, false);
    expect(applied).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "agent_review_resolve",
      expect.objectContaining({ accept: false }),
    );
  });

  it("accepts one hunk while preserving the other pending proposals", async () => {
    const review = render();
    vi.mocked(invoke).mockResolvedValueOnce([change]);
    await review.afterTurn();
    await render().decide(change, true, "Partially accepted", "Proposed");
    expect(invoke).toHaveBeenCalledWith("agent_review_resolve", {
      path: "paper.tex",
      expected: "Original",
      proposed: "Proposed",
      content: "Partially accepted",
      remaining: "Proposed",
      accept: true,
    });
    expect(applied).toHaveBeenCalledWith("paper.tex", "Partially accepted");
    expect(render().changes).toEqual([{ ...change, before: "Partially accepted" }]);
  });

  it("rejects one hunk without applying or discarding the other suggestions", async () => {
    const review = render();
    vi.mocked(invoke).mockResolvedValueOnce([change]);
    await review.afterTurn();
    await render().decide(change, false, "Proposed", "Remaining suggestion");
    expect(applied).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "agent_review_resolve",
      expect.objectContaining({ accept: false, remaining: "Remaining suggestion" }),
    );
    expect(render().changes).toEqual([{ ...change, after: "Remaining suggestion" }]);
  });

  it("detects edits made while the agent was running using the latest editor snapshot", async () => {
    const old = render();
    buffer = "User changed the original";
    render();
    vi.mocked(invoke).mockClear();
    await old.decide(change, true);
    expect(invoke).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
    expect(render().error).toContain("editor content changed");
  });

  it("accepts a suggestion for a newly created file when its editor buffer is empty", async () => {
    buffer = "";
    const created = { path: "poster.tex", before: null, after: "\\documentclass{article}" };
    await render().decide(created, true);
    expect(invoke).toHaveBeenCalledWith(
      "agent_review_resolve",
      expect.objectContaining({ path: "poster.tex", expected: null, accept: true }),
    );
    expect(applied).toHaveBeenCalledWith("poster.tex", "\\documentclass{article}");
  });

  it("preserves the original on backend conflicts", async () => {
    const review = render();
    await Promise.resolve();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("File changed"));
    await review.decide(change, true);
    expect(applied).not.toHaveBeenCalled();
    expect(render().error).toContain("File changed");
  });

  it("does not apply an old project's proposal after switching workspaces", async () => {
    const old = render();
    render("/other-project");
    await Promise.resolve();
    vi.mocked(invoke).mockClear();
    await old.decide(change, true);
    expect(invoke).not.toHaveBeenCalled();
    expect(applied).not.toHaveBeenCalled();
  });

  it("keeps pending review recoverable when preparing another turn is refused", async () => {
    const review = render();
    await Promise.resolve();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Review pending changes first"));
    await expect(review.beforeTurn()).rejects.toThrow("pending changes");
    await expect(review.beforeTurn()).resolves.toBeUndefined();
  });
});
