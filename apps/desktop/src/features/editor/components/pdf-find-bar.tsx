"use client";

import { CaretDownIcon, CaretUpIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/features/i18n";

type Props = {
  /** Changes every time the bar is asked for, to refocus an already open bar. */
  focusToken: number;
  query: string;
  hasQuery: boolean;
  searching: boolean;
  current: number;
  total: number;
  capped: boolean;
  onQuery: (query: string) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
};

export function PdfFindBar({
  focusToken,
  query,
  hasQuery,
  searching,
  current,
  total,
  capped,
  onQuery,
  onStep,
  onClose,
}: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Rerun on every request so Ctrl/Cmd+F always lands in the field.
    void focusToken;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusToken]);

  const status = !hasQuery
    ? ""
    : searching
      ? t("pdfReading.findSearching")
      : total === 0
        ? t("pdfReading.findNoResults")
        : `${current + 1} / ${total}${capped ? "+" : ""}`;

  return (
    <fieldset
      data-pdf-find
      aria-label={t("pdfReading.find")}
      className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1 border-b border-border bg-background px-3 py-1"
    >
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-label={t("pdfReading.find")}
        placeholder={t("pdfReading.findPlaceholder")}
        value={query}
        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted focus:border-accent focus:outline-none sm:max-w-56"
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      />
      <span
        role="status"
        data-pdf-find-status
        className="min-w-16 px-1 text-center text-xs tabular-nums text-muted"
      >
        {status}
      </span>
      <Tooltip label={t("pdfReading.findPrevious")} keys="Shift+Enter">
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={t("pdfReading.findPrevious")}
          disabled={total === 0}
          onClick={() => onStep(-1)}
        >
          <CaretUpIcon aria-hidden="true" className="size-4" />
        </button>
      </Tooltip>
      <Tooltip label={t("pdfReading.findNext")} keys="Enter">
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={t("pdfReading.findNext")}
          disabled={total === 0}
          onClick={() => onStep(1)}
        >
          <CaretDownIcon aria-hidden="true" className="size-4" />
        </button>
      </Tooltip>
      <Tooltip label={t("pdfReading.findClose")} keys="Esc">
        <button
          type="button"
          className="toolbar-icon-button"
          aria-label={t("pdfReading.findClose")}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </button>
      </Tooltip>
    </fieldset>
  );
}
