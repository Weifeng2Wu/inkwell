// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileNode } from "@/types/files";
import { EMPTY_METADATA, type PaperMetadata } from "./bibtex";
import { pdfFilenameHints } from "./metadata";
import { type LibraryController, useLibrary } from "./use-library";

const mock = vi.hoisted(() => ({
  hints: vi.fn(),
  identify: vi.fn(),
  toast: vi.fn(),
  translate: (key: string) => key,
  storage: new Map<string, string>(),
}));

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/features/i18n", () => ({ useI18n: () => ({ t: mock.translate }) }));
vi.mock("@/lib/storage/app-storage", () => ({
  appStorage: {
    getItem: (key: string) => mock.storage.get(key) ?? null,
    setItem: (key: string, value: string) => mock.storage.set(key, value),
  },
}));
vi.mock("./actions", async (original) => ({
  ...(await original<typeof import("./actions")>()),
  readPdfHints: mock.hints,
  identifyPdf: mock.identify,
}));

type Args = Parameters<typeof useLibrary>[0];
let root: Root;
let controller: LibraryController;
let args: Args;
let disk: Map<string, string>;

function Harness(props: Args) {
  controller = useLibrary(props);
  return null;
}

function file(path: string): FileNode {
  return { name: path.split("/").at(-1) ?? path, path, type: "file" };
}

