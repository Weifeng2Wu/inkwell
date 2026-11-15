"use client";

import { type RefObject, useEffect, useSyncExternalStore } from "react";
import { type PdfPageStore, pdfVisiblePage } from "./pdf-page";

/** Scroll the pane so `page` starts at its top. False when the page is not rendered. */
export function scrollToPdfPage(container: HTMLElement | null, page: number, store?: PdfPageStore) {
  const element = container?.querySelector(`[data-pdf-page="${page}"]`);
  if (!container || !element) return false;
  const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top - 8;
  container.scrollTop = Math.max(0, container.scrollTop + offset);
  store?.set(page);
  return true;
}

/**
 * Scroll only the PDF pane (never an outer layout box) so `element` sits at
 * the top or in the middle of it. Elements already in view are left alone.
 */
export function revealPdfElement(
  container: HTMLElement | null,
  element: Element | null,
  block: "start" | "center",
) {
  if (!container || !element) return;
  const view = container.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  if (block === "center" && box.top >= view.top + 8 && box.bottom <= view.bottom - 8) return;
  const offset =
    block === "start"
      ? box.top - view.top - 8
      : box.top + box.height / 2 - view.top - view.height / 2;
  container.scrollTop = Math.max(0, container.scrollTop + offset);
}

export function usePdfPageValue(store: PdfPageStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Keep the store on the page that fills most of the pane while it scrolls.
 * Measuring happens at most once per frame and never touches React state of
 * the viewer; `paused` suspends it while a saved position is being restored.
 */
export function usePdfPageTracking(
  containerRef: RefObject<HTMLElement | null>,
  store: PdfPageStore,
  paused: RefObject<boolean>,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | undefined;
    const measure = () => {
      frame = undefined;
      if (paused.current) return;
      const pages = [...container.querySelectorAll("[data-pdf-page]")].map((page) =>
        page.getBoundingClientRect(),
      );
      if (!pages.length) return;
      const view = container.getBoundingClientRect();
      store.set(pdfVisiblePage(pages, view.top, view.bottom));
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(measure);
    };
    container.addEventListener("scroll", schedule, { passive: true });
    return () => {
      container.removeEventListener("scroll", schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [containerRef, store, paused]);
}
