"use client";

import {
  BooksIcon,
  CircleNotchIcon,
  FileArrowDownIcon,
  FilePlusIcon,
  FileTextIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { InputDialog } from "@/components/ui/input-dialog";
import type { TabDragEndPayload, TabDragMovePayload } from "@/components/ui/tab-bar";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import {
  AcademicAgentPanel,
  AgentReviewPanel,
  ExternalAgentPanel,
  useAcademicAgent,
  useAgentReview,
  useAgentSelection,
  useExternalAgent,
} from "@/features/agent";
import { AcpConnectionDialog } from "@/features/agent/components/acp-connection-dialog";
import { useCloudBackup } from "@/features/backup";
import {
  type DockviewPanelItem,
  DockviewPanelLayout,
} from "@/features/editor/components/dockview-panel-layout";
import { EditorPane } from "@/features/editor/components/editor-pane";
import { FilePane } from "@/features/editor/components/file-pane";
import { GitDiffPane } from "@/features/editor/components/git-diff-pane";
import { activeEditor } from "@/features/editor/lib/active-editor";
import {
  citedKeys,
  missingCitations,
  parseBibliographyRecords,
} from "@/features/editor/lib/bibliography";
import { activeBuffers, type PaneId, type SplitSide } from "@/features/editor/lib/panes";
import { pdfPathFromNotes } from "@/features/editor/lib/pdf-notes";
import { useEditorPanes } from "@/features/editor/lib/use-editor-panes";
import { useProjectBibliography } from "@/features/editor/lib/use-project-bibliography";
import {
  backupErrorMessage,
  backupResultNotice,
  ExitSyncDialog,
  largeFileNotice,
  useExitSync,
  useGitBackup,
} from "@/features/git";
import { GitSidebar } from "@/features/git/components/git-sidebar";
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
import {
  citationText,
  type LibraryItem,
  LibrarySidebarPanel,
  quotationText,
  useLibrary,
  usePdfDrop,
} from "@/features/library";
import {
  MarkdownGraphModal,
  markdownGraphNode,
  resolveDocumentLink,
  useMarkdownGraph,
} from "@/features/markdown-graph";
import { countWords, documentOutline, OutlinePanel, SearchPanel } from "@/features/navigator";
import { QuickStart } from "@/features/onboarding/components/quick-start";
import { useQuickStart } from "@/features/onboarding/lib/use-quick-start";
import {
  matchesShortcut,
  SettingsPage,
  shortcutLabel,
  useEditorSettings,
  useKeyboardShortcuts,
} from "@/features/settings";
import { TerminalPanel } from "@/features/terminal/components/terminal-panel";
import {
  ActivityRail,
  CommandPalette,
  type CompileState,
  type PaletteCommand,
  type PaletteMode,
  ProjectSwitcher,
  type SidebarView,
  type StartAction,
  StartPage,
  StatusBar,
} from "@/features/workbench";
import { RecentProjects } from "@/features/workspace/components/recent-projects";
import { FileSidebarPanel } from "@/features/workspace/components/sidebar-file-panel";
import { useRecentProjects } from "@/features/workspace/lib/recent-projects";
import { buildBasenameIndex, type TreeNode } from "@/features/workspace/lib/tree-index";
import { throttle } from "@/lib/async";
import { fileLanguage, fileType } from "@/lib/file-types";
import { INSTANT_TRANSITION, PANEL_SPRING } from "@/lib/layout";
import { type MarkdownLinkKind, markdownHeadingLine } from "@/lib/markdown-links";
import { pathSync } from "@/lib/path";
import { useTauriDaemon } from "@/lib/tauri";
import { type ResizablePanel, usePanelResize } from "@/lib/use-panel-resize";
import type { EditorSelection, PdfExcerpt, SelectionAttachment } from "@/types/editor-selection";

type SettingsTab = "general" | "agent" | "translation";

const COMPACT_WIDTH = 1100;
const REVIEWABLE = /(?:\.(tex|bib|cls|sty|md|txt|csv|excalidraw)|\.poster\.json)$/i;
const slashes = (path: string) => path.replace(/\\/g, "/");

function assetUrl(path: string) {
  return isTauri() ? convertFileSrc(path, "asset") : path;
}

function ResizeHandle({
  panel,
  resize,
}: {
  panel: ResizablePanel;
  resize: ReturnType<typeof usePanelResize>;
}) {
  return (
    <div className="group relative w-1 flex-shrink-0">
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0}
        dragMomentum={false}
        onDragStart={() => resize.startResize(panel)}
        onDrag={(_event, info) => resize.dragResize(panel, info)}
        onDragEnd={resize.endResize}
        className="absolute inset-y-0 -left-1 -right-1 z-10 cursor-col-resize"
        style={{ x: 0 }}
      />
      <div
        className={`h-full w-full transition-colors ${
          resize.resizing === panel ? "bg-accent/40" : "group-hover:bg-accent/20"
        }`}
      />
    </div>
  );
}

/** Build artefacts that are never opened from the palette. */
const NOISE = /\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|bbl|blg|synctex(\.gz)?|nav|snm|vrb)$/i;

type TreeFile = { path: string; type: string; children?: TreeFile[] };
function filePaths(files: readonly TreeFile[]): string[] {
  return files.flatMap((file) =>
    file.type === "directory" ? filePaths(file.children ?? []) : [file.path],
  );
}

async function pickPdfs(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ multiple: true, filters: [{ name: "PDF", extensions: ["pdf"] }] });
  return selected ? [selected].flat() : [];
}

