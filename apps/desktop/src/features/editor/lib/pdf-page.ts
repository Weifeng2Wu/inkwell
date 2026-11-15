import type { PdfAnnotation } from "./pdf-notes";

export type PdfPageStore = {
  get: () => number;
  set: (page: number) => void;
  subscribe: (listener: () => void) => () => void;
};

/**
 * The current page lives outside React state so scrolling only re-renders the
 * small page control, never the whole viewer and its pages.
 */
export function createPdfPageStore(initial = 1): PdfPageStore {
  let page = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => page,
    set(next) {
      if (next === page) return;
      page = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function clampPdfPage(page: number, numPages: number) {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(Math.trunc(page), Math.max(1, numPages)));
}

/** A typed page number, or null when the text is not a page of this document. */
export function parsePdfPageInput(text: string, numPages: number) {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const page = Number(trimmed);
  return page >= 1 && page <= numPages ? page : null;
}

/**
 * The 1-based page occupying most of the viewport. Ties go to the earlier page;
 * when nothing overlaps, the nearest page below the viewport top wins.
 */
export function pdfVisiblePage(
  pages: readonly { top: number; bottom: number }[],
  viewTop: number,
  viewBottom: number,
) {
  let best = 0;
  let bestOverlap = 0;
  for (const [index, page] of pages.entries()) {
    const overlap = Math.min(page.bottom, viewBottom) - Math.max(page.top, viewTop);
    if (overlap > bestOverlap) {
      best = index + 1;
      bestOverlap = overlap;
    }
    if (page.top >= viewBottom) break;
  }
  if (best) return best;
  const below = pages.findIndex((page) => page.bottom > viewTop);
  return below < 0 ? Math.max(1, pages.length) : below + 1;
}

/** The passage quoted by a selection or a saved annotation; `page` is 1-based. */
export function pdfExcerpt(annotations: readonly Pick<PdfAnnotation, "quote" | "page">[]) {
  const first = annotations[0];
  const text = annotations
    .map((item) => item.quote.trim())
    .filter(Boolean)
    .join("\n");
  return first && text ? { text, page: first.page } : null;
}
