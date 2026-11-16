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
  prepare: vi.fn(),
  disposeGeometry: vi.fn(),
  outline: [] as unknown[],
  getTextContent: vi.fn(),
  watchers: new Set<(event: { payload: { path: string; kind: string } }) => void>(),
}));
vi.mock("../lib/pdf-geometry", () => ({
  PdfGeometryClient: class {
    refineSelection = mock.refineSelection;
    refineAnnotation = mock.refineAnnotation;
    prepare = mock.prepare;
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
// Icons render nothing; mapping every export keeps the mock in step with the components.
vi.mock("@phosphor-icons/react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map((name) => [name, () => null]));
});
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
        getOutline: async () => mock.outline,
        getDestination: async (name: string) => (name === "second" ? [{ num: 7, gen: 0 }] : null),
        getPageIndex: async (ref: { num: number }) => (ref.num === 7 ? 1 : 0),
        getPage: async (number: number) => ({
          getTextContent: () => mock.getTextContent(number),
        }),
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

function button(label: string, scope: ParentNode = container) {
  const target = [...scope.querySelectorAll("button")].find(
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

async function render(extra: Partial<Parameters<typeof PdfViewer>[0]> = {}) {
  await act(async () => {
    root.render(
      createElement(PdfViewer, {
        src: "/fixture.pdf",
        projectPath: "/project",
        pdfPath,
        onSynctexClick: jump,
        onOpenNotes: openNotes,
        ...extra,
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
  mock.prepare.mockReset();
  mock.outline = [];
  mock.getTextContent.mockReset().mockImplementation(async (number: number) => ({
    items: [{ str: "Important finding", hasEOL: true }, { str: `on page ${number}.` }],
  }));
  jump.mockReset();
  openNotes.mockReset();
  mock.invoke.mockImplementation(async (command: string, request: Record<string, unknown>) => {
    if (command === "pdf_notes_load")
      return { content: mock.disk, revision: `revision:${mock.disk}` };
    if (command === "pdf_notes_save") {
      if (request.expectedRevision !== `revision:${mock.disk}`)
        throw new Error("PDF_NOTES_CONFLICT");
      mock.disk = String(request.content);
      return `revision:${mock.disk}`;
    }
    if (command === "pdf_can_sync_source") return mock.source;
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

  it("prepares the glyphs of the page being read and its neighbor before any selection", async () => {
    await render();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
    });
    expect(mock.prepare.mock.calls.map(([page]) => page)).toEqual([1, 2]);
    expect(mock.refineSelection).not.toHaveBeenCalled();
  });

  it("offers the actions when the pointer is released outside the page and withdraws them with the selection", async () => {
    await render();
    const text = container.querySelector(".react-pdf__Page__textContent span")?.firstChild;
    if (!text) throw new Error("Missing PDF text");
    await act(async () => {
      text.parentElement?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 80, clientY: 80 }),
      );
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 9);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      document.body.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    });
    await settle();
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    // Clearing the selection anywhere else must not leave actions for vanished text.
    await act(async () => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    await settle();
    await settle();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("opens a saved highlight with one click even while its own text is still selected", async () => {
    await render();
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    const text = container.querySelector(".react-pdf__Page__textContent span");
    if (!text?.firstChild) throw new Error("Missing PDF text");
    const range = document.createRange();
    range.setStart(text.firstChild, 0);
    range.setEnd(text.firstChild, 9);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    // The browser collapses a clicked selection only after pointerup.
    await act(async () => {
      for (const type of ["pointerdown", "pointerup"])
        text.dispatchEvent(
          new MouseEvent(type, { bubbles: true, button: 0, clientX: 80, clientY: 80 }),
        );
      window.getSelection()?.removeAllRanges();
    });
    await settle();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
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
      expect(action?.hasAttribute("title")).toBe(false);
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
    expect(trigger.getAttribute("data-color")).toBe("info");
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
    const notes = mock.disk;
    await click(button("pdfReading.read"));
    await pointer(false);
    expect(jump).toHaveBeenCalledTimes(1);
    // The mode is a reader preference: it survives reopening without touching the notes.
    expect(mock.disk).toBe(notes);
    await act(async () => {
      root.unmount();
      root = createRoot(container);
    });
    await render();
    expect(button("pdfReading.read").getAttribute("aria-pressed")).toBe("true");
  });

  it("confirms deleting an annotation in the app's own dialog, never a native prompt", async () => {
    const native = vi.spyOn(window, "confirm");
    await render();
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    await pointer(false);
    await click(button("pdfReading.deleteAnnotation"));
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("pdfReading.deleteConfirm");
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(1);
    await click(button("common.cancel", document.body));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(1);
    await click(button("pdfReading.deleteAnnotation"));
    await click(button("common.delete", document.body));
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(native).not.toHaveBeenCalled();
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

async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(target: Element, name: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
    );
  });
  await settle();
}

function field(label: string) {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`Missing field: ${label}`);
  return input;
}

/** Lay the two fixture pages out one below the other in a 600px-high pane. */
function stackPages() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const scroller = container.querySelector<HTMLElement>("[data-pdf-scroll]");
    const scrolled = scroller?.scrollTop ?? 0;
    const page = Number(this.getAttribute("data-pdf-page") ?? 0);
    if (page) return new DOMRect(0, (page - 1) * 800 - scrolled, 612, 792);
    if (!this.classList.contains("inkwell-pdf-search-hit")) return new DOMRect(0, 0, 612, 600);
    const owner = Number(this.closest("[data-pdf-page]")?.getAttribute("data-pdf-page") ?? 1);
    return new DOMRect(72, (owner - 1) * 800 + 100 - scrolled, 150, 20);
  });
}

describe("PDF excerpts for writing and the agent", () => {
  it("hides the quote and agent actions unless their callbacks are provided", async () => {
    await render();
    await pointer(true, true);
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar?.querySelector('[aria-label="pdfReading.quote"]')).toBeNull();
    expect(toolbar?.querySelector('[aria-label="pdfReading.addToAgent"]')).toBeNull();
    await render({ onQuote: vi.fn() });
    const labels = [...(toolbar?.querySelectorAll("button") ?? [])].map((item) =>
      item.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "pdfReading.highlight",
      "pdfReading.underline",
      "pdfReading.addNote",
      "translation.action",
      "pdfReading.quote",
      "pdfReading.color",
    ]);
  });

  it("sends the selected passage with its page and clears the selection", async () => {
    const quote = vi.fn();
    const agent = vi.fn();
    await render({ onQuote: quote, onAddToAgent: agent });
    await pointer(true, true);
    await click(button("pdfReading.quote"));
    expect(quote).toHaveBeenCalledWith({ text: "Important", page: 1 });
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(window.getSelection()?.isCollapsed).toBe(true);
    await pointer(true, true);
    await click(button("pdfReading.addToAgent"));
    expect(agent).toHaveBeenCalledWith({ text: "Important", page: 1 });
    expect(agent).toHaveBeenCalledTimes(1);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
  });

  it("keeps both actions usable when notes cannot be written, and arrow keys reach them", async () => {
    mock.invoke.mockImplementation(async () => {
      throw new Error("PDF_NOTES_INVALID");
    });
    await render({ onQuote: vi.fn(), onAddToAgent: vi.fn() });
    await pointer(true, true);
    expect(button("pdfReading.highlight").disabled).toBe(true);
    const translate = button("translation.action");
    expect(translate.tabIndex).toBe(0);
    expect(button("pdfReading.quote").disabled).toBe(false);
    await act(async () => translate.focus());
    await key(translate, "ArrowRight");
    expect(document.activeElement).toBe(button("pdfReading.quote"));
    await key(button("pdfReading.quote"), "ArrowRight");
    expect(document.activeElement).toBe(button("pdfReading.addToAgent"));
    expect(button("pdfReading.addToAgent").tabIndex).toBe(0);
    await key(button("pdfReading.addToAgent"), "ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("pdfReading.color");
    expect((document.activeElement as HTMLElement).tabIndex).toBe(0);
    await key(button("pdfReading.color"), "End");
    await key(button("pdfReading.color"), "ArrowRight");
    expect(document.activeElement).toBe(translate);
  });

  it("offers the same actions for a saved annotation without closing its popup", async () => {
    const quote = vi.fn();
    const agent = vi.fn();
    await render({ onQuote: quote, onAddToAgent: agent });
    await pointer(true, true);
    await click(button("pdfReading.highlight"));
    await pointer(false);
    const dialog = container.querySelector('[role="dialog"]');
    const send = dialog?.querySelector('[aria-label="pdfReading.addToAgent"]');
    const cite = dialog?.querySelector('[aria-label="pdfReading.quote"]');
    if (!send || !cite) throw new Error("Missing popup excerpt actions");
    await click(send);
    await click(cite);
    expect(agent).toHaveBeenCalledWith({ text: "Important", page: 1 });
    expect(quote).toHaveBeenCalledWith({ text: "Important", page: 1 });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await render();
    expect(container.querySelector('[role="dialog"] [aria-label="pdfReading.quote"]')).toBeNull();
  });
});

describe("PDF reading shortcuts", () => {
  const pane = () => {
    const scroller = container.querySelector<HTMLElement>("[data-pdf-scroll]");
    if (!scroller) throw new Error("Missing PDF pane");
    return scroller;
  };

  it("marks, quotes and hands off the selection with single keys", async () => {
    const quote = vi.fn();
    const agent = vi.fn();
    await render({ onQuote: quote, onAddToAgent: agent });
    await pointer(true, true);
    await key(pane(), "h");
    expect(parsePdfNotes(mock.disk).annotations).toMatchObject([{ kind: "highlight" }]);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    await pointer(true, true);
    await key(pane(), "U");
    expect(parsePdfNotes(mock.disk).annotations.map((item) => item.kind)).toContain("underline");
    await pointer(true, true);
    await key(pane(), "q");
    expect(quote).toHaveBeenCalledWith({ text: "Important", page: 1 });
    await pointer(true, true);
    await key(pane(), "a");
    expect(agent).toHaveBeenCalledWith({ text: "Important", page: 1 });
    await pointer(true, true);
    await key(pane(), "n");
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("ignores selection keys without a selection, a callback or a modifier-free press", async () => {
    await render();
    await key(pane(), "h");
    await key(pane(), "n");
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
    expect(container.querySelector("textarea")).toBeNull();
    await pointer(true, true);
    await key(pane(), "q");
    await key(pane(), "a");
    await key(pane(), "h", { ctrlKey: true });
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(parsePdfNotes(mock.disk).annotations).toHaveLength(0);
    await key(pane(), "Escape");
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("opens translation with T and leaves typing in fields alone", async () => {
    await render();
    await pointer(true, true);
    await key(pane(), "t");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    await key(document.body, "Escape");
    const input = field("pdfReading.pageNumber");
    await key(input, "j");
    await key(input, "+");
    expect(button("editor.resetZoom").textContent).toBe("100%");
  });

  it("zooms with + - 0, turns pages with J K and arrows, and finds with /", async () => {
    stackPages();
    await render();
    const input = field("pdfReading.pageNumber");
    await key(pane(), "0");
    expect(button("editor.resetZoom").textContent).toBe("100%");
    expect(button("pdfReading.fitWidth").getAttribute("aria-pressed")).toBe("false");
    await key(pane(), "+");
    expect(button("editor.resetZoom").textContent).toBe("125%");
    await key(pane(), "-");
    await key(pane(), "-");
    expect(button("editor.resetZoom").textContent).toBe("75%");
    await key(pane(), "j");
    expect(input.value).toBe("2");
    await key(pane(), "j");
    expect(input.value).toBe("2");
    await key(pane(), "k");
    expect(input.value).toBe("1");
    await key(pane(), "ArrowRight");
    expect(input.value).toBe("2");
    await key(pane(), "ArrowLeft");
    expect(input.value).toBe("1");
    await key(pane(), "/");
    expect(container.querySelector("[data-pdf-find]")).not.toBeNull();
  });
});

describe("PDF page navigation", () => {
  it("shows the current page, jumps on Enter or blur and restores invalid input", async () => {
    stackPages();
    await render();
    const scroller = container.querySelector<HTMLElement>("[data-pdf-scroll]");
    const input = field("pdfReading.pageNumber");
    expect(input.value).toBe("1");
    expect(input.parentElement?.textContent).toBe("/ 2");
    expect(button("pdfReading.previousPage").disabled).toBe(true);
    await type(input, "2");
    await key(input, "Enter");
    expect(input.value).toBe("2");
    expect(scroller?.scrollTop).toBe(792);
    expect(button("pdfReading.nextPage").disabled).toBe(true);
    for (const invalid of ["9", "0", "abc", "1.5", ""]) {
      await type(input, invalid);
      await key(input, "Enter");
      expect(input.value).toBe("2");
    }
    expect(scroller?.scrollTop).toBe(792);
    await type(input, "1");
    await act(async () => input.blur());
    expect(input.value).toBe("1");
    expect(scroller?.scrollTop).toBe(0);
    await click(button("pdfReading.nextPage"));
    expect(input.value).toBe("2");
    await click(button("pdfReading.previousPage"));
    expect(input.value).toBe("1");
  });

  it("follows the page that fills the pane while scrolling", async () => {
    stackPages();
    await render();
    const scroller = container.querySelector<HTMLElement>("[data-pdf-scroll]");
    if (!scroller) throw new Error("Missing PDF scroll pane");
    await act(async () => {
      scroller.scrollTop = 700;
      scroller.dispatchEvent(new Event("scroll"));
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    expect(field("pdfReading.pageNumber").value).toBe("2");
  });
});

describe("PDF reading position", () => {
  const stored = (page: number) =>
    JSON.stringify({ [`/project\n${pdfPath}`]: { page, scale: 1.5, fitWidth: false } });

  it("reopens a PDF on its last page and zoom", async () => {
    stackPages();
    localStorage.setItem("inkwell-pdf-position-v1", stored(2));
    await render();
    expect(field("pdfReading.pageNumber").value).toBe("2");
    expect(container.querySelector<HTMLElement>("[data-pdf-scroll]")?.scrollTop).toBe(792);
    expect(button("editor.resetZoom").textContent).toBe("150%");
    expect(button("pdfReading.fitWidth").getAttribute("aria-pressed")).toBe("false");
  });

  it("restores only the zoom of a compiled preview", async () => {
    stackPages();
    localStorage.setItem("inkwell-pdf-position-v1", stored(2));
    await render({ compiledPreview: true });
    expect(field("pdfReading.pageNumber").value).toBe("1");
    expect(container.querySelector<HTMLElement>("[data-pdf-scroll]")?.scrollTop).toBe(0);
    expect(button("editor.resetZoom").textContent).toBe("150%");
  });

  it("saves the page and zoom after a 500ms pause and leaves an untouched PDF unrecorded", async () => {
    stackPages();
    await render();
    await click(button("pdfReading.nextPage"));
    await click(button("editor.zoomIn"));
    expect(localStorage.getItem("inkwell-pdf-position-v1")).toBeNull();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 560));
    });
    expect(JSON.parse(localStorage.getItem("inkwell-pdf-position-v1") ?? "{}")).toEqual({
      [`/project\n${pdfPath}`]: { page: 2, scale: 1.25, fitWidth: false },
    });
  });

  it("writes a pending position when the viewer closes", async () => {
    stackPages();
    await render();
    await click(button("pdfReading.nextPage"));
    await act(async () => {
      root.unmount();
      root = createRoot(container);
    });
    expect(localStorage.getItem("inkwell-pdf-position-v1")).toContain('"page":2');
  });
});

describe("PDF find", () => {
  const status = () => container.querySelector("[data-pdf-find-status]")?.textContent;

  it("opens with Ctrl/Cmd+F inside the pane, counts matches and steps through them", async () => {
    stackPages();
    await render();
    expect(container.querySelector("[data-pdf-find]")).toBeNull();
    const pane = container.firstElementChild;
    if (!pane) throw new Error("Missing PDF pane");
    const shortcut = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      pane.dispatchEvent(shortcut);
    });
    expect(shortcut.defaultPrevented).toBe(true);
    const input = field("pdfReading.find");
    expect(document.activeElement).toBe(input);
    expect(mock.getTextContent).not.toHaveBeenCalled();
    await type(input, "FINDING  on");
    await settle();
    expect(status()).toBe("1 / 2");
    expect(mock.getTextContent).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll(".inkwell-pdf-search-hit").length).toBeGreaterThanOrEqual(2);
    const current = () =>
      container.querySelector("[data-pdf-search-current]")?.closest("[data-pdf-page]");
    expect(current()?.getAttribute("data-pdf-page")).toBe("1");
    await key(input, "Enter");
    expect(status()).toBe("2 / 2");
    expect(current()?.getAttribute("data-pdf-page")).toBe("2");
    // The match on page 2 is centered in the 600px pane.
    expect(container.querySelector<HTMLElement>("[data-pdf-scroll]")?.scrollTop).toBe(610);
    await key(input, "Enter");
    expect(status()).toBe("1 / 2");
    await key(input, "Enter", { shiftKey: true });
    expect(status()).toBe("2 / 2");
    await click(button("pdfReading.findPrevious"));
    expect(status()).toBe("1 / 2");
    await type(input, "page 2");
    await settle();
    expect(status()).toBe("1 / 1");
    expect(mock.getTextContent).toHaveBeenCalledTimes(2);
    await type(input, "absent");
    await settle();
    expect(status()).toBe("pdfReading.findNoResults");
    expect(container.querySelector(".inkwell-pdf-search-hit")).toBeNull();
    expect(button("pdfReading.findNext").disabled).toBe(true);
  });

  it("closes on Escape, returns focus to the pane and removes the highlights", async () => {
    await render();
    await click(button("pdfReading.find"));
    const input = field("pdfReading.find");
    await type(input, "important");
    await settle();
    expect(container.querySelector(".inkwell-pdf-search-hit")).not.toBeNull();
    await key(input, "Escape");
    expect(container.querySelector("[data-pdf-find]")).toBeNull();
    expect(container.querySelector(".inkwell-pdf-search-hit")).toBeNull();
    expect(document.activeElement).toBe(container.firstElementChild);
    expect(button("pdfReading.find").getAttribute("aria-pressed")).toBe("false");
    // Reopening shows the previous query together with its matches.
    await click(button("pdfReading.find"));
    expect(field("pdfReading.find").value).toBe("important");
    expect(document.activeElement).toBe(field("pdfReading.find"));
    expect(container.querySelector(".inkwell-pdf-search-hit")).not.toBeNull();
  });

  it("reports progress while extracting and searches the new text after the PDF changes", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.getTextContent.mockImplementation(async () => {
      await gate;
      return { items: [{ str: "Old text" }] };
    });
    await render();
    await click(button("pdfReading.find"));
    await type(field("pdfReading.find"), "text");
    await settle();
    expect(status()).toBe("pdfReading.findSearching");
    mock.getTextContent.mockImplementation(async () => ({ items: [{ str: "New text text" }] }));
    await render({ refreshKey: 1 });
    release?.();
    await settle();
    await settle();
    expect(status()).toBe("1 / 4");
  });
});

describe("PDF outline", () => {
  it("has no outline button for a PDF without one", async () => {
    await render();
    expect(container.querySelector('[aria-label="pdfReading.outline"]')).toBeNull();
  });

  it("lists nested entries and jumps to explicit and named destinations", async () => {
    stackPages();
    mock.outline = [
      {
        title: "Introduction",
        dest: [{ num: 3, gen: 0 }, { name: "XYZ" }],
        items: [{ title: "Method", dest: "second", items: [] }],
      },
      { title: "Missing", dest: "nowhere", items: [] },
    ];
    await render();
    const trigger = button("pdfReading.outline");
    await click(trigger);
    const panel = container.querySelector('nav[aria-label="pdfReading.outline"]');
    const entries = [...(panel?.querySelectorAll("button") ?? [])];
    expect(entries.map((item) => item.textContent)).toEqual(["Introduction", "Method", "Missing"]);
    expect(entries[1]?.style.paddingLeft).not.toBe(entries[0]?.style.paddingLeft);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const missing = entries[2];
    const method = entries[1];
    if (!missing || !method) throw new Error("Missing outline entries");
    await click(missing);
    expect(field("pdfReading.pageNumber").value).toBe("1");
    expect(container.querySelector('nav[aria-label="pdfReading.outline"]')).not.toBeNull();
    await click(method);
    expect(field("pdfReading.pageNumber").value).toBe("2");
    expect(container.querySelector('nav[aria-label="pdfReading.outline"]')).toBeNull();
  });

  it("closes on Escape or an outside press", async () => {
    mock.outline = [{ title: "Introduction", dest: null, items: [] }];
    await render();
    const open = () => container.querySelector('nav[aria-label="pdfReading.outline"]') !== null;
    await click(button("pdfReading.outline"));
    expect(open()).toBe(true);
    await key(document.body, "Escape");
    expect(open()).toBe(false);
    await click(button("pdfReading.outline"));
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    expect(open()).toBe(false);
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
