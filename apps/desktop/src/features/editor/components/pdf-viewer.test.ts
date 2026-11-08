// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act, createElement, type ReactNode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPdfNotes, type PdfAnnotation, parsePdfNotes } from "../lib/pdf-notes";
import type { PdfSelectionPage } from "../lib/pdf-selection";

const mock = vi.hoisted(() => ({
  disk: "",
  source: false,
  revision: 0,
  invoke: vi.fn(),
  refineSelection: vi.fn(),
  refineAnnotation: vi.fn(),
  disposeGeometry: vi.fn(),
  watchers: new Set<(event: { payload: { path: string; kind: string } }) => void>(),
}));
vi.mock("../lib/pdf-geometry", () => ({
  PdfGeometryClient: class {
    refineSelection = mock.refineSelection;
    refineAnnotation = mock.refineAnnotation;
    dispose = mock.disposeGeometry;
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    _name: string,
    callback: (event: { payload: { path: string; kind: string } }) => void,
  ) => {
    mock.watchers.add(callback);
    return () => {
      mock.watchers.delete(callback);
    };
  },
}));
vi.mock("@/features/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ text }: { text: string }) =>
      createElement("div", null, text),
}));
vi.mock("@phosphor-icons/react", () => ({
  ArrowSquareOutIcon: () => null,
  CheckIcon: () => null,
  CaretDownIcon: () => null,
  HighlighterIcon: () => null,
  NoteIcon: () => null,
  TextUnderlineIcon: () => null,
  TranslateIcon: () => null,
  XIcon: () => null,
}));
vi.mock("./lazy", () => ({
  DraftEditor: ({
    content,
    onContentChange,
  }: {
    content: string;
    onContentChange: (text: string) => void;
  }) =>
    createElement("textarea", {
      value: content,
      onChange: (event: { target: { value: string } }) => onContentChange(event.target.value),
    }),
  MonacoEditor: () => null,
}));
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document({
    children,
    onLoadSuccess,
  }: {
    children: ReactNode;
    onLoadSuccess: (pdf: unknown) => void;
  }) {
    useEffect(() => {
      onLoadSuccess({
        numPages: 2,
        fingerprints: ["permanent-id"],
        getData: async () => new TextEncoder().encode(`actual-pdf-revision-${mock.revision}`),
      });
    }, [onLoadSuccess]);
    return createElement("div", null, children);
  },
  Page({ pageNumber, scale }: { pageNumber: number; scale: number }) {
    return createElement(
      "div",
      { className: "react-pdf__Page", "data-scale": scale },
      createElement(
        "div",
        { className: "react-pdf__Page__textContent" },
        createElement("span", null, `Important finding on page ${pageNumber}.`),
      ),
    );
  },
}));

import { PdfNotesEditor } from "./pdf-notes-editor";
import { PdfViewer } from "./pdf-viewer";

let root: Root;
let container: HTMLDivElement;
let pdfPath: string;
const jump = vi.fn();
const openNotes = vi.fn();
let serial = 0;

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
  });
}

function button(label: string) {
  const target = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );
  if (!target) throw new Error(`Missing button: ${label}`);
  return target;
}

async function click(target: Element) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

async function writeComment(text: string) {
  const textarea = container.querySelector("textarea");
  if (!textarea) throw new Error("Missing comment editor");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      text,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pointer(selectText: boolean, moved = false, clientX = 80, clientY = 80) {
  const span = container.querySelector(".react-pdf__Page__textContent span");
  if (!span?.firstChild) throw new Error("Missing PDF text layer");
  const textNode = span.firstChild;
  await act(async () => {
    span.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX, clientY }),
    );
    const selection = window.getSelection();
    selection?.removeAllRanges();
    if (selectText) {
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 9);
      Object.defineProperty(range, "getClientRects", {
        value: () => [new DOMRect(72, 72, 150, 20)],
      });
      selection?.addRange(range);
    }
    span.dispatchEvent(
      new MouseEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: clientX + (moved ? 100 : 0),
        clientY,
      }),
    );
  });
  await settle();
}

