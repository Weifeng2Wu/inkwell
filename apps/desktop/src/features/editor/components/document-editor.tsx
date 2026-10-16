"use client";

import type { ComponentProps } from "react";
import { isMarkdownFile } from "../lib/markdown";
import { DraftEditor, MonacoEditor } from "./lazy";

export function DocumentEditor({
  filePath,
  projectPath,
  ...props
}: ComponentProps<typeof MonacoEditor> & { filePath: string; projectPath: string }) {
  return isMarkdownFile(filePath) ? (
    <DraftEditor key={filePath} {...props} filePath={filePath} projectPath={projectPath} />
  ) : (
    <MonacoEditor {...props} />
  );
}