export default function EditorPage() {
  const editorSettings = useEditorSettings();
  const { settings } = editorSettings;
  const { bindings: shortcuts } = useKeyboardShortcuts();
  const daemon = useTauriDaemon({
    gitAutoFetchEnabled: settings.gitAutoFetchEnabled,
    gitAutoFetchIntervalMs: settings.gitAutoFetchIntervalSeconds * 1000,
  });
  const projectPath = daemon.projectPath;
  const prefersReducedMotion = useReducedMotion();
  const { toast } = useToast();
  const { t } = useI18n();
  const recentProjects = useRecentProjects();
  const resize = usePanelResize();
  // ── Shell layout ──────────────────────────────────────────────────────────
  const [showSidebar, setShowSidebar] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarView>("files");
  const [showAgent, setShowAgent] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [createDialog, setCreateDialog] = useState<
    "file" | "directory" | "drawing" | "mindmap" | null
  >(null);
  const [palette, setPalette] = useState<PaletteMode | null>(null);
  const showSidebarTab = useCallback((tab: SidebarView) => {
    setSidebarTab(tab);
    setShowSidebar(true);
  }, []);

  useEffect(() => {
    const openTranslation = () => setSettingsTab("translation");
    window.addEventListener("inkwell-open-translation-settings", openTranslation);
    return () => window.removeEventListener("inkwell-open-translation-settings", openTranslation);
  }, []);

  useEffect(() => {
    const collapse = throttle(() => {
      if (window.innerWidth < COMPACT_WIDTH) setShowAgent(false);
    }, 100);
    collapse();
    window.addEventListener("resize", collapse);
    return () => window.removeEventListener("resize", collapse);
  }, []);

  // ── Documents ─────────────────────────────────────────────────────────────
  const filesByBasename = useMemo(
    () => buildBasenameIndex(daemon.files as TreeNode[]),
    [daemon.files],
  );
  const resolvePath = useCallback(
    (candidate: string) => {
      const path = slashes(candidate);
      if (path.includes("/")) return path;
      const matches = filesByBasename.get(path) ?? [];
      if (matches.includes(path) || !matches[0]) return path;
      if (matches.length > 1)
        toast(t("files.multipleFilesFound", { name: path, preferred: matches[0] }), "error");
      return matches[0];
    },
    [filesByBasename, toast, t],
  );
  const writeProjectFile = useCallback(
    async (path: string, content: string) => {
      if (!projectPath) throw new Error("No project open");
      await invoke("write_file", {
        path: pathSync.join(projectPath, path),
        content,
        encoding: "utf-8",
      });
    },
    [projectPath],
  );
  const editor = useEditorPanes({
    projectPath,
    read: daemon.readFile,
    write: writeProjectFile,
    resolvePath,
    readDiff: daemon.gitDiff,
    change: daemon.lastFileChange,
  });
  const { panes } = editor;
  const selectedFile = panes.primary.active;
  const buffers = useMemo(() => activeBuffers(panes), [panes]);
  const bufferMap = useMemo(
    () => new Map(buffers.map((buffer) => [buffer.path, buffer.content])),
    [buffers],
  );
  /** The text document being written: the primary group's, else the split group's. */
  const activeDocument =
    buffers.find((buffer) => buffer.path === selectedFile) ??
    buffers.find((buffer) => buffer.path === panes.split?.active);

  const [goTo, setGoTo] = useState<{ path: string; line: number } | null>(null);
  useEffect(() => {
    if (!goTo) return;
    // Long enough for the editor to mount and apply it.
    const timer = setTimeout(() => setGoTo(null), 3000);
    return () => clearTimeout(timer);
  }, [goTo]);

  const markdownGraph = useMarkdownGraph({
    projectPath,
    files: daemon.files,
    readFile: daemon.readFile,
    change: daemon.lastFileChange,
    buffers: useMemo(
      () =>
        buffers.filter(
          (buffer) => fileLanguage(buffer.path) === "markdown" && !pdfPathFromNotes(buffer.path),
        ),
      [buffers],
    ),
  });
  const bibBuffers = buffers.filter((buffer) => /\.bib$/i.test(buffer.path));
  const { bibliography, sources: bibliographySources } = useProjectBibliography({
    projectPath,
    files: daemon.files,
    readFile: daemon.readFile,
    change: daemon.lastFileChange,
    primaryPath: bibBuffers[0]?.path,
    primaryContent: bibBuffers[0]?.content ?? "",
    secondaryPath: bibBuffers[1]?.path,
    secondaryContent: bibBuffers[1]?.content ?? "",
  });
  const library = useLibrary({
    projectPath,
    files: daemon.files,
    bibliographies: bibliographySources,
    readFile: daemon.readFile,
    writeFile: editor.writeFile,
  });

  // ── Agents ────────────────────────────────────────────────────────────────
  const agentSelection = useAgentSelection();
  const [pendingAgentMessage, setPendingAgentMessage] = useState<string | null>(null);
  const reviewBuffers = useRef(buffers);
  reviewBuffers.current = buffers.filter((buffer) => REVIEWABLE.test(buffer.path));
  const agentReview = useAgentReview({
    directory: projectPath ?? undefined,
    buffers: () => reviewBuffers.current,
    onApplied: (path, content) => {
      editor.replaceContent(path, content);
      void daemon.refreshFiles();
    },
  });
  const academicAgent = useAcademicAgent({
    directory: projectPath ?? undefined,
    pendingMessage: pendingAgentMessage,
    onPendingMessageSent: () => setPendingAgentMessage(null),
    enabled: agentSelection.ready && agentSelection.selected === "builtin",
    beforeTurn: agentReview.beforeTurn,
    afterTurn: agentReview.afterTurn,
  });
  const externalAgent = useExternalAgent({
    beforeTurn: agentReview.beforeTurn,
    afterTurn: agentReview.afterTurn,
    selection: agentSelection,
    directory: projectPath ?? undefined,
    config: academicAgent.config,
    configReady: academicAgent.configReady,
    pendingMessage: pendingAgentMessage,
    onPendingMessageSent: () => setPendingAgentMessage(null),
  });
  const agent = agentSelection.selected === "builtin" ? academicAgent : externalAgent;
  useEffect(() => {
    if (externalAgent.authentication) setShowAgent(true);
  }, [externalAgent.authentication]);

  const openFile = useCallback(
    (target: string, pane: PaneId | "beside" = "primary") => {
      const path = resolvePath(target);
      // A proposed new file is not on disk until the proposal is accepted.
      const proposed = agentReview.changes.some((change) => change.path === path);
      if (proposed) agentReview.setOpen(true);
      return editor.open(path, {
        pane,
        side: pane === "beside" ? "right" : undefined,
        optional: proposed,
      });
    },
    [editor.open, resolvePath, agentReview.changes, agentReview.setOpen],
  );
  const openAtLine = useCallback(
    async (target: string, line: number) => {
      const path = resolvePath(target);
      if (await openFile(path)) setGoTo({ path, line });
    },
    [openFile, resolvePath],
  );

  // Opening the review shows its first proposal unless one is already in view.
  const reviewWasOpen = useRef(false);
  useEffect(() => {
    const justOpened = agentReview.open && !reviewWasOpen.current;
    reviewWasOpen.current = agentReview.open;
    const first = agentReview.changes[0];
    if (justOpened && first && !agentReview.changes.some((change) => change.path === selectedFile))
      void openFile(first.path);
  }, [agentReview.open, agentReview.changes, selectedFile, openFile]);

  const [selectionDraft, setSelectionDraft] = useState<{
    projectPath: string | null;
    items: SelectionAttachment[];
  }>({ projectPath, items: [] });
  const selections = selectionDraft.projectPath === projectPath ? selectionDraft.items : [];
  const [pendingSelection, setPendingSelection] = useState<
    (EditorSelection & { path: string; requestId: string; pane: PaneId }) | null
  >(null);
  const attachSelection = useCallback(
    (path: string, selection: EditorSelection | PdfExcerpt) => {
      const signature = JSON.stringify({ ...selection, path });
      setSelectionDraft((current) => {
        const items = current.projectPath === projectPath ? current.items : [];
        const duplicate = items.some(
          ({ id: _id, ...item }) => JSON.stringify({ ...selection, ...item }) === signature,
        );
        return {
          projectPath,
          items: duplicate ? items : [...items, { ...selection, id: crypto.randomUUID(), path }],
        };
      });
      setShowAgent(true);
    },
    [projectPath],
  );
  const removeSelection = useCallback(
    (id: string) =>
      setSelectionDraft((current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== id),
      })),
    [],
  );
  const revealSelection = useCallback(
    async (selection: SelectionAttachment) => {
      const root = projectPath;
      const pane = panes.split?.active === selection.path ? "split" : "primary";
      if (pane === "primary" && !(await openFile(selection.path))) return;
      if (pane === "primary") agentReview.setOpen(false);
      if (activeProject.current !== root || "page" in selection) return;
      setPendingSelection({ ...selection, requestId: crypto.randomUUID(), pane });
    },
    [projectPath, panes.split?.active, openFile, agentReview.setOpen],
  );

  // ── Reading into writing ──────────────────────────────────────────────────
  /** Inserts text at the cursor of the document being written, or copies it. */
  const insertIntoDocument = useCallback(
    async (text: (language: string) => string, copied: string) => {
      const target = activeEditor();
      if (target?.insert(text(target.language()))) return;
      await navigator.clipboard.writeText(text("latex"));
      toast(copied, "info");
    },
    [toast],
  );
  const cite = useCallback(
    (item: LibraryItem) =>
      void insertIntoDocument(
        (language) => citationText(item.key, language),
        t("library.citationCopied"),
      ),
    [insertIntoDocument, t],
  );
  const quote = useCallback(
    (pdfPath: string, excerpt: PdfExcerpt) => {
      const key = library.library.items.find((item) => item.file === pdfPath)?.key;
      void insertIntoDocument(
        (language) => quotationText(excerpt.text, key, language),
        t("library.quoteCopied"),
      );
    },
    [library.library.items, insertIntoDocument, t],
  );
  const editEntry = useCallback(
    (item: LibraryItem) => {
      const source = bibliographySources.get(item.source) ?? "";
      const start = parseBibliographyRecords(source).find((entry) => entry.key === item.key)?.start;
      void openAtLine(item.source, source.slice(0, start ?? 0).split("\n").length);
    },
    [bibliographySources, openAtLine],
  );
  const importPdfs = useCallback(
    (sources: string[]) => {
      showSidebarTab("library");
      void library.importSources(sources);
    },
    [library.importSources, showSidebarTab],
  );
  const droppingPdfs = usePdfDrop(Boolean(projectPath), importPdfs);

  const openMarkdownFile = useCallback(
    async (path: string, heading?: string) => {
      if (!(await openFile(path))) return;
      setShowGraph(false);
      if (!heading || fileLanguage(path) !== "markdown") return;
      const text =
        bufferMap.get(path) ??
        markdownGraph.content(path) ??
        (await daemon.readFile(path).catch(() => null));
      const line = text == null ? undefined : markdownHeadingLine(text, heading);
      if (line) setGoTo({ path, line });
    },
    [openFile, bufferMap, markdownGraph, daemon.readFile],
  );
  const followLink = useCallback(
    (target: string, source: string, kind: MarkdownLinkKind = "wiki") => {
      const resolved = resolveDocumentLink(
        target,
        source,
        markdownGraph.paths,
        kind,
        markdownGraph.caseInsensitive,
      );
      if (resolved.status === "resolved")
        return void openMarkdownFile(resolved.path, resolved.heading);
      toast(
        t(resolved.status === "ambiguous" ? "markdown.linkAmbiguous" : "markdown.linkNotFound", {
          target,
        }),
        "error",
      );
    },
    [openMarkdownFile, markdownGraph.paths, markdownGraph.caseInsensitive, toast, t],
  );

  // ── LaTeX ─────────────────────────────────────────────────────────────────
  const latexSettings = useLatexSettings();
  const texFiles = useMemo(() => findTexFiles(daemon.files), [daemon.files]);
  const latexCompiler = useLatexCompiler({ settings: latexSettings.settings, projectPath });
  const compilers = latexCompiler.compilersStatus;
  const hasCompiler = Boolean(
    compilers &&
      (compilers.pdflatex.available ||
        compilers.xelatex.available ||
        compilers.lualatex.available ||
        compilers.latexmk.available),
  );
  useEffect(() => {
    if (daemon.files.length === 0 || latexSettings.settings.mainFile) return;
    const mainFile = findMainTexFile(daemon.files);
    if (mainFile) latexSettings.setMainFile(mainFile);
  }, [daemon.files, latexSettings.settings.mainFile, latexSettings.setMainFile]);

  const [mainFileChoice, setMainFileChoice] = useState<MainFileDetectionResult | null>(null);
  const compile = useCallback(
    async (mainFile: string) => {
      try {
        await editor.flush();
        const result = await latexCompiler.compile(mainFile);
        if (result.success) {
          toast(t("latex.compileSuccess"), "success");
          void daemon.refreshFiles();
          editor.reloadPdfs();
          void editor.open(mainFile.replace(/\.tex$/i, ".pdf"), { pane: "beside", side: "right" });
          return;
        }
        const errors = latexCompiler.compileLogs
          .filter((log) => log.is_error)
          .map((log) => log.line.trim())
          .filter(Boolean);
        const cause =
          errors.find((line) => line.startsWith("!") || /error:/i.test(line)) ?? errors.at(-1);
        const failure = t("latex.compileFailed", { error: result.error || "Unknown error" });
        toast(cause ? `${failure}: ${cause}` : failure, "error");
        const log = (
          errors.length ? errors : latexCompiler.compileLogs.slice(-15).map((l) => l.line)
        )
          .slice(-10)
          .join("\n");
        setShowAgent(true);
        setPendingAgentMessage(
          `LaTeX compilation of "${mainFile}" failed.\nError: ${result.error || ""}\n${cause ? `Primary cause: ${cause}\n` : ""}${log ? `Recent log:\n${log}` : ""}\nPlease inspect the LaTeX source code and help fix the compilation error.`,
        );
      } catch (error) {
        toast(t("latex.compileFailed", { error: String(error) }), "error");
      }
    },
    [editor.flush, editor.reloadPdfs, editor.open, latexCompiler, daemon.refreshFiles, toast, t],
  );
  const compileProject = useCallback(async () => {
    if (!projectPath) return;
    if (!hasCompiler) return toast(t("latex.noCompilerFound"), "error");
    const detected = await latexSettings.detectMainFile(projectPath);
    if (!detected) return toast(t("latex.detectFailed"), "error");
    if (detected.main_file && !detected.needs_user_input) return void compile(detected.main_file);
    if (detected.needs_user_input && detected.tex_files.length > 0)
      return setMainFileChoice(detected);
    toast(t("latex.noTexFilesToast"), "error");
  }, [projectPath, hasCompiler, latexSettings.detectMainFile, compile, toast, t]);

  const [synctexRetry, setSynctexRetry] = useState<{
    pdf: string;
    page: number;
    x: number;
    y: number;
    install: boolean;
  } | null>(null);
  /** Jumps from a position in a compiled PDF to its source, keeping the PDF on the right. */
  const jumpToSource = useCallback(
    async (pdf: string, page: number, x: number, y: number) => {
      if (!projectPath) return;
      try {
        const result = await invoke<SynctexResult>("latex_synctex_edit", {
          pdfPath: pathSync.join(projectPath, pdf),
          page,
          x,
          y,
        });
        const clean = (path: string) =>
          slashes(path)
            .replace(/\/\.\//g, "/")
            .replace(/\/+/g, "/");
        const root = clean(projectPath);
        const file = clean(result.file);
        const source = file.startsWith(root) ? file.slice(root.length).replace(/^\/+/, "") : file;
        if (!(await editor.open(source))) return;
        editor.showBeside(pdf, "right");
        setGoTo({ path: source, line: result.line });
      } catch (error) {
        if (String(error).includes("SYNCTEX_NOT_INSTALLED"))
          setSynctexRetry({ pdf, page, x, y, install: true });
        else if (isMissingSynctexData(error)) toast(t("latex.synctexDataMissing"), "info");
        else toast(t("latex.synctexLookupFailed"), "error");
      }
    },
    [projectPath, editor.open, editor.showBeside, toast, t],
  );

  // ── Git ───────────────────────────────────────────────────────────────────
  const gitBusy =
    daemon.isPushing || daemon.isPulling || agent.working || latexCompiler.isCompiling;
  const backup = useGitBackup({
    projectPath,
    isRepo: Boolean(daemon.gitStatus?.isRepo),
    enabled: settings.gitAutoBackupEnabled,
    intervalMinutes: settings.gitAutoBackupIntervalMinutes,
    push: settings.gitAutoBackupPush,
    busy: gitBusy,
    flush: editor.flush,
    onDone: (result) => {
      void daemon.refreshGitStatus();
      if (result.committed || result.pushError) {
        const notice = backupResultNotice(result, t);
        toast(notice.message, notice.type);
      }
    },
    onError: (code) => toast(backupErrorMessage(code, t), "error"),
    onLargeFilesSkipped: (files) => {
      const notice = largeFileNotice(files, t);
      if (notice) toast(notice, "info");
    },
  });
  const cloudBackup = useCloudBackup({
    projectPath,
    busy: gitBusy || backup.running || daemon.isOpeningProject,
    flush: editor.flush,
  });
  const exitSync = useExitSync({
    projectPath,
    gitPush: daemon.gitPush,
    backup: { enabled: settings.gitAutoBackupEnabled, push: settings.gitAutoBackupPush },
    flush: editor.flush,
  });

  // ── Workspace ─────────────────────────────────────────────────────────────
  const activeProject = useRef(projectPath);
  activeProject.current = projectPath;
  const switching = useRef(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const workspaceReady = Boolean(
    daemon.projectInfo &&
      !daemon.isOpeningProject &&
      daemon.lastError?.operation !== "open project",
  );
  const quickStart = useQuickStart(workspaceReady);
  const touring = quickStart.visible;

  // Panels that belong to one project do not carry over to the next.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset exactly when the project changes.
  useEffect(() => {
    setShowTerminal(false);
    setShowGraph(false);
    setGoTo(null);
    setPendingSelection(null);
    setPendingAgentMessage(null);
    setMainFileChoice(null);
    setSynctexRetry(null);
    setCreateDialog(null);
  }, [projectPath]);

  const changeWorkspace = useCallback(
    async (path: string) => {
      if (switching.current || path === projectPath) return;
      if (academicAgent.working || externalAgent.working || latexCompiler.isCompiling)
        return toast(t("workspace.waitForOperations"), "info");
      switching.current = true;
      setIsSwitching(true);
      try {
        // A failed save aborts the switch instead of losing the edit.
        await editor.flush();
        await daemon.setProject(path);
        latexSettings.setMainFile(null);
        setShowSidebar(true);
        setShowAgent(window.innerWidth >= COMPACT_WIDTH);
        await recentProjects.addProject(path);
      } catch (error) {
        toast(`${t("workspace.openProjectFailed")}: ${String(error)}`, "error");
      } finally {
        switching.current = false;
        setIsSwitching(false);
      }
    },
    [
      projectPath,
      academicAgent.working,
      externalAgent.working,
      latexCompiler.isCompiling,
      editor.flush,
      daemon.setProject,
      latexSettings.setMainFile,
      recentProjects.addProject,
      toast,
      t,
    ],
  );
  const openFolder = useCallback(async () => {
    if (switching.current) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("workspace.openWorkspace"),
      });
      if (typeof selected === "string") await changeWorkspace(selected);
    } catch (error) {
      toast(`${t("workspace.openProjectFailed")}: ${String(error)}`, "error");
    }
  }, [changeWorkspace, toast, t]);

  // Reopen the last workspace on launch.
  const restored = useRef(false);
  useEffect(() => {
    if (!recentProjects.loaded || restored.current || projectPath || !isTauri()) return;
    restored.current = true;
    const last = recentProjects.projects[0];
    if (!last) return;
    void daemon
      .setProject(last.path)
      .then(() => {
        setShowSidebar(true);
        setShowAgent(window.innerWidth >= COMPACT_WIDTH);
      })
      // The workspace may have been moved or deleted.
      .catch(() => {});
  }, [daemon.setProject, projectPath, recentProjects.loaded, recentProjects.projects]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (typeof event.key !== "string" || event.isComposing || event.defaultPrevented) return;
      if (event.repeat || touring) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[data-shortcut-recorder], [role="dialog"]')
      )
        return;
      const pressed = (id: keyof typeof shortcuts) => matchesShortcut(event, shortcuts[id]);
      if (settingsTab && !pressed("settings")) return;
      if (projectPath && (pressed("newDrawing") || pressed("newMindmap"))) {
        event.preventDefault();
        event.stopPropagation();
        setCreateDialog(pressed("newDrawing") ? "drawing" : "mindmap");
        return;
      }
      const action = pressed("openProject")
        ? () => void openFolder()
        : pressed("closeTab")
          ? () => selectedFile && editor.close("primary", [selectedFile])
          : pressed("compile")
            ? () => void compileProject()
            : pressed("settings")
              ? () => setSettingsTab((tab) => (tab ? null : "general"))
              : pressed("sidebar")
                ? () => setShowSidebar((shown) => !shown)
                : pressed("terminal")
                  ? () => setShowTerminal((shown) => !shown)
                  : pressed("search")
                    ? () => showSidebarTab("search")
                    : pressed("library")
                      ? () => showSidebarTab("library")
                      : pressed("git")
                        ? () => showSidebarTab("git")
                        : pressed("agent")
                          ? () => setShowAgent((shown) => !shown)
                          : pressed("quickOpen")
                            ? () => setPalette("open")
                            : pressed("commandPalette")
                              ? () => setPalette("command")
                              : pressed("cite")
                                ? () => setPalette("cite")
                                : null;
      if (!action) return;
      event.preventDefault();
      // Keep the focused editor from also handling the combination.
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    shortcuts,
    projectPath,
    touring,
    settingsTab,
    selectedFile,
    openFolder,
    compileProject,
    editor.close,
    showSidebarTab,
  ]);

  // ── Editor area ───────────────────────────────────────────────────────────
  const workspace = useRef<HTMLDivElement | null>(null);
  const [dropHint, setDropHint] = useState<SplitSide | null>(null);
  /** The side a tab dragged out of `source` would land on, if it would move groups. */
  const dropSide = useCallback(
    (source: PaneId, payload: { clientX: number; clientY: number }): SplitSide | null => {
      const bounds = workspace.current?.getBoundingClientRect();
      if (
        !bounds ||
        payload.clientX < bounds.left ||
        payload.clientX > bounds.right ||
        payload.clientY < bounds.top ||
        payload.clientY > bounds.bottom
      )
        return null;
      const hovered = payload.clientX < bounds.left + bounds.width / 2 ? "left" : "right";
      if (!panes.split)
        return source === "primary" && panes.primary.tabs.length > 1 ? hovered : null;
      return (hovered === panes.side) === (source === "primary") ? hovered : null;
    },
    [panes.split, panes.side, panes.primary.tabs.length],
  );

  const renderPane = (id: PaneId) => {
    const pane = panes[id];
    const path = pane?.active;
    if (!pane || !path || !projectPath) return null;
    const reviewing =
      id === "primary" &&
      agentReview.open &&
      agentReview.changes.some((change) => change.path === path);
    const jump = pendingSelection?.pane === id && pendingSelection.path === path;
    return (
      <EditorPane
        id={id}
        pane={pane}
        controller={editor}
        onOpen={(tab) => void openFile(tab, id)}
        onTabDragMove={(payload: TabDragMovePayload | null) =>
          setDropHint(payload && dropSide(id, payload))
        }
        onTabDragEnd={(payload: TabDragEndPayload) => {
          setDropHint(null);
          const side = payload.dropTarget.type === "outside" ? dropSide(id, payload) : null;
          if (side) editor.move(payload.tabId, id === "primary" ? "split" : "primary", side);
        }}
      >
        {reviewing ? (
          <AgentReviewPanel
            review={agentReview}
            editorSettings={settings}
            filePath={path}
            onFileSelect={openFile}
          />
        ) : id === "primary" && editor.diff ? (
          <GitDiffPane
            diff={editor.diff}
            editorSettings={settings}
            editorTheme={editorSettings.editorTheme}
            onRefresh={() => void editor.loadDiff(path, Boolean(editor.diff?.staged))}
            onOpenFile={() => void openFile(path)}
          />
        ) : (
          <FilePane
            projectPath={projectPath}
            path={path}
            content={pane.content}
            previewUrl={
              fileType(path) === "text" ? null : assetUrl(pathSync.join(projectPath, path))
            }
            loading={pane.loading}
            error={pane.error}
            pdfRefreshKey={editor.pdfRevision}
            compiledPdfPath={
              (latexCompiler.lastResult?.success && latexCompiler.lastResult.pdf_path) || undefined
            }
            editor={{
              backlinks: markdownGraphNode(markdownGraph.graph, path)?.incoming,
              onBacklinkClick: openMarkdownFile,
              onWikiLinkClick: (target, kind) => followLink(target, path, kind),
              onAddSelection: (selection) => attachSelection(path, selection),
              bibliography,
              onContentChange: (content) => editor.edit(id, content, path, projectPath),
              editorSettings: settings,
              editorTheme: editorSettings.editorTheme,
              goToLine: goTo?.path === path ? goTo.line : undefined,
              goToSelection: jump ? pendingSelection : undefined,
            }}
            pdf={{
              onOpenNotes: (notes) => void openFile(notes, id === "primary" ? "beside" : "primary"),
              onSynctexClick: (page, x, y) => void jumpToSource(path, page, x, y),
              onQuote: (excerpt) => quote(path, excerpt),
              onAddToAgent: (excerpt) => attachSelection(path, excerpt),
            }}
          />
        )}
      </EditorPane>
    );
  };

  const editorPanels: DockviewPanelItem[] = [];
  if (panes.primary.active) {
    editorPanels.push({
      id: "editor-primary",
      title: pathSync.basename(panes.primary.active),
      content: renderPane("primary"),
      inactive: false,
    });
    if (panes.split?.active)
      editorPanels.push({
        id: "editor-split",
        title: pathSync.basename(panes.split.active),
        content: renderPane("split"),
        inactive: false,
        position: { referencePanel: "editor-primary", direction: panes.side },
        positionRevision: panes.side === "left" ? 1 : 2,
      });
  }

  // ── Status and commands ───────────────────────────────────────────────────
  const keys = (id: keyof typeof shortcuts) => shortcutLabel(shortcuts[id]) || undefined;
  const documentLanguage = activeDocument ? fileLanguage(activeDocument.path) : "";
  const documentText = useDeferredValue(activeDocument?.content ?? "");
  const knownKeys = useMemo(() => new Set(bibliography.map((entry) => entry.key)), [bibliography]);
  const headings = useMemo(
    () => documentOutline(documentText, documentLanguage),
    [documentText, documentLanguage],
  );
  const documentStats = useMemo(() => {
    if (!documentLanguage) return null;
    const prose = ["latex", "markdown", "plaintext"].includes(documentLanguage);
    const missing = knownKeys.size
      ? missingCitations(documentText, documentLanguage, knownKeys)
      : [];
    return {
      words: prose ? countWords(documentText, documentLanguage) : null,
      citations: citedKeys(documentText, documentLanguage).length,
      missing: missing.length,
      firstMissing: missing[0]
        ? documentText.slice(0, missing[0].start).split("\n").length
        : undefined,
    };
  }, [documentText, documentLanguage, knownKeys]);
  const compileState: CompileState = latexCompiler.isCompiling
    ? "compiling"
    : !latexCompiler.lastResult
      ? "idle"
      : latexCompiler.lastResult.success
        ? "ok"
        : "failed";

  const openTabs = useMemo(
    () => [...panes.primary.tabs, ...(panes.split?.tabs ?? [])],
    [panes.primary.tabs, panes.split?.tabs],
  );
  const paletteFiles = useMemo(() => {
    const open = openTabs;
    const rest = filePaths(daemon.files).filter((path) => !NOISE.test(path));
    return [...new Set([...open, ...rest])];
  }, [daemon.files, openTabs]);
  const importFromDisk = () =>
    void pickPdfs().then((sources) => {
      if (sources.length) importPdfs(sources);
    });
  const addReference = () => {
    showSidebarTab("library");
    library.setManualAdd({});
  };
  const mainFile = latexSettings.settings.mainFile;
  const command = (
    id: string,
    run: () => void,
    shortcut?: keyof typeof shortcuts,
  ): PaletteCommand => ({
    id,
    label: t(`workbench.commands.${id}`),
    keys: shortcut && keys(shortcut),
    run,
  });
  const commands: PaletteCommand[] = [
    command("quickOpen", () => setPalette("open"), "quickOpen"),
    ...(projectPath
      ? [
          command("cite", () => setPalette("cite"), "cite"),
          command("heading", () => setPalette("heading")),
          command("compile", () => void compileProject(), "compile"),
          ...(mainFile ? [command("openMainFile", () => void openFile(mainFile))] : []),
          command("importPdfs", importFromDisk),
          command("addReference", addReference),
          command("readingDigest", () => {
            void library.writeDigest().then((path) => {
              if (path) void openFile(path);
            });
          }),
          command("showFiles", () => showSidebarTab("files")),
          command("showSearch", () => showSidebarTab("search"), "search"),
          command("showOutline", () => showSidebarTab("outline")),
          command("showLibrary", () => showSidebarTab("library"), "library"),
          command("showGit", () => showSidebarTab("git"), "git"),
          command("newFile", () => setCreateDialog("file")),
          command("newDrawing", () => setCreateDialog("drawing"), "newDrawing"),
          command("newMindmap", () => setCreateDialog("mindmap"), "newMindmap"),
          command("newFolder", () => setCreateDialog("directory")),
          command("openGraph", () => setShowGraph(true)),
          command("toggleTerminal", () => setShowTerminal((shown) => !shown), "terminal"),
          ...(daemon.gitStatus?.isRepo
            ? [command("backupNow", () => void backup.backupNow())]
            : []),
          ...(selectedFile
            ? [command("closeTab", () => void editor.close("primary", [selectedFile]), "closeTab")]
            : []),
        ]
      : []),
    command("toggleSidebar", () => setShowSidebar((shown) => !shown), "sidebar"),
    command("toggleAgent", () => setShowAgent((shown) => !shown), "agent"),
    command("openFolder", () => void openFolder(), "openProject"),
    command("openSettings", () => setSettingsTab("general"), "settings"),
  ];
  const startIcon = "size-4";
  const startActions: StartAction[] = [
    ...(mainFile
      ? [
          {
            id: "main",
            label: t("workbench.start.openMain", { file: mainFile }),
            icon: <FileTextIcon className={startIcon} />,
            run: () => void openFile(mainFile),
          },
        ]
      : []),
    {
      id: "open",
      label: t("workbench.commands.quickOpen"),
      keys: keys("quickOpen"),
      icon: <MagnifyingGlassIcon className={startIcon} />,
      run: () => setPalette("open"),
    },
    {
      id: "import",
      label: t("workbench.commands.importPdfs"),
      icon: <FileArrowDownIcon className={startIcon} />,
      run: importFromDisk,
    },
    {
      id: "add",
      label: t("workbench.commands.addReference"),
      icon: <PlusIcon className={startIcon} />,
      run: addReference,
    },
    {
      id: "library",
      label: t("workbench.commands.showLibrary"),
      keys: keys("library"),
      icon: <BooksIcon className={startIcon} />,
      run: () => showSidebarTab("library"),
    },
    {
      id: "new",
      label: t("workbench.commands.newFile"),
      icon: <FilePlusIcon className={startIcon} />,
      run: () => setCreateDialog("file"),
    },
  ];
  const readingQueue = useMemo(
    () =>
      library.library.items
        .filter((item) => item.file && item.status !== "read")
        .sort((a, b) => Number(b.status === "reading") - Number(a.status === "reading"))
        .slice(0, 6),
    [library.library.items],
  );

  const reviewPending =
    agentReview.changes.length > 0 &&
    !(agentReview.open && agentReview.changes.some((change) => change.path === selectedFile));
  const panelTransition = prefersReducedMotion ? INSTANT_TRANSITION : PANEL_SPRING;
  const settingsOpen = Boolean(settingsTab) || (touring && quickStart.step >= 4);
  return (
    <div className="flex h-dvh flex-col">
      <ExitSyncDialog controller={exitSync} />
      {externalAgent.confirmationAgent !== "builtin" && (
        <AcpConnectionDialog
          selected={externalAgent.confirmationAgent}
          directory={projectPath ?? undefined}
          open={externalAgent.connectionConfirmation}
          onConfirm={externalAgent.confirmConnection}
          onCancel={externalAgent.cancelConnection}
        />
      )}

      <header
        data-workspace-shell
        className="grid h-11 flex-shrink-0 grid-cols-[1fr_minmax(0,24rem)_1fr] items-center gap-4 border-b border-border px-3"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Logo size="small" className="h-6 w-auto flex-shrink-0 select-none" />
          <span aria-hidden="true" className="text-border">
            /
          </span>
          <ProjectSwitcher
            projectPath={projectPath}
            recent={recentProjects.projects}
            disabled={isSwitching || daemon.isOpeningProject}
            keys={keys("openProject")}
            onOpenFolder={() => void openFolder()}
            onSelect={(path) => void changeWorkspace(path)}
          />
        </div>

        <button
          type="button"
          onClick={() => setPalette("open")}
          className="flex h-7 min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-xs text-muted transition-colors duration-150 hover:border-border-dark hover:text-foreground"
        >
          <MagnifyingGlassIcon className="size-3.5 flex-shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{t("workbench.paletteTrigger")}</span>
          <kbd className="kbd-quiet flex-shrink-0">{keys("quickOpen")}</kbd>
        </button>

        <div className="flex items-center justify-end gap-2">
          {projectPath && (
            <>
              <MainFileSwitcher
                mainFile={mainFile}
                texFiles={texFiles}
                disabled={latexSettings.isDetecting || latexCompiler.isCompiling}
                onSelect={latexSettings.setMainFile}
              />
              <Tooltip label={t("workbench.commands.compile")} keys={keys("compile")}>
                <button
                  type="button"
                  onClick={() => void compileProject()}
                  data-tour="compile"
                  disabled={latexSettings.isDetecting || latexCompiler.isCompiling}
                  className="btn btn-sm btn-primary flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
                >
                  {latexCompiler.isCompiling ? (
                    <CircleNotchIcon className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <PlayIcon weight="fill" className="size-3.5" aria-hidden="true" />
                  )}
                  {t(latexCompiler.isCompiling ? "workbench.compiling" : "workbench.compile")}
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </header>

      <main data-workspace-shell className="relative flex min-h-0 flex-1 overflow-hidden">
        <ActivityRail
          view={showSidebar ? sidebarTab : null}
          onSelect={(view) =>
            showSidebar && view === sidebarTab ? setShowSidebar(false) : showSidebarTab(view)
          }
          keys={{ search: keys("search"), library: keys("library"), git: keys("git") }}
          gitChanges={daemon.gitStatus?.changes.length ?? 0}
          graph={{ active: showGraph, onToggle: () => setShowGraph((shown) => !shown) }}
          terminal={{
            active: showTerminal,
            keys: keys("terminal"),
            onToggle: () => setShowTerminal((shown) => !shown),
          }}
          agent={{
            active: showAgent,
            keys: keys("agent"),
            onToggle: () => setShowAgent((shown) => !shown),
          }}
          settings={{
            active: Boolean(settingsTab),
            keys: keys("settings"),
            onToggle: () => setSettingsTab("general"),
          }}
          reducedMotion={Boolean(prefersReducedMotion)}
        />
        <AnimatePresence mode="wait">
          {showSidebar && (
            <motion.div
              key="sidebar"
              initial={prefersReducedMotion ? { opacity: 1 } : { x: -12, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { x: -12, opacity: 0 }}
              transition={panelTransition}
              className="flex flex-shrink-0"
            >
              <aside
                style={{
                  width:
                    resize.resizing === "sidebar" ? "var(--sidebar-width)" : resize.sidebarWidth,
                }}
                className="flex flex-shrink-0 flex-col overflow-hidden border-r border-border"
              >
                {sidebarTab === "files" && (
                  <FileSidebarPanel
                    projectPath={projectPath}
                    files={daemon.files}
                    selectedFile={selectedFile}
                    openFiles={openTabs}
                    highlightedFile={null}
                    onFileSelect={(path) => void openFile(path)}
                    onCreateFile={() => setCreateDialog("file")}
                    onCreateDirectory={() => setCreateDialog("directory")}
                    onRefreshFiles={daemon.refreshFiles}
                    fileOperations={{
                      createFile: daemon.createFile,
                      createDirectory: daemon.createDirectory,
                      renamePath: daemon.renamePath,
                      deletePath: daemon.deletePath,
                    }}
                    contextMenuItems={(node) =>
                      node.type === "file" &&
                      /\.pdf$/i.test(node.name) &&
                      !library.library.items.some((item) => item.file === node.path)
                        ? [
                            {
                              label: t("library.addToLibrary"),
                              icon: <BooksIcon size={16} />,
                              onClick: () => {
                                showSidebarTab("library");
                                void library.identify([node.path]);
                              },
                            },
                          ]
                        : []
                    }
                  />
                )}
                {sidebarTab === "search" && (
                  <SearchPanel
                    projectPath={projectPath}
                    files={daemon.files}
                    readFile={daemon.readFile}
                    buffers={bufferMap}
                    onOpenResult={(path, line) => void openAtLine(path, line)}
                  />
                )}
                {sidebarTab === "outline" && (
                  <OutlinePanel
                    filePath={activeDocument?.path}
                    content={activeDocument?.content ?? ""}
                    language={activeDocument ? fileLanguage(activeDocument.path) : ""}
                    onGoToLine={(line) =>
                      activeDocument && setGoTo({ path: activeDocument.path, line })
                    }
                  />
                )}
                {sidebarTab === "library" && (
                  <LibrarySidebarPanel
                    projectPath={projectPath}
                    library={library}
                    selectedFile={selectedFile}
                    onOpenFile={(path) => void openFile(path)}
                    onOpenBeside={(path) => void openFile(path, "beside")}
                    onEditEntry={editEntry}
                    onCite={cite}
                  />
                )}
                {/* Stays mounted so a commit in progress survives switching tabs. */}
                <div
                  className={
                    sidebarTab === "git" ? "flex flex-1 flex-col overflow-hidden" : "hidden"
                  }
                >
                  <GitSidebar
                    key={projectPath ?? ""}
                    daemon={daemon}
                    generateCommitMessage={agent.generateCommitMessage}
                    onPreviewDiff={editor.previewDiff}
                    onOpenFile={(path) => void openFile(path)}
                  />
                </div>
              </aside>
              <ResizeHandle panel="sidebar" resize={resize} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex w-0 min-w-0 flex-1 flex-col overflow-hidden">
          {reviewPending && (
            <div className="flex items-center justify-end border-b border-border px-3 py-1">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  agentReview.setOpen(true);
                  const first = agentReview.changes[0];
                  if (first) void openFile(first.path);
                }}
              >
                {t("workbench.reviewSuggestions", { count: agentReview.changes.length })}
              </button>
            </div>
          )}
          {projectPath && editorPanels.length > 0 ? (
            <div ref={workspace} className="relative min-h-0 flex-1">
              {dropHint && (
                <div
                  className={`pointer-events-none absolute inset-y-0 z-10 w-1/2 bg-accent/10 ${
                    dropHint === "left"
                      ? "left-0 border-r border-accent/40"
                      : "right-0 border-l border-accent/40"
                  }`}
                />
              )}
              <DockviewPanelLayout panels={editorPanels} className="dockview-editor-layout" />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              {projectPath ? (
                <StartPage
                  key={projectPath}
                  projectName={pathSync.basename(projectPath)}
                  references={library.library.items.length}
                  actions={startActions}
                  queue={readingQueue}
                  onOpenPaper={(paper) => paper.file && void openFile(paper.file)}
                />
              ) : (
                <div className="motion-rise flex flex-col items-center px-6 text-center">
                  <Logo size="large" className="mb-4 h-20 w-auto" />
                  <p className="font-reading mb-8 max-w-sm text-base leading-relaxed text-muted">
                    {t("workbench.welcome")}
                  </p>
                  <button
                    type="button"
                    data-tour="workspace"
                    onClick={() => void openFolder()}
                    className="btn btn-primary"
                  >
                    {t("workbench.project.openFolder")}
                  </button>
                  <RecentProjects
                    projects={recentProjects.projects}
                    onSelect={(path) => void changeWorkspace(path)}
                    onRemove={recentProjects.removeProject}
                    onClearAll={recentProjects.clearAll}
                  />
                </div>
              )}
            </div>
          )}

          {projectPath && compilers && !hasCompiler && !latexCompiler.isDetecting && (
            <div className="border-t border-border">
              <LaTeXInstallPrompt onRefreshCompilers={latexCompiler.detectCompilers} />
            </div>
          )}
          <TerminalPanel
            projectPath={projectPath}
            open={showTerminal}
            shellMode={settings.terminalShellMode}
            customShell={settings.terminalShellPath}
            fontFamily={settings.terminalFontFamily}
            fontSize={settings.terminalFontSize}
            lineHeight={settings.terminalLineHeight}
            prefersReducedMotion={Boolean(prefersReducedMotion)}
            onClose={() => setShowTerminal(false)}
          />
        </div>

        <AnimatePresence>
          {showAgent && (
            <motion.div
              key="agent"
              initial={{ opacity: prefersReducedMotion ? 1 : 0, width: 0 }}
              animate={{
                opacity: 1,
                width:
                  resize.resizing === "right"
                    ? "calc(var(--right-panel-width) + 4px)"
                    : resize.rightPanelWidth + 4,
              }}
              exit={{ opacity: 0, width: 0 }}
              transition={panelTransition}
              className="flex flex-shrink-0 overflow-hidden bg-background"
            >
              <ResizeHandle panel="right" resize={resize} />
              <aside
                style={{
                  width:
                    resize.resizing === "right"
                      ? "var(--right-panel-width)"
                      : resize.rightPanelWidth,
                }}
                className="flex flex-shrink-0 flex-col overflow-hidden border-l border-border"
              >
                {agentSelection.ready && agentSelection.selected !== "builtin" ? (
                  <ExternalAgentPanel
                    selections={selections}
                    onRemoveSelection={removeSelection}
                    onRevealSelection={revealSelection}
                    agent={externalAgent}
                    selected={agentSelection.selected}
                    directory={projectPath ?? undefined}
                    files={daemon.files}
                    papers={library.library.items}
                    skills={academicAgent.catalog.filter((skill) =>
                      academicAgent.config.skillIds.includes(skill.id),
                    )}
                    enabledSkillIds={academicAgent.config.skillIds}
                  />
                ) : (
                  <AcademicAgentPanel
                    key={projectPath ?? "no-project"}
                    selections={selections}
                    onRemoveSelection={removeSelection}
                    onRevealSelection={revealSelection}
                    agent={academicAgent}
                    files={daemon.files}
                    papers={library.library.items}
                    onOpenSettings={() => setSettingsTab("agent")}
                  />
                )}
              </aside>
            </motion.div>
          )}
        </AnimatePresence>

        {droppingPdfs && (
          <div className="motion-fade pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border border-dashed border-accent bg-background/80 text-sm text-foreground">
            {t("workbench.dropPdfs")}
          </div>
        )}
      </main>

      <StatusBar
        git={
          daemon.gitStatus?.isRepo
            ? {
                branch: daemon.gitStatus.branch,
                ahead: daemon.gitStatus.ahead,
                behind: daemon.gitStatus.behind,
                changes: daemon.gitStatus.changes.length,
              }
            : null
        }
        backup={
          settings.gitAutoBackupEnabled
            ? { running: backup.running, lastBackupAt: backup.lastBackupAt }
            : null
        }
        compile={compileState}
        document={activeDocument && documentStats ? documentStats : null}
        unsaved={editor.unsaved}
        onOpenGit={() => showSidebarTab("git")}
        onOpenOutline={() => showSidebarTab("outline")}
        onOpenCitations={() =>
          activeDocument && documentStats?.firstMissing
            ? setGoTo({ path: activeDocument.path, line: documentStats.firstMissing })
            : showSidebarTab("library")
        }
        onCompile={() => void compileProject()}
      />

      {palette && (
        <CommandPalette
          key={palette}
          mode={palette}
          files={paletteFiles}
          papers={library.library.items}
          headings={headings}
          commands={commands}
          onOpenFile={(path, beside) => void openFile(path, beside ? "beside" : "primary")}
          onOpenPaper={(paper, beside) => {
            const item = library.library.items.find((candidate) => candidate.key === paper.key);
            if (item?.file) void openFile(item.file, beside ? "beside" : "primary");
            else if (item) editEntry(item);
          }}
          onCite={(paper) => {
            const item = library.library.items.find((candidate) => candidate.key === paper.key);
            if (item) cite(item);
          }}
          onGoToHeading={(line) => activeDocument && setGoTo({ path: activeDocument.path, line })}
          onClose={() => setPalette(null)}
        />
      )}

      {showGraph && projectPath && (
        <MarkdownGraphModal
          key={projectPath}
          graph={markdownGraph.graph}
          activePath={selectedFile}
          isLoading={markdownGraph.isLoading}
          errors={markdownGraph.errors}
          onRefresh={markdownGraph.refresh}
          onClose={() => setShowGraph(false)}
          onOpenFile={openMarkdownFile}
        />
      )}

      {createDialog && (
        <InputDialog
          title={t(
            createDialog === "directory"
              ? "files.newFolder"
              : createDialog === "drawing"
                ? "files.newDrawing"
                : createDialog === "mindmap"
                  ? "files.newMindmap"
                  : "files.newFile",
          )}
          defaultValue={
            createDialog === "drawing"
              ? "drawing.excalidraw"
              : createDialog === "mindmap"
                ? "research.mindmap.md"
                : ""
          }
          placeholder={createDialog === "directory" ? t("files.folderName") : "file.tex"}
          validator={(name) =>
            !name.trim() || /[\\/]/.test(name) || name.startsWith(".")
              ? t("files.invalidName")
              : null
          }
          onCancel={() => setCreateDialog(null)}
          onConfirm={(name) => {
            const suffix =
              createDialog === "drawing"
                ? ".excalidraw"
                : createDialog === "mindmap"
                  ? ".mindmap.md"
                  : "";
            const path = suffix && !name.toLowerCase().endsWith(suffix) ? `${name}${suffix}` : name;
            void (
              createDialog === "directory" ? daemon.createDirectory(path) : daemon.createFile(path)
            )
              .then(() => {
                if (createDialog !== "directory") void openFile(path);
                setCreateDialog(null);
              })
              .catch((error: unknown) =>
                toast(t("files.failedToCreate", { error: String(error) }), "error"),
              );
          }}
        />
      )}

      {settingsOpen && (
        <SettingsPage
          cloudBackup={cloudBackup}
          gitSync={{
            projectPath,
            status: daemon.gitStatus,
            isRefreshing: daemon.isRefreshingGit,
            error: daemon.gitRemoteError,
            isPulling: daemon.isPulling,
            isPushing: daemon.isPushing,
            onRefresh: () => daemon.refreshGitStatus(true),
            onPull: daemon.gitPull,
            onBackupNow: backup.backupNow,
            lastBackupAt: backup.lastBackupAt,
            isBackingUp: backup.running,
          }}
          initialTab={settingsTab ?? "general"}
          quickStart={
            touring && quickStart.step >= 4
              ? {
                  step: quickStart.step,
                  saveError: quickStart.saveError,
                  onNext: quickStart.next,
                  onBack: quickStart.back,
                  onClose: () => {
                    quickStart.close();
                    setSettingsTab("general");
                  },
                }
              : undefined
          }
          onOpenTerminal={() => {
            quickStart.close();
            setSettingsTab(null);
            setShowTerminal(true);
          }}
          onClose={() => setSettingsTab(null)}
          academicAgent={academicAgent}
          agentSelection={agentSelection}
          externalAgent={externalAgent}
          editorSettings={settings}
          onUpdateEditorSettings={editorSettings.updateSettings}
          onOpenQuickStart={() => {
            setSettingsTab(null);
            quickStart.open();
          }}
        />
      )}

      {touring && quickStart.step < 4 && (
        <QuickStart
          step={quickStart.step}
          workspaceReady={workspaceReady}
          workspaceError={
            daemon.lastError?.operation === "open project" ? daemon.lastError.message : undefined
          }
          saveError={quickStart.saveError}
          onOpenFolder={openFolder}
          onNext={quickStart.next}
          onBack={quickStart.back}
        />
      )}

      {mainFileChoice && (
        <MainFileSelectionDialog
          open
          detectionResult={mainFileChoice}
          onSelect={(mainFile) => {
            latexSettings.setMainFile(mainFile);
            setMainFileChoice(null);
            void compile(mainFile);
          }}
          onCancel={() => setMainFileChoice(null)}
        />
      )}

      <SynctexInstallDialog
        open={Boolean(synctexRetry?.install)}
        onClose={() => setSynctexRetry(null)}
        onInstallComplete={() => {
          const retry = synctexRetry;
          setSynctexRetry(null);
          // Give PATH a moment to refresh after installation.
          if (retry)
            setTimeout(() => void jumpToSource(retry.pdf, retry.page, retry.x, retry.y), 500);
        }}
      />
    </div>
  );
}
