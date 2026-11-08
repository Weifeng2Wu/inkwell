import { type RefObject, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PdfGeometry } from "../lib/pdf-geometry";
import {
  collectPdfSelection,
  isCurrentPdfSelection,
  type PdfSelectionPage,
  pdfHighlightPath,
} from "../lib/pdf-selection";

const RENDERER_ATTRIBUTE = "data-pdf-selection-renderer";

/** One frame-throttled listener for all pages, independent of PDF raster renders. */
export function PdfSelectionPreview({
  rootRef,
  geometryKey,
  geometry,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  geometryKey: string;
  geometry: PdfGeometry | null;
}) {
  const [pages, setPages] = useState<PdfSelectionPage[]>([]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Reset old-document paint before the browser presents the new text layer.
    setPages([]);
    if (geometry) root.setAttribute(RENDERER_ATTRIBUTE, "glyph");
    else root.removeAttribute(RENDERER_ATTRIBUTE);
    let frame: number | undefined;
    let generation = 0;
    let disposed = false;
    let usingNativeFallback = false;
    const nativeFallback = () => {
      usingNativeFallback = true;
      root.removeAttribute(RENDERER_ATTRIBUTE);
      setPages([]);
    };
    const update = () => {
      frame = undefined;
      const version = generation;
      const selection = window.getSelection();
      try {
        if (!geometry || !selection?.rangeCount) {
          setPages([]);
          return;
        }
        const range = selection.getRangeAt(0).cloneRange();
        const captured = collectPdfSelection(root, range);
        if (!captured.length) {
          setPages([]);
          return;
        }
        // Keep the last exact frame while the next one is being calculated.
        // Pending work is not a reason to expose loose native font boxes.
        void geometry
          .refineSelection(captured)
          .then((tight) => {
            if (!disposed && generation === version && isCurrentPdfSelection(range)) {
              usingNativeFallback = false;
              root.setAttribute(RENDERER_ATTRIBUTE, "glyph");
              setPages(tight);
            }
          })
          .catch(() => {
            if (!disposed && generation === version && isCurrentPdfSelection(range))
              nativeFallback();
          });
      } catch {
        // Keep native selection visible if it cannot be represented safely.
        nativeFallback();
      }
    };
    const schedule = () => {
      generation++;
      if (geometry && !usingNativeFallback) root.setAttribute(RENDERER_ATTRIBUTE, "glyph");
      if (frame === undefined) frame = requestAnimationFrame(update);
    };
    // The key tracks document, page count and zoom; measure the new text layer.
    void geometryKey;
    schedule();
    document.addEventListener("selectionchange", schedule);
    root.addEventListener("pointerdown", schedule);
    root.addEventListener("pointerup", schedule);
    root.addEventListener("inkwell-pdf-text-layer-ready", schedule);
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    observer?.observe(root);
    for (const page of root.querySelectorAll("[data-pdf-page]")) observer?.observe(page);
    return () => {
      disposed = true;
      generation++;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      root.removeAttribute(RENDERER_ATTRIBUTE);
      document.removeEventListener("selectionchange", schedule);
      root.removeEventListener("pointerdown", schedule);
      root.removeEventListener("pointerup", schedule);
      root.removeEventListener("inkwell-pdf-text-layer-ready", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [rootRef, geometryKey, geometry]);
  return pages.map(({ element, page, rects, highlightRects }) =>
    createPortal(
      <svg
        aria-hidden="true"
        data-pdf-selection-preview=""
        className="inkwell-pdf-mark-layer"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
      >
        <path
          d={pdfHighlightPath(highlightRects ?? rects)}
          fill="var(--accent)"
          fillOpacity={0.28}
        />
      </svg>,
      element,
      String(page),
    ),
  );
}
