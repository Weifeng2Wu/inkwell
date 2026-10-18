"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { useI18n } from "@/features/i18n";
import { pdfNavigationPoint } from "../lib/pdf-navigation";
import { PDF_DOCUMENT_OPTIONS } from "../lib/pdf-options";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Props = {
  src: string;
  onSynctexClick?: (page: number, x: number, y: number) => void;
  refreshKey?: number;
};

export function PdfViewer({ src, onSynctexClick, refreshKey = 0 }: Props) {
  const { t } = useI18n();
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const containerRef = useRef<HTMLDivElement>(null);
  const pressedPage = useRef<number | null>(null);

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    setNumPages(numPages);
  }

  const handlePageClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, pageNumber: number) => {
      if (!onSynctexClick) return;

      const target = e.currentTarget;
      const rect = target.getBoundingClientRect();
      const point = pdfNavigationPoint({
        clientX: e.clientX,
        clientY: e.clientY,
        rect,
        scale,
        pointerStartedOnPage: pressedPage.current === pageNumber,
        keyboard: e.detail === 0,
      });
      pressedPage.current = null;
      if (point) onSynctexClick(pageNumber, point.x, point.y);
    },
    [onSynctexClick, scale],
  );

  const zoomIn = useCallback(() => setScale((s) => Math.min(s + 0.25, 4.0)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(s - 0.25, 0.25)), []);
  const zoomReset = useCallback(() => setScale(1.0), []);
  const pageNumbers = Array.from({ length: numPages }, (_, pageIndex) => pageIndex + 1);

  // Fit width on mount
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth;
      // Assume standard letter/A4 width ~612 PDF points
      const fitScale = (containerWidth - 32) / 612;
      if (fitScale > 0.25 && fitScale < 4.0) {
        setScale(fitScale);
      }
    }
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-surface-secondary shrink-0">
        <span className="text-xs text-muted">
          {numPages > 0
            ? t("editor.pdfPages", { count: numPages, s: numPages !== 1 ? "s" : "" })
            : t("common.loading")}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={zoomOut}
            className="px-1.5 py-0.5 text-xs text-muted hover:text-foreground hover:bg-surface-tertiary rounded transition-colors"
            title={t("editor.zoomOut")}
          >
            -
          </button>
          <button
            type="button"
            onClick={zoomReset}
            className="px-1.5 py-0.5 text-xs text-muted hover:text-foreground hover:bg-surface-tertiary rounded transition-colors min-w-[3.5rem] text-center"
            title={t("editor.resetZoom")}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            className="px-1.5 py-0.5 text-xs text-muted hover:text-foreground hover:bg-surface-tertiary rounded transition-colors"
            title={t("editor.zoomIn")}
          >
            +
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 overflow-auto bg-accent-hover p-4">
        <Document
          options={PDF_DOCUMENT_OPTIONS}
          key={refreshKey}
          file={
            refreshKey > 0
              ? src.includes("?")
                ? `${src}&v=${refreshKey}`
                : `${src}?v=${refreshKey}`
              : src
          }
          onLoadSuccess={onDocumentLoadSuccess}
          loading={
            <div className="flex items-center justify-center h-32 text-sm text-muted">
              {t("editor.loadingPdf")}
            </div>
          }
          error={
            <div className="flex items-center justify-center h-32 text-sm text-muted">
              {t("editor.failedToLoadPdf")}
            </div>
          }
        >
          {pageNumbers.map((pageNumber) => (
            <button
              type="button"
              key={`pdf-page-${pageNumber}`}
              className="mb-4 block cursor-crosshair border-0 bg-transparent p-0 text-left"
              onPointerDown={(event) => {
                pressedPage.current = event.button === 0 ? pageNumber : null;
              }}
              onPointerCancel={() => {
                pressedPage.current = null;
              }}
              onClick={(e) => handlePageClick(e, pageNumber)}
              aria-label={t("editor.syncPdfPage", { page: pageNumber })}
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </button>
          ))}
        </Document>
      </div>
    </div>
  );
}
