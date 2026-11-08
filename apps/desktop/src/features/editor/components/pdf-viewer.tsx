"use client";

import {
  ArrowSquareOutIcon,
  HighlighterIcon,
  NoteIcon,
  TextUnderlineIcon,
  XIcon,
} from "@phosphor-icons/react";
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
import { useI18n } from "@/features/i18n";
import { readTranslationConfig, type TranslationConfig } from "@/features/translation";
import { appStorage } from "@/lib/storage/app-storage";
import { PdfGeometryClient, type PdfPaintAnnotation } from "../lib/pdf-geometry";
import { pdfNavigationPoint } from "../lib/pdf-navigation";
import {
  isPdfAnnotationColor,
  type PdfAnnotation,
  type PdfAnnotationColor,
  type PdfAnnotationKind,
  type PdfReadingMode,
  pdfNotesPath,
} from "../lib/pdf-notes";
import { PDF_DOCUMENT_OPTIONS } from "../lib/pdf-options";
import { collectPdfSelection, isCurrentPdfSelection } from "../lib/pdf-selection";
import type { PdfToolbarAnchor } from "../lib/pdf-toolbar-position";
import { usePdfAnnotationGeometry } from "../lib/use-pdf-annotation-geometry";
import { usePdfNotes } from "../lib/use-pdf-notes";
import { PdfAnnotationLayer } from "./pdf-annotation-layer";
import { PdfColorPicker } from "./pdf-color-picker";
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
}: Props) {
  const { t } = useI18n();
  const notes = usePdfNotes(projectPath, pdfPath);
  const [numPages, setNumPages] = useState(0);
  const [fingerprint, setFingerprint] = useState("");
  const [geometry, setGeometry] = useState<PdfGeometryClient | null>(null);
  const geometryRef = useRef<PdfGeometryClient | null>(null);
  const selectionGeneration = useRef(0);
  const [scale, setScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [pageWidth, setPageWidth] = useState(612);
  const [color, setColor] = useState<PdfAnnotationColor>("warning");
  const [translation, setTranslation] = useState<{
    annotations: PdfAnnotation[];
    config: TranslationConfig;
  } | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [popup, setPopup] = useState<NotePopup | null>(null);
  const [continuous, setContinuous] = useState<PdfAnnotationKind | null>(null);
  const [modeOverride, setModeOverride] = useState<PdfReadingMode | undefined>(undefined);
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
  const documentKey = `${src}.${pdfPath}.${refreshKey}.${notes.pdfRevision}`;
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
  const pressed = useRef<{ page: number; x: number; y: number } | null>(null);
  const canSync = Boolean(onSynctexClick && (notes.canSyncSource || compiledPreview));
  const preferredMode = modeOverride ?? notes.mode ?? (canSync ? "write" : "read");
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
    selectionGeneration.current++;
    geometryRef.current?.dispose();
    geometryRef.current = null;
    setGeometry(null);
    setFingerprint("");
    setSelected(null);
    setTranslation(null);
    return () => {
      documentGeneration.current.value += 1;
      selectionGeneration.current++;
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
        )) &&
      !window.confirm(t("pdfReading.discardCommentConfirm"))
    )
      return;
    setPopup(null);
  }, [popup, t, notes.annotations]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        selectionGeneration.current++;
        setSelected(null);
        closePopup();
        setTranslation(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [closePopup]);

  const heading = (annotation: PdfAnnotation) =>
    t("pdfReading.annotationHeading", {
      page: annotation.page,
      kind: t(`pdfReading.${annotation.kind}`),
    });

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

  async function captureSelection(clientX: number, clientY: number) {
    const selection = window.getSelection();
    const root = rootRef.current;
    if (!root || !selection || selection.isCollapsed || !selection.rangeCount || !fingerprint)
      return null;
    const range = selection.getRangeAt(0).cloneRange();
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
    let annotations: PdfAnnotation[];
    const rootBounds = root.getBoundingClientRect();
    const boxes: PdfToolbarAnchor[] = [];
    const generation = documentGeneration.current.value;
    const request = ++selectionGeneration.current;
    try {
      const captured = collectPdfSelection(root, range);
      if (!captured.length) return null;
      if (!geometry) throw new Error("PDF_GEOMETRY_FAILED");
      const pages = await geometry.refineSelection(captured);
      if (
        generation !== documentGeneration.current.value ||
        request !== selectionGeneration.current ||
        !isCurrentPdfSelection(range)
      )
        return null;
      for (const { element, rects } of pages) {
        const bounds = element.getBoundingClientRect();
        for (const rect of rects) {
          const top = bounds.top - rootBounds.top + rect.y * bounds.height;
          const bottom = top + rect.height * bounds.height;
          if (bottom < toolbarHeight || top > rootBounds.height) continue;
          const left = bounds.left - rootBounds.left + rect.x * bounds.width;
          boxes.push({ left, right: left + rect.width * bounds.width, top, bottom });
        }
      }
      annotations = pages.map(({ page, quote, rects }) => ({
        id: crypto.randomUUID(),
        page,
        kind: "highlight" as const,
        color,
        quote,
        fingerprint,
        rects,
        note: "",
      }));
    } catch (error) {
      if (
        generation === documentGeneration.current.value &&
        request === selectionGeneration.current &&
        isCurrentPdfSelection(range)
      )
        setActionError(String(error));
      return null;
    }
    if (!annotations.length) return null;
    const x = clientX - rootBounds.left;
    const y = clientY - rootBounds.top;
    return {
      annotations,
      anchor: boxes.length
        ? {
            left: Math.min(...boxes.map((box) => box.left)),
            right: Math.max(...boxes.map((box) => box.right)),
            top: Math.min(...boxes.map((box) => box.top)),
            bottom: Math.max(...boxes.map((box) => box.bottom)),
          }
        : { left: x, right: x, top: y, bottom: y },
    };
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>, pageNumber: number) {
    const start = pressed.current;
    pressed.current = null;
    if (event.button !== 0 || !start) return;
    const target = event.target;
    if (target instanceof Element && target.closest("a, button, input, textarea, select")) return;
    if (!window.getSelection()?.isCollapsed) {
      if (popup?.editing) return;
      setTranslation(null);
      setPopup(null);
      setSelected(null);
      void captureSelection(event.clientX, event.clientY).then((selection) => {
        if (!selection) return;
        setActionError(undefined);
        if (mode === "read" && continuous && notes.content !== undefined && !notes.error)
          void saveSelection(selection, continuous);
        else setSelected(selection);
      });
      return;
    }
    // Dragging/selecting must never become a source jump, even if the selection
    // falls outside a text layer or the PDF is scanned and has no text.
    if (
      start.page !== pageNumber ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4 ||
      !window.getSelection()?.isCollapsed
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
    <div ref={rootRef} className="relative flex h-full flex-col overflow-hidden">
      <div
        ref={toolbarRef}
        className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <fieldset
            aria-label={t("pdfReading.mode")}
            className="flex gap-1 rounded-md bg-surface-secondary p-0.5"
          >
            {(["read", "write"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={value === "write" && !canSync}
                title={
                  value === "write" && !canSync
                    ? t("pdfReading.noSource")
                    : t(`pdfReading.${value}`)
                }
                className={`rounded px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${mode === value ? "bg-accent-hover text-accent" : "text-muted hover:bg-surface-tertiary hover:text-foreground"}`}
                onClick={() => {
                  selectionGeneration.current++;
                  setModeOverride(value);
                  setSelected(null);
                  setContinuous(null);
                  void notes.session
                    .setMode(value)
                    .then(() => setModeOverride(undefined))
                    .catch((failure: unknown) => setActionError(String(failure)));
                }}
              >
                {t(`pdfReading.${value}`)}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            className="btn btn-sm"
            disabled={notes.content === undefined}
            onClick={() => onOpenNotes(pdfNotesPath(pdfPath))}
          >
            <NoteIcon aria-hidden="true" className="size-4" />
            {t("pdfReading.openNotes")}
          </button>
          {mode === "read" && (
            <div className="flex flex-wrap items-center gap-2">
              <fieldset
                className="flex gap-1 border-l border-border pl-2"
                aria-label={t("pdfReading.continuous")}
              >
                {(
                  [
                    { kind: "highlight", Icon: HighlighterIcon },
                    { kind: "underline", Icon: TextUnderlineIcon },
                  ] as const
                ).map(({ kind, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    className="toolbar-icon-button"
                    aria-pressed={continuous === kind}
                    disabled={!writable}
                    title={t(
                      `pdfReading.continuous${kind === "highlight" ? "Highlight" : "Underline"}`,
                    )}
                    aria-label={t(
                      `pdfReading.continuous${kind === "highlight" ? "Highlight" : "Underline"}`,
                    )}
                    onClick={() => setContinuous((current) => (current === kind ? null : kind))}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </button>
                ))}
              </fieldset>
              <PdfColorPicker value={color} onChange={chooseColor} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted">
          <span>
            {numPages > 0
              ? t("editor.pdfPages", { count: numPages, s: numPages !== 1 ? "s" : "" })
              : t("common.loading")}
          </span>
          <button
            type="button"
            title={t("editor.zoomOut")}
            className="rounded px-1.5 py-0.5 hover:bg-surface-tertiary hover:text-foreground"
            onClick={() => {
              setFitWidth(false);
              setScale((current) => Math.max(current - 0.25, 0.25));
            }}
          >
            −
          </button>
          <button
            type="button"
            title={t("editor.resetZoom")}
            className="min-w-14 rounded px-1.5 py-0.5 hover:bg-surface-tertiary hover:text-foreground"
            onClick={() => {
              setFitWidth(false);
              setScale(1);
            }}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            title={t("editor.zoomIn")}
            className="rounded px-1.5 py-0.5 hover:bg-surface-tertiary hover:text-foreground"
            onClick={() => {
              setFitWidth(false);
              setScale((current) => Math.min(current + 0.25, 4));
            }}
          >
            +
          </button>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-pressed={fitWidth}
            aria-label={t("pdfReading.fitWidth")}
            title={t("pdfReading.fitWidth")}
            onClick={() => setFitWidth(true)}
          >
            ↔
          </button>
        </div>
      </div>
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
        onScroll={() => {
          selectionGeneration.current++;
          setSelected(null);
        }}
        className="flex-1 overflow-auto bg-surface-secondary p-4"
      >
        <Document
          options={PDF_DOCUMENT_OPTIONS}
          key={documentKey}
          file={
            refreshKey > 0 || notes.pdfRevision > 0
              ? `${src}${src.includes("?") ? "&" : "?"}v=${refreshKey}.${notes.pdfRevision}`
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
                selectionGeneration.current++;
                const target = event.target;
                pressed.current =
                  event.button === 0 &&
                  !(
                    target instanceof Element &&
                    target.closest("a, button, input, textarea, select")
                  )
                    ? { page: pageNumber, x: event.clientX, y: event.clientY }
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
                onLoadSuccess={
                  pageNumber === 1
                    ? (page) => setPageWidth(page.getViewport({ scale: 1 }).width)
                    : undefined
                }
              />
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
                      title={annotation.note || annotation.quote}
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
                  title={t("editor.syncPdfPage", { page: pageNumber })}
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
      <PdfSelectionPreview
        rootRef={rootRef}
        geometryKey={`${documentKey}.${numPages}.${scale}`}
        geometry={geometry}
      />
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
          onNote={() => {
            setPopup({
              annotations: selected.annotations.map((item) => ({ ...item, color })),
              existing: false,
              editing: true,
              text: "",
            });
            setSelected(null);
          }}
          onTranslate={() => {
            setTranslation({
              annotations: selected.annotations.map((item) => ({ ...item, color })),
              config: readTranslationConfig(),
            });
            setSelected(null);
          }}
        />
      )}
      {popup && (
        <section
          role="dialog"
          aria-label={t("pdfReading.note")}
          className="absolute right-3 z-30 flex w-96 max-w-[calc(100%-1.5rem)] flex-col rounded-lg border border-border bg-background text-foreground shadow-lg"
          style={{ top: toolbarHeight + 8, maxHeight: `calc(100% - ${toolbarHeight + 20}px)` }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
            <div>
              <span className="text-sm font-medium">{t("pdfReading.note")}</span>
              <p className="mt-0.5 text-xs text-muted">
                {t("pdfReading.page", { page: popup.annotations[0]?.page ?? 1 })}
              </p>
            </div>
            <button
              type="button"
              className="toolbar-icon-button"
              aria-label={t("common.close")}
              onClick={closePopup}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 overflow-auto p-3">
            <blockquote className="mb-3 max-h-32 overflow-auto border-l-2 border-accent pl-3 text-xs text-muted">
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
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-3 py-2">
            {popup.editing ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={notes.busy}
                onClick={() => void savePopup()}
              >
                {t("pdfReading.saveNote")}
              </button>
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
              <button
                type="button"
                className="btn btn-sm"
                disabled={notes.busy}
                onClick={() => {
                  const first = popup.annotations[0];
                  if (!first || !window.confirm(t("pdfReading.deleteConfirm"))) return;
                  void notes.session
                    .remove(first.id, first.note)
                    .then(() => setPopup(null))
                    .catch((failure: unknown) => setPopup({ ...popup, error: String(failure) }));
                }}
              >
                {t("pdfReading.deleteAnnotation")}
              </button>
            )}
          </div>
        </section>
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
