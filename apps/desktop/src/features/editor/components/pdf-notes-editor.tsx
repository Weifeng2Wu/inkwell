"use client";

import { type ComponentProps, useEffect, useRef, useState } from "react";
import { useI18n } from "@/features/i18n";
import type { PdfNotesSession } from "../lib/pdf-notes-session";
import { usePdfNotes } from "../lib/use-pdf-notes";
import { DraftEditor, type MonacoEditor } from "./lazy";

type Draft = { text: string; baseline: string; error?: string };
// Preserve rejected drafts across tab switches. Disk remains the durable source;
// this cache is only a recovery buffer, never an alternative annotations database.
const drafts = new Map<PdfNotesSession, Draft>();

export function PdfNotesEditor({
  filePath,
  projectPath,
  pdfPath,
  ...props
}: ComponentProps<typeof MonacoEditor> & {
  filePath: string;
  projectPath: string;
  pdfPath: string;
}) {
  const { t } = useI18n();
  const notes = usePdfNotes(projectPath, pdfPath);
  const { session } = notes;
  const [draft, setDraft] = useState<Draft>(
    () =>
      drafts.get(session) ?? {
        text: props.content ?? "",
        baseline: props.content ?? "",
      },
  );
  const draftRef = useRef(draft);
  const inFlight = useRef<Promise<void> | undefined>(undefined);
  const mounted = useRef(true);
  const persistRef = useRef<() => Promise<void>>(async () => {});
  drafts.set(session, draftRef.current);

  function update(next: Draft) {
    draftRef.current = next;
    drafts.set(session, next);
    if (mounted.current) setDraft(next);
  }

  const persist = async (): Promise<void> => {
    if (inFlight.current) {
      await inFlight.current;
      return persistRef.current();
    }
    const current = draftRef.current;
    if (current.text === current.baseline) return;
    const operation = session
      .replaceMarkdown(current.text, current.baseline)
      .then(() => {
        update({ ...draftRef.current, baseline: current.text, error: undefined });
      })
      .catch((error: unknown) => {
        update({ ...draftRef.current, error: String(error) });
        throw error;
      })
      .finally(() => {
        inFlight.current = undefined;
      });
    inFlight.current = operation;
    await operation;
  };
  persistRef.current = persist;

  useEffect(() => {
    const content = notes.content;
    const current = draftRef.current;
    if (content === undefined || inFlight.current) return;
    if (current.text === current.baseline) {
      const next = { text: content, baseline: content };
      draftRef.current = next;
      drafts.set(session, next);
      setDraft(next);
    } else if (content !== current.baseline) {
      const next = { ...current, error: "PDF_NOTES_CONFLICT" };
      draftRef.current = next;
      drafts.set(session, next);
      setDraft(next);
    }
  }, [notes.content, session]);

  useEffect(() => {
    if (draft.text === draft.baseline || draft.error) return;
    const timeout = setTimeout(() => {
      void persistRef.current().catch(() => {});
    }, 350);
    return () => clearTimeout(timeout);
  }, [draft]);

  useEffect(() => {
    mounted.current = true;
    const close = (event: Event) => {
      (event as CustomEvent<Promise<unknown>[]>).detail.push(persistRef.current());
    };
    window.addEventListener("inkwell-before-close", close);
    return () => {
      mounted.current = false;
      window.removeEventListener("inkwell-before-close", close);
      if (!draftRef.current.error) void persistRef.current().catch(() => {});
    };
  }, []);

  const error = draft.error;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <DraftEditor
          {...props}
          content={draft.text}
          filePath={filePath}
          projectPath={projectPath}
          onContentChange={(text) => update({ ...draftRef.current, text, error: undefined })}
        />
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface-secondary px-3 py-2 text-xs">
        <span className={error ? "text-error" : "text-muted"} role="status">
          {error
            ? t(
                error.includes("PDF_NOTES_CONFLICT")
                  ? "pdfReading.conflict"
                  : "pdfReading.saveFailed",
              )
            : t(draft.text === draft.baseline ? "editor.savedStatus" : "editor.savingStatus")}
        </span>
        {error && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void persist().catch(() => {})}
            >
              {t("pdfReading.retry")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                void navigator.clipboard.writeText(draftRef.current.text).catch(() => {});
              }}
            >
              {t("pdfReading.copyDraft")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                if (!window.confirm(t("pdfReading.discardDraftConfirm"))) return;
                void session
                  .reload()
                  .then(() => {
                    const content = session.getSnapshot().content;
                    if (content !== undefined) update({ text: content, baseline: content });
                  })
                  .catch(() => {});
              }}
            >
              {t("pdfReading.reload")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
