"use client";

import "@/features/editor/monaco/config";

import Editor, { type Monaco, type OnChange, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { registerLaTeXLanguage } from "@/features/editor/monaco/latex";
import { defineEditorThemes } from "@/features/editor/monaco/themes";
import { useI18n } from "@/features/i18n";
import {
  type EditorSettings,
  type EditorTheme,
  resolveEditorFontFamily,
  useKeyboardShortcuts,
} from "@/features/settings";
import type { EditorSelection } from "@/types/editor-selection";
import type { BibliographyEntry } from "../lib/bibliography";
import { bindBibliography } from "../monaco/citation-completion";
import { registerMarkdownLanguage } from "../monaco/markdown";
import { monacoShortcut } from "../monaco/shortcut-keybinding";

type Props = {
  content?: string;
  readOnly?: boolean;
  className?: string;
  language?: string;
  editorSettings?: Partial<EditorSettings>;
  editorTheme?: EditorTheme;
  onContentChange?: (content: string) => void;
  goToLine?: number;
  goToSelection?: EditorSelection & { requestId: string };
  bibliography?: readonly BibliographyEntry[];
  onAddSelection?: (selection: EditorSelection) => void;
};

type VimModeController = {
  dispose: () => void;
};

const EMPTY_BIBLIOGRAPHY: readonly BibliographyEntry[] = [];

function detectLanguage(lang: string): string {
  const languageMap: Record<string, string> = {
    tex: "latex",
    latex: "latex",
    bib: "bibtex",
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    py: "python",
    md: "markdown",
    markdown: "markdown",
    mdown: "markdown",
    json: "json",
    css: "css",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
  };
  return languageMap[lang.toLowerCase()] || lang;
}

export const MonacoEditor = memo(function MonacoEditor({
  content = "",
  readOnly = false,
  className = "",
  language = "latex",
  editorSettings,
  editorTheme = "one-light",
  onContentChange,
  goToLine,
  goToSelection,
  bibliography = EMPTY_BIBLIOGRAPHY,
  onAddSelection,
}: Props) {
  const { t } = useI18n();
  const { bindings: keyboardShortcuts } = useKeyboardShortcuts();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const isExternalUpdateRef = useRef(false);
  const contentRef = useRef(content);
  const vimModeRef = useRef<VimModeController | null>(null);
  const vimStatusRef = useRef<HTMLDivElement | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionButtonRef = useRef<HTMLButtonElement>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{ left: number; top: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    const button = selectionButtonRef.current;
    if (!selectionAnchor || !container || !button) return;
    const bounds = container.getBoundingClientRect();
    const size = button.getBoundingClientRect();
    const left = Math.max(8, Math.min(selectionAnchor.left + 12, bounds.width - size.width - 8));
    const below = selectionAnchor.top + 12;
    const top =
      below + size.height <= bounds.height - 8 ? below : selectionAnchor.top - size.height - 12;
    button.style.left = `${left}px`;
    button.style.top = `${Math.max(8, Math.min(top, bounds.height - size.height - 8))}px`;
  }, [selectionAnchor]);

  const addSelection = useCallback(() => {
    const instance = editorRef.current;
    const range = instance?.getSelection();
    const model = instance?.getModel();
    if (!range || !model || range.isEmpty()) return;
    const text = model.getValueInRange(range);
    if (!text.trim()) return;
    onAddSelection?.({
      text,
      startLineNumber: range.startLineNumber,
      startColumn: range.startColumn,
      endLineNumber: range.endLineNumber,
      endColumn: range.endColumn,
    });
    setSelectionAnchor(null);
  }, [onAddSelection]);

  useEffect(() => {
    const instance = editorRef.current;
    if (!editorReady || !instance || !onAddSelection) return;
    let selecting = false;
    const update = (pointer?: MouseEvent) => {
      const range = instance.getSelection();
      const container = containerRef.current;
      if (
        selecting ||
        !range ||
        !instance.getModel()?.getValueInRange(range).trim() ||
        !container
      ) {
        setSelectionAnchor(null);
        return;
      }
      const bounds = container.getBoundingClientRect();
      if (
        pointer &&
        pointer.clientX >= bounds.left &&
        pointer.clientX <= bounds.right &&
        pointer.clientY >= bounds.top &&
        pointer.clientY <= bounds.bottom
      ) {
        setSelectionAnchor({
          left: pointer.clientX - bounds.left,
          top: pointer.clientY - bounds.top,
        });
        return;
      }
      const position = instance.getScrolledVisiblePosition(range.getPosition());
      if (
        !position ||
        position.top < 0 ||
        position.top + position.height > bounds.height ||
        position.left < 0 ||
        position.left > bounds.width
      ) {
        setSelectionAnchor(null);
        return;
      }
      setSelectionAnchor({ left: position.left, top: position.top + position.height });
    };
    const listener = instance.onDidChangeCursorSelection(() => update());
    const mouseDown = instance.onMouseDown((event) => {
      if (!event.event.leftButton) return;
      selecting = true;
      setSelectionAnchor(null);
    });
    const mouseUp = (event: MouseEvent) => {
      if (!selecting || event.button !== 0) return;
      selecting = false;
      update(event);
    };
    window.addEventListener("mouseup", mouseUp);
    const scroll = instance.onDidScrollChange(() => setSelectionAnchor(null));
    const layout = instance.onDidLayoutChange(() => setSelectionAnchor(null));
    const keyDown = instance.onKeyDown((event) => {
      if (event.browserEvent.key === "Escape") setSelectionAnchor(null);
    });
    const action = instance.addAction({
      id: "add-selection-to-agent",
      label: t("interface.addSelection"),
      precondition: "editorHasSelection",
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1.5,
      run: addSelection,
    });
    return () => {
      listener.dispose();
      mouseDown.dispose();
      window.removeEventListener("mouseup", mouseUp);
      scroll.dispose();
      layout.dispose();
      keyDown.dispose();
      action.dispose();
    };
  }, [editorReady, onAddSelection, addSelection, t]);

  useEffect(() => {
    const instance = editorRef.current;
    const model = instance?.getModel();
    if (!editorReady || !goToSelection || !instance || !model) return;
    let range = model.validateRange(goToSelection);
    if (model.getValueInRange(range) !== goToSelection.text) {
      const matches = model.findMatches(goToSelection.text, false, false, true, null, false);
      const nearest = matches.sort(
        (first, second) =>
          Math.abs(first.range.startLineNumber - goToSelection.startLineNumber) -
          Math.abs(second.range.startLineNumber - goToSelection.startLineNumber),
      )[0];
      if (nearest) range = nearest.range;
    }
    instance.setSelection(range);
    instance.revealRangeInCenter(range);
    instance.focus();
    setSelectionAnchor(null);
  }, [editorReady, goToSelection]);
  const loadingRows = [70, 45, 60, 80, 35, 55, 40, 65].map((width) => ({
    id: `monaco-loading-${width}`,
    width,
  }));

  const pendingGoToLineRef = useRef<number>(0);

  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorReady || !instance || !monaco) return;
    const actions = [
      { id: "bold" as const, before: "**", after: "**" },
      { id: "italic" as const, before: "*", after: "*" },
      { id: "link" as const, before: "[", after: "](https://example.com)" },
    ].map(({ id, before, after }) =>
      instance.addAction({
        id: `markdown-${id}`,
        label: t(`markdown.${id}`),
        precondition: "editorLangId == markdown && !editorReadonly",
        keybindings: monacoShortcut(monaco, keyboardShortcuts[id]),
        run: (activeEditor) => {
          const selection = activeEditor.getSelection();
          const model = activeEditor.getModel();
          if (!selection || !model) return;
          const offset = model.getOffsetAt(selection.getStartPosition());
          const selected = model.getValueInRange(selection);
          activeEditor.pushUndoStop();
          activeEditor.executeEdits(`markdown-${id}`, [
            { range: selection, text: `${before}${selected}${after}` },
          ]);
          const start = model.getPositionAt(offset + before.length);
          const end = model.getPositionAt(offset + before.length + selected.length);
          activeEditor.setSelection(
            new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column),
          );
          activeEditor.pushUndoStop();
          activeEditor.focus();
        },
      }),
    );
    return () => {
      for (const action of actions) action.dispose();
    };
  }, [editorReady, t, keyboardShortcuts]);

  useEffect(() => {
    if (!editorReady) return;
    const model = editorRef.current?.getModel();
    if (model) return bindBibliography(model, bibliography);
  }, [bibliography, editorReady]);

  const handleEditorDidMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorReady(true);

    // Apply any pending goToLine that arrived before the editor was ready
    if (pendingGoToLineRef.current > 0) {
      const line = pendingGoToLineRef.current;
      pendingGoToLineRef.current = 0;
      setTimeout(() => {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
        const decorations = editor.deltaDecorations(
          [],
          [
            {
              range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
              options: {
                isWholeLine: true,
                className: "synctex-line-highlight",
                overviewRuler: { color: "rgba(255, 200, 0, 0.6)", position: 1 },
              },
            },
          ],
        );
        setTimeout(() => editor.deltaDecorations(decorations, []), 1500);
      }, 50);
    }

    defineEditorThemes(monaco);
    registerLaTeXLanguage(monaco);
    registerMarkdownLanguage(monaco);

    editor.focus();
  }, []);

  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorReady || !instance || !monaco) return;
    const action = instance.addAction({
      id: "toggle-latex-comment",
      label: t("shortcuts.actions.comment"),
      precondition: "editorLangId == latex && !editorReadonly",
      keybindings: monacoShortcut(monaco, keyboardShortcuts.comment),
      run: (ed) => {
        const selection = ed.getSelection();
        if (!selection) return;

        const model = ed.getModel();
        if (!model) return;

        const edits: editor.IIdentifiedSingleEditOperation[] = [];

        for (
          let lineNumber = selection.startLineNumber;
          lineNumber <= selection.endLineNumber;
          lineNumber++
        ) {
          const lineContent = model.getLineContent(lineNumber);
          const trimmedLine = lineContent.trimStart();
          const leadingSpaces = lineContent.length - trimmedLine.length;

          if (trimmedLine.startsWith("%")) {
            const commentLength = trimmedLine.startsWith("% ") ? 2 : 1;
            edits.push({
              range: {
                startLineNumber: lineNumber,
                startColumn: leadingSpaces + 1,
                endLineNumber: lineNumber,
                endColumn: leadingSpaces + 1 + commentLength,
              },
              text: "",
            });
          } else {
            edits.push({
              range: {
                startLineNumber: lineNumber,
                startColumn: leadingSpaces + 1,
                endLineNumber: lineNumber,
                endColumn: leadingSpaces + 1,
              },
              text: "% ",
            });
          }
        }

        ed.executeEdits("toggle-comment", edits);
      },
    });
    return () => action.dispose();
  }, [editorReady, keyboardShortcuts.comment, t]);

  const handleChange: OnChange = useCallback(
    (value) => {
      if (isExternalUpdateRef.current) return;
      if (value !== undefined) {
        contentRef.current = value;
        onContentChange?.(value);
      }
    },
    [onContentChange],
  );

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineEditorThemes(monaco);
    registerLaTeXLanguage(monaco);
  }, []);

  useEffect(() => {
    const update = () => {
      if (monacoRef.current && editorTheme) {
        defineEditorThemes(monacoRef.current);
        monacoRef.current.editor.setTheme(editorTheme);
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [editorTheme]);

  useEffect(() => {
    if (!goToLine || goToLine <= 0) return;

    const ed = editorRef.current;
    if (!ed) {
      // Editor not ready yet — store for when it mounts
      pendingGoToLineRef.current = goToLine;
      return;
    }

    ed.revealLineInCenter(goToLine);
    ed.setPosition({ lineNumber: goToLine, column: 1 });
    ed.focus();

    // Briefly highlight the line
    const decorations = ed.deltaDecorations(
      [],
      [
        {
          range: {
            startLineNumber: goToLine,
            startColumn: 1,
            endLineNumber: goToLine,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className: "synctex-line-highlight",
            overviewRuler: {
              color: "rgba(255, 200, 0, 0.6)",
              position: 1,
            },
          },
        },
      ],
    );

    const timer = setTimeout(() => {
      ed.deltaDecorations(decorations, []);
    }, 1500);

    return () => clearTimeout(timer);
  }, [goToLine]);

  useEffect(() => {
    const statusNode = vimStatusRef.current;
    if (!editorReady || !editorRef.current || !statusNode) return;

    vimModeRef.current?.dispose();
    vimModeRef.current = null;
    statusNode.textContent = "";

    const shouldEnableVim = !!editorSettings?.vimMode && !readOnly;
    if (!shouldEnableVim) return;

    let cancelled = false;

    (async () => {
      try {
        const monacoVim = await import("monaco-vim");
        if (cancelled || !editorRef.current) return;

        vimModeRef.current?.dispose();
        vimModeRef.current = monacoVim.initVimMode(editorRef.current, statusNode);
        editorRef.current.focus();
      } catch (error) {
        console.error("Failed to enable Vim mode:", error);
      }
    })();

    return () => {
      cancelled = true;
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
      statusNode.textContent = "";
    };
  }, [editorReady, editorSettings?.vimMode, readOnly]);

  useEffect(() => {
    return () => {
      vimModeRef.current?.dispose();
      vimModeRef.current = null;
    };
  }, []);

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className}`}>
      {onAddSelection && selectionAnchor && (
        <button
          ref={selectionButtonRef}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addSelection}
          className="absolute z-20 max-w-[calc(100%-16px)] rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-sm hover:bg-surface"
        >
          {t("interface.addSelection")}
        </button>
      )}
      {editorSettings?.vimMode && !readOnly && (
        <div
          ref={vimStatusRef}
          className="pointer-events-none absolute right-3 top-3 z-10 border border-border bg-background px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider"
        />
      )}
      <Editor
        height="100%"
        language={detectLanguage(language)}
        value={content}
        theme={editorTheme}
        beforeMount={handleBeforeMount}
        onMount={handleEditorDidMount}
        onChange={handleChange}
        options={{
          readOnly,
          fontSize: editorSettings?.fontSize ?? 14,
          fontFamily: resolveEditorFontFamily(editorSettings, detectLanguage(language)),
          fontLigatures: false,
          lineNumbers: editorSettings?.lineNumbers ?? "on",
          lineHeight: editorSettings?.lineHeight ?? 1.6,
          letterSpacing: 0,
          renderWhitespace: editorSettings?.renderWhitespace ?? "selection",
          tabSize: editorSettings?.tabSize ?? 2,
          insertSpaces: editorSettings?.insertSpaces ?? true,
          wordWrap: editorSettings?.wordWrap ?? "on",
          wordWrapColumn: editorSettings?.wordWrapColumn ?? 80,
          wrappingIndent: "indent",
          automaticLayout: true,
          minimap: {
            enabled: editorSettings?.minimap?.enabled ?? false,
            side: editorSettings?.minimap?.side ?? "right",
            size: editorSettings?.minimap?.size ?? "proportional",
            maxColumn: 120,
            renderCharacters: editorSettings?.minimap?.renderCharacters ?? false,
            scale: editorSettings?.minimap?.scale ?? 1,
            showSlider: editorSettings?.minimap?.showSlider ?? "mouseover",
          },
          scrollBeyondLastLine: false,
          smoothScrolling: editorSettings?.smoothScrolling ?? true,
          cursorBlinking: editorSettings?.cursorBlinking ?? "smooth",
          cursorSmoothCaretAnimation: "on",
          cursorStyle: editorSettings?.cursorStyle ?? "line",
          cursorWidth: 2,
          formatOnPaste: editorSettings?.formatOnPaste ?? false,
          formatOnType: editorSettings?.formatOnSave ?? false,
          autoClosingBrackets: editorSettings?.autoClosingBrackets ?? "languageDefined",
          autoClosingQuotes: editorSettings?.autoClosingQuotes ?? "languageDefined",
          renderLineHighlight: "line",
          renderLineHighlightOnlyWhenFocus: false,
          selectOnLineNumbers: true,
          folding: true,
          foldingStrategy: "auto",
          showFoldingControls: "mouseover",
          matchBrackets: "always",
          bracketPairColorization: {
            enabled: false,
          },
          guides: {
            bracketPairs: true,
            bracketPairsHorizontal: false,
            indentation: true,
            highlightActiveIndentation: true,
          },
          suggest: {
            snippetsPreventQuickSuggestions: false,
            showKeywords: true,
            showSnippets: true,
            showFunctions: true,
            showConstants: true,
            showVariables: true,
            filterGraceful: true,
            localityBonus: true,
          },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: true,
          },
          acceptSuggestionOnCommitCharacter: true,
          acceptSuggestionOnEnter: "on",
          snippetSuggestions: "inline",
          parameterHints: {
            enabled: true,
          },
          find: {
            addExtraSpaceOnTop: false,
            autoFindInSelection: "multiline",
            seedSearchStringFromSelection: "selection",
          },
          padding: {
            top: 16,
            bottom: 16,
          },
          scrollbar: {
            vertical: "visible",
            horizontal: "visible",
            useShadows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            arrowSize: 0,
          },
          overviewRulerBorder: false,
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          contextmenu: true,
          mouseWheelZoom: true,
          dragAndDrop: true,
          links: true,
          colorDecorators: false,
          accessibilitySupport: "auto",
        }}
        loading={
          <div className="flex flex-col h-full bg-background">
            <div className="flex-1 p-4 space-y-2">
              {loadingRows.map(({ id, width }) => (
                <div key={id} className="flex gap-4">
                  <div className="w-8 h-4 bg-surface-secondary animate-pulse" />
                  <div
                    className="flex-1 h-4 bg-surface-secondary animate-pulse"
                    style={{ width: `${width}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        }
      />
    </div>
  );
});
