"use client";

import dynamic from "next/dynamic";
import { EditorSkeleton } from "@/features/editor/components/editor-skeleton";

/**
 * Monaco and the PDF viewer are large and reach for browser-only APIs, so they are loaded
 * on demand rather than pulled into the initial bundle.
 */

export const PdfViewer = dynamic(
  () => import("@/features/editor/components/pdf-viewer").then((mod) => mod.PdfViewer),
  { ssr: false },
);

export const MonacoEditor = dynamic(
  () => import("@/features/editor/components/monaco-editor").then((mod) => mod.MonacoEditor),
  { ssr: false },
);

export const GitMonacoDiffEditor = dynamic(
  () =>
    import("@/features/editor/components/monaco-diff-editor").then((mod) => mod.MonacoDiffEditor),
  {
    ssr: false,
    loading: () => <EditorSkeleton className="h-full" />,
  },
);
