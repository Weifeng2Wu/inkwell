"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { normalizePdfPath, projectRelativePdfPath } from "./pdf-notes-session";

/**
 * Follows the PDF file itself: `pdfRevision` counts rewrites of it (a recompile),
 * and `canSyncSource` tells whether its `.tex` source and SyncTeX data sit beside it.
 */
export function usePdfSource(projectPath: string, pdfPath: string) {
  const [source, setSource] = useState({ canSyncSource: false, pdfRevision: 0 });
  useEffect(() => {
    let active = true;
    const relative = projectRelativePdfPath(projectPath, pdfPath);
    const pdf = [relative, `${projectPath}/${relative}`].map(normalizePdfPath);
    const companions = ["synctex.gz", "synctex", "tex"].flatMap((extension) =>
      pdf.map((path) => path.replace(/\.pdf$/i, `.${extension}`)),
    );
    const check = () =>
      invoke<boolean>("pdf_can_sync_source", {
        expectedProject: projectPath,
        relativePath: relative,
      }).then(
        (canSyncSource) => {
          if (active)
            setSource((current) =>
              current.canSyncSource === canSyncSource ? current : { ...current, canSyncSource },
            );
        },
        () => {},
      );
    void check();
    const stop = listen<{ path: string; kind: string }>("file-changed", ({ payload }) => {
      if (!active || payload.kind === "access") return;
      const path = normalizePdfPath(payload.path);
      const rewritten = pdf.includes(path);
      if (rewritten && payload.kind === "modify")
        setSource((current) => ({ ...current, pdfRevision: current.pdfRevision + 1 }));
      if (rewritten || companions.includes(path)) void check();
    }).catch(() => () => {});
    return () => {
      active = false;
      void stop.then((unlisten) => unlisten());
    };
  }, [projectPath, pdfPath]);
  return source;
}
