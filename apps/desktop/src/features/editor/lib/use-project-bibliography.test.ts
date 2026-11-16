// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectBibliography } from "./use-project-bibliography";

type Args = Parameters<typeof useProjectBibliography>[0];
let root: Root;
let args: Args;
let bibliography: ReturnType<typeof useProjectBibliography>;

function Harness(props: Args) {
  bibliography = useProjectBibliography(props);
  return null;
}

function deferred<Result>() {
  let resolve: (value: Result) => void = () => {};
  const promise = new Promise<Result>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function render(updates: Partial<Args> = {}) {
  args = { ...args, ...updates };
  await act(async () => root.render(createElement(Harness, args)));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  args = {
    projectPath: "/project",
    files: [{ name: "refs.bib", path: "refs.bib", type: "file" }],
    readFile: vi.fn<Args["readFile"]>().mockResolvedValue("@misc{known, title = {Known}}"),
    change: null,
    primaryContent: "",
    secondaryContent: "",
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("bibliography readiness for automatic PDF recognition", () => {
  it("waits for existing references and reloads before allowing new writes", async () => {
    const initial = deferred<string>();
    vi.mocked(args.readFile).mockReturnValueOnce(initial.promise);
    await render();
    expect(bibliography.ready).toBe(false);
    await act(async () => initial.resolve("@misc{known, title = {Known}}"));
    expect(bibliography.ready).toBe(true);
    expect(bibliography.sources.get("refs.bib")).toContain("Known");

    const reload = deferred<string>();
    vi.mocked(args.readFile).mockReturnValueOnce(reload.promise);
    await render({ change: { path: "refs.bib", kind: "modify" } });
    expect(bibliography.ready).toBe(false);
    await act(async () => reload.resolve("@misc{known, title = {Edited}}"));
    expect(bibliography.ready).toBe(true);
    expect(bibliography.sources.get("refs.bib")).toContain("Edited");
  });

  it("is ready without bibliographies so a first reference can be created", async () => {
    await render({ files: [] });
    expect(bibliography.ready).toBe(true);
    expect(args.readFile).not.toHaveBeenCalled();
  });

  it("keeps failed or unavailable reads from authorizing automatic writes", async () => {
    vi.mocked(args.readFile).mockRejectedValueOnce(new Error("Access denied"));
    await render();
    expect(bibliography.ready).toBe(false);
    vi.mocked(args.readFile).mockResolvedValueOnce(null);
    await render({ change: { path: "refs.bib", kind: "modify" } });
    expect(bibliography.ready).toBe(false);
    await render({ change: { path: "refs.bib", kind: "modify" } });
    expect(bibliography.ready).toBe(true);
  });

  it("does not mix old project reads with a new project's unsaved bibliography", async () => {
    const pending = deferred<string>();
    vi.mocked(args.readFile).mockReturnValueOnce(pending.promise);
    await render();
    await render({
      projectPath: "/other",
      primaryPath: "refs.bib",
      primaryContent: "@misc{draft, title = {Unsaved reference}}",
    });
    await act(async () => pending.resolve("@misc{old, title = {Old project}}"));
    expect(bibliography.ready).toBe(true);
    expect(bibliography.sources.get("refs.bib")).toContain("Unsaved reference");
    expect(bibliography.sources.get("refs.bib")).not.toContain("Old project");
  });
});
