"use client";

import {
  ArrowClockwiseIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
} from "@phosphor-icons/react";
import { EditorErrorBoundary } from "@/features/editor/components/editor-error-boundary";
import { useI18n } from "@/features/i18n";
import { type FileOperations, FileTree } from "@/features/workspace/components/file-tree";
import { pathSync } from "@/lib/path";
import type { FileNode } from "@/types/files";

type FileSidebarPanelProps = {
  projectPath: string | null;
  files: FileNode[];
  selectedFile?: string;
  highlightedFile: string | null;
  onFileSelect: (path: string) => void;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onRefreshFiles: () => void | Promise<void>;
  fileOperations: FileOperations;
};

export function FileSidebarPanel({
  projectPath,
  files,
  selectedFile,
  highlightedFile,
  onFileSelect,
  onCreateFile,
  onCreateDirectory,
  onRefreshFiles,
  fileOperations,
}: FileSidebarPanelProps) {
  const { t } = useI18n();

  if (!projectPath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-4 text-center text-muted">
        <FolderIcon className="w-8 h-8 mb-2 opacity-30" />
        <p className="text-xs">{t("files.noFolderOpen")}</p>
      </div>
    );
  }

  return (
    <>
      <div
        className="px-3 py-2 border-b border-border flex items-center justify-between gap-2"
        title={projectPath}
      >
        <span className="text-xs text-muted truncate">{pathSync.basename(projectPath)}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={onCreateFile}
            className="p-1 text-muted hover:text-foreground hover:bg-accent/5 transition-colors"
            title={t("files.newFile")}
            aria-label={t("files.newFile")}
          >
            <FilePlusIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCreateDirectory}
            className="p-1 text-muted hover:text-foreground hover:bg-accent/5 transition-colors"
            title={t("files.newFolder")}
            aria-label={t("files.newFolder")}
          >
            <FolderPlusIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRefreshFiles}
            className="p-1 text-muted hover:text-foreground hover:bg-accent/5 transition-colors"
            title={t("files.refreshFiles")}
            aria-label={t("files.refreshFiles")}
          >
            <ArrowClockwiseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <EditorErrorBoundary>
        <FileTree
          files={files}
          selectedFile={selectedFile}
          highlightedFile={highlightedFile}
          onFileSelect={onFileSelect}
          className="flex-1 min-h-0 overflow-hidden"
          fileOperations={fileOperations}
          projectPath={projectPath}
          onRefresh={onRefreshFiles}
        />
      </EditorErrorBoundary>
    </>
  );
}
