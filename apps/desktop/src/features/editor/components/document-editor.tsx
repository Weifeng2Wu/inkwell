"use client";

import type { ComponentProps } from "react";
import { isPosterFile } from "@/features/poster/lib/model";
import { isMarkdownFile } from "../lib/markdown";
import { pdfPathFromNotes } from "../lib/pdf-notes";
import { DraftEditor, MonacoEditor, PosterEditor } from "./lazy";
import { PdfNotesEditor } from "./pdf-notes-editor";

export function DocumentEditor({
  filePath,
  projectPath,
  ...props
}: ComponentProps<typeof MonacoEditor> & { filePath: string; projectPath: string }) {
  const pdfPath = pdfPathFromNotes(filePath);
  return pdfPath ? (
    <PdfNotesEditor
      key={`${projectPath}/${filePath}`}
      {...props}
      filePath={filePath}
      projectPath={projectPath}
      pdfPath={pdfPath}
    />
  ) : isPosterFile(filePath) ? (
    <PosterEditor key={filePath} {...props} filePath={filePath} projectPath={projectPath} />
  ) : isMarkdownFile(filePath) ? (
    <DraftEditor key={filePath} {...props} filePath={filePath} projectPath={projectPath} />
  ) : (
    <MonacoEditor {...props} />
  );
}
