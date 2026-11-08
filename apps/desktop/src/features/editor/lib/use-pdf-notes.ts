"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useI18n } from "@/features/i18n";
import { createPdfNotes } from "./pdf-notes";
import { getPdfNotesSession } from "./pdf-notes-session";

export function usePdfNotes(projectPath: string, pdfPath: string) {
  const { t } = useI18n();
  const session = useMemo(
    () =>
      getPdfNotesSession(
        projectPath,
        pdfPath,
        createPdfNotes(pdfPath, t("pdfReading.notesTitle"), t("pdfReading.notesIntroduction")),
      ),
    [projectPath, pdfPath, t],
  );
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  return { session, ...snapshot };
}
