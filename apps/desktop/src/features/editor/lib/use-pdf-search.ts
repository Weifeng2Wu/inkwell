"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractPdfSearchText,
  initialPdfMatch,
  normalizePdfQuery,
  type PdfSearchMatch,
  searchPdfPages,
  stepPdfMatch,
} from "./pdf-search";

type SearchDocument = Parameters<typeof extractPdfSearchText>[0];
type Found = {
  pdf: SearchDocument | null;
  needle: string;
  matches: PdfSearchMatch[];
  capped: boolean;
  current: number;
};
const NOTHING: Found = { pdf: null, needle: "", matches: [], capped: false, current: -1 };

/**
 * Find-in-document state. Page text is extracted once per loaded document, on
 * the first search, and dropped (with any extraction still running cancelled)
 * as soon as `pdf` changes — a new file, a refresh or a new revision.
 */
export function usePdfSearch(
  pdf: SearchDocument | null,
  /** Must be stable, e.g. the page store's `get`. */
  currentPage: () => number,
) {
  const [open, setOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState(NOTHING);
  const [jump, setJump] = useState(0);
  const cache = useRef<{
    pdf: SearchDocument;
    cancelled: boolean;
    texts: Promise<string[] | null>;
  } | null>(null);
  const needle = open && pdf ? normalizePdfQuery(query) : "";

  useEffect(() => {
    // Rerun for every document so its text never outlives it.
    void pdf;
    return () => {
      if (cache.current) cache.current.cancelled = true;
      cache.current = null;
    };
  }, [pdf]);

  useEffect(() => {
    if (!pdf || !needle) return;
    let stale = false;
    let entry = cache.current;
    if (!entry || entry.pdf !== pdf) {
      const created = { pdf, cancelled: false, texts: Promise.resolve<string[] | null>(null) };
      created.texts = extractPdfSearchText(pdf, () => created.cancelled).catch(() => []);
      cache.current = created;
      entry = created;
    }
    void entry.texts.then((texts) => {
      if (stale || !texts) return;
      const { matches, capped } = searchPdfPages(texts, needle);
      setFound({ pdf, needle, matches, capped, current: initialPdfMatch(matches, currentPage()) });
      setJump((value) => value + 1);
    });
    return () => {
      stale = true;
    };
  }, [pdf, needle, currentPage]);

  const show = useCallback(() => {
    setOpen(true);
    setFocusToken((value) => value + 1);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const step = useCallback((delta: number) => {
    setFound((value) => ({
      ...value,
      current: stepPdfMatch(value.current, value.matches.length, delta),
    }));
    setJump((value) => value + 1);
  }, []);

  // Results for an older query or a closed bar are never shown or painted.
  const fresh = Boolean(needle) && found.pdf === pdf && found.needle === needle;
  const active = fresh ? found : NOTHING;
  const pages = useMemo(() => new Set(active.matches.map((match) => match.page)), [active.matches]);
  return {
    open,
    focusToken,
    query,
    needle,
    searching: Boolean(needle) && !fresh,
    matches: active.matches,
    capped: active.capped,
    current: active.current,
    currentMatch: active.matches[active.current] ?? null,
    pages,
    /** Changes whenever the reader should be taken to the current match. */
    jump,
    show,
    close,
    step,
    setQuery,
  };
}
