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

export const DraftEditor = dynamic(
  () => import("./draft-editor").then((module) => module.DraftEditor),
  { ssr: false, loading: () => <EditorSkeleton className="h-full" /> },
);

export const PosterEditor = dynamic(
  () =>
    import("@/features/poster/components/poster-document-editor").then(
      (module) => module.PosterDocumentEditor,
    ),
  { ssr: false, loading: () => <EditorSkeleton className="h-full" /> },
);

export const DrawingEditor = dynamic(
  () => {
    Object.assign(window, { EXCALIDRAW_ASSET_PATH: "/excalidraw/" });
    return import("@/features/drawing/components/drawing-editor").then(
      (module) => module.DrawingEditor,
    );
  },
  { ssr: false, loading: () => <EditorSkeleton className="h-full" /> },
);

export const MindmapEditor = dynamic(
  () =>
    import("@/features/mindmap/components/mindmap-editor").then((module) => module.MindmapEditor),
  { ssr: false, loading: () => <EditorSkeleton className="h-full" /> },
);

export const DocumentEditor = dynamic(
  () => import("./document-editor").then((module) => module.DocumentEditor),
  { ssr: false, loading: () => <EditorSkeleton className="h-full" /> },
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
