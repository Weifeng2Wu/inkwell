"use client";

import {
  CircleNotchIcon,
  FolderOpenIcon,
  GearIcon,
  PlayIcon,
  SquaresFourIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { AnimatePresence, motion, type PanInfo, useReducedMotion } from "framer-motion";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function safeConvertFileSrc(filePath: string, protocol = "asset"): string {
  if (!isTauri()) return filePath;
  return convertFileSrc(filePath, protocol);
}

import { Logo } from "@/components/logo";
import { AcpConnectionDialog } from "@/features/agent/components/acp-connection-dialog";
import { InputDialog } from "@/components/ui/input-dialog";
import {
  TabBar,
  type TabDragEndPayload,
  type TabDragMovePayload,
  type TabItem,
  type TabReorderPosition,
} from "@/components/ui/tab-bar";
import { useToast } from "@/components/ui/toast";
import {
  AcademicAgentPanel,
  AgentReviewPanel,
  ExternalAgentPanel,
  useAcademicAgent,
  useAgentReview,
  useAgentSelection,
  useExternalAgent,
} from "@/features/agent";
import {
  type DockviewPanelItem,
  DockviewPanelLayout,
} from "@/features/editor/components/dockview-panel-layout";
import { EditorErrorBoundary } from "@/features/editor/components/editor-error-boundary";
import { EditorSkeleton } from "@/features/editor/components/editor-skeleton";
import {
  DocumentEditor,
  GitMonacoDiffEditor,
  MonacoEditor,
  PdfViewer,
} from "@/features/editor/components/lazy";
import { parseUnifiedDiffContent } from "@/features/editor/lib/diff";
import {
  placeSynctexPdfOnRight,
  type SplitPaneSide,
  type SplitPaneState,
} from "@/features/editor/lib/synctex-layout";
import { useProjectBibliography } from "@/features/editor/lib/use-project-bibliography";
import { GitHubPublishDialog } from "@/features/git/components/github-publish-dialog";
import { GitSidebarPanel } from "@/features/git/components/sidebar-git-panel";
import {
  AI_COMMIT_DIFF_LIMIT,
  buildAiCommitPrompt,
  sanitizeAiCommitMessage,
} from "@/features/git/lib/ai-commit";
import { useI18n } from "@/features/i18n";
import {
  findMainTexFile,
  findTexFiles,
  isMissingSynctexData,
  LaTeXInstallPrompt,
  type MainFileDetectionResult,
  MainFileSelectionDialog,
  MainFileSwitcher,
  SynctexInstallDialog,
  type SynctexResult,
  useLatexCompiler,
  useLatexSettings,
} from "@/features/latex";
import { QuickStart } from "@/features/onboarding/components/quick-start";
import { useQuickStart } from "@/features/onboarding/lib/use-quick-start";
import {
  matchesShortcut,
  SettingsPage,
  useEditorSettings,
  useKeyboardShortcuts,
} from "@/features/settings";
import { TerminalPanel } from "@/features/terminal/components/terminal-panel";
import { RecentProjects } from "@/features/workspace/components/recent-projects";
import { FileSidebarPanel } from "@/features/workspace/components/sidebar-file-panel";
import { useRecentProjects } from "@/features/workspace/lib/recent-projects";
import { buildBasenameIndex, type TreeNode } from "@/features/workspace/lib/tree-index";
import { throttle } from "@/lib/async";
import { INSTANT_TRANSITION, MAX_SIDEBAR_WIDTH, MIN_PANEL_WIDTH, PANEL_SPRING } from "@/lib/layout";
import { pathSync } from "@/lib/path";
import { appStorage, storedPanelWidth } from "@/lib/storage/app-storage";
import { useTauriDaemon } from "@/lib/tauri";

type EditorViewMode = "file" | "git-diff";
type GitDiffPreviewState = {
  path: string;
  staged: boolean;
  content: string;
  isLoading: boolean;
  error: string | null;
};

type DragSourcePane = "primary" | "split";

export default function EditorPage() {
  const editorSettings = useEditorSettings();
  const { bindings: keyboardShortcuts } = useKeyboardShortcuts();
  const daemon = useTauriDaemon({
    gitAutoFetchEnabled: editorSettings.settings.gitAutoFetchEnabled,
    gitAutoFetchIntervalMs: editorSettings.settings.gitAutoFetchIntervalSeconds * 1000,
  });
  const prefersReducedMotion = useReducedMotion();
  const { toast } = useToast();
  const { t, locale } = useI18n();
  const recentProjects = useRecentProjects();

  const [selectedFile, setSelectedFile] = useState<string>();
  const [fileContent, setFileContent] = useState<string>("");
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>("file");
  const [gitDiffPreview, setGitDiffPreview] = useState<GitDiffPreviewState | null>(null);
  const [splitPane, setSplitPane] = useState<SplitPaneState | null>(null);
  const [splitPositionRevision, setSplitPositionRevision] = useState(0);
  const bibliography = useProjectBibliography({
    projectPath: daemon.projectPath,
    files: daemon.files,
    readFile: daemon.readFile,
    change: daemon.lastFileChange,
    primaryPath: selectedFile,
    primaryContent: selectedFile && /\.bib$/i.test(selectedFile) ? fileContent : "",
    secondaryPath: splitPane?.selectedFile,
    secondaryContent:
      splitPane?.selectedFile && /\.bib$/i.test(splitPane.selectedFile) ? splitPane.content : "",
  });
  const [splitDropHint, setSplitDropHint] = useState<SplitPaneSide | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [binaryPreviewUrl, setBinaryPreviewUrl] = useState<string | null>(null);
  const [pdfRefreshKey, setPdfRefreshKey] = useState(0);
  const [pendingGoToLine, setPendingGoToLine] = useState(0);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    storedPanelWidth("sidebarWidth", 150, 600),
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() =>
    storedPanelWidth("rightPanelWidth", 280, 700),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const savedSidebar = appStorage.getItem("sidebarWidth");
      if (savedSidebar) {
        const parsed = parseInt(savedSidebar, 10);
        if (!Number.isNaN(parsed) && parsed >= 150 && parsed <= 600) {
          setSidebarWidth(parsed);
        }
      }
      const savedRight = appStorage.getItem("rightPanelWidth");
      if (savedRight) {
        const parsed = parseInt(savedRight, 10);
        if (!Number.isNaN(parsed) && parsed >= 280 && parsed <= 700) {
          setRightPanelWidth(parsed);
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);
  const [resizing, setResizing] = useState<"sidebar" | "right" | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"files" | "git">("files");
  const [highlightedFile, _setHighlightedFile] = useState<string | null>(null);

  const [commitMessage, setCommitMessage] = useState("");
  const [showCommitInput, setShowCommitInput] = useState(false);
  const activeProjectPathRef = useRef(daemon.projectPath);
  activeProjectPathRef.current = daemon.projectPath;
  const [isGeneratingCommitMessageAI, setIsGeneratingCommitMessageAI] = useState(false);
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [createDialog, setCreateDialog] = useState<{
    type: "file" | "directory";
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const switchingProjectRef = useRef(false);
  const restoredWorkspaceRef = useRef(false);
  const [isSwitchingProject, setIsSwitchingProject] = useState(false);
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"general" | "agent">("general");
  const workspaceReady = Boolean(
    daemon.projectInfo &&
      !daemon.isOpeningProject &&
      daemon.lastError?.operation !== "open project",
  );
  const quickStart = useQuickStart(workspaceReady);
  const showQuickStart = quickStart.visible;
  const [pendingAcademicMessage, setPendingAcademicMessage] = useState<string | null>(null);
  const agentSelection = useAgentSelection();
  const reviewBuffers = useRef<{ path: string; content: string }[]>([]);
  reviewBuffers.current = [
    ...(selectedFile && !binaryPreviewUrl && editorViewMode === "file"
      ? [{ path: selectedFile, content: fileContent }]
      : []),
    ...(splitPane?.selectedFile && !splitPane.binaryPreviewUrl
      ? [{ path: splitPane.selectedFile, content: splitPane.content }]
      : []),
  ].filter((buffer) => /(?:\.(tex|bib|cls|sty|md|txt|csv)|\.poster\.json)$/i.test(buffer.path));
  const agentReview = useAgentReview({
    directory: daemon.projectPath ?? undefined,
    buffers: () => reviewBuffers.current,
    onApplied: (path, content) => {
      if (selectedFile === path && contentSaveTimeoutRef.current) {
        clearTimeout(contentSaveTimeoutRef.current);
        contentSaveTimeoutRef.current = null;
      }
      if (splitPane?.selectedFile === path && splitContentSaveTimeoutRef.current) {
        clearTimeout(splitContentSaveTimeoutRef.current);
        splitContentSaveTimeoutRef.current = null;
      }
      if (selectedFile === path) {
        setFileContent(content ?? "");
        if (content === null) setSelectedFile(undefined);
      }
      setSplitPane((current) =>
        current?.selectedFile === path
          ? {
              ...current,
              content: content ?? "",
              selectedFile: content === null ? undefined : path,
            }
          : current,
      );
      void daemon.refreshFiles();
    },
  });
  const academicAgent = useAcademicAgent({
    directory: daemon.projectPath ?? undefined,
    pendingMessage: pendingAcademicMessage,
    onPendingMessageSent: () => setPendingAcademicMessage(null),
    enabled: agentSelection.ready && agentSelection.selected === "builtin",
    beforeTurn: agentReview.beforeTurn,
    afterTurn: agentReview.afterTurn,
  });
  const externalAgent = useExternalAgent({
    beforeTurn: agentReview.beforeTurn,
    afterTurn: agentReview.afterTurn,
    selection: agentSelection,
    directory: daemon.projectPath ?? undefined,
    config: academicAgent.config,
    configReady: academicAgent.configReady,
    pendingMessage: pendingAcademicMessage,
    onPendingMessageSent: () => setPendingAcademicMessage(null),
  });

  useEffect(() => {
    if (externalAgent.authentication) setShowRightPanel(true);
  }, [externalAgent.authentication]);

  const [showMainFileDialog, setShowMainFileDialog] = useState(false);
  const [mainFileDetectionResult, setMainFileDetectionResult] =
    useState<MainFileDetectionResult | null>(null);
  const [showGitHubPublishDialog, setShowGitHubPublishDialog] = useState(false);
  const [ghPublishError, setGhPublishError] = useState<string | null>(null);
  const [showSynctexInstallDialog, setShowSynctexInstallDialog] = useState(false);
  const pendingSynctexRetryRef = useRef<{
    page: number;
    x: number;
    y: number;
    context: "main" | "split";
  } | null>(null);

  const contentSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const splitContentSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savingVisualTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<{ path: string; time: number } | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const gitDiffRequestIdRef = useRef(0);
  const splitLoadRequestIdRef = useRef(0);
  const editorWorkspaceRef = useRef<HTMLDivElement | null>(null);

  // RAF-based resize refs for 60fps performance
  const sidebarWidthRef = useRef(sidebarWidth);
  const rightPanelWidthRef = useRef(rightPanelWidth);
  const rafIdRef = useRef<number | null>(null);

  const gitStatus = daemon.gitStatus;
  const stagedChanges = useMemo(
    () => (gitStatus?.changes ?? []).filter((c: { staged: boolean; path: string }) => c.staged),
    [gitStatus?.changes],
  );
  const unstagedChanges = useMemo(
    () => (gitStatus?.changes ?? []).filter((c: { staged: boolean; path: string }) => !c.staged),
    [gitStatus?.changes],
  );

  // LaTeX settings and editor settings
  const latexSettings = useLatexSettings();
  const texFiles = useMemo(() => findTexFiles(daemon.files), [daemon.files]);

  // Auto-detect main file when project opens
  useEffect(() => {
    if (daemon.files.length > 0 && !latexSettings.settings.mainFile) {
      const mainFile = findMainTexFile(daemon.files);
      if (mainFile) {
        latexSettings.setMainFile(mainFile);
      }
    }
  }, [daemon.files, latexSettings.settings.mainFile, latexSettings]);

  const latexCompiler = useLatexCompiler({
    settings: latexSettings.settings,
    projectPath: daemon.projectPath,
  });

  // Check if any LaTeX compiler is available
  const hasAnyCompiler =
    latexCompiler.compilersStatus &&
    (latexCompiler.compilersStatus.pdflatex.available ||
      latexCompiler.compilersStatus.xelatex.available ||
      latexCompiler.compilersStatus.lualatex.available ||
      latexCompiler.compilersStatus.latexmk.available);

  const handleMainFileDialogCancel = useCallback(() => {
    setShowMainFileDialog(false);
    setMainFileDetectionResult(null);
  }, []);

  const handleToggleRightPanel = useCallback(() => {
    setShowRightPanel((current) => !current);
  }, []);

  useEffect(() => {
    appStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    appStorage.setItem("rightPanelWidth", String(rightPanelWidth));
  }, [rightPanelWidth]);

  useEffect(() => {
    if (pendingGoToLine > 0) {
      // Give the editor time to load new file content before clearing
      const timer = setTimeout(() => setPendingGoToLine(0), 3000);
      return () => clearTimeout(timer);
    }
  }, [pendingGoToLine]);

  useEffect(() => {
    if (!daemon.projectPath) {
      if (splitContentSaveTimeoutRef.current) {
        clearTimeout(splitContentSaveTimeoutRef.current);
        splitContentSaveTimeoutRef.current = null;
      }
      setSplitPane(null);
    }
  }, [daemon.projectPath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Close the terminal when switching workspaces.
  useEffect(() => {
    setShowTerminal(false);
  }, [daemon.projectPath]);

  useEffect(() => {
    return () => {
      if (splitContentSaveTimeoutRef.current) {
        clearTimeout(splitContentSaveTimeoutRef.current);
        splitContentSaveTimeoutRef.current = null;
      }
    };
  }, []);

  const startResize = useCallback(
    (panel: "sidebar" | "right") => {
      setResizing(panel);
      sidebarWidthRef.current = sidebarWidth;
      rightPanelWidthRef.current = rightPanelWidth;
      document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
      document.documentElement.style.setProperty("--right-panel-width", `${rightPanelWidth}px`);
    },
    [sidebarWidth, rightPanelWidth],
  );

  const handleResizeDrag = useCallback((panel: "sidebar" | "right", info: PanInfo) => {
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      if (panel === "sidebar") {
        const newWidth = Math.round(
          Math.min(Math.max(info.point.x, MIN_PANEL_WIDTH), MAX_SIDEBAR_WIDTH),
        );
        sidebarWidthRef.current = newWidth;
        document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);
      } else if (panel === "right") {
        const maxRightWidth = Math.floor(window.innerWidth / 2);
        const newWidth = Math.min(
          Math.max(window.innerWidth - info.point.x, MIN_PANEL_WIDTH),
          maxRightWidth,
        );
        rightPanelWidthRef.current = newWidth;
        document.documentElement.style.setProperty("--right-panel-width", `${newWidth}px`);
      }
      rafIdRef.current = null;
    });
  }, []);

  const endResize = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    setSidebarWidth(sidebarWidthRef.current);
    setRightPanelWidth(rightPanelWidthRef.current);
    document.documentElement.style.removeProperty("--sidebar-width");
    document.documentElement.style.removeProperty("--right-panel-width");
    setResizing(null);
  }, []);

  useEffect(() => {
    const COMPACT_THRESHOLD = 1100;

    const handleResize = throttle(() => {
      if (window.innerWidth < COMPACT_THRESHOLD) {
        setShowRightPanel(false);
      }
    }, 100);

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const getFileType = useCallback((path: string): "text" | "image" | "pdf" => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
      return "image";
    }
    if (ext === "pdf") {
      return "pdf";
    }
    return "text";
  }, []);

  const getFileLanguage = useCallback((path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const languageMap: Record<string, string> = {
      tex: "latex",
      sty: "latex",
      cls: "latex",
      bib: "bibtex",
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      py: "python",
      md: "markdown",
      json: "json",
      css: "css",
      scss: "scss",
      less: "less",
      html: "html",
      htm: "html",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      sh: "shell",
      bash: "shell",
      zsh: "shell",
      c: "c",
      cpp: "cpp",
      h: "c",
      hpp: "cpp",
      java: "java",
      rs: "rust",
      go: "go",
      rb: "ruby",
      php: "php",
      sql: "sql",
      r: "r",
      lua: "lua",
      swift: "swift",
      kt: "kotlin",
      scala: "scala",
      toml: "toml",
      ini: "ini",
      conf: "ini",
      dockerfile: "dockerfile",
      makefile: "makefile",
    };
    return languageMap[ext] || "plaintext";
  }, []);

  const filesByBasename = useMemo(
    () => buildBasenameIndex(daemon.files as TreeNode[]),
    [daemon.files],
  );

  const resolveSelectablePath = useCallback(
    (candidatePath: string): string => {
      const normalized = candidatePath.replace(/\\/g, "/");
      if (normalized.includes("/")) {
        return normalized;
      }

      const matches = filesByBasename.get(normalized) ?? [];
      if (matches.length === 0) {
        return normalized;
      }

      if (matches.length > 1) {
        const preferred = matches[0];
        if (preferred) {
          toast(t("files.multipleFilesFound", { name: normalized, preferred }), "error");
          return preferred;
        }
      }

      return matches[0] ?? normalized;
    },
    [filesByBasename, toast, t],
  );

  const handleFileSelect = useCallback(
    async (path: string) => {
      const resolvedPath = resolveSelectablePath(path);
      if (agentReview.changes.some((change) => change.path === resolvedPath)) {
        agentReview.setOpen(true);
      }
      setEditorViewMode("file");
      setGitDiffPreview(null);
      const fileType = getFileType(resolvedPath);

      setOpenTabs((prev) => {
        if (prev.includes(resolvedPath)) return prev;
        return [...prev, resolvedPath];
      });
      setSelectedFile(resolvedPath);
      setBinaryPreviewUrl(null);

      if (fileType === "text") {
        setIsLoadingFile(true);
        try {
          const proposal = agentReview.changes.find((change) => change.path === resolvedPath);
          const content = proposal ? (proposal.before ?? "") : await daemon.readFile(resolvedPath);
          setFileContent(content ?? "");
        } catch (err) {
          const errorStr = String(err);

          // Handle file not found - remove from tabs and notify user
          if (errorStr.includes("FILE_NOT_FOUND")) {
            const fileName = pathSync.basename(resolvedPath);
            toast(t("files.fileRemovedFromTabs", { name: fileName }), "error");

            // Remove the file from open tabs
            setOpenTabs((prev) => {
              const newTabs = prev.filter((p) => p !== resolvedPath);

              // Switch to another tab if available
              if (newTabs.length > 0) {
                const nextFile = newTabs[0];
                if (nextFile) {
                  // Recursively try to open the next file
                  setTimeout(() => handleFileSelect(nextFile), 0);
                }
              } else {
                // No more tabs, clear selection
                setSelectedFile(undefined);
                setFileContent("");
              }

              return newTabs;
            });
          } else {
            console.error("Failed to read file:", err);
            toast(t("files.failedToReadFile", { error: String(err) }), "error");
            setFileContent("");
          }
        } finally {
          setIsLoadingFile(false);
        }
      } else {
        const fullPath = daemon.projectPath
          ? pathSync.join(daemon.projectPath, resolvedPath)
          : resolvedPath;
        setBinaryPreviewUrl(safeConvertFileSrc(fullPath));
        setFileContent("");
      }
    },
    [
      daemon,
      getFileType,
      resolveSelectablePath,
      toast,
      t,
      agentReview.changes,
      agentReview.setOpen,
    ],
  );

  const reviewWasOpen = useRef(false);
  useEffect(() => {
    const justOpened = agentReview.open && !reviewWasOpen.current;
    reviewWasOpen.current = agentReview.open;
    const first = agentReview.changes[0];
    if (
      justOpened &&
      first &&
      !agentReview.changes.some((change) => change.path === selectedFile)
    ) {
      void handleFileSelect(first.path);
    }
  }, [agentReview.open, agentReview.changes, selectedFile, handleFileSelect]);

  const handleSynctexClick = useCallback(
    async (page: number, x: number, y: number) => {
      if (!daemon.projectPath || !selectedFile || !/\.pdf$/i.test(selectedFile)) return;

      // Resolve the PDF path on disk
      const pdfPath = pathSync.join(daemon.projectPath, selectedFile);

      try {
        const result = await invoke<SynctexResult>("latex_synctex_edit", {
          pdfPath,
          page,
          x,
          y,
        });

        // Normalize slashes and resolve "." segments for comparison
        const normalize = (p: string) =>
          p
            .replace(/\\/g, "/")
            .replace(/\/\.\//g, "/")
            .replace(/\/+/g, "/");

        const normalFile = normalize(result.file);
        const normalProject = normalize(daemon.projectPath);

        let resolvedFile = normalFile;
        if (resolvedFile.startsWith(normalProject)) {
          resolvedFile = resolvedFile.slice(normalProject.length);
          // Remove leading slash
          resolvedFile = resolvedFile.replace(/^\/+/, "");
        }

        setSplitPane((current) =>
          placeSynctexPdfOnRight(
            current,
            {
              path: selectedFile,
              url: safeConvertFileSrc(pdfPath),
              refreshKey: pdfRefreshKey,
            },
            resolvedFile,
          ),
        );
        setOpenTabs((current) => current.filter((path) => path !== selectedFile));
        await handleFileSelect(resolvedFile);
        setShowSidebar(false);
        setSplitPositionRevision((revision) => revision + 1);
        setPendingGoToLine(result.line);
      } catch (err) {
        const errorStr = String(err);
        if (errorStr.includes("SYNCTEX_NOT_INSTALLED")) {
          pendingSynctexRetryRef.current = { page, x, y, context: "main" };
          setShowSynctexInstallDialog(true);
        } else if (isMissingSynctexData(err)) {
          toast(t("latex.synctexDataMissing"), "info");
        } else {
          console.error("SyncTeX lookup failed:", err);
          toast(t("latex.synctexLookupFailed"), "error");
        }
      }
    },
    [daemon.projectPath, selectedFile, pdfRefreshKey, handleFileSelect, toast, t],
  );

  const handleSplitSynctexClick = useCallback(
    async (page: number, x: number, y: number) => {
      if (
        !daemon.projectPath ||
        !splitPane?.selectedFile ||
        !/\.pdf$/i.test(splitPane.selectedFile)
      )
        return;

      const pdfFile = splitPane.selectedFile;
      const pdfPath = pathSync.join(daemon.projectPath, pdfFile);

      try {
        const result = await invoke<SynctexResult>("latex_synctex_edit", {
          pdfPath,
          page,
          x,
          y,
        });

        const normalize = (p: string) =>
          p
            .replace(/\\/g, "/")
            .replace(/\/\.\//g, "/")
            .replace(/\/+/g, "/");

        const normalFile = normalize(result.file);
        const normalProject = normalize(daemon.projectPath);

        let resolvedFile = normalFile;
        if (resolvedFile.startsWith(normalProject)) {
          resolvedFile = resolvedFile.slice(normalProject.length);
          resolvedFile = resolvedFile.replace(/^\/+/, "");
        }

        setSplitPane((current) =>
          placeSynctexPdfOnRight(
            current,
            {
              path: pdfFile,
              url: safeConvertFileSrc(pdfPath),
              refreshKey: splitPane.pdfRefreshKey,
            },
            resolvedFile,
          ),
        );
        setOpenTabs((current) => current.filter((path) => path !== pdfFile));
        await handleFileSelect(resolvedFile);
        setShowSidebar(false);
        setSplitPositionRevision((revision) => revision + 1);
        setPendingGoToLine(result.line);
      } catch (err) {
        const errorStr = String(err);
        if (errorStr.includes("SYNCTEX_NOT_INSTALLED")) {
          pendingSynctexRetryRef.current = { page, x, y, context: "split" };
          setShowSynctexInstallDialog(true);
        } else if (isMissingSynctexData(err)) {
          toast(t("latex.synctexDataMissing"), "info");
        } else {
          console.error("SyncTeX lookup failed:", err);
          toast(t("latex.synctexLookupFailed"), "error");
        }
      }
    },
    [daemon.projectPath, splitPane, handleFileSelect, toast, t],
  );

  const handleSynctexInstallComplete = useCallback(() => {
    setShowSynctexInstallDialog(false);
    const pending = pendingSynctexRetryRef.current;
    if (pending) {
      pendingSynctexRetryRef.current = null;
      // Small delay to let PATH refresh after installation
      setTimeout(() => {
        if (pending.context === "main") {
          handleSynctexClick(pending.page, pending.x, pending.y);
        } else {
          handleSplitSynctexClick(pending.page, pending.x, pending.y);
        }
      }, 500);
    }
  }, [handleSynctexClick, handleSplitSynctexClick]);

  const loadGitDiffPreview = useCallback(
    async (path: string, staged: boolean) => {
      const requestId = gitDiffRequestIdRef.current + 1;
      gitDiffRequestIdRef.current = requestId;

      setGitDiffPreview({
        path,
        staged,
        content: "",
        isLoading: true,
        error: null,
      });

      try {
        const content = await daemon.gitDiff(path, staged);
        if (gitDiffRequestIdRef.current !== requestId) return;
        setGitDiffPreview({
          path,
          staged,
          content,
          isLoading: false,
          error: null,
        });
      } catch (error) {
        if (gitDiffRequestIdRef.current !== requestId) return;
        setGitDiffPreview({
          path,
          staged,
          content: "",
          isLoading: false,
          error: String(error),
        });
      }
    },
    [daemon],
  );

  const handlePreviewGitDiff = useCallback(
    async (path: string, staged: boolean) => {
      setOpenTabs((prev) => {
        if (prev.includes(path)) return prev;
        return [...prev, path];
      });
      setSelectedFile(path);
      setBinaryPreviewUrl(null);
      setEditorViewMode("git-diff");
      await loadGitDiffPreview(path, staged);
    },
    [loadGitDiffPreview],
  );

  useEffect(() => {
    if (selectedFile && !openTabs.includes(selectedFile)) {
      setOpenTabs((prev) => [...prev, selectedFile]);
    }
  }, [selectedFile, openTabs]);

  // Handle file changes - deletion and external modifications
  useEffect(() => {
    if (!daemon.lastFileChange) return;

    const { path, kind } = daemon.lastFileChange;

    if (kind === "remove") {
      if (splitPane?.openTabs.includes(path)) {
        setSplitPane(null);
      }
      // Check if the deleted file is in open tabs
      setOpenTabs((prev) => {
        if (!prev.includes(path)) return prev;

        const newTabs = prev.filter((p) => p !== path);

        // If the deleted file was selected, switch to another tab
        if (selectedFile === path) {
          if (newTabs.length > 0) {
            const nextFile = newTabs[0];
            if (nextFile) {
              handleFileSelect(nextFile);
            }
          } else {
            setSelectedFile(undefined);
            setFileContent("");
            setBinaryPreviewUrl(null);
            setGitDiffPreview(null);
            setEditorViewMode("file");
          }
        }

        return newTabs;
      });
    } else if (kind === "modify") {
      // Reload file content if the currently selected file was modified externally
      // Skip if this was our own save (within 2 seconds)
      const lastSave = lastSaveTimeRef.current;
      const isOurSave = lastSave && lastSave.path === path && Date.now() - lastSave.time < 2000;

      if (path === selectedFile && !isOurSave) {
        daemon
          .readFile(path)
          .then((content) => {
            if (content !== null) {
              setFileContent(content);
            }
          })
          .catch((err) => {
            console.error("Failed to reload modified file:", err);
          });
      }

      if (
        splitPane &&
        path === splitPane.selectedFile &&
        !splitPane.binaryPreviewUrl &&
        !isOurSave
      ) {
        daemon
          .readFile(path)
          .then((content) => {
            if (content !== null) {
              setSplitPane((prev) => {
                if (!prev || prev.selectedFile !== path) return prev;
                return {
                  ...prev,
                  content,
                  error: null,
                };
              });
            }
          })
          .catch((err) => {
            console.error("Failed to reload modified split file:", err);
          });
      }
    }
  }, [daemon.lastFileChange, selectedFile, handleFileSelect, daemon, splitPane]);

  const handleCloseTab = useCallback(
    (path: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setOpenTabs((prev) => {
        const newTabs = prev.filter((p) => p !== path);
        if (selectedFile === path) {
          const idx = prev.indexOf(path);
          const newSelected = newTabs[Math.min(idx, newTabs.length - 1)];
          if (newSelected) {
            handleFileSelect(newSelected);
          } else {
            setSelectedFile(undefined);
            setFileContent("");
            setBinaryPreviewUrl(null);
            setGitDiffPreview(null);
            setEditorViewMode("file");
          }
        }
        return newTabs;
      });
    },
    [selectedFile, handleFileSelect],
  );

  const handleCloseOtherTabs = useCallback(
    (keepPath: string) => {
      setOpenTabs([keepPath]);
      if (selectedFile !== keepPath) {
        handleFileSelect(keepPath);
      }
    },
    [selectedFile, handleFileSelect],
  );

  const handleCloseTabsToLeft = useCallback(
    (path: string) => {
      setOpenTabs((prev) => {
        const idx = prev.indexOf(path);
        if (idx <= 0) return prev;
        const newTabs = prev.slice(idx);
        if (selectedFile && !newTabs.includes(selectedFile)) {
          handleFileSelect(path);
        }
        return newTabs;
      });
    },
    [selectedFile, handleFileSelect],
  );

  const handleCloseTabsToRight = useCallback(
    (path: string) => {
      setOpenTabs((prev) => {
        const idx = prev.indexOf(path);
        if (idx === prev.length - 1) return prev;
        const newTabs = prev.slice(0, idx + 1);
        if (selectedFile && !newTabs.includes(selectedFile)) {
          handleFileSelect(path);
        }
        return newTabs;
      });
    },
    [selectedFile, handleFileSelect],
  );

  const handleCloseAllTabs = useCallback(() => {
    setOpenTabs([]);
    setSelectedFile(undefined);
    setFileContent("");
    setGitDiffPreview(null);
    setEditorViewMode("file");
    setSplitPane(null);
  }, []);

  const handleReorderTabs = useCallback(
    (draggedPath: string, targetPath: string, position: TabReorderPosition) => {
      if (draggedPath === targetPath) return;

      setOpenTabs((prev) => {
        const fromIndex = prev.indexOf(draggedPath);
        const targetIndex = prev.indexOf(targetPath);
        if (fromIndex < 0 || targetIndex < 0) return prev;

        const reordered = [...prev];
        const [movedTab] = reordered.splice(fromIndex, 1);
        if (!movedTab) return prev;

        const targetAfterRemoval = reordered.indexOf(targetPath);
        if (targetAfterRemoval < 0) return prev;

        const insertIndex = position === "before" ? targetAfterRemoval : targetAfterRemoval + 1;
        reordered.splice(insertIndex, 0, movedTab);
        return reordered;
      });
    },
    [],
  );

  const closeSplitPane = useCallback(() => {
    if (splitContentSaveTimeoutRef.current) {
      clearTimeout(splitContentSaveTimeoutRef.current);
      splitContentSaveTimeoutRef.current = null;
    }
    setSplitPane(null);
  }, []);

  const openFileInSplitPane = useCallback(
    async (path: string, side: SplitPaneSide, options?: { moveFromPrimary?: boolean }) => {
      const resolvedPath = resolveSelectablePath(path);
      const fileType = getFileType(resolvedPath);
      const requestId = splitLoadRequestIdRef.current + 1;
      splitLoadRequestIdRef.current = requestId;

      if (splitContentSaveTimeoutRef.current) {
        clearTimeout(splitContentSaveTimeoutRef.current);
        splitContentSaveTimeoutRef.current = null;
      }

      if (options?.moveFromPrimary) {
        setOpenTabs((prev) => {
          if (!prev.includes(resolvedPath)) return prev;

          const idx = prev.indexOf(resolvedPath);
          const newTabs = prev.filter((p) => p !== resolvedPath);
          if (selectedFile === resolvedPath) {
            const nextFile = newTabs[Math.min(idx, newTabs.length - 1)];
            if (nextFile) {
              void handleFileSelect(nextFile);
            } else {
              setSelectedFile(undefined);
              setFileContent("");
              setBinaryPreviewUrl(null);
              setGitDiffPreview(null);
              setEditorViewMode("file");
            }
          }
          return newTabs;
        });
      }

      if (fileType === "text") {
        setSplitPane((prev) => {
          const base: SplitPaneState = prev ?? {
            side,
            openTabs: [],
            selectedFile: undefined,
            content: "",
            isLoading: false,
            error: null,
            binaryPreviewUrl: null,
            pdfRefreshKey: 0,
          };
          return {
            ...base,
            side,
            openTabs: base.openTabs.includes(resolvedPath)
              ? base.openTabs
              : [...base.openTabs, resolvedPath],
            selectedFile: resolvedPath,
            content: "",
            isLoading: true,
            error: null,
            binaryPreviewUrl: null,
          };
        });

        try {
          const content = await daemon.readFile(resolvedPath);
          if (splitLoadRequestIdRef.current !== requestId) return;
          setSplitPane((prev) => {
            if (!prev || prev.selectedFile !== resolvedPath) return prev;
            return {
              ...prev,
              side,
              content: content ?? "",
              isLoading: false,
              error: null,
              binaryPreviewUrl: null,
            };
          });
        } catch (err) {
          if (splitLoadRequestIdRef.current !== requestId) return;
          const errorStr = String(err);
          if (errorStr.includes("FILE_NOT_FOUND")) {
            toast(
              t("files.fileNoLongerExists", { name: pathSync.basename(resolvedPath) }),
              "error",
            );
            setSplitPane(null);
            return;
          }
          setSplitPane((prev) => {
            if (!prev || prev.selectedFile !== resolvedPath) return prev;
            return {
              ...prev,
              isLoading: false,
              error: errorStr,
            };
          });
        }
        return;
      }

      const fullPath = daemon.projectPath
        ? pathSync.join(daemon.projectPath, resolvedPath)
        : resolvedPath;
      setSplitPane((prev) => {
        const base: SplitPaneState = prev ?? {
          side,
          openTabs: [],
          selectedFile: undefined,
          content: "",
          isLoading: false,
          error: null,
          binaryPreviewUrl: null,
          pdfRefreshKey: 0,
        };

        return {
          ...base,
          side,
          openTabs: base.openTabs.includes(resolvedPath)
            ? base.openTabs
            : [...base.openTabs, resolvedPath],
          selectedFile: resolvedPath,
          content: "",
          isLoading: false,
          error: null,
          binaryPreviewUrl: safeConvertFileSrc(fullPath),
          pdfRefreshKey: 0,
        };
      });
    },
    [daemon, getFileType, resolveSelectablePath, toast, t, selectedFile, handleFileSelect],
  );

  const handleSplitContentChange = useCallback(
    (content: string) => {
      setSplitPane((prev) => {
        if (!prev || prev.binaryPreviewUrl) return prev;
        return {
          ...prev,
          content,
        };
      });

      if (splitContentSaveTimeoutRef.current) {
        clearTimeout(splitContentSaveTimeoutRef.current);
      }

      const fileToSave = splitPane?.selectedFile;
      if (!fileToSave) return;

      splitContentSaveTimeoutRef.current = setTimeout(async () => {
        try {
          await daemon.writeFile(fileToSave, content);
          lastSaveTimeRef.current = { path: fileToSave, time: Date.now() };
        } catch (error) {
          console.error("Failed to save split pane file:", error);
        }
      }, 500);
    },
    [daemon, splitPane?.selectedFile],
  );

  const handleSplitTabSelect = useCallback(
    (path: string) => {
      if (!splitPane) return;
      void openFileInSplitPane(path, splitPane.side);
    },
    [splitPane, openFileInSplitPane],
  );

  // Execute local LaTeX compilation and handle PDF output / error diagnostics
  const performCompile = useCallback(
    async (mainFile: string) => {
      if (!daemon.projectPath) return;

      if (!hasAnyCompiler) {
        toast(t("latex.noCompilerFound"), "error");
        return;
      }

      try {
        const result = await latexCompiler.compile(mainFile);

        if (result.success) {
          toast(t("latex.compileSuccess"), "success");

          // Refresh file tree to include newly generated PDF and aux files
          void daemon.refreshFiles();

          // Target PDF relative path
          const pdfRelPath = mainFile.replace(/\.tex$/i, ".pdf");

          // Increment PDF refresh keys to force viewers to reload
          setPdfRefreshKey((k) => k + 1);
          setSplitPane((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              pdfRefreshKey: prev.pdfRefreshKey + 1,
            };
          });

          // Check if PDF is already visible in main or split pane
          const isPdfSelectedInMain = selectedFile === pdfRelPath;
          const isPdfSelectedInSplit = splitPane?.selectedFile === pdfRelPath;

          if (!isPdfSelectedInMain && !isPdfSelectedInSplit) {
            void openFileInSplitPane(pdfRelPath, "right");
          }
        } else {
          // Extract specific error details from compiler output logs if available
          const errorLogs = latexCompiler.compileLogs
            .filter((l) => l.is_error)
            .map((l) => l.line.trim())
            .filter((l) => l.length > 0);

          const primaryError =
            errorLogs.find(
              (l) => l.startsWith("!") || l.includes("Error:") || l.includes("error:"),
            ) || errorLogs[errorLogs.length - 1];

          const displayMessage = primaryError
            ? `${t("latex.compileFailed", { error: result.error || "Error" })}: ${primaryError}`
            : result.error || t("latex.compileFailed", { error: "Unknown error" });

          toast(displayMessage, "error");

          if (daemon.projectPath) {
            const errorLines = (
              errorLogs.length > 0
                ? errorLogs
                : latexCompiler.compileLogs.slice(-15).map((l) => l.line)
            )
              .slice(-10)
              .join("\n");
            const diagnosticMsg = `LaTeX compilation of "${mainFile}" failed.\nError: ${result.error || ""}\n${primaryError ? `Primary cause: ${primaryError}\n` : ""}${errorLines ? `Recent log:\n${errorLines}` : ""}\nPlease inspect the LaTeX source code and help fix the compilation error.`;
            setShowRightPanel(true);
            setPendingAcademicMessage(diagnosticMsg);
          }
        }
      } catch (err) {
        console.error("Compilation error:", err);
        toast(t("latex.compileFailed", { error: String(err) }), "error");
      }
    },
    [
      daemon,
      hasAnyCompiler,
      latexCompiler,
      toast,
      t,
      selectedFile,
      splitPane?.selectedFile,
      openFileInSplitPane,
    ],
  );

  // Handle compile with main file detection
  const handleCompileWithDetection = useCallback(async () => {
    if (!daemon.projectPath) return;

    if (!hasAnyCompiler) {
      toast(t("latex.noCompilerFound"), "error");
      return;
    }

    // Run detection
    const result = await latexSettings.detectMainFile(daemon.projectPath);

    if (!result) {
      toast(t("latex.detectFailed"), "error");
      return;
    }

    // If detection found a main file and doesn't need user input, proceed
    if (result.main_file && !result.needs_user_input) {
      void performCompile(result.main_file);
      return;
    }

    // If we need user input (ambiguous case), show the dialog
    if (result.needs_user_input && result.tex_files.length > 0) {
      setMainFileDetectionResult(result);
      setShowMainFileDialog(true);
      return;
    }

    // No tex files found
    toast(t("latex.noTexFilesToast"), "error");
  }, [
    daemon.projectPath,
    hasAnyCompiler,
    latexSettings,
    toast,
    t,
    performCompile,
  ]);

  // Handle main file selection from dialog
  const handleMainFileSelect = useCallback(
    (mainFile: string) => {
      latexSettings.setMainFile(mainFile);
      setShowMainFileDialog(false);
      setMainFileDetectionResult(null);

      void performCompile(mainFile);
    },
    [latexSettings, performCompile],
  );

  const handleSplitCloseTab = useCallback(
    (path: string) => {
      if (!splitPane) return;

      const idx = splitPane.openTabs.indexOf(path);
      if (idx < 0) return;
      const newTabs = splitPane.openTabs.filter((p) => p !== path);
      if (newTabs.length === 0) {
        closeSplitPane();
        return;
      }

      const nextSelected =
        splitPane.selectedFile === path
          ? newTabs[Math.min(idx, newTabs.length - 1)]
          : (splitPane.selectedFile ?? newTabs[0]);

      setSplitPane((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          openTabs: newTabs,
          selectedFile: nextSelected,
        };
      });

      if (splitPane.selectedFile === path && nextSelected) {
        void openFileInSplitPane(nextSelected, splitPane.side);
      }
    },
    [splitPane, closeSplitPane, openFileInSplitPane],
  );

  const handleSplitCloseOtherTabs = useCallback(
    (keepPath: string) => {
      if (!splitPane) return;
      setSplitPane((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          openTabs: [keepPath],
          selectedFile: keepPath,
        };
      });
      if (splitPane.selectedFile !== keepPath) {
        void openFileInSplitPane(keepPath, splitPane.side);
      }
    },
    [splitPane, openFileInSplitPane],
  );

  const handleSplitCloseTabsToLeft = useCallback(
    (path: string) => {
      if (!splitPane) return;
      const idx = splitPane.openTabs.indexOf(path);
      if (idx <= 0) return;
      const newTabs = splitPane.openTabs.slice(idx);
      setSplitPane((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          openTabs: newTabs,
          selectedFile:
            prev.selectedFile && newTabs.includes(prev.selectedFile) ? prev.selectedFile : path,
        };
      });
      if (splitPane.selectedFile && !newTabs.includes(splitPane.selectedFile)) {
        void openFileInSplitPane(path, splitPane.side);
      }
    },
    [splitPane, openFileInSplitPane],
  );

  const handleSplitCloseTabsToRight = useCallback(
    (path: string) => {
      if (!splitPane) return;
      const idx = splitPane.openTabs.indexOf(path);
      if (idx === splitPane.openTabs.length - 1) return;
      const newTabs = splitPane.openTabs.slice(0, idx + 1);
      setSplitPane((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          openTabs: newTabs,
          selectedFile:
            prev.selectedFile && newTabs.includes(prev.selectedFile) ? prev.selectedFile : path,
        };
      });
      if (splitPane.selectedFile && !newTabs.includes(splitPane.selectedFile)) {
        void openFileInSplitPane(path, splitPane.side);
      }
    },
    [splitPane, openFileInSplitPane],
  );

  const handleSplitReorderTabs = useCallback(
    (draggedPath: string, targetPath: string, position: TabReorderPosition) => {
      if (draggedPath === targetPath) return;
      setSplitPane((prev) => {
        if (!prev) return prev;
        const fromIndex = prev.openTabs.indexOf(draggedPath);
        const targetIndex = prev.openTabs.indexOf(targetPath);
        if (fromIndex < 0 || targetIndex < 0) return prev;

        const reordered = [...prev.openTabs];
        const [movedTab] = reordered.splice(fromIndex, 1);
        if (!movedTab) return prev;

        const targetAfterRemoval = reordered.indexOf(targetPath);
        if (targetAfterRemoval < 0) return prev;

        const insertIndex = position === "before" ? targetAfterRemoval : targetAfterRemoval + 1;
        reordered.splice(insertIndex, 0, movedTab);
        return {
          ...prev,
          openTabs: reordered,
        };
      });
    },
    [],
  );

  const resolveSplitDropSide = useCallback(
    (clientX: number, clientY: number, source: DragSourcePane): SplitPaneSide | null => {
      const container = editorWorkspaceRef.current;
      if (!container) return null;

      const rect = container.getBoundingClientRect();
      const isInsideEditorWorkspace =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;

      if (!isInsideEditorWorkspace) return null;

      const hoveredSide: SplitPaneSide = clientX < rect.left + rect.width / 2 ? "left" : "right";

      if (!splitPane) return source === "primary" ? hoveredSide : null;

      const splitSide: SplitPaneSide = splitPane.side;
      const primarySide: SplitPaneSide = splitSide === "left" ? "right" : "left";

      if (source === "primary") {
        return hoveredSide === splitSide ? splitSide : null;
      }

      return hoveredSide === primarySide ? primarySide : null;
    },
    [splitPane],
  );

  const handleEditorTabDragMove = useCallback(
    (payload: TabDragMovePayload | null) => {
      if (!payload) {
        setSplitDropHint(null);
        return;
      }

      setSplitDropHint(resolveSplitDropSide(payload.clientX, payload.clientY, "primary"));
    },
    [resolveSplitDropSide],
  );

  const moveTabFromSplitToPrimary = useCallback(
    (path: string) => {
      if (!splitPane) return;
      const resolvedPath = resolveSelectablePath(path);
      const currentIndex = splitPane.openTabs.indexOf(resolvedPath);
      if (currentIndex < 0) return;

      const nextTabs = splitPane.openTabs.filter((p) => p !== resolvedPath);
      if (nextTabs.length === 0) {
        closeSplitPane();
      } else {
        const nextSelected =
          splitPane.selectedFile === resolvedPath
            ? nextTabs[Math.min(currentIndex, nextTabs.length - 1)]
            : (splitPane.selectedFile ?? nextTabs[0]);

        setSplitPane((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            openTabs: nextTabs,
            selectedFile: nextSelected,
          };
        });

        if (splitPane.selectedFile === resolvedPath && nextSelected) {
          void openFileInSplitPane(nextSelected, splitPane.side);
        }
      }

      void handleFileSelect(resolvedPath);
    },
    [splitPane, resolveSelectablePath, closeSplitPane, openFileInSplitPane, handleFileSelect],
  );

  const handleSplitTabDragMove = useCallback(
    (payload: TabDragMovePayload | null) => {
      if (!payload) {
        setSplitDropHint(null);
        return;
      }

      setSplitDropHint(resolveSplitDropSide(payload.clientX, payload.clientY, "split"));
    },
    [resolveSplitDropSide],
  );

  const handleEditorTabDragEnd = useCallback(
    (payload: TabDragEndPayload) => {
      setSplitDropHint(null);
      if (payload.dropTarget.type !== "outside") return;

      const side = resolveSplitDropSide(payload.clientX, payload.clientY, "primary");
      if (!side) return;

      void openFileInSplitPane(payload.tabId, side, { moveFromPrimary: true });
    },
    [openFileInSplitPane, resolveSplitDropSide],
  );

  const handleSplitTabDragEnd = useCallback(
    (payload: TabDragEndPayload) => {
      setSplitDropHint(null);
      if (payload.dropTarget.type !== "outside") return;

      const side = resolveSplitDropSide(payload.clientX, payload.clientY, "split");
      if (!side || !splitPane) return;

      const primarySide: SplitPaneSide = splitPane.side === "left" ? "right" : "left";
      if (side !== primarySide) return;

      moveTabFromSplitToPrimary(payload.tabId);
    },
    [resolveSplitDropSide, splitPane, moveTabFromSplitToPrimary],
  );

  const splitPaneTabs = useMemo(
    (): TabItem[] =>
      splitPane?.openTabs.map((path) => ({
        id: path,
        label: pathSync.basename(path),
        title: path,
      })) ?? [],
    [splitPane?.openTabs],
  );

  const renderSplitPane = useCallback(
    (side: SplitPaneSide) => {
      if (!splitPane || splitPane.side !== side) return null;
      const splitSelectedFile = splitPane.selectedFile;
      const splitFileType = splitSelectedFile ? getFileType(splitSelectedFile) : "text";

      return (
        <div className="h-full min-h-0 flex flex-col overflow-hidden">
          {splitSelectedFile && (
            <div>
              <TabBar
                tabs={splitPaneTabs}
                activeTab={splitSelectedFile}
                onTabSelect={handleSplitTabSelect}
                onTabClose={handleSplitCloseTab}
                onTabReorder={handleSplitReorderTabs}
                onTabDragMove={handleSplitTabDragMove}
                onTabDragEnd={handleSplitTabDragEnd}
                onCloseOthers={handleSplitCloseOtherTabs}
                onCloseToLeft={handleSplitCloseTabsToLeft}
                onCloseToRight={handleSplitCloseTabsToRight}
                onCloseAll={closeSplitPane}
                variant="editor"
              />
            </div>
          )}

          <div className="flex-1 min-h-0">
            {!splitSelectedFile ? (
              <div className="h-full flex items-center justify-center px-6 text-sm text-muted">
                Drag a tab here to open a second editor group.
              </div>
            ) : splitPane.isLoading ? (
              <EditorSkeleton className="h-full" />
            ) : splitPane.error ? (
              <div className="h-full flex items-center justify-center px-6 text-sm text-muted">
                Failed to load file: {splitPane.error}
              </div>
            ) : splitPane.binaryPreviewUrl ? (
              <div className="h-full flex items-center justify-center overflow-auto p-4 bg-accent-hover">
                {splitFileType === "image" ? (
                  <Image
                    unoptimized
                    src={splitPane.binaryPreviewUrl}
                    alt={splitSelectedFile}
                    width={1200}
                    height={900}
                    className="max-w-full max-h-full object-contain"
                  />
                ) : splitFileType === "pdf" ? (
                  <PdfViewer
                    src={splitPane.binaryPreviewUrl}
                    refreshKey={splitPane.pdfRefreshKey}
                    onSynctexClick={handleSplitSynctexClick}
                  />
                ) : (
                  <iframe
                    key={splitPane.pdfRefreshKey}
                    src={splitPane.binaryPreviewUrl}
                    className="w-full h-full border-0"
                    title={`PDF: ${splitSelectedFile}`}
                  />
                )}
              </div>
            ) : (
              <EditorErrorBoundary>
                <DocumentEditor
                  filePath={splitSelectedFile}
                  projectPath={daemon.projectPath ?? ""}
                  content={splitPane.content}
                  bibliography={bibliography}
                  readOnly={false}
                  onContentChange={handleSplitContentChange}
                  language={getFileLanguage(splitSelectedFile)}
                  editorSettings={editorSettings.settings}
                  editorTheme={editorSettings.editorTheme}
                  className="h-full"
                />
              </EditorErrorBoundary>
            )}
          </div>
        </div>
      );
    },
    [
      splitPane,
      bibliography,
      getFileType,
      closeSplitPane,
      splitPaneTabs,
      handleSplitTabSelect,
      handleSplitCloseTab,
      handleSplitReorderTabs,
      handleSplitTabDragMove,
      handleSplitTabDragEnd,
      handleSplitCloseOtherTabs,
      handleSplitCloseTabsToLeft,
      handleSplitCloseTabsToRight,
      handleSplitSynctexClick,
      handleSplitContentChange,
      daemon.projectPath,
      getFileLanguage,
      editorSettings.settings,
      editorSettings.editorTheme,
    ],
  );

  // Convert openTabs to TabItem format for TabBar
  const editorTabs = useMemo(
    (): TabItem[] =>
      openTabs.map((path) => ({
        id: path,
        label: pathSync.basename(path),
        title: path,
      })),
    [openTabs],
  );

  // Sidebar tabs configuration
  const sidebarTabs = useMemo(
    (): TabItem[] => [
      { id: "files", label: t("files.title") },
      {
        id: "git",
        label: t("git.title"),
        badge: gitStatus && gitStatus.changes.length > 0 ? gitStatus.changes.length : undefined,
      },
    ],
    [gitStatus, t],
  );

  const handleContentChange = useCallback(
    (content: string) => {
      setFileContent(content);

      if (savingVisualTimeoutRef.current) {
        clearTimeout(savingVisualTimeoutRef.current);
      }

      savingVisualTimeoutRef.current = setTimeout(() => {
        setIsSaving(true);
      }, 300);

      if (contentSaveTimeoutRef.current) {
        clearTimeout(contentSaveTimeoutRef.current);
      }

      // Capture the current file at callback creation time to prevent race condition
      // when user switches files rapidly during debounce window
      const fileToSave = selectedFile;
      contentSaveTimeoutRef.current = setTimeout(async () => {
        if (fileToSave) {
          try {
            await daemon.writeFile(fileToSave, content);
            // Track when we saved this file to avoid reloading our own changes
            lastSaveTimeRef.current = { path: fileToSave, time: Date.now() };
          } catch (error) {
            console.error("Failed to save file:", error);
          }
        }
        if (savingVisualTimeoutRef.current) {
          clearTimeout(savingVisualTimeoutRef.current);
          savingVisualTimeoutRef.current = null;
        }
        setIsSaving(false);
      }, 500);
    },
    [selectedFile, daemon],
  );

  const changeWorkspace = useCallback(
    async (path: string) => {
      if (switchingProjectRef.current || path === daemon.projectPath) return;
      if (academicAgent.working || externalAgent.working || latexCompiler.isCompiling) {
        toast(t("workspace.waitForOperations"), "info");
        return;
      }
      switchingProjectRef.current = true;
      setIsSwitchingProject(true);
      try {
        // Stop the debounce timers and persist both current buffers before changing scope.
        if (contentSaveTimeoutRef.current) {
          clearTimeout(contentSaveTimeoutRef.current);
          contentSaveTimeoutRef.current = null;
        }
        if (splitContentSaveTimeoutRef.current) {
          clearTimeout(splitContentSaveTimeoutRef.current);
          splitContentSaveTimeoutRef.current = null;
        }
        if (savingVisualTimeoutRef.current) {
          clearTimeout(savingVisualTimeoutRef.current);
          savingVisualTimeoutRef.current = null;
        }
        if (daemon.projectPath) {
          const buffers = new Map<string, string>();
          if (selectedFile && !binaryPreviewUrl && editorViewMode === "file")
            buffers.set(selectedFile, fileContent);
          if (splitPane?.selectedFile && !splitPane.binaryPreviewUrl)
            buffers.set(splitPane.selectedFile, splitPane.content);
          for (const [relative, content] of buffers) {
            // Invoke directly so a failed save aborts the switch instead of being swallowed.
            await invoke("write_file", {
              path: pathSync.join(daemon.projectPath, relative),
              content,
              encoding: "utf-8",
            });
          }
        }
        await daemon.setProject(path);
        handleCloseAllTabs();
        setBinaryPreviewUrl(null);
        setPendingGoToLine(0);
        setPendingAcademicMessage(null);
        setIsLoadingFile(false);
        gitDiffRequestIdRef.current += 1;
        splitLoadRequestIdRef.current += 1;
        latexSettings.setMainFile(null);
        setShowMainFileDialog(false);
        setMainFileDetectionResult(null);
        setCreateDialog(null);
        setCommitMessage("");
        setShowCommitInput(false);
        setShowSidebar(true);
        setShowRightPanel(true);
        setShowTerminal(false);
        setIsSaving(false);
        await recentProjects.addProject(path);
      } catch (error) {
        console.error("Failed to switch workspace:", error);
        toast(`${t("workspace.openProjectFailed")}: ${String(error)}`, "error");
      } finally {
        switchingProjectRef.current = false;
        setIsSwitchingProject(false);
      }
    },
    [
      daemon,
      academicAgent.working,
      externalAgent.working,
      latexCompiler.isCompiling,
      latexSettings,
      selectedFile,
      binaryPreviewUrl,
      editorViewMode,
      fileContent,
      splitPane,
      handleCloseAllTabs,
      recentProjects,
      toast,
      t,
    ],
  );

  const handleOpenFolder = useCallback(async () => {
    if (switchingProjectRef.current) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("workspace.openWorkspace"),
      });
      if (selected && typeof selected === "string") await changeWorkspace(selected);
    } catch (error) {
      toast(`${t("workspace.openProjectFailed")}: ${String(error)}`, "error");
    }
  }, [changeWorkspace, toast, t]);

  const handleOpenRecentProject = changeWorkspace;

  useEffect(() => {
    if (!recentProjects.loaded || restoredWorkspaceRef.current || daemon.projectPath || !isTauri())
      return;
    restoredWorkspaceRef.current = true;
    const lastWorkspace = recentProjects.projects[0];
    if (!lastWorkspace) return;

    void daemon
      .setProject(lastWorkspace.path)
      .then(() => {
        setShowSidebar(true);
        setShowRightPanel(true);
      })
      .catch(() => {
        // The recent workspace may have been moved or deleted.
      });
  }, [daemon, recentProjects.loaded, recentProjects.projects]);

  const handleStageAll = useCallback(() => {
    if (!gitStatus) return;
    const unstaged = gitStatus.changes
      .filter((c: { staged: boolean }) => !c.staged)
      .map((c: { path: string }) => c.path);
    if (unstaged.length > 0) {
      daemon.gitAdd(unstaged);
    }
  }, [gitStatus, daemon]);

  const handleStageFile = useCallback(
    (path: string) => {
      daemon.gitAdd([path]);
    },
    [daemon],
  );

  const handleUnstageAll = useCallback(() => {
    const stagedPaths = (daemon.gitStatus?.changes ?? [])
      .filter((c: { staged: boolean }) => c.staged)
      .map((c: { path: string }) => c.path);
    if (stagedPaths.length > 0) {
      daemon.gitUnstage(stagedPaths);
    }
  }, [daemon]);

  const handleUnstageFile = useCallback(
    (path: string) => {
      daemon.gitUnstage([path]);
    },
    [daemon],
  );

  const handleRemoteSubmit = useCallback(() => {
    const trimmed = remoteUrl.trim();
    if (!trimmed) return;
    daemon.gitAddRemote(trimmed);
    setRemoteUrl("");
    setShowRemoteInput(false);
  }, [daemon, remoteUrl]);

  const handleGitPush = useCallback(async () => {
    const result = await daemon.gitPush();
    if (result.success) {
      toast(t("git.pushSuccess"), "success");
    } else {
      toast(result.error || t("git.pushFailed"), "error");
    }
  }, [daemon, toast, t]);

  const handleGitPull = useCallback(async () => {
    const result = await daemon.gitPull();
    if (result.success) {
      toast(t("git.pullSuccess"), "success");
    } else {
      toast(result.error || t("git.pullFailed"), "error");
    }
  }, [daemon, toast, t]);

  const handleRefreshGitStatus = useCallback(() => {
    void daemon.refreshGitStatus(true);
  }, [daemon]);

  const handleDiscardAll = useCallback(async () => {
    const result = await daemon.gitDiscardAll();
    if (result.success) {
      toast(t("git.discardAllSuccess"), "success");
    } else {
      toast(result.error || t("git.discardAllFailed"), "error");
    }
  }, [daemon, toast, t]);

  const handleDiscardFile = useCallback(
    async (path: string) => {
      const result = await daemon.gitDiscardFile(path);
      if (result.success) {
        toast(t("git.discardFileSuccess", { path }), "success");
      } else {
        toast(result.error || t("git.discardFileFailed"), "error");
      }
    },
    [daemon, toast, t],
  );

  const handlePublishToGitHub = useCallback(async () => {
    setGhPublishError(null);

    const status = await daemon.ghCheck();
    if (!status.installed) {
      toast(t("git.ghNotInstalled"), "error");
      return;
    }

    if (!status.authenticated) {
      if (daemon.isAuthenticatingGh) {
        toast(t("git.authInProgress"), "info");
        return;
      }

      toast(
        "Terminal opened for GitHub login. Complete prompts there (type Y when asked), then continue in browser.",
        "info",
      );
      const loginResult = await daemon.ghAuthLogin();
      if (!loginResult.success || !loginResult.authenticated) {
        toast(loginResult.error || t("git.authFailed"), "error");
        return;
      }
      toast(t("git.authenticatedSuccess"), "success");
    }

    setShowGitHubPublishDialog(true);
  }, [daemon, toast, t]);

  const handleGitHubPublish = useCallback(
    async (name: string, isPrivate: boolean, description: string) => {
      setGhPublishError(null);
      const result = await daemon.ghCreateRepo(name, isPrivate, description || undefined);
      if (result.success) {
        setShowGitHubPublishDialog(false);
        toast(t("git.repoPublished", { url: result.url || "" }), "success");
      } else {
        setGhPublishError(result.error || t("git.publishDialogTitle"));
      }
    },
    [daemon, toast, t],
  );

  const handleGenerateCommitMessageAI = useCallback(async () => {
    if (!daemon.projectPath) {
      toast(t("agent.openProjectFirst"), "error");
      return;
    }

    if (stagedChanges.length === 0) {
      toast(t("git.stageBeforeAi"), "error");
      return;
    }

    const projectPath = daemon.projectPath;
    setShowCommitInput(true);
    setIsGeneratingCommitMessageAI(true);

    try {
      const diffChunks: string[] = await Promise.all(
        stagedChanges.map((change: { path: string }) => daemon.gitDiff(change.path, true)),
      );
      const mergedDiff = diffChunks
        .filter((chunk: string) => chunk.trim().length > 0)
        .join("\n\n")
        .slice(0, AI_COMMIT_DIFF_LIMIT)
        .trim();

      if (!mergedDiff) {
        toast(t("git.noDiffAvailable"), "error");
        return;
      }

      const prompt = buildAiCommitPrompt(mergedDiff, "staged");
      const aiRaw = await (agentSelection.selected === "builtin"
        ? academicAgent
        : externalAgent
      ).generateCommitMessage(prompt);
      const aiMessage = sanitizeAiCommitMessage(aiRaw);

      if (!aiMessage) {
        toast(t("git.emptyAiCommit"), "error");
        return;
      }

      if (activeProjectPathRef.current !== projectPath) return;
      setCommitMessage(aiMessage);
      toast(t("git.aiCommitGenerated"), "success");
    } catch (error) {
      console.error("Failed to generate AI commit message:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast(t("git.aiDraftFailed", { error: errorMessage }), "error");
    } finally {
      setIsGeneratingCommitMessageAI(false);
    }
  }, [daemon, stagedChanges, academicAgent, externalAgent, agentSelection.selected, toast, t]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    const result = await daemon.gitCommit(commitMessage.trim());
    if (result.success) {
      toast(t("git.commitSuccess"), "success");
      setCommitMessage("");
      setShowCommitInput(false);
    } else {
      toast(result.error || t("git.commitFailed"), "error");
    }
  }, [commitMessage, daemon, toast, t]);

  const validateFileName = useCallback(
    (name: string): string | null => {
      if (!name.trim()) {
        return t("files.invalidName");
      }
      if (name.includes("/") || name.includes("\\")) {
        return t("files.invalidName");
      }
      if (name.startsWith(".")) {
        return t("files.invalidName");
      }
      return null;
    },
    [t],
  );

  const handleCreateConfirm = useCallback(
    async (value: string) => {
      if (!createDialog) return;
      try {
        if (createDialog.type === "file") {
          await daemon.createFile(value);
        } else {
          await daemon.createDirectory(value);
        }
        setCreateDialog(null);
      } catch (error) {
        toast(t("files.failedToCreate", { error: String(error) }), "error");
      }
    },
    [createDialog, daemon, toast, t],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (typeof e.key !== "string" || e.isComposing || e.defaultPrevented || e.repeat) return;
      if (showQuickStart) return;
      if (
        e.target instanceof Element &&
        e.target.closest('[data-shortcut-recorder], [role="dialog"]')
      )
        return;
      if (showSettingsPage && !matchesShortcut(e, keyboardShortcuts.settings)) return;

      if (matchesShortcut(e, keyboardShortcuts.openProject)) {
        e.preventDefault();
        handleOpenFolder();
        return;
      }

      if (matchesShortcut(e, keyboardShortcuts.closeTab)) {
        e.preventDefault();
        if (selectedFile) {
          handleCloseTab(selectedFile);
        }
        return;
      }

      if (matchesShortcut(e, keyboardShortcuts.compile)) {
        e.preventDefault();
        if (daemon.projectPath) {
          handleCompileWithDetection();
        }
        return;
      }

      if (matchesShortcut(e, keyboardShortcuts.settings)) {
        e.preventDefault();
        setShowSettingsPage((prev) => !prev);
        return;
      }
      if (matchesShortcut(e, keyboardShortcuts.sidebar)) {
        e.preventDefault();
        setShowSidebar((previous) => !previous);
      } else if (matchesShortcut(e, keyboardShortcuts.terminal)) {
        e.preventDefault();
        setShowTerminal((previous) => !previous);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    daemon,
    handleOpenFolder,
    selectedFile,
    handleCloseTab,
    handleCompileWithDetection,
    keyboardShortcuts,
    showSettingsPage,
    showQuickStart,
  ]);

  const isShowingGitDiff =
    editorViewMode === "git-diff" && !!gitDiffPreview && selectedFile === gitDiffPreview.path;

  const gitDiffContent = gitDiffPreview?.content;
  const parsedGitDiff = useMemo(() => {
    if (!gitDiffContent) return null;
    return parseUnifiedDiffContent(gitDiffContent);
  }, [gitDiffContent]);

  const primaryEditorPaneContent = (
    <div className="h-full min-h-0 flex flex-col overflow-hidden">
      {selectedFile && (
        <TabBar
          tabs={editorTabs}
          activeTab={selectedFile}
          onTabSelect={handleFileSelect}
          onTabClose={handleCloseTab}
          onTabReorder={handleReorderTabs}
          onTabDragMove={handleEditorTabDragMove}
          onTabDragEnd={handleEditorTabDragEnd}
          onCloseOthers={handleCloseOtherTabs}
          onCloseToLeft={handleCloseTabsToLeft}
          onCloseToRight={handleCloseTabsToRight}
          onCloseAll={handleCloseAllTabs}
          variant="editor"
        />
      )}

      {agentReview.open && agentReview.changes.some((change) => change.path === selectedFile) ? (
        <div className="flex-1 min-h-0">
          <AgentReviewPanel
            review={agentReview}
            editorSettings={editorSettings.settings}
            filePath={selectedFile}
            onFileSelect={handleFileSelect}
          />
        </div>
      ) : selectedFile ? (
        isShowingGitDiff ? (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="border-b border-border bg-accent-hover px-3 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{gitDiffPreview.path}</div>
                <div className="text-xs text-muted flex items-center gap-2">
                  <span>{gitDiffPreview.staged ? "Staged changes" : "Working tree changes"}</span>
                  {parsedGitDiff?.hasRenderableHunks && (
                    <span>
                      +{parsedGitDiff.added} / -{parsedGitDiff.removed}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void loadGitDiffPreview(gitDiffPreview.path, gitDiffPreview.staged)
                  }
                  className="btn btn-sm btn-secondary"
                >
                  Refresh Diff
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleFileSelect(gitDiffPreview.path);
                  }}
                  className="btn btn-sm btn-secondary"
                >
                  Open File
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {gitDiffPreview.isLoading ? (
                <EditorSkeleton className="h-full" />
              ) : gitDiffPreview.error ? (
                <div className="h-full flex items-center justify-center px-6 text-sm text-muted">
                  Failed to load diff: {gitDiffPreview.error}
                </div>
              ) : parsedGitDiff?.isBinary ? (
                <div className="h-full flex items-center justify-center px-6 text-sm text-muted">
                  Binary file diff is not previewable in editor.
                </div>
              ) : !gitDiffPreview.content.trim() ? (
                <div className="h-full flex items-center justify-center px-6 text-sm text-muted">
                  No textual diff available for this file.
                </div>
              ) : parsedGitDiff?.hasRenderableHunks ? (
                <GitMonacoDiffEditor
                  original={parsedGitDiff.original}
                  modified={parsedGitDiff.modified}
                  filePath={gitDiffPreview.path}
                  editorSettings={editorSettings.settings}
                  className="h-full"
                />
              ) : (
                <MonacoEditor
                  content={gitDiffPreview.content}
                  readOnly
                  onContentChange={() => {}}
                  language="diff"
                  editorSettings={editorSettings.settings}
                  editorTheme={editorSettings.editorTheme}
                  className="h-full"
                />
              )}
            </div>
          </div>
        ) : binaryPreviewUrl ? (
          <div className="flex-1 flex flex-col bg-accent-hover overflow-hidden">
            {getFileType(selectedFile) === "image" ? (
              <div className="flex-1 flex items-center justify-center overflow-auto p-4">
                <Image
                  unoptimized
                  src={binaryPreviewUrl}
                  alt={selectedFile}
                  width={1200}
                  height={900}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : getFileType(selectedFile) === "pdf" ? (
              <PdfViewer
                src={binaryPreviewUrl}
                refreshKey={pdfRefreshKey}
                onSynctexClick={handleSynctexClick}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center overflow-auto p-4">
                <iframe
                  key={pdfRefreshKey}
                  src={binaryPreviewUrl}
                  className="w-full h-full border-0"
                  title={`File: ${selectedFile}`}
                />
              </div>
            )}
          </div>
        ) : isLoadingFile ? (
          <EditorSkeleton className="flex-1 min-h-0" />
        ) : (
          <motion.div
            key={selectedFile}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex-1 min-h-0"
          >
            <EditorErrorBoundary>
              <DocumentEditor
                filePath={selectedFile}
                projectPath={daemon.projectPath ?? ""}
                content={fileContent}
                bibliography={bibliography}
                readOnly={false}
                onContentChange={handleContentChange}
                language={getFileLanguage(selectedFile)}
                editorSettings={editorSettings.settings}
                editorTheme={editorSettings.editorTheme}
                goToLine={pendingGoToLine}
                className="h-full"
              />
            </EditorErrorBoundary>
          </motion.div>
        )
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center px-6 text-sm text-muted bg-accent-hover">
          Drop a tab here to open this panel.
        </div>
      )}
    </div>
  );

  const editorPanelItems: DockviewPanelItem[] = [];
  if (selectedFile || openTabs.length > 0 || (agentReview.open && agentReview.changes.length > 0)) {
    editorPanelItems.push({
      id: "editor-primary",
      title: selectedFile ? pathSync.basename(selectedFile) : "Editor",
      content: primaryEditorPaneContent,
      inactive: false,
    });
  }
  if (splitPane) {
    editorPanelItems.push({
      id: `editor-split-${splitPane.side}`,
      title: splitPane.selectedFile ? pathSync.basename(splitPane.selectedFile) : "Split",
      content: renderSplitPane(splitPane.side),
      inactive: false,
      position: {
        referencePanel: "editor-primary",
        direction: splitPane.side,
      },
      positionRevision: splitPositionRevision,
    });
  }

  return (
    <div className="h-dvh flex flex-col">
      {externalAgent.confirmationAgent !== "builtin" && (
        <AcpConnectionDialog
          selected={externalAgent.confirmationAgent}
          directory={daemon.projectPath ?? undefined}
          open={externalAgent.connectionConfirmation}
          onConfirm={externalAgent.confirmConnection}
          onCancel={externalAgent.cancelConnection}
        />
      )}
      <div data-workspace-shell className="flex-shrink-0 flex flex-col">
        <header className="h-12 border-b border-border flex items-center">
          <div className="w-full px-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex items-center select-none">
                <Logo size="small" className="h-7 w-auto" />
              </div>
              <span className="text-border">/</span>
              <div className="flex items-center gap-2 min-w-0">
                <div className="text-sm font-medium px-2 py-1 -ml-2 truncate">
                  {daemon.projectPath ? pathSync.basename(daemon.projectPath) : "Inkwell"}
                </div>
                {isSaving && (
                  <span className="text-xs text-muted shrink-0">{t("editor.saving")}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 h-8">
              <button
                type="button"
                onClick={handleOpenFolder}
                disabled={isSwitchingProject || daemon.isOpeningProject}
                className="toolbar-icon-button"
                aria-label={t(
                  daemon.projectPath ? "workspace.switchWorkspace" : "workspace.openWorkspace",
                )}
                title={`${t(daemon.projectPath ? "workspace.switchWorkspace" : "workspace.openWorkspace")} (${keyboardShortcuts.openProject.replace("Mod", "⌘/Ctrl")})`}
              >
                <FolderOpenIcon className="size-4" aria-hidden="true" />
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowLayoutMenu((open) => !open)}
                  className="toolbar-icon-button"
                  aria-expanded={showLayoutMenu}
                  aria-haspopup="true"
                  aria-label={t("header.layout")}
                  title={t("header.layout")}
                >
                  <SquaresFourIcon className="size-4" aria-hidden="true" />
                </button>
                {showLayoutMenu && (
                  <div
                    className="absolute right-0 top-full z-50 mt-2 min-w-52 rounded-md border border-border bg-background p-1 shadow-lg"
                    role="group"
                    aria-label={t("header.layout")}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setShowSidebar(false);
                        setShowRightPanel(false);
                        setShowLayoutMenu(false);
                      }}
                      className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent-hover"
                      aria-pressed={!showSidebar && !showRightPanel}
                    >
                      {t("header.editorOnly")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSidebar(true);
                        setShowRightPanel(true);
                        setShowLayoutMenu(false);
                      }}
                      className="w-full rounded px-3 py-2 text-left text-sm hover:bg-accent-hover"
                      aria-pressed={showSidebar && showRightPanel}
                    >
                      {t("header.editorWithSidebars")}
                    </button>
                  </div>
                )}
              </div>
              {daemon.projectPath && (
                <button
                  type="button"
                  onClick={() => setShowSidebar((prev) => !prev)}
                  className="toolbar-icon-button"
                  aria-pressed={showSidebar}
                  aria-label={t("header.toggleSidebar")}
                  title={t("header.toggleSidebar")}
                >
                  <SidebarSimpleIcon className="size-4" aria-hidden="true" />
                </button>
              )}

              {daemon.projectPath && (
                <MainFileSwitcher
                  mainFile={latexSettings.settings.mainFile}
                  texFiles={texFiles}
                  disabled={latexSettings.isDetecting || latexCompiler.isCompiling}
                  onSelect={latexSettings.setMainFile}
                />
              )}

              {daemon.projectPath && (
                <button
                  type="button"
                  onClick={() => setShowTerminal((prev) => !prev)}
                  className="toolbar-icon-button"
                  aria-pressed={showTerminal}
                  aria-label={t("header.toggleTerminal")}
                  title={t("header.toggleTerminal")}
                >
                  <TerminalIcon className="size-4" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                onClick={handleToggleRightPanel}
                className="toolbar-icon-button"
                aria-pressed={showRightPanel}
                aria-label={t("header.toggleAgent")}
                title={t("header.toggleAgent")}
              >
                <SparkleIcon className="size-4" aria-hidden="true" />
              </button>

              <span className="text-border text-lg select-none">/</span>
              <div className="flex items-center gap-2 h-8">
                {daemon.projectPath && (
                  <button
                    type="button"
                    onClick={handleCompileWithDetection}
                    data-tour="compile"
                    disabled={latexSettings.isDetecting || latexCompiler.isCompiling}
                    className="toolbar-icon-button"
                    title={
                      latexCompiler.isCompiling ? t("latex.compiling") : t("header.compileTooltip")
                    }
                    aria-label={
                      latexCompiler.isCompiling ? t("latex.compiling") : t("header.compileTooltip")
                    }
                  >
                    {latexCompiler.isCompiling ? (
                      <CircleNotchIcon
                        className="size-4 animate-spin text-accent"
                        aria-hidden="true"
                      />
                    ) : (
                      <PlayIcon className="size-4" aria-hidden="true" />
                    )}
                  </button>
                )}

                <button
                  type="button"
                  data-tour="settings"
                  onClick={() => {
                    setShowSettingsPage(true);
                  }}
                  className="toolbar-icon-button"
                  aria-pressed={showSettingsPage}
                  title={t("header.settingsTooltip")}
                  aria-label={t("header.settingsTooltip")}
                >
                  <GearIcon className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </header>
      </div>

      <main data-workspace-shell className="flex-1 min-h-0 flex relative overflow-hidden">
        <AnimatePresence mode="wait">
          {showSidebar && (
            <motion.div
              key="sidebar-container"
              initial={prefersReducedMotion ? { opacity: 1 } : { x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { x: -280, opacity: 0 }}
              transition={prefersReducedMotion ? INSTANT_TRANSITION : PANEL_SPRING}
              className="flex flex-shrink-0"
              style={{
                willChange: "auto",
              }}
            >
              <aside
                style={{
                  width: resizing === "sidebar" ? "var(--sidebar-width)" : sidebarWidth,
                  willChange: resizing === "sidebar" ? "width" : undefined,
                }}
                className="border-r border-border flex flex-col flex-shrink-0 overflow-hidden"
              >
                <TabBar
                  tabs={sidebarTabs}
                  activeTab={sidebarTab}
                  onTabSelect={(id) => setSidebarTab(id as "files" | "git")}
                  variant="sidebar"
                />

                {sidebarTab === "files" && (
                  <FileSidebarPanel
                    projectPath={daemon.projectPath}
                    files={daemon.files}
                    selectedFile={selectedFile}
                    highlightedFile={highlightedFile}
                    onFileSelect={handleFileSelect}
                    onCreateFile={() => setCreateDialog({ type: "file" })}
                    onCreateDirectory={() => setCreateDialog({ type: "directory" })}
                    onRefreshFiles={daemon.refreshFiles}
                    fileOperations={{
                      createFile: daemon.createFile,
                      createDirectory: daemon.createDirectory,
                      renamePath: daemon.renamePath,
                      deletePath: daemon.deletePath,
                    }}
                  />
                )}

                {sidebarTab === "git" && (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <GitSidebarPanel
                      projectPath={daemon.projectPath}
                      gitStatus={gitStatus}
                      gitGraph={daemon.gitGraph}
                      gitLogEntries={daemon.gitLogEntries}
                      stagedChanges={stagedChanges}
                      unstagedChanges={unstagedChanges}
                      showRemoteInput={showRemoteInput}
                      remoteUrl={remoteUrl}
                      onRemoteUrlChange={(value) => setRemoteUrl(value)}
                      onShowRemoteInput={() => setShowRemoteInput(true)}
                      onHideRemoteInput={() => setShowRemoteInput(false)}
                      onSubmitRemote={handleRemoteSubmit}
                      onInitGit={daemon.gitInit}
                      isInitializingGit={daemon.isInitializingGit}
                      onRefreshStatus={handleRefreshGitStatus}
                      onStageAll={handleStageAll}
                      onDiscardAll={handleDiscardAll}
                      onDiscardFile={handleDiscardFile}
                      onStageFile={handleStageFile}
                      onUnstageFile={handleUnstageFile}
                      onUnstageAll={handleUnstageAll}
                      showCommitInput={showCommitInput}
                      commitMessage={commitMessage}
                      onCommitMessageChange={(value) => setCommitMessage(value)}
                      onShowCommitInput={() => setShowCommitInput(true)}
                      onHideCommitInput={() => setShowCommitInput(false)}
                      onCommit={handleCommit}
                      onPush={handleGitPush}
                      onPull={handleGitPull}
                      onPreviewDiff={handlePreviewGitDiff}
                      onGenerateCommitMessageAI={handleGenerateCommitMessageAI}
                      onOpenFile={(path) => {
                        void handleFileSelect(path);
                      }}
                      onPublishToGitHub={handlePublishToGitHub}
                      isGeneratingCommitMessageAI={isGeneratingCommitMessageAI}
                      isPushing={daemon.isPushing}
                      isPulling={daemon.isPulling}
                      isAuthenticatingGh={daemon.isAuthenticatingGh}
                    />
                  </div>
                )}
              </aside>
              <div className="relative group w-1 flex-shrink-0">
                <motion.div
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0}
                  dragMomentum={false}
                  onDragStart={() => startResize("sidebar")}
                  onDrag={(_event, info) => handleResizeDrag("sidebar", info)}
                  onDragEnd={endResize}
                  className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize z-10"
                  style={{ x: 0 }}
                />
                <div
                  className={`w-full h-full transition-colors ${resizing === "sidebar" ? "bg-accent/40" : "group-hover:bg-accent/20"}`}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 min-w-0 w-0 flex flex-col overflow-hidden">
          {agentReview.changes.length > 0 &&
            (!agentReview.open ||
              !agentReview.changes.some((change) => change.path === selectedFile)) && (
              <div className="flex items-center justify-end border-b border-border px-3 py-1">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    agentReview.setOpen(true);
                    const first = agentReview.changes[0];
                    if (first) void handleFileSelect(first.path);
                  }}
                >
                  {
                    { zh: "Agent 修改建议", en: "Agent suggestions", ko: "Agent 제안" }[
                      locale
                    ]
                  }{" "}
                  ({agentReview.changes.length})
                </button>
              </div>
            )}
          {daemon.projectPath && editorPanelItems.length > 0 ? (
            <div ref={editorWorkspaceRef} className="relative flex-1 min-h-0">
              {splitDropHint && (
                <div className="pointer-events-none absolute inset-0 z-10">
                  <div
                    className={`absolute inset-y-0 w-1/2 transition-opacity duration-100 ${
                      splitDropHint === "left"
                        ? "left-0 border-r border-accent/40 bg-gradient-to-r from-foreground/15 to-transparent"
                        : "right-0 border-l border-accent/40 bg-gradient-to-l from-foreground/15 to-transparent"
                    }`}
                  />
                </div>
              )}

              <DockviewPanelLayout panels={editorPanelItems} className="dockview-editor-layout" />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              {daemon.projectPath ? (
                <div />
              ) : (
                <div className="flex flex-col items-center justify-center text-center px-6">
                  <Logo size="large" className="h-24 w-auto mb-10" />
                  <button
                    type="button"
                    data-tour="workspace"
                    onClick={handleOpenFolder}
                    className="btn btn-primary"
                  >
                    {t("welcome.openFolder")}
                  </button>
                  <RecentProjects
                    projects={recentProjects.projects}
                    onSelect={handleOpenRecentProject}
                    onRemove={recentProjects.removeProject}
                    onClearAll={recentProjects.clearAll}
                  />
                </div>
              )}
            </div>
          )}

          {/* LaTeX Install Prompt - shown when no compiler is detected */}
          {daemon.projectPath &&
            latexCompiler.compilersStatus &&
            !hasAnyCompiler &&
            !latexCompiler.isDetecting && (
              <div className="border-t border-border">
                <LaTeXInstallPrompt onRefreshCompilers={latexCompiler.detectCompilers} />
              </div>
            )}

          <TerminalPanel
            projectPath={daemon.projectPath}
            open={showTerminal}
            shellMode={editorSettings.settings.terminalShellMode}
            customShell={editorSettings.settings.terminalShellPath}
            fontFamily={editorSettings.settings.terminalFontFamily}
            fontSize={editorSettings.settings.terminalFontSize}
            lineHeight={editorSettings.settings.terminalLineHeight}
            prefersReducedMotion={Boolean(prefersReducedMotion)}
            onClose={() => setShowTerminal(false)}
          />
        </div>

        <AnimatePresence>
          {showRightPanel && (
            <motion.div
              key="right-panel-container"
              initial={prefersReducedMotion ? { opacity: 1, width: 0 } : { opacity: 0, width: 0 }}
              animate={{
                opacity: 1,
                width:
                  resizing === "right"
                    ? `calc(var(--right-panel-width) + 4px)`
                    : rightPanelWidth + 4,
              }}
              exit={prefersReducedMotion ? { opacity: 0, width: 0 } : { opacity: 0, width: 0 }}
              transition={prefersReducedMotion ? INSTANT_TRANSITION : PANEL_SPRING}
              className="flex flex-shrink-0 bg-background overflow-hidden"
              style={{
                willChange: prefersReducedMotion ? undefined : "width, opacity",
              }}
            >
              <div className="relative group w-1 flex-shrink-0">
                <motion.div
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0}
                  dragMomentum={false}
                  onDragStart={() => startResize("right")}
                  onDrag={(_event, info) => handleResizeDrag("right", info)}
                  onDragEnd={endResize}
                  className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize z-10"
                  style={{ x: 0 }}
                />
                <div
                  className={`w-full h-full transition-colors ${resizing === "right" ? "bg-accent/40" : "group-hover:bg-accent/20"}`}
                />
              </div>
              <aside
                style={{
                  width: resizing === "right" ? "var(--right-panel-width)" : rightPanelWidth,
                  willChange: resizing === "right" ? "width" : undefined,
                }}
                className="border-l border-border flex flex-col flex-shrink-0 overflow-hidden"
              >
                {agentSelection.ready && agentSelection.selected !== "builtin" ? (
                  <ExternalAgentPanel
                    agent={externalAgent}
                    selected={agentSelection.selected}
                    directory={daemon.projectPath ?? undefined}
                    files={daemon.files}
                    skills={academicAgent.catalog.filter((skill) =>
                      academicAgent.config.skillIds.includes(skill.id),
                    )}
                    enabledSkillIds={academicAgent.config.skillIds}
                  />
                ) : (
                  <AcademicAgentPanel
                    key={daemon.projectPath ?? "no-project"}
                    agent={academicAgent}
                    files={daemon.files}
                    onOpenSettings={() => {
                      setSettingsInitialTab("agent");
                      setShowSettingsPage(true);
                    }}
                  />
                )}
              </aside>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {createDialog && (
        <InputDialog
          title={createDialog.type === "file" ? t("files.newFile") : t("files.newFolder")}
          placeholder={createDialog.type === "file" ? "file.tex" : t("files.folderName")}
          onConfirm={handleCreateConfirm}
          onCancel={() => setCreateDialog(null)}
          validator={validateFileName}
        />
      )}

      {(showSettingsPage || (showQuickStart && quickStart.step >= 4)) && (
        <SettingsPage
          initialTab={settingsInitialTab}
          quickStart={
            showQuickStart && quickStart.step >= 4
              ? {
                  step: quickStart.step,
                  saveError: quickStart.saveError,
                  onNext: quickStart.next,
                  onBack: quickStart.back,
                  onClose: () => {
                    quickStart.close();
                    setShowSettingsPage(true);
                  },
                }
              : undefined
          }
          onOpenTerminal={() => {
            quickStart.close();
            setShowSettingsPage(false);
            setShowTerminal(true);
          }}
          onClose={() => {
            setShowSettingsPage(false);
            setSettingsInitialTab("general");
          }}
          academicAgent={academicAgent}
          agentSelection={agentSelection}
          externalAgent={externalAgent}
          editorSettings={editorSettings.settings}
          onUpdateEditorSettings={editorSettings.updateSettings}
          onOpenQuickStart={() => {
            setShowSettingsPage(false);
            quickStart.open();
          }}
        />
      )}

      {showQuickStart && quickStart.step < 4 && (
        <QuickStart
          step={quickStart.step}
          workspaceReady={workspaceReady}
          workspaceError={
            daemon.lastError?.operation === "open project" ? daemon.lastError.message : undefined
          }
          saveError={quickStart.saveError}
          onOpenFolder={handleOpenFolder}
          onNext={quickStart.next}
          onBack={quickStart.back}
        />
      )}

      {mainFileDetectionResult && (
        <MainFileSelectionDialog
          open={showMainFileDialog}
          detectionResult={mainFileDetectionResult}
          onSelect={handleMainFileSelect}
          onCancel={handleMainFileDialogCancel}
        />
      )}

      <SynctexInstallDialog
        open={showSynctexInstallDialog}
        onClose={() => {
          setShowSynctexInstallDialog(false);
          pendingSynctexRetryRef.current = null;
        }}
        onInstallComplete={handleSynctexInstallComplete}
      />

      {showGitHubPublishDialog && (
        <GitHubPublishDialog
          defaultRepoName={
            daemon.projectPath ? pathSync.basename(daemon.projectPath) : "my-project"
          }
          onPublish={handleGitHubPublish}
          onCancel={() => {
            setShowGitHubPublishDialog(false);
            setGhPublishError(null);
          }}
          isCreating={daemon.isCreatingRepo}
          error={ghPublishError}
        />
      )}
    </div>
  );
}
