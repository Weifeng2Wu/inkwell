import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { PdfGeometry } from "./pdf-geometry";
import {
  collectPdfSelection,
  isCurrentPdfSelection,
  type PdfSelectionPage,
  type PdfSelectionPointers,
  samePdfRange,
} from "./pdf-selection";

const RENDERER_ATTRIBUTE = "data-pdf-selection-renderer";
const INTERACTIVE = "a, button, input, textarea, select";
/** Marks the selection's own floating controls (toolbar, color palette). */
export const PDF_SELECTION_ACTIONS_ATTRIBUTE = "data-pdf-selection-actions";

function caretInSelectionActions(range: Range) {
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return range.collapsed && Boolean(element?.closest(`[${PDF_SELECTION_ACTIONS_ATTRIBUTE}]`));
}

/** One plain drag: where it was pressed (page-relative) and where the pointer is now. */
type Gesture = {
  page: Element;
  x: number;
  y: number;
  origin: { x: number; y: number };
  pointer: { x: number; y: number };
  moved: boolean;
  /** Word/line (multi-click) and Shift selections keep the browser's own boundaries. */
  plain: boolean;
};

function forwardSelection(selection: globalThis.Selection, range: Range) {
  return (
    selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset
  );
}

function gesturePointers(
  gesture: Gesture,
  selection: globalThis.Selection,
  range: Range,
): PdfSelectionPointers {
  const bounds = gesture.page.getBoundingClientRect();
  const anchor = {
    x: bounds.left + gesture.x * bounds.width,
    y: bounds.top + gesture.y * bounds.height,
  };
  return forwardSelection(selection, range)
    ? { start: anchor, end: gesture.pointer }
    : { start: gesture.pointer, end: anchor };
}

/** The range the glyph-corrected boundary runs describe, when it differs from the native one. */
function correctedRange(range: Range, pages: PdfSelectionPage[]) {
  let first: { node: Text; offset: number } | undefined;
  let last: { node: Text; offset: number } | undefined;
  for (const run of pages.flatMap((page) => page.runs)) {
    if (!run.node) continue;
    if (run.snapStart !== undefined) first ??= { node: run.node, offset: run.start };
    if (run.snapEnd !== undefined) last = { node: run.node, offset: run.end };
  }
  const corrected = range.cloneRange();
  if (first) corrected.setStart(first.node, first.offset);
  if (last) corrected.setEnd(last.node, last.offset);
  return samePdfRange(corrected, range) ? undefined : corrected;
}

/**
 * Called when the selection comes to rest: once per distinct native range, never
 * while a pointer is still dragging it. No pages means the selection is gone;
 * an error means it exists but has no tight geometry to act on.
 */
export type PdfSelectionSettled = (pages: PdfSelectionPage[], error?: unknown) => void;

/**
 * The single owner of the live text selection: one frame-throttled listener for
 * all pages, independent of PDF raster renders. `pages` is the tight geometry to
 * paint; `onSettle` drives the selection actions from that same geometry.
 */
