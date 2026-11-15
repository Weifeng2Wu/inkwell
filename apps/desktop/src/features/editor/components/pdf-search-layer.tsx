"use client";

import { memo, useEffect, useRef, useState } from "react";
import { type PdfSearchHit, pdfSearchHits } from "../lib/pdf-search-hits";
import { revealPdfElement } from "../lib/use-pdf-page";

type Props = {
  /** Normalized query; see `normalizePdfQuery`. */
  needle: string;
  /** Ordinal of the current match on this page, or -1 when it is elsewhere. */
  current: number;
  /** Changes whenever the reader should be taken to the current match. */
  jump: number;
};

/**
 * Paints the find matches of one page over its text layer and brings the
 * current one into view. Rectangles come from the rendered text layer, so they
 * follow the browser's text boxes rather than exact PDF glyph outlines.
 */
export const PdfSearchLayer = memo(function PdfSearchLayer({ needle, current, jump }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [located, setLocated] = useState<{ needle: string; hits: PdfSearchHit[] } | null>(null);
  const revealed = useRef({ page: -1, hit: -1 });

  useEffect(() => {
    const layer = layerRef.current;
    const page = layer?.parentElement;
    if (!layer || !page) return;
    let frame: number | undefined;
    const locate = () => {
      frame = undefined;
      const text = page.querySelector(".react-pdf__Page__textContent");
      const hits = text ? pdfSearchHits(text, page.getBoundingClientRect(), needle) : null;
      // Keep what is painted while the text layer is being rendered again.
      if (hits) setLocated({ needle, hits });
    };
    locate();
    if (typeof MutationObserver === "undefined") return;
    // The text layer is rebuilt after loading and on every zoom change.
    const observer = new MutationObserver((records) => {
      if (records.every((record) => layer.contains(record.target))) return;
      frame ??= requestAnimationFrame(locate);
    });
    observer.observe(page, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [needle]);

  const hits = located?.needle === needle ? located.hits : null;

  useEffect(() => {
    if (current < 0) return;
    const layer = layerRef.current;
    const container = layer?.closest<HTMLElement>("[data-pdf-scroll]") ?? null;
    const hit = hits ? layer?.querySelector("[data-pdf-search-current]") : null;
    if (hit) {
      if (revealed.current.hit === jump) return;
      revealed.current = { page: jump, hit: jump };
      revealPdfElement(container, hit, "center");
    } else if (revealed.current.page !== jump) {
      // Until the text layer is ready, at least show the page of the match.
      revealed.current.page = jump;
      revealPdfElement(container, layer?.parentElement ?? null, "start");
    }
  }, [current, jump, hits]);

  return (
    <div ref={layerRef} aria-hidden="true" className="inkwell-pdf-search-layer">
      {hits?.map((hit) => (
        <span
          key={hit.id}
          className="inkwell-pdf-search-hit"
          data-pdf-search-current={hit.hit === current ? "" : undefined}
          style={{
            left: `${hit.x * 100}%`,
            top: `${hit.y * 100}%`,
            width: `${hit.width * 100}%`,
            height: `${hit.height * 100}%`,
          }}
        />
      ))}
    </div>
  );
});