async function render() {
  await act(async () => {
    root.render(
      createElement(PdfViewer, {
        src: "/fixture.pdf",
        projectPath: "/project",
        pdfPath,
        onSynctexClick: jump,
        onOpenNotes: openNotes,
      }),
    );
  });
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  pdfPath = `paper-${++serial}.pdf`;
  mock.disk = createPdfNotes(pdfPath, "Notes", "Free-form notes");
  mock.source = false;
  mock.revision = 0;
  mock.watchers.clear();
  mock.invoke.mockReset();
  mock.refineSelection.mockReset().mockImplementation(async (pages: PdfSelectionPage[]) =>
    pages.map((item) => ({
      ...item,
      rects: [
        {
          x: 72 / 612,
          y: 76 / 792,
          width: (item.quote.trim().length * 10) / 612,
          height: 11 / 792,
        },
      ],
    })),
  );
  mock.refineAnnotation.mockReset().mockImplementation(async (item: PdfAnnotation) => item);
  mock.disposeGeometry.mockReset();
  jump.mockReset();
  openNotes.mockReset();
  mock.invoke.mockImplementation(async (command: string, request: Record<string, unknown>) => {
    if (command === "pdf_notes_load")
      return { content: mock.disk, canSyncSource: mock.source, path: `${pdfPath}.notes.md` };
    if (command === "pdf_notes_save") {
      if (request.expectedContent !== mock.disk) throw new Error("PDF_NOTES_CONFLICT");
      mock.disk = String(request.content);
      return;
    }
    if (command === "translation_request") return "你好，这是测试译文。";
    throw new Error("Unexpected command");
  });
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [new DOMRect(72, 72, 150, 20)],
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const scale = Number(this.querySelector("[data-scale]")?.getAttribute("data-scale") ?? 1);
    return new DOMRect(0, 0, 612 * scale, 792 * scale);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PDF reading interactions", () => {
  it("keeps highlight padding out of saved anchors and hit-tests the actual painted region", async () => {
    const bands = [{ x: 72 / 612, y: 76 / 792, width: 90 / 612, height: 40 / 792 }];
    mock.refineSelection.mockImplementation(async (pages: PdfSelectionPage[]) =>
      pages.map((item) => ({
        ...item,
        rects: [{ x: 72 / 612, y: 76 / 792, width: 90 / 612, height: 11 / 792 }],
        highlightRects: bands,
      })),
    );
    mock.refineAnnotation.mockImplementation(async (item: PdfAnnotation) => ({
      ...item,
      highlightRects: bands,
    }));
    await render();
    await pointer(true, true);
    await settle();
    const preview = container.querySelector("[data-pdf-selection-preview] path")?.getAttribute("d");
    await click(button("pdfReading.highlight"));
    expect(parsePdfNotes(mock.disk).annotations[0]?.rects[0]?.height).toBeCloseTo(11 / 792);
    expect(mock.disk).not.toContain("highlightRects");
    expect(container.querySelector("[data-pdf-annotation-paint]")?.getAttribute("d")).toBe(preview);
    await pointer(false, false, 80, 100);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(jump).not.toHaveBeenCalled();
  });

  it("does not save loose rectangles or jump to source when glyph extraction fails", async () => {
    mock.source = true;
    mock.refineSelection.mockRejectedValue(new Error("PDF_GEOMETRY_FAILED"));
    await render();
    await pointer(true, true);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.textContent).toContain("pdfReading.geometryFailed");
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
    expect(jump).not.toHaveBeenCalled();
  });

  it("discards pending selection actions after Escape or a newer native selection", async () => {
    let resolve: ((value: PdfSelectionPage[]) => void) | undefined;
    const pending = new Promise<PdfSelectionPage[]>((done) => {
      resolve = done;
    });
    mock.refineSelection.mockImplementation(() => pending);
    await render();
    await pointer(true, true);
    const captured = mock.refineSelection.mock.calls[0]?.[0] as PdfSelectionPage[] | undefined;
    expect(captured).toBeDefined();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      resolve?.(captured ?? []);
      await pending;
    });
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
  });

  it("visually realigns saved notes and their hit targets without rewriting Markdown on open", async () => {
    await render();
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    const original = mock.disk;
    await act(async () => {
      root.unmount();
      root = createRoot(container);
    });
    mock.invoke.mockClear();
    mock.refineAnnotation.mockImplementation(async (item: PdfAnnotation) => ({
      ...item,
      rects: [{ x: 72 / 612, y: 76 / 792, width: 50 / 612, height: 8 / 792 }],
    }));
    await render();
    expect(mock.disk).toBe(original);
    expect(mock.invoke.mock.calls.some(([command]) => command === "pdf_notes_save")).toBe(false);
    expect(container.querySelector("[data-pdf-annotation-paint]")?.getAttribute("d")).toContain(
      `v${8 / 792}`,
    );
    await pointer(false, false, 80, 80);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("shows only four icon actions and a collapsed color trigger, with no copy or overflow button", async () => {
    await render();
    await pointer(true, true);
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar?.querySelectorAll("button")).toHaveLength(5);
    expect(toolbar?.textContent).toBe("");
    expect(toolbar?.querySelector("fieldset")).toBeNull();
    expect(toolbar?.querySelector('[aria-label="pdfReading.copy"]')).toBeNull();
    const labels = [
      "pdfReading.highlight",
      "pdfReading.underline",
      "pdfReading.addNote",
      "translation.action",
    ];
    for (const label of labels) {
      const action = toolbar?.querySelector(`[aria-label="${label}"]`);
      expect(action?.getAttribute("title")).toBe(label);
      expect(action?.classList.contains("toolbar-icon-button")).toBe(true);
    }
    expect(
      toolbar?.querySelector('[aria-label="pdfReading.color"]')?.getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("opens the color palette only on demand and saves the chosen color with the same text", async () => {
    await render();
    await pointer(true, true);
    const trigger = container.querySelector('[role="toolbar"] [aria-label="pdfReading.color"]');
    if (!trigger) throw new Error("Missing color trigger");
    await click(trigger);
    const palette = container.querySelector('[role="dialog"][aria-label="pdfReading.color"]');
    expect(palette?.querySelectorAll("button")).toHaveLength(5);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(palette?.id).toBe(trigger.getAttribute("aria-controls"));
    const chosen = palette?.querySelector('[aria-label="pdfReading.colors.info"]');
    if (!chosen) throw new Error("Missing palette color");
    await click(chosen);
    expect(container.querySelector('[role="dialog"][aria-label="pdfReading.color"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("title")).toContain("pdfReading.colors.info");
    expect(document.activeElement).toBe(trigger);
    await click(button("pdfReading.highlight"));
    expect(parsePdfNotes(mock.disk).annotations[0]).toMatchObject({
      quote: "Important",
      color: "info",
    });
    expect(jump).not.toHaveBeenCalled();
  });

  it("preserves native selected text when pressing a toolbar button", async () => {
    await render();
    await pointer(true, true);
    const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      button("pdfReading.highlight").dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe("Important");
  });

  it("uses PDFium tight bounds for both preview and saving, not oversized browser rectangles", async () => {
    await render();
    const text = container.querySelector(".react-pdf__Page__textContent span")?.firstChild;
    if (!text) throw new Error("Missing PDF text");
    text.textContent = "word     ";
    vi.spyOn(Range.prototype, "getClientRects").mockImplementation(function (this: Range) {
      const rects = [new DOMRect(72, 72, (this.endOffset - this.startOffset) * 20, 20)];
      return Object.assign(rects, { item: (index: number) => rects[index] ?? null });
    });
    await pointer(true, true);
    await settle();
    const previewPath = container
      .querySelector("[data-pdf-selection-preview] path")
      ?.getAttribute("d");
    expect(previewPath).toBeTruthy();
    await click(button("pdfReading.highlight"));
    const annotation = parsePdfNotes(mock.disk).annotations[0];
    expect(annotation?.quote).toBe("word");
    expect(annotation?.rects[0]?.width).toBeCloseTo(40 / 612);
    expect(annotation?.rects[0]?.height).toBeCloseTo(11 / 792);
    expect(mock.refineSelection).toHaveBeenCalled();
    expect(container.querySelector("[data-pdf-annotation-paint]")?.getAttribute("d")).toBe(
      previewPath,
    );
  });

  it("supports arrow-key navigation and closes the palette before dismissing the toolbar on Escape", async () => {
    await render();
    await pointer(true, true);
    const highlight = button("pdfReading.highlight");
    await act(async () => {
      highlight.focus();
      highlight.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(button("pdfReading.underline"));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[role="toolbar"] [aria-label="pdfReading.color"]',
    );
    if (!trigger) throw new Error("Missing color trigger");
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });
    const palette = container.querySelector('[role="dialog"][aria-label="pdfReading.color"]');
    expect(palette).not.toBeNull();
    const current = palette?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    expect(document.activeElement).toBe(current);
    await act(async () => {
      current?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(container.querySelector('[role="dialog"][aria-label="pdfReading.color"]')).toBeNull();
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("closes the palette on an outside press without adding a note or translating", async () => {
    await render();
    await pointer(true, true);
    const trigger = container.querySelector('[role="toolbar"] [aria-label="pdfReading.color"]');
    if (!trigger) throw new Error("Missing color trigger");
    await click(trigger);
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(container.querySelector('[role="dialog"][aria-label="pdfReading.color"]')).toBeNull();
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(0);
  });

  it("persists a chosen color and can recolor a saved annotation without changing its note", async () => {
    await render();
    await click(button("pdfReading.colors.info"));
    await pointer(true, true);
    await click(button("pdfReading.addNote"));
    await writeComment("Keep this note");
    await click(button("pdfReading.saveNote"));
    expect(parsePdfNotes(mock.disk).annotations[0]).toMatchObject({
      color: "info",
      note: "Keep this note",
    });
    const dialog = container.querySelector('[role="dialog"]');
    const red = dialog?.querySelector('[aria-label="pdfReading.colors.error"]');
    if (!red) throw new Error("Missing popup color picker");
    await click(red);
    expect(parsePdfNotes(mock.disk).annotations[0]).toMatchObject({
      color: "error",
      note: "Keep this note",
    });
  });
  it("does not translate just by selecting; saves a translation only after explicit confirmation", async () => {
    await render();
    await pointer(true, true);
    expect(
      mock.invoke.mock.calls.filter(([command]) => command === "translation_request"),
    ).toHaveLength(0);
    await click(button("translation.action"));
    expect(container.textContent).toContain("你好，这是测试译文。");
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
    await click(button("translation.saveNote"));
    expect(parsePdfNotes(mock.disk).annotations[0]?.note).toContain("你好，这是测试译文。");
    expect(container.textContent).toContain("translation.savedNote");
    expect(jump).not.toHaveBeenCalled();
  });
  it("defaults external PDFs to reading and never invokes SyncTeX on a click", async () => {
    await render();
    expect(button("pdfReading.read").getAttribute("aria-pressed")).toBe("true");
    expect(button("pdfReading.write").disabled).toBe(true);
    await pointer(false);
    expect(jump).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("synctex");
    await click(button("pdfReading.openNotes"));
    expect(openNotes).toHaveBeenCalledWith(`${pdfPath}.notes.md`);
  });

  it("waits for pending note writes before the app closes", async () => {
    await render();
    const tasks: Promise<unknown>[] = [];
    window.dispatchEvent(new CustomEvent("inkwell-before-close", { detail: tasks }));
    expect(tasks).toHaveLength(1);
    await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
  });

  it("saves selected text as a highlight, restores it on remount, and opens its note when clicked", async () => {
    await render();
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    expect(parsePdfNotes(mock.disk).annotations[0]?.quote).toBe("Important");
    expect(container.querySelectorAll("[data-pdf-annotation-paint]")).toHaveLength(1);
    await pointer(false);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(jump).not.toHaveBeenCalled();
    await act(async () => {
      root.unmount();
      root = createRoot(container);
    });
    await render();
    expect(container.querySelectorAll("[data-pdf-annotation-paint]")).toHaveLength(1);
  });

  it("preserves writing-preview clicks but ignores drags, selections and PDF links", async () => {
    mock.source = true;
    await render();
    expect(button("pdfReading.write").getAttribute("aria-pressed")).toBe("true");
    await pointer(false);
    expect(jump).toHaveBeenCalledTimes(1);
    await pointer(false, true);
    await pointer(true, true);
    expect(jump).toHaveBeenCalledTimes(1);
    const page = container.querySelector("[data-pdf-page]");
    const link = document.createElement("a");
    link.href = "#page-2";
    page?.append(link);
    await act(async () => {
      link.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 90, clientY: 80 }),
      );
      link.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 90, clientY: 80 }),
      );
    });
    expect(jump).toHaveBeenCalledTimes(1);
    await click(button("pdfReading.read"));
    expect(parsePdfNotes(mock.disk).mode).toBe("read");
    await pointer(false);
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it("supports continuous underlining without an extra save click", async () => {
    await render();
    await click(button("pdfReading.continuousUnderline"));
    await pointer(true, true);
    expect(parsePdfNotes(mock.disk).annotations[0]?.kind).toBe("underline");
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("retains separate notes while repeated same-color highlights share a single paint", async () => {
    await render();
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    const annotations = parsePdfNotes(mock.disk).annotations;
    expect(annotations).toHaveLength(2);
    expect(annotations[0]?.id).not.toBe(annotations[1]?.id);
    expect(container.querySelectorAll("[data-pdf-annotation-paint]")).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label="pdfReading.viewAnnotation"]')).toHaveLength(2);
  });

  it("saves a Markdown comment, reads it in the PDF popup, and reflects edits from the linked notes", async () => {
    await render();
    await pointer(true, true);
    await click(button("pdfReading.addNote"));
    await writeComment("A **saved** reading note.");
    await click(button("pdfReading.saveNote"));
    expect(parsePdfNotes(mock.disk).annotations[0]?.note).toBe("A **saved** reading note.");
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "A **saved** reading note.",
    );
    mock.disk = mock.disk.replace("A **saved** reading note.", "Edited in the linked Markdown.");
    await act(async () => {
      for (const watcher of mock.watchers)
        watcher({ payload: { path: `${pdfPath}.notes.md`, kind: "modify" } });
    });
    await settle();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Edited in the linked Markdown.",
    );
  });

  it("retains an unsaved popup draft if the same comment was edited elsewhere", async () => {
    await render();
    await pointer(true, true);
    await click(button("pdfReading.addNote"));
    await writeComment("Original comment");
    await click(button("pdfReading.saveNote"));
    await click(button("pdfReading.editNote"));
    await writeComment("My unsaved popup draft");
    mock.disk = mock.disk.replace("Original comment", "Changed in Markdown");
    await click(button("pdfReading.saveNote"));
    expect(parsePdfNotes(mock.disk).annotations[0]?.note).toBe("Changed in Markdown");
    expect(container.querySelector("textarea")?.value).toBe("My unsaved popup draft");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("pdfReading.conflict");
  });

  it("hides old anchors when actual PDF bytes change even if the permanent PDF ID does not", async () => {
    await render();
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    expect(container.querySelectorAll("[data-pdf-annotation-paint]")).toHaveLength(1);
    mock.revision += 1;
    await act(async () => {
      for (const watcher of mock.watchers) watcher({ payload: { path: pdfPath, kind: "modify" } });
    });
    await settle();
    expect(container.querySelectorAll("[data-pdf-annotation-paint]")).toHaveLength(0);
    expect(container.textContent).toContain("pdfReading.staleAnnotations");
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(1);
  });
});

describe("associated Markdown notes editor", () => {
  const genericSave = vi.fn();
  async function renderNotes() {
    await act(async () => {
      root.render(
        createElement(PdfNotesEditor, {
          filePath: `${pdfPath}.notes.md`,
          pdfPath,
          projectPath: "/project",
          content: mock.disk,
          onContentChange: genericSave,
        }),
      );
    });
    await settle();
  }

  it("auto-saves free-form Markdown through the protected notes flow instead of generic file writes", async () => {
    genericSave.mockReset();
    await renderNotes();
    const updated = `${mock.disk}\n## My summary\n\nA useful result.\n`;
    await writeComment(updated);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
    });
    expect(mock.disk).toBe(updated);
    expect(genericSave).not.toHaveBeenCalled();
    expect(container.textContent).toContain("editor.savedStatus");
  });

  it("keeps a conflicting draft intact across a tab switch", async () => {
    await renderNotes();
    const local = `${mock.disk}\nMy local draft\n`;
    await writeComment(local);
    mock.disk += "\nExternal update\n";
    await act(async () => {
      for (const watcher of mock.watchers)
        watcher({ payload: { path: `${pdfPath}.notes.md`, kind: "modify" } });
    });
    await settle();
    expect(container.querySelector("textarea")?.value).toBe(local);
    expect(container.textContent).toContain("pdfReading.conflict");
    await act(async () => {
      root.unmount();
      root = createRoot(container);
    });
    await renderNotes();
    expect(container.querySelector("textarea")?.value).toBe(local);
    expect(mock.disk).toContain("External update");
    expect(mock.disk).not.toContain("My local draft");
  });
});
