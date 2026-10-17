"use client";

import type { ComponentProps } from "react";
import { isPosterFile } from "@/features/poster/lib/model";
import { isMarkdownFile } from "../lib/markdown";
import { DraftEditor, MonacoEditor, PosterEditor } from "./lazy";

export function DocumentEditor({
  filePath,
  projectPath,
  ...props
}: ComponentProps<typeof MonacoEditor> & { filePath: string; projectPath: string }) {
  return isPosterFile(filePath) ? (
    <PosterEditor key={filePath} {...props} filePath={filePath} projectPath={projectPath} />
  ) : isMarkdownFile(filePath) ? (
    <DraftEditor key={filePath} {...props} filePath={filePath} projectPath={projectPath} />
  ) : (
    <MonacoEditor {...props} />
  );
}
