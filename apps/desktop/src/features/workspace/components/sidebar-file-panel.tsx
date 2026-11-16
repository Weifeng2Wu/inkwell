"use client";

import {
  ArrowClockwiseIcon,
  FilePlusIcon,
  FolderIcon,
  FolderPlusIcon,
} from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { PanelAction, PanelHeader } from "@/components/ui/panel-header";
import { EditorErrorBoundary } from "@/features/editor/components/editor-error-boundary";
import { useI18n } from "@/features/i18n";
import { shortcutLabel, useKeyboardShortcuts } from "@/features/settings";
import { type FileOperations, FileTree } from "@/features/workspace/components/file-tree";
import type { FileNode } from "@/types/files";

type FileSidebarPanelProps = {
  projectPath: string | null;
  files: FileNode[];
  pdfMetadata?: ComponentProps<typeof FileTree>["pdfMetadata"];
  selectedFile?: string;
  openFiles?: readonly string[];
  highlightedFile: string | null;
  onFileSelect: (path: string) => void;
  onCreateFile: () => void;
  onCreateDirectory: () => void;
  onRefreshFiles: () => void | Promise<void>;
  fileOperations: FileOperations;
  contextMenuItems?: ComponentProps<typeof FileTree>["contextMenuItems"];
};

export function FileSidebarPanel({
  projectPath,
  files,
  pdfMetadata,
  selectedFile,
  openFiles,
  highlightedFile,
  onFileSelect,
  onCreateFile,
  onCreateDirectory,
  onRefreshFiles,
  fileOperations,
  contextMenuItems,
}: FileSidebarPanelProps) {
  const { t } = useI18n();
  const { bindings } = useKeyboardShortcuts();
  const openKeys = shortcutLabel(bindings.openProject);

  const title = t("workbench.views.files");

  if (!projectPath) {
    return (
      <>
        <PanelHeader title={title} />
        <PanelEmpty
          icon={<FolderIcon className="size-7" />}
          title={t("files.noFolderOpen")}
          description={t("files.noProjectHint")}
        >
          {openKeys && <kbd className="kbd-quiet mt-1">{openKeys}</kbd>}
        </PanelEmpty>
      </>
    );
  }

  return (
    <>
      <PanelHeader title={title}>
        <PanelAction label={t("files.newFile")} onClick={onCreateFile}>
          <FilePlusIcon className="size-4" aria-hidden="true" />
        </PanelAction>
        <PanelAction label={t("files.newFolder")} onClick={onCreateDirectory}>
          <FolderPlusIcon className="size-4" aria-hidden="true" />
        </PanelAction>
        <PanelAction label={t("files.refreshFiles")} onClick={() => void onRefreshFiles()}>
          <ArrowClockwiseIcon className="size-4" aria-hidden="true" />
        </PanelAction>
      </PanelHeader>
      <EditorErrorBoundary>
        <FileTree
          files={files}
          pdfMetadata={pdfMetadata}
          selectedFile={selectedFile}
          openFiles={openFiles}
          highlightedFile={highlightedFile}
          onFileSelect={onFileSelect}
          className="flex-1 min-h-0 overflow-hidden"
          fileOperations={fileOperations}
          contextMenuItems={contextMenuItems}
          projectPath={projectPath}
          onRefresh={onRefreshFiles}
        />
      </EditorErrorBoundary>
    </>
  );
}
