import { memo, useMemo } from "react";
import type { PdfPaintAnnotation } from "../lib/pdf-geometry";
import { PDF_ANNOTATION_COLORS } from "../lib/pdf-notes";
import { pdfHighlightPath, pdfUnderlinePath } from "../lib/pdf-selection";

export const PdfAnnotationLayer = memo(function PdfAnnotationLayer({
  annotations,
}: {
  annotations: PdfPaintAnnotation[];
}) {
  const paints = useMemo(
    () =>
      PDF_ANNOTATION_COLORS.flatMap((color) => {
        const highlights = annotations
          .filter((item) => item.kind === "highlight" && (item.color ?? "accent") === color)
          .flatMap((item) => item.highlightRects ?? item.rects);
        const underlines = annotations
          .filter((item) => item.kind === "underline" && (item.color ?? "accent") === color)
          .flatMap((item) => item.rects);
        return [
          { color, kind: "highlight", path: pdfHighlightPath(highlights) },
          { color, kind: "underline", path: pdfUnderlinePath(underlines) },
        ].filter((paint) => paint.path);
      }),
    [annotations],
  );
  return (
    <svg
      aria-hidden="true"
      className="inkwell-pdf-mark-layer"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
    >
      {paints.map(({ color, kind, path }) => (
        <path
          key={`${color}-${kind}`}
          data-pdf-annotation-paint={kind}
          d={path}
          fill={kind === "highlight" ? `var(--${color})` : "none"}
          fillOpacity={0.28}
          stroke={kind === "underline" ? `var(--${color})` : undefined}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
});
