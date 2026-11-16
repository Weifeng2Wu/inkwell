"use client";

import {
  ArrowSquareOutIcon,
  ArrowsHorizontalIcon,
  HighlighterIcon,
  ListIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  NoteIcon,
  PlusIcon,
  QuotesIcon,
  SparkleIcon,
  TextUnderlineIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import dynamic from "next/dynamic";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import { shortcutLabel } from "@/features/settings";
import { readTranslationConfig, type TranslationConfig } from "@/features/translation";
import { appStorage } from "@/lib/storage/app-storage";
import type { PdfExcerpt } from "@/types/editor-selection";
import { PdfGeometryClient, type PdfPaintAnnotation } from "../lib/pdf-geometry";
import { pdfNavigationPoint } from "../lib/pdf-navigation";
import {
  isPdfAnnotationColor,
  type PdfAnnotation,
  type PdfAnnotationColor,
  type PdfAnnotationKind,
  pdfNotesPath,
} from "../lib/pdf-notes";
import { PDF_DOCUMENT_OPTIONS } from "../lib/pdf-options";
import { clampPdfPage, createPdfPageStore, pdfExcerpt } from "../lib/pdf-page";
import {
  loadPdfPosition,
  type PdfReadingMode,
  pdfPositionKey,
  savePdfMode,
} from "../lib/pdf-position";
import { type PdfSelectionPage, samePdfRange } from "../lib/pdf-selection";
import { type PdfToolbarAnchor, pdfSelectionAnchor } from "../lib/pdf-toolbar-position";
import { usePdfAnnotationGeometry } from "../lib/use-pdf-annotation-geometry";
import { usePdfNotes } from "../lib/use-pdf-notes";
import { scrollToPdfPage, usePdfPageTracking } from "../lib/use-pdf-page";
import { usePdfPosition } from "../lib/use-pdf-position";
import { usePdfSearch } from "../lib/use-pdf-search";
import { usePdfSelection } from "../lib/use-pdf-selection";
import { usePdfSource } from "../lib/use-pdf-source";
import { PdfAnnotationLayer } from "./pdf-annotation-layer";
import { PdfColorPicker } from "./pdf-color-picker";
import { PdfFindBar } from "./pdf-find-bar";
import { PdfOutlinePanel, usePdfOutline } from "./pdf-outline";
import { PdfPageNavigation } from "./pdf-page-navigation";
import { PdfSearchLayer } from "./pdf-search-layer";
import { PdfSelectionPreview } from "./pdf-selection-preview";
import { PdfSelectionToolbar } from "./pdf-selection-toolbar";
import { PdfTranslationPanel } from "./pdf-translation-panel";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./pdf-viewer.css";

const MarkdownContent = dynamic(() =>
  import("@/components/markdown/markdown-content").then((module) => module.MarkdownContent),
);

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Props = {
  src: string;
  projectPath: string;
  pdfPath: string;
  onOpenNotes: (path: string) => void;
  compiledPreview?: boolean;
  onSynctexClick?: (page: number, x: number, y: number) => void;
  refreshKey?: number;
  /** Quote the selected passage in the manuscript. The action is hidden when absent. */
  onQuote?: (excerpt: PdfExcerpt) => void;
  /** Attach the selected passage to the agent chat. The action is hidden when absent. */
  onAddToAgent?: (excerpt: PdfExcerpt) => void;
};
type Selection = { annotations: PdfAnnotation[]; anchor: PdfToolbarAnchor };
type NotePopup = {
  annotations: PdfAnnotation[];
  existing: boolean;
  editing: boolean;
  text: string;
  error?: string;
};
const EMPTY_ANNOTATIONS: PdfAnnotation[] = [];

export function PdfViewer({
  src,
  projectPath,
  pdfPath,
  onOpenNotes,
  compiledPreview = false,
  onSynctexClick,
  refreshKey = 0,
  onQuote,
  onAddToAgent,
}: Props) {
  const { t } = useI18n();
  const notes = usePdfNotes(projectPath, pdfPath);
  const source = usePdfSource(projectPath, pdfPath);
  const [numPages, setNumPages] = useState(0);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageStore] = useState(() => createPdfPageStore());
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [fingerprint, setFingerprint] = useState("");
  const [geometry, setGeometry] = useState<PdfGeometryClient | null>(null);
  const geometryRef = useRef<PdfGeometryClient | null>(null);
  // The viewer is keyed per PDF, so the saved position is read once per mount.
  const positionKey = pdfPositionKey(projectPath, pdfPath);
  const [savedPosition] = useState(() => loadPdfPosition(positionKey));
  const [chosenMode, setChosenMode] = useState<PdfReadingMode | undefined>(savedPosition?.mode);
  const [scale, setScale] = useState(savedPosition?.scale ?? 1);
  const [fitWidth, setFitWidth] = useState(savedPosition?.fitWidth ?? true);
  const [pageWidth, setPageWidth] = useState(612);
  const [color, setColor] = useState<PdfAnnotationColor>("warning");
  const [translation, setTranslation] = useState<{
    annotations: PdfAnnotation[];
    config: TranslationConfig;
  } | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [popup, setPopup] = useState<NotePopup | null>(null);
  /** A destructive popup action awaiting confirmation in the app's own dialog. */
  const [confirming, setConfirming] = useState<"delete" | "discard" | null>(null);
  const [continuous, setContinuous] = useState<PdfAnnotationKind | null>(null);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(48);
  const containerRef = useRef<HTMLDivElement>(null);
  const onTextLayerRendered = useCallback(() => {
    rootRef.current?.dispatchEvent(new Event("inkwell-pdf-text-layer-ready"));
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const noteInputId = useId();
  const modeIndicatorId = `pdf-mode-${useId()}`;
  const reducedMotion = useReducedMotion();
  const position = usePdfPosition({
    storageKey: positionKey,
    initial: savedPosition,
    restorePage: !compiledPreview,
    containerRef,
    store: pageStore,
    numPages,
    scale,
    fitWidth,
  });
  usePdfPageTracking(containerRef, pageStore, position.restoring);
  const search = usePdfSearch(pdfDocument, pageStore.get);
  const outline = usePdfOutline(pdfDocument);
  const closeOutline = useCallback(() => setOutlineOpen(false), []);
  const { settle: settlePosition } = position;
  const goToPage = useCallback(
    (page: number) => {
      settlePosition();
      scrollToPdfPage(containerRef.current, clampPdfPage(page, numPages), pageStore);
    },
    [settlePosition, numPages, pageStore],
  );
  const { show: showFind, close: hideFind } = search;
  const openFind = useCallback(() => {
    settlePosition();
    showFind();
  }, [settlePosition, showFind]);
  const closeFind = useCallback(() => {
    hideFind();
    rootRef.current?.focus();
  }, [hideFind]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const handleFind = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      openFind();
    };
    root.addEventListener("keydown", handleFind);
    return () => root.removeEventListener("keydown", handleFind);
  }, [openFind]);
  useEffect(() => {
    try {
      const saved = appStorage.getItem("inkwell-pdf-color-v1");
      if (isPdfAnnotationColor(saved)) setColor(saved);
    } catch {
      /* The default remains usable if preferences are unavailable. */
    }
  }, []);
  function chooseColor(value: PdfAnnotationColor) {
    setColor(value);
    try {
      appStorage.setItem("inkwell-pdf-color-v1", value);
    } catch {
      /* Annotations still persist their own color. */
    }
  }
  const documentKey = `${src}.${pdfPath}.${refreshKey}.${source.pdfRevision}`;
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const measure = () => setToolbarHeight(toolbar.getBoundingClientRect().height || 48);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, []);
  const documentGeneration = useRef({ key: documentKey, value: 0 });
  const liveSelection = usePdfSelection({
    rootRef,
    geometryKey: `${documentKey}.${numPages}.${scale}`,
    geometry,
    onSettle: handleSelectionSettled,
  });
  const { dismiss: dismissSelection } = liveSelection;
  const pressed = useRef<{ page: number; x: number; y: number; range: Range | null } | null>(null);
  // Glyph extraction is per page and lazy. Warm the page being read and its
  // neighbors once scrolling pauses, so the first selection there is immediate.
  useEffect(() => {
    if (!geometry || numPages < 1) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const warm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const current = pageStore.get();
        for (const page of [current, current + 1, current - 1])
          if (page >= 1 && page <= numPages) geometry.prepare(page);
      }, 150);
    };
    warm();
    const unsubscribe = pageStore.subscribe(warm);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [geometry, numPages, pageStore]);
  const canSync = Boolean(onSynctexClick && (source.canSyncSource || compiledPreview));
  const preferredMode = chosenMode ?? (canSync ? "write" : "read");
  const mode = canSync ? preferredMode : "read";
  const writable =
    notes.content !== undefined && !notes.error && !notes.busy && Boolean(fingerprint);
  const staleCount = fingerprint
    ? notes.annotations.filter((item) => item.fingerprint !== fingerprint).length
    : 0;
  const visibleAnnotations = usePdfAnnotationGeometry(notes.annotations, fingerprint, geometry);
  const annotationsByPage = useMemo(() => {
    const pages = new Map<number, PdfPaintAnnotation[]>();
    for (const item of visibleAnnotations) {
      if (item.fingerprint !== fingerprint) continue;
      const annotations = pages.get(item.page) ?? [];
      annotations.push(item);
      pages.set(item.page, annotations);
    }
    return pages;
  }, [visibleAnnotations, fingerprint]);

  useEffect(() => {
    const beforeClose = (event: Event) => {
      const tasks = (event as CustomEvent<Promise<unknown>[]>).detail;
      if (Array.isArray(tasks)) tasks.push(notes.session.flush());
    };
    window.addEventListener("inkwell-before-close", beforeClose);
    return () => window.removeEventListener("inkwell-before-close", beforeClose);
  }, [notes.session]);

  const onDocumentLoadSuccess = useCallback(async (pdf: PDFDocumentProxy) => {
    const generation = ++documentGeneration.current.value;
    geometryRef.current?.dispose();
    geometryRef.current = null;
    setGeometry(null);
    setNumPages(pdf.numPages);
    setPdfDocument(pdf);
    setSelected(null);
    let hashed = false;
    try {
      // PDF's permanent /ID can survive edits. Hash the actual bytes so a new
      // revision cannot silently reuse the old annotation coordinates.
      const bytes = new Uint8Array(await pdf.getData());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      if (generation !== documentGeneration.current.value) return;
      setFingerprint(
        Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
      );
      hashed = true;
      const client = new PdfGeometryClient(bytes, async (number) => {
        const viewport = (await pdf.getPage(number)).getViewport({ scale: 1 });
        const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = viewport.transform;
        return { width: viewport.width, height: viewport.height, transform: [a, b, c, d, e, f] };
      });
      geometryRef.current = client;
      setGeometry(client);
    } catch {
      if (generation === documentGeneration.current.value)
        setActionError(hashed ? "PDF_GEOMETRY_FAILED" : "PDF_FINGERPRINT_FAILED");
    }
  }, []);

  useLayoutEffect(() => {
    documentGeneration.current = { key: documentKey, value: documentGeneration.current.value + 1 };
    geometryRef.current?.dispose();
    geometryRef.current = null;
    setGeometry(null);
    setFingerprint("");
    setPdfDocument(null);
    setOutlineOpen(false);
    setSelected(null);
    setTranslation(null);
    return () => {
      documentGeneration.current.value += 1;
      geometryRef.current?.dispose();
      geometryRef.current = null;
    };
  }, [documentKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !fitWidth) return;
    const fitPage = () => {
      const next = (container.clientWidth - 32) / pageWidth;
      if (next > 0) setScale(Math.max(0.25, Math.min(next, 4)));
    };
    fitPage();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitPage);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitWidth, pageWidth]);

  useEffect(() => {
    if (popup?.editing) textareaRef.current?.focus();
  }, [popup?.editing]);

  useEffect(() => {
    setPopup((current) => {
      if (!current?.existing || current.editing) return current;
      const latest = notes.annotations.find((item) => item.id === current.annotations[0]?.id);
      if (!latest) return null;
      return latest.note === current.text && latest.color === current.annotations[0]?.color
        ? current
        : { ...current, annotations: [latest], text: latest.note };
    });
  }, [notes.annotations]);

  const closePopup = useCallback(() => {
    if (
      popup?.editing &&
      (popup.text !== (popup.annotations[0]?.note ?? "") ||
        popup.annotations.some(
          (item) => notes.annotations.find((saved) => saved.id === item.id)?.color !== item.color,
        ))
    ) {
      setConfirming("discard");
      return;
    }
    setPopup(null);
  }, [popup, notes.annotations]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissSelection();
        setSelected(null);
        closePopup();
        setTranslation(null);
        setOutlineOpen(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closePopup, dismissSelection]);

  const heading = (annotation: PdfAnnotation) =>
    t("pdfReading.annotationHeading", {
      page: annotation.page,
      kind: t(`pdfReading.${annotation.kind}`),
    });

  function sendExcerpt(
    handler: (excerpt: PdfExcerpt) => void,
    annotations: PdfAnnotation[],
    clearSelection: boolean,
  ) {
    const excerpt = pdfExcerpt(annotations);
    if (!excerpt) return;
    handler(excerpt);
    if (!clearSelection) return;
    setSelected(null);
    window.getSelection()?.removeAllRanges();
  }

  async function saveSelection(selection: Selection, kind: PdfAnnotationKind) {
    setActionError(undefined);
    try {
      const annotations = selection.annotations.map((item) => ({ ...item, kind, color }));
      await notes.session.addMany(annotations, annotations.map(heading));
      setSelected(null);
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      setActionError(String(error));
    }
  }

  /** The live selection came to rest, changed, or went away: keep its actions in step. */
  function handleSelectionSettled(pages: PdfSelectionPage[], error?: unknown) {
    const root = rootRef.current;
    if (!pages.length && error === undefined) {
      setSelected(null);
      return;
    }
    // Reading the passage being commented on must not replace the open draft.
    if (popup?.editing || !root) return;
    setTranslation(null);
    setPopup(null);
    if (error !== undefined || !fingerprint) {
      setSelected(null);
      if (error !== undefined) setActionError(String(error));
      return;
    }
    const selection: Selection = {
      annotations: pages.map(({ page, quote, rects }) => ({
        id: crypto.randomUUID(),
        page,
        kind: "highlight",
        color,
        quote,
        fingerprint,
        rects,
        note: "",
      })),
      anchor: pdfSelectionAnchor(
        pages.map(({ element, rects }) => ({ bounds: element.getBoundingClientRect(), rects })),
        root.getBoundingClientRect(),
        toolbarHeight,
      ),
    };
    setActionError(undefined);
    if (mode === "read" && continuous && notes.content !== undefined && !notes.error)
      void saveSelection(selection, continuous);
    else setSelected(selection);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>, pageNumber: number) {
    const start = pressed.current;
    pressed.current = null;
    if (event.button !== 0 || !start) return;
    const target = event.target;
    if (target instanceof Element && target.closest("a, button, input, textarea, select")) return;
    // Dragging/selecting must never become a source jump, even if the selection
    // falls outside a text layer or the PDF is scanned and has no text. A plain
    // click on already selected text is still a click: the browser only collapses
    // that selection after this event.
    const selection = window.getSelection();
    const selecting =
      selection?.rangeCount && !selection.isCollapsed
        ? !start.range || !samePdfRange(start.range, selection.getRangeAt(0))
        : false;
    if (
      selecting ||
      start.page !== pageNumber ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4
    )
      return;
    setSelected(null);
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const annotation = [...visibleAnnotations]
      .reverse()
      .find(
        (item) =>
          item.page === pageNumber &&
          item.fingerprint === fingerprint &&
          (item.kind === "highlight" ? (item.highlightRects ?? item.rects) : item.rects).some(
            (area) =>
              x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height,
          ),
      );
    if (annotation) {
      if (popup?.editing) return;
      setPopup({
        annotations: [annotation],
        existing: true,
        editing: false,
        text: annotation.note,
      });
      return;
    }
    if (mode !== "write") return;
    const point = pdfNavigationPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      scale,
      pointerStartedOnPage: true,
      keyboard: false,
    });
    if (point) onSynctexClick?.(pageNumber, point.x, point.y);
  }

  async function savePopup() {
    if (!popup) return;
    const annotations = popup.annotations.map((item) => ({ ...item, note: popup.text }));
    try {
      const first = annotations[0];
      if (popup.existing && first)
        await notes.session.upsert(first, heading(first), popup.annotations[0]?.note);
      else await notes.session.addMany(annotations, annotations.map(heading));
      if (first)
        setPopup({ annotations: [first], existing: true, editing: false, text: popup.text });
      window.getSelection()?.removeAllRanges();
    } catch (error) {
      setPopup((current) => (current ? { ...current, error: String(error) } : current));
    }
  }

  function setPopupColor(value: PdfAnnotationColor) {
    if (!popup) return;
    const annotations = popup.annotations.map((item) => ({ ...item, color: value }));
    if (popup.editing || !popup.existing) {
      setPopup({ ...popup, annotations });
      return;
    }
    const first = annotations[0];
    if (first)
      void notes.session
        .upsert(first, heading(first), first.note)
        .catch((failure: unknown) =>
          setPopup((current) => (current ? { ...current, error: String(failure) } : current)),
        );
  }

  async function saveTranslation(result: string) {
    if (!translation) return;
    const title = t("translation.noteHeading", {
      source: translation.config.source,
      target: translation.config.target,
    });
    // Escape provider text as literal Markdown; it must not inject notes metadata or HTML.
    const literal = result.replace(/[\\`*_{}[\]<>#]/g, "\\$&");
    const annotations = translation.annotations.map((item) => ({
      ...item,
      color,
      note: `### ${title}\n\n${literal}`,
    }));
    await notes.session.addMany(annotations, annotations.map(heading));
  }

  function zoomBy(delta: number) {
    setFitWidth(false);
    setScale((current) => Math.max(0.25, Math.min(current + delta, 4)));
  }
  function resetZoom() {
    setFitWidth(false);
    setScale(1);
  }
  function startNote(selection: Selection) {
    setPopup({
      annotations: selection.annotations.map((item) => ({ ...item, color })),
      existing: false,
      editing: true,
      text: "",
    });
    setSelected(null);
  }
  function startTranslation(selection: Selection) {
    setTranslation({
      annotations: selection.annotations.map((item) => ({ ...item, color })),
      config: readTranslationConfig(),
    });
    setSelected(null);
  }

  // Single-key reading shortcuts. They act only while focus is inside this pane and
  // outside any text field, so they never compete with the editor or global bindings.
  function handleKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.isContentEditable || target.closest("input, textarea, select")) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const selection = !popup && !translation ? selected : null;
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    if (key === "Escape") {
      if (selected) window.getSelection()?.removeAllRanges();
    } else if (key === "/") {
      if (pdfDocument) run(openFind);
    } else if (key === "+" || key === "=") run(() => zoomBy(0.25));
    else if (key === "-") run(() => zoomBy(-0.25));
    else if (key === "0") run(resetZoom);
    else if (key === "j" || key === "k" || key === "ArrowRight" || key === "ArrowLeft") {
      // Arrow keys keep their meaning inside toolbars, menus and popovers.
      if (key.startsWith("Arrow") && target.closest('[role="toolbar"], [role="dialog"], nav'))
        return;
      if (numPages < 1) return;
      const step = key === "j" || key === "ArrowRight" ? 1 : -1;
      run(() => goToPage(pageStore.get() + step));
    } else if (selection) {
      if (key === "h" && writable) run(() => void saveSelection(selection, "highlight"));
      else if (key === "u" && writable) run(() => void saveSelection(selection, "underline"));
      else if (key === "n" && writable) run(() => startNote(selection));
      else if (key === "t") run(() => startTranslation(selection));
      else if (key === "q" && onQuote) run(() => sendExcerpt(onQuote, selection.annotations, true));
      else if (key === "a" && onAddToAgent)
        run(() => sendExcerpt(onAddToAgent, selection.annotations, true));
    }
  }

  const keyHandler = useRef(handleKeyDown);
  keyHandler.current = handleKeyDown;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    root.addEventListener("keydown", listener);
    return () => root.removeEventListener("keydown", listener);
  }, []);

  const error = actionError ?? notes.error;
  const errorMessage = (value: string) =>
    t(
      value.includes("PDF_NOTES_CONFLICT")
        ? "pdfReading.conflict"
        : value.includes("PDF_NOTES_INVALID")
          ? "pdfReading.invalidNotes"
          : value.includes("PDF_SELECTION_TOO_LONG")
            ? "pdfReading.selectionTooLong"
            : value.includes("PDF_GEOMETRY_FAILED")
              ? "pdfReading.geometryFailed"
              : "pdfReading.saveFailed",
    );

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="relative flex h-full flex-col overflow-hidden focus:outline-none"
    >
      <div
        ref={toolbarRef}
        className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-3 py-1.5"
      >
        <div className="flex flex-auto flex-wrap items-center gap-x-2 gap-y-1">
          <fieldset
            aria-label={t("pdfReading.mode")}
            className="flex shrink-0 rounded-md bg-surface-secondary p-0.5"
          >
            {(["read", "write"] as const).map((value) => {
              const unavailable = value === "write" && !canSync;
              return (
                <Tooltip
                  key={value}
                  label={t(unavailable ? "pdfReading.noSource" : `pdfReading.${value}Hint`)}
                >
                  <button
                    type="button"
                    aria-pressed={mode === value}
                    disabled={unavailable}
                    className={`relative h-6 whitespace-nowrap rounded px-2.5 text-xs transition-colors duration-100 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${mode === value ? "text-foreground" : "text-muted hover:text-foreground"}`}
                    onClick={() => {
                      dismissSelection();
                      setChosenMode(value);
                      savePdfMode(positionKey, value);
                      setSelected(null);
                      setContinuous(null);
                    }}
                  >
                    {mode === value && (
                      <motion.span
                        layoutId={modeIndicatorId}
                        transition={
                          reducedMotion
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 520, damping: 42 }
                        }
                        className="absolute inset-0 rounded border border-border bg-background shadow-sm"
                      />
                    )}
                    <span className="relative">{t(`pdfReading.${value}`)}</span>
                  </button>
                </Tooltip>
              );
            })}
          </fieldset>
          <button
            type="button"
            className="flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs text-foreground-secondary transition-colors duration-100 hover:bg-surface-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={notes.content === undefined}
            onClick={() => onOpenNotes(pdfNotesPath(pdfPath))}
          >
            <NoteIcon aria-hidden="true" className="size-4" />
            {t("pdfReading.openNotes")}
          </button>
        </div>
        {mode === "read" && (
          <div className="flex flex-wrap items-center gap-1.5">
            <fieldset className="flex gap-0.5" aria-label={t("pdfReading.continuous")}>
              {(
                [
                  { kind: "highlight", Icon: HighlighterIcon, label: "continuousHighlight" },
                  { kind: "underline", Icon: TextUnderlineIcon, label: "continuousUnderline" },
                ] as const
              ).map(({ kind, Icon, label }) => (
                <Tooltip key={kind} label={t(`pdfReading.${label}Hint`)}>
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    aria-pressed={continuous === kind}
                    disabled={!writable}
                    aria-label={t(`pdfReading.${label}`)}
                    onClick={() => setContinuous((current) => (current === kind ? null : kind))}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              ))}
            </fieldset>
            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
            <PdfColorPicker value={color} onChange={chooseColor} />
          </div>
        )}
        <div className="flex flex-auto flex-wrap items-center justify-end gap-x-1 gap-y-1 text-xs text-muted">
          <Tooltip label={t("pdfReading.find")} keys={`/ · ${shortcutLabel("Mod+F")}`}>
            <button
              type="button"
              className="toolbar-icon-button"
              aria-pressed={search.open}
              aria-label={t("pdfReading.find")}
              disabled={!pdfDocument}
              onClick={() => (search.open ? closeFind() : openFind())}
            >
              <MagnifyingGlassIcon aria-hidden="true" className="size-4" />
            </button>
          </Tooltip>
          {outline.length > 0 && (
            <Tooltip label={t("pdfReading.outline")}>
              <button
                type="button"
                data-pdf-outline-trigger
                className="toolbar-icon-button"
                aria-expanded={outlineOpen}
                data-state={outlineOpen ? "open" : "closed"}
                aria-label={t("pdfReading.outline")}
                onClick={() => setOutlineOpen((open) => !open)}
              >
                <ListIcon aria-hidden="true" className="size-4" />
              </button>
            </Tooltip>
          )}
          {numPages > 0 ? (
            <PdfPageNavigation store={pageStore} numPages={numPages} onGo={goToPage} />
          ) : (
            <span className="whitespace-nowrap px-1">{t("common.loading")}</span>
          )}
          <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
          <fieldset aria-label={t("pdfReading.zoom")} className="flex shrink-0 items-center">
            <Tooltip label={t("editor.zoomOut")} keys="-">
              <button
                type="button"
                className="toolbar-icon-button"
                aria-label={t("editor.zoomOut")}
                disabled={scale <= 0.25}
                onClick={() => zoomBy(-0.25)}
              >
                <MinusIcon aria-hidden="true" className="size-4" />
              </button>
            </Tooltip>
            <Tooltip label={t("editor.resetZoom")} keys="0">
              <button
                type="button"
                aria-label={t("editor.resetZoom")}
                className="h-7 min-w-12 rounded-md px-1 text-center text-xs tabular-nums text-foreground-secondary transition-colors duration-100 hover:bg-surface-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
                onClick={resetZoom}
              >
                {Math.round(scale * 100)}%
              </button>
            </Tooltip>
            <Tooltip label={t("editor.zoomIn")} keys="+">
              <button
                type="button"
                className="toolbar-icon-button"
                aria-label={t("editor.zoomIn")}
                disabled={scale >= 4}
                onClick={() => zoomBy(0.25)}
              >
                <PlusIcon aria-hidden="true" className="size-4" />
              </button>
            </Tooltip>
          </fieldset>
          <Tooltip label={t("pdfReading.fitWidth")}>
            <button
              type="button"
              className="toolbar-icon-button"
              aria-pressed={fitWidth}
              aria-label={t("pdfReading.fitWidth")}
              onClick={() => setFitWidth(true)}
            >
              <ArrowsHorizontalIcon aria-hidden="true" className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>
      {search.open && (
        <PdfFindBar
          focusToken={search.focusToken}
          query={search.query}
          hasQuery={Boolean(search.needle)}
          searching={search.searching}
          current={search.current}
          total={search.matches.length}
          capped={search.capped}
          onQuery={search.setQuery}
          onStep={search.step}
          onClose={closeFind}
        />
      )}
      {staleCount > 0 && (
        <div
          role="status"
          className="shrink-0 border-b border-border bg-warning/10 px-3 py-2 text-xs text-foreground-secondary"
        >
          {t("pdfReading.staleAnnotations", { count: staleCount })}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs text-error"
        >
          <span>{errorMessage(error)}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setActionError(undefined);
              void notes.session.reload().catch(() => {});
            }}
          >
            {t("pdfReading.retry")}
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        data-pdf-scroll
        onScroll={() => {
          dismissSelection();
          setSelected(null);
        }}
        className="flex-1 overflow-auto bg-surface-secondary p-4"
      >
        <Document
          options={PDF_DOCUMENT_OPTIONS}
          key={documentKey}
          file={
            refreshKey > 0 || source.pdfRevision > 0
              ? `${src}${src.includes("?") ? "&" : "?"}v=${refreshKey}.${source.pdfRevision}`
              : src
          }
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex h-32 items-center justify-center text-sm text-muted">
              {t("editor.loadingPdf")}
            </div>
          }
          error={
            <div className="flex h-32 items-center justify-center text-sm text-muted">
              {t("editor.failedToLoadPdf")}
            </div>
          }
        >
          {Array.from({ length: numPages }, (_, index) => index + 1).map((pageNumber) => (
            <div
              key={`pdf-page-${pageNumber}`}
              data-pdf-page={pageNumber}
              className={`inkwell-pdf-page relative mx-auto mb-4 w-fit shadow-md ${mode === "write" ? "cursor-crosshair" : "cursor-text"}`}
              onPointerDown={(event) => {
                const target = event.target;
                const selection = window.getSelection();
                pressed.current =
                  event.button === 0 &&
                  !(
                    target instanceof Element &&
                    target.closest("a, button, input, textarea, select")
                  )
                    ? {
                        page: pageNumber,
                        x: event.clientX,
                        y: event.clientY,
                        range:
                          selection?.rangeCount && !selection.isCollapsed
                            ? selection.getRangeAt(0).cloneRange()
                            : null,
                      }
                    : null;
              }}
              onPointerCancel={() => {
                pressed.current = null;
              }}
              onPointerUp={(event) => handlePointerUp(event, pageNumber)}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer
                renderAnnotationLayer
                onRenderTextLayerSuccess={onTextLayerRendered}
                onLoadSuccess={(page) => {
                  if (pageNumber === 1) setPageWidth(page.getViewport({ scale: 1 }).width);
                  position.onPageLoaded(pageNumber);
                }}
              />
              {search.pages.has(pageNumber) && (
                <PdfSearchLayer
                  needle={search.needle}
                  current={
                    search.currentMatch?.page === pageNumber ? search.currentMatch.index : -1
                  }
                  jump={search.jump}
                />
              )}
              <PdfAnnotationLayer
                annotations={annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS}
              />
              {(annotationsByPage.get(pageNumber) ?? EMPTY_ANNOTATIONS).map((annotation) => {
                const first = annotation.rects[0];
                return (
                  first && (
                    <button
                      key={annotation.id}
                      type="button"
                      className="absolute right-0 z-[5] rounded border border-border bg-background p-1 focus-visible:outline-2 focus-visible:outline-accent"
                      style={{
                        top: `${first.y * 100}%`,
                        color: `var(--${annotation.color ?? "accent"})`,
                      }}
                      aria-label={t("pdfReading.viewAnnotation", {
                        page: pageNumber,
                        quote: annotation.quote,
                      })}
                      onClick={() => {
                        if (!popup?.editing)
                          setPopup({
                            annotations: [annotation],
                            existing: true,
                            editing: false,
                            text: annotation.note,
                          });
                      }}
                    >
                      <NoteIcon aria-hidden="true" className="size-3" />
                    </button>
                  )
                );
              })}
              {mode === "write" && (
                <button
                  type="button"
                  className="absolute right-1 top-1 z-[5] rounded bg-surface-secondary p-1 text-muted hover:text-accent"
                  aria-label={t("editor.syncPdfPage", { page: pageNumber })}
                  onClick={(event) => {
                    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
                    if (rect)
                      onSynctexClick?.(pageNumber, rect.width / scale / 2, rect.height / scale / 2);
                  }}
                >
                  <ArrowSquareOutIcon className="size-4" aria-hidden="true" />
                </button>
              )}
            </div>
          ))}
        </Document>
      </div>
      <PdfSelectionPreview pages={liveSelection.pages} />
      {selected && !popup && !translation && (
        <PdfSelectionToolbar
          key={selected.annotations[0]?.id}
          rootRef={rootRef}
          anchor={selected.anchor}
          minimumTop={toolbarHeight + 8}
          color={color}
          writable={writable}
          onColorChange={chooseColor}
          onHighlight={() => void saveSelection(selected, "highlight")}
          onUnderline={() => void saveSelection(selected, "underline")}
          onNote={() => startNote(selected)}
          onTranslate={() => startTranslation(selected)}
          onQuote={onQuote ? () => sendExcerpt(onQuote, selected.annotations, true) : undefined}
          onAddToAgent={
            onAddToAgent ? () => sendExcerpt(onAddToAgent, selected.annotations, true) : undefined
          }
        />
      )}
      {outlineOpen && pdfDocument && outline.length > 0 && (
        <PdfOutlinePanel
          pdf={pdfDocument}
          items={outline}
          top={toolbarHeight + 8}
          onNavigate={goToPage}
          onClose={closeOutline}
        />
      )}
      {popup && (
        <section
          role="dialog"
          aria-label={t("pdfReading.note")}
          className="motion-pop absolute right-3 z-30 flex w-96 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border border-border bg-background text-foreground shadow-lg"
          style={{ top: toolbarHeight + 8, maxHeight: `calc(100% - ${toolbarHeight + 20}px)` }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <div>
              <span className="text-sm font-medium">{t("pdfReading.note")}</span>
              <p className="mt-0.5 text-xs text-muted">
                {t("pdfReading.page", { page: popup.annotations[0]?.page ?? 1 })}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {onQuote && (
                <Tooltip label={t("pdfReading.quote")}>
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    aria-label={t("pdfReading.quote")}
                    onClick={() => sendExcerpt(onQuote, popup.annotations, false)}
                  >
                    <QuotesIcon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
              {onAddToAgent && (
                <Tooltip label={t("pdfReading.addToAgent")}>
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    aria-label={t("pdfReading.addToAgent")}
                    onClick={() => sendExcerpt(onAddToAgent, popup.annotations, false)}
                  >
                    <SparkleIcon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              )}
              <Tooltip label={t("common.close")} keys="Esc">
                <button
                  type="button"
                  className="toolbar-icon-button"
                  aria-label={t("common.close")}
                  onClick={closePopup}
                >
                  <XIcon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </div>
          <div className="min-h-0 overflow-auto p-3">
            <blockquote className="font-reading mb-3 max-h-32 overflow-auto border-l-2 border-border pl-3 text-[13px] leading-relaxed text-foreground-secondary">
              {popup.annotations.map((item) => item.quote).join("\n")}
            </blockquote>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-muted">{t("pdfReading.color")}</span>
              <PdfColorPicker
                value={popup.annotations[0]?.color ?? "accent"}
                onChange={setPopupColor}
                disabled={notes.busy}
              />
            </div>
            {popup.editing ? (
              <>
                <label htmlFor={noteInputId} className="mb-1 block text-xs text-muted">
                  {t("pdfReading.noteMarkdown")}
                </label>
                <textarea
                  ref={textareaRef}
                  id={noteInputId}
                  rows={6}
                  value={popup.text}
                  className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                  onChange={(event) =>
                    setPopup({ ...popup, text: event.target.value, error: undefined })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
                    event.preventDefault();
                    if (!notes.busy) void savePopup();
                  }}
                />
              </>
            ) : popup.text ? (
              <div className="text-sm">
                <MarkdownContent text={popup.text} />
              </div>
            ) : (
              <p className="text-sm text-muted">{t("pdfReading.noNote")}</p>
            )}
            {popup.error && (
              <p role="alert" className="mt-2 text-xs text-error">
                {errorMessage(popup.error)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
            {popup.editing ? (
              <Tooltip label={t("pdfReading.saveNote")} keys={shortcutLabel("Mod+Enter")}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={notes.busy}
                  onClick={() => void savePopup()}
                >
                  {t("pdfReading.saveNote")}
                </button>
              </Tooltip>
            ) : (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPopup({ ...popup, editing: true })}
              >
                {t("pdfReading.editNote")}
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => onOpenNotes(pdfNotesPath(pdfPath))}
            >
              {t("pdfReading.openNotes")}
            </button>
            {popup.existing && (
              <Tooltip label={t("pdfReading.deleteAnnotation")} className="ml-auto inline-flex">
                <button
                  type="button"
                  className="toolbar-icon-button hover:text-error"
                  aria-label={t("pdfReading.deleteAnnotation")}
                  disabled={notes.busy}
                  onClick={() => setConfirming("delete")}
                >
                  <TrashIcon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </div>
        </section>
      )}
      {popup && confirming === "delete" && (
        <ConfirmDialog
          danger
          title={t("pdfReading.deleteAnnotation")}
          message={t("pdfReading.deleteConfirm")}
          confirmLabel={t("common.delete")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            const first = popup.annotations[0];
            if (!first) return;
            void notes.session
              .remove(first.id, first.note)
              .then(() => setPopup(null))
              .catch((failure: unknown) =>
                setPopup((current) => (current ? { ...current, error: String(failure) } : current)),
              );
          }}
        />
      )}
      {popup && confirming === "discard" && (
        <ConfirmDialog
          danger
          title={t("pdfReading.discardCommentConfirm")}
          message={t("pdfReading.discardCommentMessage")}
          confirmLabel={t("pdfReading.discard")}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            setPopup(null);
          }}
        />
      )}
      {translation && (
        <PdfTranslationPanel
          top={toolbarHeight + 8}
          text={translation.annotations.map((item) => item.quote).join("\n")}
          config={translation.config}
          writable={writable}
          onSave={saveTranslation}
          onClose={() => setTranslation(null)}
        />
      )}
    </div>
  );
}