function paper(title: string, doi = ""): PaperMetadata {
  return { ...EMPTY_METADATA, title, doi, authors: ["Researcher, Alex"], year: "2024" };
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
  mock.storage.clear();
  mock.toast.mockReset();
  mock.hints
    .mockReset()
    .mockImplementation(async (_project: string, path: string) => pdfFilenameHints(path));
  mock.identify
    .mockReset()
    .mockImplementation(async (hints: { title: string }) => paper(hints.title));
  disk = new Map();
  args = {
    projectPath: "/project",
    files: [],
    bibliographies: new Map(),
    ready: true,
    readFile: vi.fn(async (path) => disk.get(path) ?? null),
    writeFile: vi.fn(async (path, content) => {
      disk.set(path, content);
    }),
  };
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe("project PDF discovery", () => {
  it("identifies root and nested PDFs without mounting the library panel", async () => {
    await render({
      files: [
        file("Root_Paper.pdf"),
        {
          name: "readings",
          path: "readings",
          type: "directory",
          children: [file("readings/Nested_Paper.PDF")],
        },
      ],
    });
    expect(mock.hints.mock.calls).toEqual([
      ["/project", "Root_Paper.pdf"],
      ["/project", "readings/Nested_Paper.PDF"],
    ]);
    expect(controller.library.items.map((item) => item.title)).toEqual([
      "Root Paper",
      "Nested Paper",
    ]);
    expect(controller.pdfMetadata.get("Root_Paper.pdf")).toMatchObject({
      title: "Root Paper",
      year: "2024",
    });
    expect(controller.library.unlinked).toEqual([]);
    expect(controller.manualAdd).toBeNull();
    expect(mock.toast).not.toHaveBeenCalled();
  });

  it("waits for existing bibliographies before scanning or writing", async () => {
    const source =
      "@article{existing, title = {Existing}, file = {Known.pdf}, readstatus = {read}}";
    disk.set("refs.bib", source);
    await render({ files: [file("Known.pdf"), file("refs.bib")], ready: false });
    expect(mock.hints).not.toHaveBeenCalled();
    expect(args.writeFile).not.toHaveBeenCalled();
    await render({ bibliographies: new Map(disk), ready: true });
    expect(mock.hints).not.toHaveBeenCalled();
    expect(args.writeFile).not.toHaveBeenCalled();
    expect(controller.library.items[0]).toMatchObject({ key: "existing", status: "read" });
    expect(controller.pdfMetadata.get("Known.pdf")?.title).toBe("Existing");
  });

  it("handles new files without repeatedly identifying PDFs after watcher refreshes", async () => {
    await render({ files: [file("First_Paper.pdf")] });
    await render({ files: [file("First_Paper.pdf"), file("notes.md")] });
    await render({ files: [file("First_Paper.pdf"), file("Second_Paper.pdf")] });
    await render({ files: [...args.files], bibliographies: new Map() });
    expect(mock.hints).toHaveBeenCalledTimes(2);
    expect(controller.library.items).toHaveLength(2);
    expect(disk.get("references.bib")).toContain("First Paper");
    expect(disk.get("references.bib")).toContain("Second Paper");
  });

  it("exposes directory metadata while the library write is still pending", async () => {
    const writing = deferred<void>();
    vi.mocked(args.writeFile).mockImplementation(async (path, content) => {
      await writing.promise;
      disk.set(path, content);
    });
    await render({ files: [file("Directory_Paper.pdf")] });
    expect(controller.library.items).toHaveLength(0);
    expect(controller.pdfMetadata.get("Directory_Paper.pdf")?.title).toBe("Directory Paper");
    await act(async () => writing.resolve());
    expect(controller.library.items).toHaveLength(1);
  });

  it("shares metadata across duplicate PDFs while keeping one DOI entry", async () => {
    mock.identify.mockResolvedValue(paper("Same Paper", "10.1234/example"));
    await render({ files: [file("Original.pdf"), file("copy.pdf")] });
    expect(controller.library.items).toHaveLength(1);
    expect(controller.pdfMetadata.get("Original.pdf")?.title).toBe("Same Paper");
    expect(controller.pdfMetadata.get("copy.pdf")?.title).toBe("Same Paper");
    expect(args.writeFile).toHaveBeenCalledTimes(1);
  });

  it("links an existing DOI without changing its key, reading status, or tags", async () => {
    const source =
      "@article{customKey, title = {Known}, doi = {10.1234/example}, readstatus = {read}, keywords = {important}}";
    disk.set("refs.bib", source);
    mock.identify.mockResolvedValue(paper("Known", "10.1234/example"));
    await render({ files: [file("Known.pdf"), file("refs.bib")], bibliographies: new Map(disk) });
    expect(controller.library.items).toHaveLength(1);
    expect(controller.library.items[0]).toMatchObject({
      key: "customKey",
      status: "read",
      tags: ["important"],
      file: "Known.pdf",
      source: "refs.bib",
    });
    expect(disk.has("references.bib")).toBe(false);
  });

  it("keeps offline PDFs available without repeated requests, dialogs, or fabricated entries", async () => {
    mock.identify.mockRejectedValue(new Error("offline"));
    await render({ files: [file("Offline_Paper.pdf")] });
    await render({ files: [...args.files] });
    expect(mock.identify).toHaveBeenCalledTimes(1);
    expect(args.writeFile).not.toHaveBeenCalled();
    expect(controller.library.unlinked).toEqual(["Offline_Paper.pdf"]);
    expect(controller.manualAdd).toBeNull();
    expect(mock.toast).not.toHaveBeenCalled();
    mock.identify.mockResolvedValue(paper("Recovered"));
    await act(async () => {
      await controller.identify(["Offline_Paper.pdf"]);
    });
    expect(controller.library.items[0]?.title).toBe("Recovered");
  });

  it("uses a filename identifier when the PDF text cannot be read", async () => {
    mock.hints.mockRejectedValue(new Error("Image-only or unavailable PDF"));
    mock.identify.mockResolvedValue(paper("Attention Is All You Need"));
    await render({ files: [file("1706.03762v7.pdf")] });
    expect(mock.identify).toHaveBeenCalledWith({ title: "", doi: "", arxiv: "1706.03762" });
    expect(controller.pdfMetadata.get("1706.03762v7.pdf")?.title).toBe("Attention Is All You Need");
  });

  it("ignores old metadata results after switching projects", async () => {
    const pending = deferred<PaperMetadata>();
    mock.identify.mockReturnValueOnce(pending.promise);
    await render({ files: [file("Old_Paper.pdf")] });
    const oldWrite = args.writeFile;
    const newWrite = vi.fn<Args["writeFile"]>(async () => {});
    await render({ projectPath: "/other", files: [file("New_Paper.pdf")], writeFile: newWrite });
    await act(async () => pending.resolve(paper("Old Paper")));
    expect(oldWrite).not.toHaveBeenCalled();
    expect(newWrite).toHaveBeenCalledTimes(1);
    expect(newWrite.mock.calls[0]?.[1]).not.toContain("Old Paper");
    expect(controller.pdfMetadata.has("Old_Paper.pdf")).toBe(false);
    expect(controller.library.items[0]?.title).toBe("New Paper");
  });

  it("does not register a PDF removed during recognition", async () => {
    const pending = deferred<PaperMetadata>();
    mock.identify.mockReturnValueOnce(pending.promise);
    await render({ files: [file("Deleted.pdf")] });
    await render({ files: [] });
    await act(async () => pending.resolve(paper("Deleted")));
    expect(args.writeFile).not.toHaveBeenCalled();
    expect(controller.pdfMetadata.size).toBe(0);
  });

  it("preserves bibliography edits made while a metadata request is running", async () => {
    const pending = deferred<PaperMetadata>();
    mock.identify.mockReturnValueOnce(pending.promise);
    await render({ files: [file("Paper.pdf")] });
    const edited = "@misc{userEdit, title = {Keep my edit}}";
    disk.set("references.bib", edited);
    await render({ files: [...args.files, file("references.bib")], bibliographies: new Map(disk) });
    await act(async () => pending.resolve(paper("Found Paper")));
    expect(disk.get("references.bib")).toContain("Keep my edit");
    expect(controller.library.items).toHaveLength(2);
  });

  it("waits for a bibliography reload before saving recognized metadata", async () => {
    const pending = deferred<PaperMetadata>();
    mock.identify.mockReturnValueOnce(pending.promise);
    await render({ files: [file("Paper.pdf")] });
    await render({ files: [...args.files, file("refs.bib")], ready: false });
    await act(async () => pending.resolve(paper("Found Paper")));
    expect(args.writeFile).not.toHaveBeenCalled();
    expect(controller.pdfMetadata.get("Paper.pdf")?.title).toBe("Found Paper");
    disk.set("refs.bib", "@misc{existing, title = {Keep this reference}}");
    await render({ bibliographies: new Map(disk), ready: true });
    expect(disk.get("refs.bib")).toContain("Keep this reference");
    expect(disk.get("refs.bib")).toContain("Found Paper");
    expect(disk.has("references.bib")).toBe(false);
    expect(mock.identify).toHaveBeenCalledTimes(1);
  });

  it("respects a user reverting bibliography content after a write has been indexed", async () => {
    const original = "@misc{keep, title = {Keep this reference}}";
    disk.set("refs.bib", original);
    await render({
      files: [file("refs.bib"), file("First.pdf")],
      bibliographies: new Map(disk),
    });
    await render({ bibliographies: new Map(disk) });
    disk.set("refs.bib", original);
    await render({
      files: [...args.files, file("Second.pdf")],
      bibliographies: new Map(disk),
    });
    expect(disk.get("refs.bib")).toContain("Keep this reference");
    expect(disk.get("refs.bib")).toContain("Second");
    expect(disk.get("refs.bib")).not.toContain("First");
  });

  it("continues recognizing other PDFs after a bibliography write fails", async () => {
    vi.mocked(args.writeFile).mockRejectedValueOnce(new Error("Read-only bibliography"));
    await render({ files: [file("First.pdf"), file("Second.pdf")] });
    expect(controller.pdfMetadata.get("First.pdf")?.title).toBe("First");
    expect(controller.pdfMetadata.get("Second.pdf")?.title).toBe("Second");
    expect(controller.library.items.map((item) => item.title)).toEqual(["Second"]);
    expect(mock.identify).toHaveBeenCalledTimes(2);
    expect(controller.busy).toBe("");
  });

  it("does not write pending metadata after the workspace unmounts", async () => {
    const pending = deferred<PaperMetadata>();
    mock.identify.mockReturnValueOnce(pending.promise);
    await render({ files: [file("Paper.pdf")] });
    await act(async () => root.render(null));
    await act(async () => pending.resolve(paper("Late Result")));
    expect(args.writeFile).not.toHaveBeenCalled();
    expect(mock.toast).not.toHaveBeenCalled();
  });

  it("remembers deliberate removals without suppressing directory metadata", async () => {
    await render({ files: [file("Removed_Paper.pdf")] });
    const item = controller.library.items[0];
    if (!item) throw new Error("Missing reference");
    await act(async () => {
      await controller.remove(item);
    });
    await render({ files: [...args.files], bibliographies: new Map(disk) });
    expect(controller.library.items).toHaveLength(0);
    await render({ projectPath: null, files: [], bibliographies: new Map() });
    await render({
      projectPath: "/project",
      files: [file("Removed_Paper.pdf"), file("references.bib")],
      bibliographies: new Map(disk),
    });
    expect(controller.library.items).toHaveLength(0);
    expect(controller.pdfMetadata.get("Removed_Paper.pdf")?.title).toBe("Removed Paper");
    await act(async () => {
      await controller.identify(["Removed_Paper.pdf"]);
    });
    expect(controller.library.items).toHaveLength(1);
  });

  it("continues with other PDFs when one has no reliable match", async () => {
    mock.identify.mockResolvedValueOnce(null);
    await render({ files: [file("Unknown.pdf"), file("Known_Paper.pdf")] });
    expect(controller.library.unlinked).toEqual(["Unknown.pdf"]);
    expect(controller.library.items[0]?.title).toBe("Known Paper");
    expect(controller.manualAdd).toBeNull();
  });
});