export function usePdfSelection({
  rootRef,
  geometryKey,
  geometry,
  onSettle,
}: {
  rootRef: RefObject<HTMLElement | null>;
  geometryKey: string;
  geometry: PdfGeometry | null;
  onSettle?: PdfSelectionSettled;
}) {
  const [pages, setPages] = useState<PdfSelectionPage[]>([]);
  const settled = useRef(onSettle);
  settled.current = onSettle;
  // Survives remeasurement: zooming must not announce the same selection twice.
  const session = useRef<{ held: boolean; reported: Range | null; gesture: Gesture | null }>({
    held: false,
    reported: null,
    gesture: null,
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const state = session.current;
    // Reset old-document paint before the browser presents the new text layer.
    setPages([]);
    if (geometry) root.setAttribute(RENDERER_ATTRIBUTE, "glyph");
    else root.removeAttribute(RENDERER_ATTRIBUTE);
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let disposed = false;
    let usingNativeFallback = false;
    const nativeFallback = () => {
      usingNativeFallback = true;
      root.removeAttribute(RENDERER_ATTRIBUTE);
      setPages([]);
    };
    const report = (range: Range | null, result: PdfSelectionPage[], error?: unknown) => {
      if (range) {
        if (state.held || (state.reported && samePdfRange(state.reported, range))) return;
      } else if (!state.reported) return;
      state.reported = range;
      settled.current?.(result, error);
    };
    const clear = () => {
      setPages([]);
      report(null, []);
    };
    const update = () => {
      const version = generation;
      const selection = window.getSelection();
      if (!geometry || !selection?.rangeCount) {
        clear();
        return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      const current = () => !disposed && generation === version && isCurrentPdfSelection(range);
      // A drag is measured against the glyphs under the pointer; the pass after its
      // release writes the corrected boundaries back to the native selection.
      const gesture = state.gesture?.plain && state.gesture.moved ? state.gesture : null;
      const settling = !state.held;
      if (settling) state.gesture = null;
      let captured: PdfSelectionPage[];
      try {
        captured = collectPdfSelection(
          root,
          range,
          gesture ? gesturePointers(gesture, selection, range) : undefined,
        );
      } catch (error) {
        // Keep native selection visible if it cannot be represented safely.
        nativeFallback();
        report(range, [], error);
        return;
      }
      if (!captured.length) {
        setPages([]);
        // Some engines move the caret into a focused control. Keyboard focus on
        // the selection's own actions is not the reader abandoning the passage.
        if (!caretInSelectionActions(range)) report(null, []);
        return;
      }
      // Keep the last exact frame while the next one is being calculated.
      // Pending work is not a reason to expose loose native font boxes.
      void geometry.refineSelection(captured).then(
        (tight) => {
          if (!current()) return;
          usingNativeFallback = false;
          root.setAttribute(RENDERER_ATTRIBUTE, "glyph");
          const visible = tight.filter((page) => page.rects.length);
          setPages(visible);
          const corrected = gesture && settling ? correctedRange(range, tight) : undefined;
          if (corrected) {
            // Copying and quoting must yield exactly the painted passage.
            if (forwardSelection(selection, range))
              selection.setBaseAndExtent(
                corrected.startContainer,
                corrected.startOffset,
                corrected.endContainer,
                corrected.endOffset,
              );
            else
              selection.setBaseAndExtent(
                corrected.endContainer,
                corrected.endOffset,
                corrected.startContainer,
                corrected.startOffset,
              );
            schedule();
          } else if (visible.length) report(range, visible);
          else report(null, []);
        },
        (error: unknown) => {
          if (!current()) return;
          nativeFallback();
          report(range, [], error);
        },
      );
    };
    const run = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = undefined;
      timer = undefined;
      update();
    };
    const schedule = () => {
      generation++;
      if (geometry && !usingNativeFallback) root.setAttribute(RENDERER_ATTRIBUTE, "glyph");
      if (frame === undefined) frame = requestAnimationFrame(run);
    };
    const press = (event: PointerEvent) => {
      if (event.button !== 0) return;
      state.held = true;
      state.gesture = null;
      // A press on page content starts a new gesture and retires the old actions.
      // Controls keep them: their click must not look like a fresh selection.
      const target = event.target;
      if (
        target instanceof Element &&
        root.contains(target) &&
        target.closest("[data-pdf-page]") &&
        !target.closest(INTERACTIVE)
      ) {
        report(null, []);
        const page = target.closest("[data-pdf-page]");
        const bounds = page?.getBoundingClientRect();
        const point = { x: event.clientX, y: event.clientY };
        if (page && bounds?.width && bounds.height)
          state.gesture = {
            page,
            x: (point.x - bounds.left) / bounds.width,
            y: (point.y - bounds.top) / bounds.height,
            origin: point,
            pointer: point,
            moved: false,
            plain: !event.shiftKey,
          };
      }
    };
    const track = (event: Event) => {
      const gesture = state.gesture;
      if (!state.held || !gesture || !(event instanceof MouseEvent)) return false;
      gesture.pointer = { x: event.clientX, y: event.clientY };
      gesture.moved ||=
        Math.hypot(event.clientX - gesture.origin.x, event.clientY - gesture.origin.y) > 4;
      return gesture.plain && gesture.moved;
    };
    const move = (event: PointerEvent) => {
      // The glyph under the pointer can change without the native offsets changing.
      if (track(event)) schedule();
    };
    const multiClick = (event: MouseEvent) => {
      if (event.detail > 1 && state.gesture) state.gesture.plain = false;
    };
    const release = (event: Event) => {
      if (!state.held) return;
      track(event);
      state.held = false;
      schedule();
      // The browser collapses a clicked selection after pointerup. Measure once
      // its own handling is done, without waiting for the next painted frame.
      timer ??= setTimeout(run);
    };
    // The key tracks document, page count and zoom; measure the new text layer.
    void geometryKey;
    schedule();
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("mousedown", multiClick, true);
    document.addEventListener("pointerup", release, true);
    document.addEventListener("pointercancel", release, true);
    // A release outside the window may never be delivered.
    window.addEventListener("blur", release);
    root.addEventListener("pointerdown", schedule);
    root.addEventListener("inkwell-pdf-text-layer-ready", schedule);
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(root);
    for (const page of root.querySelectorAll("[data-pdf-page]")) observer?.observe(page);
    return () => {
      disposed = true;
      generation++;
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
      observer?.disconnect();
      root.removeAttribute(RENDERER_ATTRIBUTE);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("mousedown", multiClick, true);
      document.removeEventListener("pointerup", release, true);
      document.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
      root.removeEventListener("pointerdown", schedule);
      root.removeEventListener("inkwell-pdf-text-layer-ready", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [rootRef, geometryKey, geometry]);

  /** Retire the current selection's actions; only a different selection settles again. */
  const dismiss = useCallback(() => {
    const state = session.current;
    // A drag in progress reports its own result when the pointer is released.
    if (state.held) return;
    const selection = window.getSelection();
    state.reported =
      selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
  }, []);

  return { pages, dismiss };
}
