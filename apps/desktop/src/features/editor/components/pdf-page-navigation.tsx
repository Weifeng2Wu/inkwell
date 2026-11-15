"use client";

import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";
import { type PdfPageStore, parsePdfPageInput } from "../lib/pdf-page";
import { usePdfPageValue } from "../lib/use-pdf-page";

/** Current page / page count. Subscribes to the page store on its own. */
export function PdfPageNavigation({
  store,
  numPages,
  onGo,
}: {
  store: PdfPageStore;
  numPages: number;
  onGo: (page: number) => void;
}) {
  const { t } = useI18n();
  const page = usePdfPageValue(store);
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const next = parsePdfPageInput(draft, numPages);
    setDraft(null);
    if (next !== null && next !== page) onGo(next);
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip label={t("pdfReading.previousPage")} keys="K · ←">
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={t("pdfReading.previousPage")}
          disabled={page <= 1}
          onClick={() => onGo(page - 1)}
        >
          <CaretUpIcon aria-hidden="true" className="size-4" />
        </button>
      </Tooltip>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        aria-label={t("pdfReading.pageNumber")}
        className="h-7 rounded-md border border-border bg-background px-1 text-center text-xs tabular-nums text-foreground transition-colors duration-100 focus:border-accent focus:outline-none"
        style={{ width: `calc(${Math.max(3, String(numPages).length)}ch + 0.75rem)` }}
        value={draft ?? String(page)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape" && draft !== null) {
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
          }
        }}
      />
      <span className="whitespace-nowrap px-1 tabular-nums">/ {numPages}</span>
      <Tooltip label={t("pdfReading.nextPage")} keys="J · →">
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={t("pdfReading.nextPage")}
          disabled={page >= numPages}
          onClick={() => onGo(page + 1)}
        >
          <CaretDownIcon aria-hidden="true" className="size-4" />
        </button>
      </Tooltip>
    </div>
  );
}
