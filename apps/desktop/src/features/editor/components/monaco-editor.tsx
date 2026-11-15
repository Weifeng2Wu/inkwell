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
import { clearActiveEditor, reportCursor, setActiveEditor } from "../lib/active-editor";
import { type BibliographyEntry, missingCitations } from "../lib/bibliography";
import { unclosedEnvironment, wrapEdit } from "../lib/latex-editing";
import { bindBibliography } from "../monaco/citation-completion";
import { registerMarkdownLanguage } from "../monaco/markdown";
import { monacoShortcut } from "../monaco/shortcut-keybinding";
import { EditorSkeleton } from "./editor-skeleton";

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
// Not part of the typed editor options, hence the separate record.
const PLAIN_BRACKETS: Record<string, unknown> = { "bracketPairColorization.enabled": false };

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
  const pendingGoToLineRef = useRef<number>(0);

  // Bold and italic share one shortcut across Markdown and LaTeX; pressing it again on
  // text that already carries the markup removes it.
  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorReady || !instance || !monaco) return;
    const actions = (
      [
        { id: "bold", language: "markdown", before: "**", after: "**" },
        { id: "italic", language: "markdown", before: "*", after: "*" },
        { id: "link", language: "markdown", before: "[", after: "](https://example.com)" },
        { id: "bold", language: "latex", before: "\\textbf{", after: "}" },
        { id: "italic", language: "latex", before: "\\textit{", after: "}" },
      ] as const
    ).map(({ id, language, before, after }) =>
      instance.addAction({
        id: `${language}-${id}`,
        label: t(`markdown.${id}`),
        precondition: `editorLangId == ${language} && !editorReadonly`,
        keybindings: monacoShortcut(monaco, keyboardShortcuts[id]),
        run: (activeEditor) => {
          const selection = activeEditor.getSelection();
          const model = activeEditor.getModel();
          if (!selection || !model) return;
          const edit = wrapEdit(
            model.getValue(),
            model.getOffsetAt(selection.getStartPosition()),
            model.getOffsetAt(selection.getEndPosition()),
            before,
            after,
          );
          const from = model.getPositionAt(edit.start);
          const to = model.getPositionAt(edit.end);
          activeEditor.pushUndoStop();
          activeEditor.executeEdits(`${language}-${id}`, [
            {
              range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column),
              text: edit.replacement,
            },
          ]);
          const start = model.getPositionAt(edit.selectionStart);
          const end = model.getPositionAt(edit.selectionEnd);
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

  // Enter after `\begin{name}` adds the matching `\end{name}` and leaves the caret between.
  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!editorReady || !instance || !monaco) return;
    const opensEnvironment = instance.createContextKey<boolean>("inkwellOpensEnvironment", false);
    const lineAroundCaret = () => {
      const model = instance.getModel();
      const selection = instance.getSelection();
      if (!model || !selection?.isEmpty() || model.getLanguageId() !== "latex") return null;
      const line = model.getLineContent(selection.positionLineNumber);
      const before = line.slice(0, selection.positionColumn - 1);
      return line.slice(selection.positionColumn - 1).trim() ? null : { model, selection, before };
    };
    const update = () =>
      opensEnvironment.set(/\\begin\s*\{[^{}]+\}[^\\]*$/.test(lineAroundCaret()?.before ?? ""));
    const cursor = instance.onDidChangeCursorSelection(update);
    update();
    instance.addCommand(
      monaco.KeyCode.Enter,
      () => {
        const caret = lineAroundCaret();
        const name = caret && unclosedEnvironment(caret.model.getValue(), caret.before);
        if (!caret || !name) {
          instance.trigger("keyboard", "type", { text: "\n" });
          return;
        }
        const { model, selection } = caret;
        const indent = /^\s*/.exec(caret.before)?.[0] ?? "";
        const options = model.getOptions();
        const step = options.insertSpaces ? " ".repeat(options.indentSize) : "\t";
        const inner = name === "document" ? indent : indent + step;
        instance.pushUndoStop();
        instance.executeEdits(
          "close-environment",
          [
            {
              range: new monaco.Range(
                selection.positionLineNumber,
                selection.positionColumn,
                selection.positionLineNumber,
                model.getLineMaxColumn(selection.positionLineNumber),
              ),
              text: `\n${inner}\n${indent}\\end{${name}}`,
            },
          ],
          [
            new monaco.Selection(
              selection.positionLineNumber + 1,
              inner.length + 1,
              selection.positionLineNumber + 1,
              inner.length + 1,
            ),
          ],
        );
        instance.pushUndoStop();
      },
      "editorTextFocus && !editorReadonly && !editorHasMultipleSelections && inkwellOpensEnvironment && !suggestWidgetVisible && !inSnippetMode",
    );
    return () => {
      cursor.dispose();
      opensEnvironment.set(false);
    };
  }, [editorReady]);

  useEffect(() => {
    if (!editorReady) return;
    const model = editorRef.current?.getModel();
    if (model) return bindBibliography(model, bibliography);
  }, [bibliography, editorReady]);

  // Underline citations whose key is in no project bibliography.
  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!editorReady || !monaco || !model) return;
    const known = new Set(bibliography.map((entry) => entry.key));
    const update = () => {
      const missing = known.size
        ? missingCitations(model.getValue(), model.getLanguageId(), known)
        : [];
      monaco.editor.setModelMarkers(
        model,
        "citations",
        missing.map(({ key, start, end }) => {
          const from = model.getPositionAt(start);
          const to = model.getPositionAt(end);
          return {
            severity: monaco.MarkerSeverity.Warning,
            message: t("editor.unknownCitation", { key }),
            startLineNumber: from.lineNumber,
            startColumn: from.column,
            endLineNumber: to.lineNumber,
            endColumn: to.column,
          };
        }),
      );
    };
    let timer = setTimeout(update, 0);
    const subscription = model.onDidChangeContent(() => {
      clearTimeout(timer);
      timer = setTimeout(update, 400);
    });
    return () => {
      clearTimeout(timer);
      subscription.dispose();
      if (!model.isDisposed()) monaco.editor.setModelMarkers(model, "citations", []);
    };
  }, [bibliography, editorReady, t]);

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
              options: { isWholeLine: true, className: "synctex-line-highlight" },
            },
          ],
        );
        setTimeout(() => editor.deltaDecorations(decorations, []), 1500);
      }, 50);
    }

    defineEditorThemes(monaco);
    registerLaTeXLanguage(monaco);
    registerMarkdownLanguage(monaco);

    const activeEditor = {
      language: () => editor.getModel()?.getLanguageId() ?? "",
      insert: (text: string) => {
        const range = editor.getSelection();
        if (!range) return false;
        editor.focus();
        return editor.executeEdits("insert-text", [{ range, text, forceMoveMarkers: true }]);
      },
    };
    const reportCaret = () => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (!selection || !model) return;
      reportCursor(activeEditor, {
        line: selection.positionLineNumber,
        column: selection.positionColumn,
        selected: selection.isEmpty() ? 0 : model.getValueLengthInRange(selection),
      });
    };
    editor.onDidFocusEditorText(() => {
      setActiveEditor(activeEditor);
      reportCaret();
    });
    editor.onDidChangeCursorSelection(reportCaret);
    editor.onDidDispose(() => clearActiveEditor(activeEditor));

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
    registerMarkdownLanguage(monaco);
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
          options: { isWholeLine: true, className: "synctex-line-highlight" },
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

  const monacoLanguage = detectLanguage(language);
  const prose = ["latex", "markdown", "plaintext"].includes(monacoLanguage);

  return (
    <div ref={containerRef} className={`relative flex flex-col ${className}`}>
      {onAddSelection && selectionAnchor && (
        <button
          ref={selectionButtonRef}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={addSelection}
          className="motion-fade absolute z-20 max-w-[calc(100%-16px)] rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-lg transition-colors hover:bg-surface-secondary"
        >
          {t("interface.addSelection")}
        </button>
      )}
      {editorSettings?.vimMode && !readOnly && (
        <div
          ref={vimStatusRef}
          className="pointer-events-none absolute right-3 top-3 z-10 rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted empty:hidden"
        />
      )}
      <Editor
        height="100%"
        language={monacoLanguage}
        value={content}
        theme={editorTheme}
        beforeMount={handleBeforeMount}
        onMount={handleEditorDidMount}
        onChange={handleChange}
        options={{
          readOnly,
          fontSize: editorSettings?.fontSize ?? 14,
          fontFamily: resolveEditorFontFamily(editorSettings, monacoLanguage),
          fontLigatures: false,
          lineNumbers: editorSettings?.lineNumbers ?? "on",
          lineHeight: editorSettings?.lineHeight ?? 1.6,
          letterSpacing: 0,
          renderWhitespace: editorSettings?.renderWhitespace ?? "selection",
          tabSize: editorSettings?.tabSize ?? 2,
          insertSpaces: editorSettings?.insertSpaces ?? true,
          wordWrap: editorSettings?.wordWrap ?? "on",
          wordWrapColumn: editorSettings?.wordWrapColumn ?? 80,
          // A wrapped paragraph continues at its own margin; wrapped code is indented.
          wrappingIndent: prose ? "same" : "indent",
          // Prose would otherwise suggest every word already in the document.
          wordBasedSuggestions: prose ? "off" : "matchingDocuments",
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
          // The standalone editor reads this setting only under its dotted name; the nested
          // form is ignored and leaves every bracket coloured.
          ...PLAIN_BRACKETS,
          guides: {
            bracketPairs: false,
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
        loading={<EditorSkeleton className="h-full w-full" />}
      />
    </div>
  );
});
