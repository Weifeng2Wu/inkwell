"use client";

import Image from "next/image";
import type { ComponentProps } from "react";
import { useI18n } from "@/features/i18n";
import { fileLanguage, fileType } from "@/lib/file-types";
import { pathSync } from "@/lib/path";
import { EditorErrorBoundary } from "./editor-error-boundary";
import { EditorSkeleton } from "./editor-skeleton";
import { DocumentEditor, PdfViewer } from "./lazy";

type EditorProps = Omit<
  ComponentProps<typeof DocumentEditor>,
  "filePath" | "projectPath" | "content" | "language" | "className"
>;
type PdfProps = Omit<
  ComponentProps<typeof PdfViewer>,
  "src" | "projectPath" | "pdfPath" | "compiledPreview" | "refreshKey"
>;

type Props = {
  projectPath: string;
  /** Project-relative path of the open file. */
  path: string;
  /** Text content; unused for image and PDF previews. */
  content: string;
  /** Asset URL for image and PDF previews. */
  previewUrl: string | null;
  loading: boolean;
  error?: string | null;
  pdfRefreshKey: number;
  /** Absolute path of the PDF produced by the last successful compilation. */
  compiledPdfPath?: string;
  editor: EditorProps;
  pdf: PdfProps;
};

const slashes = (path: string) => path.replace(/\\/g, "/");

/**
 * The body of an editor pane, faded in once per file. The wrapper is keyed by path, so
 * switching tabs replays the entrance while loading-to-content inside one file does not.
 */
export function FilePane(props: Props) {
  return (
    <div key={`${props.projectPath}/${props.path}`} className="motion-fade h-full min-h-0">
      <FilePaneBody {...props} />
    </div>
  );
}

/** A text editor, or an image or PDF preview. */
function FilePaneBody({
  projectPath,
  path,
  content,
  previewUrl,
  loading,
  error,
  pdfRefreshKey,
  compiledPdfPath,
  editor,
  pdf,
}: Props) {
  const { t } = useI18n();
  if (loading) return <EditorSkeleton className="h-full" />;
  if (error)
    return (
      <div
        role="alert"
        className="flex h-full items-center justify-center px-6 text-center text-sm text-muted"
      >
        {t("files.failedToReadFile", { error })}
      </div>
    );
  if (!previewUrl)
    return (
      <EditorErrorBoundary>
        <DocumentEditor
          {...editor}
          filePath={path}
          projectPath={projectPath}
          content={content}
          language={fileLanguage(path)}
          className="h-full"
        />
      </EditorErrorBoundary>
    );
  if (fileType(path) === "pdf")
    return (
      <PdfViewer
        {...pdf}
        key={`${projectPath}/${path}`}
        src={previewUrl}
        projectPath={projectPath}
        pdfPath={path}
        compiledPreview={
          !!compiledPdfPath &&
          slashes(compiledPdfPath) === slashes(pathSync.join(projectPath, path))
        }
        refreshKey={pdfRefreshKey}
      />
    );
  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-surface-secondary p-4">
      <Image
        unoptimized
        src={previewUrl}
        alt={path}
        width={1200}
        height={900}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
