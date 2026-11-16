import { memo } from "react";
import { createPortal } from "react-dom";
import { type PdfSelectionPage, pdfHighlightPath } from "../lib/pdf-selection";

/** Paints the live selection on each page it touches; `usePdfSelection` owns the state. */
export const PdfSelectionPreview = memo(function PdfSelectionPreview({
  pages,
}: {
  pages: PdfSelectionPage[];
}) {
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
});
