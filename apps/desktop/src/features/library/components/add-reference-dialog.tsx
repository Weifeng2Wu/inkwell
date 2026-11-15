"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/features/i18n";
import { lookupIdentifier } from "../lib/actions";
import { EMPTY_METADATA, type PaperMetadata } from "../lib/bibtex";
import { parseIdentifier } from "../lib/metadata";
import type { NewReference } from "../lib/use-library";

type Props = {
  /** Prefills the search, e.g. with the title guessed from a PDF. */
  initialQuery?: string;
  onAdd: (reference: NewReference) => void;
  onClose: () => void;
};

type Search =
  | { state: "idle" | "loading" | "failed" }
  | { state: "done"; candidates: PaperMetadata[] };

export function AddReferenceDialog({ initialQuery = "", onAdd, onClose }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const request = useRef(0);
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState<Search>({ state: "idle" });
  const [active, setActive] = useState(0);
  const listId = useId();
  const identifier = parseIdentifier(query);
  const candidates = search.state === "done" ? search.candidates : [];
  const candidateId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    inputRef.current?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const submit = async () => {
    if (!identifier || search.state === "loading") return;
    if (identifier.kind === "bibtex") return onAdd({ bibtex: identifier.value });
    const current = ++request.current;
    setSearch({ state: "loading" });
    try {
      const candidates = await lookupIdentifier(identifier);
      if (current !== request.current) return;
      setActive(0);
      setSearch({ state: "done", candidates });
    } catch {
      if (current === request.current) setSearch({ state: "failed" });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("common.cancel")}
        className="absolute inset-0 cursor-default bg-black/45"
        onClick={onClose}
      />
      <div className="motion-pop relative z-10 mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-border bg-background text-foreground shadow-2xl">
        <div className="border-b border-border px-5 py-4">
          <h3 id={titleId} className="text-sm font-medium">
            {t("library.addTitle")}
          </h3>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
          <textarea
            ref={inputRef}
            value={query}
            rows={3}
            aria-label={t("library.addTitle")}
            aria-controls={candidates.length ? listId : undefined}
            aria-activedescendant={candidates.length ? candidateId(active) : undefined}
            placeholder={t("library.addPlaceholder")}
            className="settings-control w-full resize-y py-2"
            onChange={(event) => {
              request.current += 1;
              setQuery(event.target.value);
              setSearch({ state: "idle" });
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
              if (step && candidates.length) {
                event.preventDefault();
                const next = Math.min(Math.max(active + step, 0), candidates.length - 1);
                setActive(next);
                document.getElementById(candidateId(next))?.scrollIntoView({ block: "nearest" });
                return;
              }
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              const chosen = candidates[active];
              if (chosen) onAdd({ metadata: chosen });
              else void submit();
            }}
          />
          <p aria-live="polite" className="flex min-h-4 items-center gap-1.5 text-xs text-muted">
            {search.state === "loading" ? (
              <>
                <Spinner className="size-3" />
                {t("library.lookingUp")}
              </>
            ) : (
              identifier && (
                <span key={identifier.kind} className="motion-fade">
                  {t(`library.detect.${identifier.kind}`)}
                </span>
              )
            )}
          </p>
          {search.state === "failed" && (
            <p className="rounded-md bg-error/10 px-3 py-2 text-xs text-error">
              {t("library.lookupFailed")}
            </p>
          )}
          {search.state === "done" && (
            <div
              id={listId}
              role="listbox"
              aria-label={t("library.candidates")}
              className="motion-rise -mx-2"
            >
              {search.candidates.map((candidate, index) => (
                <button
                  key={`${candidate.doi}|${candidate.arxiv}|${candidate.title}`}
                  id={candidateId(index)}
                  role="option"
                  aria-selected={index === active}
                  type="button"
                  tabIndex={-1}
                  data-active={index === active}
                  className="list-row w-full rounded-md px-2 py-2 text-left"
                  onMouseMove={() => setActive(index)}
                  onClick={() => onAdd({ metadata: candidate })}
                >
                  <span className="font-reading block text-sm leading-snug">{candidate.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {[candidate.authors.join("; "), candidate.year, candidate.venue]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}
              {search.candidates.length === 0 && (
                <p className="px-2 text-xs leading-relaxed text-muted">{t("library.noMatches")}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          {search.state !== "idle" &&
            search.state !== "loading" &&
            identifier?.kind === "title" && (
              <button
                type="button"
                className="btn btn-sm mr-auto"
                onClick={() => onAdd({ metadata: { ...EMPTY_METADATA, title: identifier.value } })}
              >
                {t("library.addTitleOnly")}
              </button>
            )}
          {search.state === "idle" && (
            <span className="mr-auto truncate text-[11px] text-muted-foreground">
              {t("library.addHint")}
            </span>
          )}
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary flex items-center gap-1.5 disabled:opacity-50"
            disabled={!identifier || search.state === "loading"}
            onClick={() => {
              const chosen = candidates[active];
              if (chosen) onAdd({ metadata: chosen });
              else void submit();
            }}
          >
            {identifier?.kind === "bibtex" || candidates.length
              ? t("library.add")
              : t("library.lookup")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
