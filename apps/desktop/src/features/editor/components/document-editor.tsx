"use client";

import type { ComponentProps } from "react";
import { isDrawingFile } from "@/features/drawing";
import { isMindmapFile } from "@/features/mindmap";
import { isPosterFile } from "@/features/poster/lib/model";
import type { MarkdownLinkKind } from "@/lib/markdown-links";
import { isMarkdownFile } from "../lib/markdown";
import { pdfPathFromNotes } from "../lib/pdf-notes";
import { DraftEditor, DrawingEditor, MindmapEditor, MonacoEditor, PosterEditor } from "./lazy";
import { PdfNotesEditor } from "./pdf-notes-editor";

export function DocumentEditor({
  filePath,
  projectPath,
  backlinks,
  onBacklinkClick,
  onWikiLinkClick,
  ...props
}: ComponentProps<typeof MonacoEditor> & {
  filePath: string;
  projectPath: string;
  backlinks?: string[];
  onBacklinkClick?: (path: string) => void;
  onWikiLinkClick?: (target: string, kind?: MarkdownLinkKind) => void;
}) {
  const pdfPath = pdfPathFromNotes(filePath);
  return pdfPath ? (
    <PdfNotesEditor
      key={`${projectPath}/${filePath}`}
      {...props}
      filePath={filePath}
      projectPath={projectPath}
      pdfPath={pdfPath}
      backlinks={backlinks}
      onBacklinkClick={onBacklinkClick}
      onWikiLinkClick={onWikiLinkClick}
    />
  ) : isDrawingFile(filePath) ? (
    <DrawingEditor
      key={`${projectPath}/${filePath}`}
      {...props}
      filePath={filePath}
      projectPath={projectPath}
    />
  ) : isMindmapFile(filePath) ? (
    <MindmapEditor
      key={`${projectPath}/${filePath}`}
      {...props}
      filePath={filePath}
      projectPath={projectPath}
    />
  ) : isPosterFile(filePath) ? (
    <PosterEditor
      key={`${projectPath}/${filePath}`}
      {...props}
      filePath={filePath}
      projectPath={projectPath}
    />
  ) : isMarkdownFile(filePath) ? (
    <DraftEditor
      key={filePath}
      {...props}
      backlinks={backlinks}
      onBacklinkClick={onBacklinkClick}
      onWikiLinkClick={onWikiLinkClick}
      filePath={filePath}
      projectPath={projectPath}
    />
  ) : (
    // Keyed so one file's undo history and cursor never apply to another.
    <MonacoEditor key={filePath} {...props} />
  );
}
