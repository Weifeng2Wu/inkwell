"use client";

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { clampPdfPage, type PdfPageStore } from "./pdf-page";
import { type PdfPosition, savePdfPosition } from "./pdf-position";
import { scrollToPdfPage } from "./use-pdf-page";

const SAVE_DELAY = 500;
const SETTLE_DELAY = 800;
const RESTORE_TIMEOUT = 15_000;

type Options = {
  /** See `pdfPositionKey`. */
  storageKey: string;
  /**
   * The position saved for this PDF, read once when the viewer mounts; the
   * viewer seeds its zoom state from it and this hook restores the page.
   */
  initial: PdfPosition | null;
  /** Compiled previews follow SyncTeX, so only their zoom is restored. */
  restorePage: boolean;
  containerRef: RefObject<HTMLElement | null>;
  store: PdfPageStore;
  numPages: number;
  scale: number;
  fitWidth: boolean;
};

/**
 * Remember the page and zoom of each PDF. Pages get their size as they load, so
 * the saved page is re-anchored on every layout change until loading settles
 * or the reader scrolls, clicks or types.
 */
export function usePdfPosition({
  storageKey,
  initial,
  restorePage,
  containerRef,
  store,
  numPages,
  scale,
  fitWidth,
}: Options) {
  const startPage = restorePage && initial && initial.page > 1 ? initial.page : 0;
  const restoring = useRef(startPage > 0);
  const target = useRef<{ page: number; loaded: boolean } | null>(
    startPage > 0 ? { page: startPage, loaded: false } : null,
  );
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ storageKey, scale, fitWidth });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    latest.current = { storageKey, scale, fitWidth };
  });

  const finish = useCallback(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = undefined;
    target.current = null;
    restoring.current = false;
  }, []);

  const anchor = useCallback(
    (delay: number) => {
      const pending = target.current;
      if (!pending) return;
      scrollToPdfPage(containerRef.current, pending.page, store);
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(finish, pending.loaded ? delay : RESTORE_TIMEOUT);
    },
    [containerRef, store, finish],
  );

  useEffect(() => {
    const container = containerRef.current;
    const pending = target.current;
    if (!container || !pending || numPages <= 0) return;
    pending.page = clampPdfPage(pending.page, numPages);
    anchor(SETTLE_DELAY);
    const cancel = () => finish();
    const events = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
    for (const name of events) container.addEventListener(name, cancel, { passive: true });
    const content = container.firstElementChild;
    const observer =
      typeof ResizeObserver === "undefined" || !content
        ? undefined
        : new ResizeObserver(() => anchor(SETTLE_DELAY));
    if (content) observer?.observe(content);
    return () => {
      for (const name of events) container.removeEventListener(name, cancel);
      observer?.disconnect();
    };
  }, [containerRef, numPages, anchor, finish]);

  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const flush = useCallback(() => {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    savePdfPosition(latest.current.storageKey, {
      page: target.current?.page ?? store.get(),
      scale: latest.current.scale,
      fitWidth: latest.current.fitWidth,
    });
  }, [store]);

  const schedule = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY);
  }, [flush]);

  // Nothing is written before the document has loaded: defaults must not
  // replace a saved position while it is still being restored.
  const loaded = numPages > 0;
  useEffect(() => {
    if (!loaded) return;
    return store.subscribe(schedule);
  }, [loaded, store, schedule]);
  // Under fit-to-width the scale follows the pane, so only the mode counts.
  const zoom = fitWidth ? "fit" : String(scale);
  const savedZoom = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    // The first zoom seen after loading is the restored or default one.
    if (savedZoom.current !== null && savedZoom.current !== zoom) schedule();
    savedZoom.current = zoom;
  }, [loaded, zoom, schedule]);
  useEffect(() => flush, [flush]);

  const onPageLoaded = useCallback(
    (page: number) => {
      const pending = target.current;
      if (!pending) return;
      if (page === pending.page) pending.loaded = true;
      requestAnimationFrame(() => anchor(SETTLE_DELAY));
    },
    [anchor],
  );

  return { restoring, onPageLoaded, settle: finish };
}
