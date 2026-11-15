"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import {
  flattenPdfOutline,
  type PdfOutlineItem,
  resolvePdfDestinationPage,
} from "../lib/pdf-outline";

const NO_OUTLINE: PdfOutlineItem[] = [];

/** The document's table of contents; empty while loading or when it has none. */
export function usePdfOutline(pdf: PDFDocumentProxy | null) {
  const [outline, setOutline] = useState<{ pdf: PDFDocumentProxy; items: PdfOutlineItem[] }>();
  useEffect(() => {
    if (!pdf) return;
    let stale = false;
    void (async () => {
      let items = NO_OUTLINE;
      try {
        items = flattenPdfOutline(await pdf.getOutline());
      } catch {
        /* A PDF without a readable outline simply has no outline button. */
      }
      if (!stale) setOutline({ pdf, items });
    })();
    return () => {
      stale = true;
    };
  }, [pdf]);
  return pdf && outline?.pdf === pdf ? outline.items : NO_OUTLINE;
}

type Props = {
  pdf: PDFDocumentProxy;
  items: PdfOutlineItem[];
  top: number;
  onNavigate: (page: number) => void;
  onClose: () => void;
};

export function PdfOutlinePanel({ pdf, items, top, onNavigate, onClose }: Props) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    panelRef.current?.querySelector("button")?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Element &&
        !panelRef.current?.contains(event.target) &&
        !event.target.closest("[data-pdf-outline-trigger]")
      )
        onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [onClose]);

  return (
    <nav
      ref={panelRef}
      aria-label={t("pdfReading.outline")}
      className="motion-pop absolute right-3 z-30 flex w-72 max-w-[calc(100%-1.5rem)] flex-col overflow-auto rounded-lg border border-border bg-background p-1 text-foreground shadow-2xl"
      style={{ top, maxHeight: `calc(100% - ${top + 12}px)` }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.title}
          className="shrink-0 truncate rounded-md py-1.5 pr-2 text-left text-xs text-foreground-secondary hover:bg-surface-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
          style={{ paddingLeft: `${0.5 + Math.min(item.depth, 6) * 0.75}rem` }}
          onClick={() => {
            void resolvePdfDestinationPage(pdf, item.dest).then((page) => {
              if (page === null) return;
              onNavigate(page);
              onClose();
            });
          }}
        >
          {item.title}
        </button>
      ))}
    </nav>
  );
}
