"use client";

import "@/features/editor/monaco/config";
import { DiffEditor, type DiffOnMount, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { memo, useCallback, useEffect, useRef } from "react";
import { type EditorSettings, resolveEditorFontFamily, useThemeMode } from "@/features/settings";
import { mountReviewZones } from "../lib/review-zones";
import { editorChromeColors, editorDiffColors } from "../monaco/theme-chrome";

// Define diff themes for both light and dark
const defineDiffThemes = (monaco: Monaco) => {
  monaco.editor.defineTheme("diff-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "24292e", background: "ffffff" },
      { token: "comment", foreground: "6a737d", fontStyle: "italic" },
      { token: "keyword", foreground: "d73a49" },
      { token: "string", foreground: "032f62" },
      { token: "number", foreground: "005cc5" },
      { token: "variable", foreground: "e36209" },
      { token: "operator", foreground: "d73a49" },
      { token: "delimiter", foreground: "586069" },
      { token: "entity.name.function", foreground: "6f42c1" },
      { token: "entity.name.tag", foreground: "22863a" },
      { token: "constant", foreground: "005cc5" },
      { token: "support", foreground: "005cc5" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#24292e",
      "editorLineNumber.foreground": "#959da5",
      "editorLineNumber.activeForeground": "#24292e",
      "editor.selectionBackground": "#c8c8fa",
      "editor.lineHighlightBackground": "#fafbfc",
      "editorGutter.background": "#ffffff",
      "editorOverviewRuler.border": "#e1e4e8",
      "diffEditor.insertedTextBackground": "#bbf7d0",
      "diffEditor.removedTextBackground": "#fecaca",
      "diffEditor.insertedLineBackground": "#f0fdf4",
      "diffEditor.removedLineBackground": "#fef2f2",
      "diffEditorGutter.insertedLineBackground": "#dcfce7",
      "diffEditorGutter.removedLineBackground": "#fee2e2",
      "diffEditor.border": "#e5e5e5",
      "diffEditor.diagonalFill": "#f5f5f5",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#d4d4d4",
      "scrollbarSlider.hoverBackground": "#a3a3a3",
      ...editorChromeColors(),
      ...editorDiffColors(),
    },
  });

  monaco.editor.defineTheme("diff-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "c9d1d9", background: "24292e" },
      { token: "comment", foreground: "8b949e", fontStyle: "italic" },
      { token: "keyword", foreground: "f47067" },
      { token: "string", foreground: "79c0ff" },
      { token: "number", foreground: "a5d6ff" },
      { token: "variable", foreground: "f0883e" },
      { token: "operator", foreground: "f47067" },
      { token: "delimiter", foreground: "c9d1d9" },
      { token: "entity.name.function", foreground: "a371f7" },
      { token: "entity.name.tag", foreground: "56d364" },
      { token: "constant", foreground: "a5d6ff" },
      { token: "support", foreground: "a5d6ff" },
    ],
    colors: {
      "editor.background": "#24292e",
      "editor.foreground": "#c9d1d9",
      "editorLineNumber.foreground": "#636e7b",
      "editorLineNumber.activeForeground": "#d1d5da",
      "editor.selectionBackground": "#3b4048",
      "editor.lineHighlightBackground": "#2b3137",
      "editorGutter.background": "#24292e",
      "editorOverviewRuler.border": "#3b4048",
      "diffEditor.insertedTextBackground": "#56d36433",
      "diffEditor.removedTextBackground": "#f8514933",
      "diffEditor.insertedLineBackground": "#56d36418",
      "diffEditor.removedLineBackground": "#f8514918",
      "diffEditorGutter.insertedLineBackground": "#56d36425",
      "diffEditorGutter.removedLineBackground": "#f8514925",
      "diffEditor.border": "#3b4048",
      "diffEditor.diagonalFill": "#2b3137",
      "scrollbar.shadow": "#01040900",
      "scrollbarSlider.background": "#636e7b33",
      "scrollbarSlider.hoverBackground": "#636e7b55",
      ...editorChromeColors(),
      ...editorDiffColors(),
    },
  });
};

// Detect language from file path
const getLanguageFromPath = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    tex: "latex",
    bib: "bibtex",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    md: "markdown",
    json: "json",
    css: "css",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
  };
  return languageMap[ext] || "plaintext";
};

type Props = {
  original: string;
  modified: string;
  filePath?: string;
  language?: string;
  className?: string;
  editorSettings?: Partial<EditorSettings>;
  onChanges?: (changes: editor.ILineChange[]) => void;
  inlineReview?: {
    acceptLabel: string;
    rejectLabel: string;
    disabled: boolean;
    onDecide: (changes: editor.ILineChange[], index: number, accept: boolean) => void;
  };
};

export const MonacoDiffEditor = memo(function MonacoDiffEditor({
  original,
  modified,
  filePath,
  language,
  className = "",
  editorSettings,
  onChanges,
  inlineReview,
}: Props) {
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const isDisposingRef = useRef(false);
  const themeMode = useThemeMode();

  const diffTheme = themeMode === "dark" ? "diff-dark" : "diff-light";
  const detectedLanguage = language || (filePath ? getLanguageFromPath(filePath) : "plaintext");
  const onChangesRef = useRef(onChanges);
  onChangesRef.current = onChanges;
  const reviewRef = useRef(inlineReview);
  reviewRef.current = inlineReview;
  const updateReviewRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!inlineReview) return;
    updateReviewRef.current?.();
  }, [inlineReview]);

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    defineDiffThemes(monaco);
  }, []);

  const handleEditorDidMount: DiffOnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    isDisposingRef.current = false;
    const reviewZones = mountReviewZones(
      editor,
      () => reviewRef.current,
      (changes) => onChangesRef.current?.(changes),
    );
    updateReviewRef.current = reviewZones.update;
    editor.onDidDispose(() => {
      reviewZones.dispose();
      updateReviewRef.current = null;
    });
  }, []);

  // Reactively switch theme when app mode changes
  useEffect(() => {
    const update = () => {
      if (monacoRef.current) {
        defineDiffThemes(monacoRef.current);
        monacoRef.current.editor.setTheme(diffTheme);
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [diffTheme]);

  // Cleanup effect to properly dispose the editor before unmount
  useEffect(() => {
    return () => {
      if (editorRef.current && !isDisposingRef.current) {
        isDisposingRef.current = true;
        try {
          // Get the models before disposing
          const originalModel = editorRef.current.getModel()?.original;
          const modifiedModel = editorRef.current.getModel()?.modified;

          // Dispose the editor first (this should reset the widget)
          editorRef.current.dispose();

          // Then dispose the models if they exist and aren't already disposed
          try {
            if (originalModel && !originalModel.isDisposed()) {
              originalModel.dispose();
            }
          } catch {
            // Ignore errors during model disposal
          }
          try {
            if (modifiedModel && !modifiedModel.isDisposed()) {
              modifiedModel.dispose();
            }
          } catch {
            // Ignore errors during model disposal
          }
        } catch {
          // Silently ignore disposal errors
        }
        editorRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`flex flex-col ${inlineReview ? "agent-inline-review" : ""} ${className}`}>
      <DiffEditor
        height="100%"
        language={detectedLanguage}
        original={original}
        modified={modified}
        theme={diffTheme}
        beforeMount={handleBeforeMount}
        onMount={handleEditorDidMount}
        options={{
          readOnly: true,
          renderSideBySide: !inlineReview,
          experimental: { useTrueInlineView: false },
          renderMarginRevertIcon: !inlineReview,
          enableSplitViewResizing: true,
          ignoreTrimWhitespace: false,
          renderIndicators: true,
          originalEditable: false,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          diffWordWrap: "on",
          fontSize: editorSettings?.fontSize ?? 13,
          fontFamily: resolveEditorFontFamily(editorSettings, detectedLanguage),
          lineNumbers: "on",
          lineHeight: editorSettings?.lineHeight ?? 1.5,
          padding: { top: 12, bottom: 12 },
          scrollbar: {
            vertical: "visible",
            horizontal: "visible",
            useShadows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          renderLineHighlight: "none",
          folding: false,
          glyphMargin: false,
          contextmenu: false,
        }}
        loading={
          <div className="flex items-center justify-center h-full bg-background">
            <div className="text-sm text-muted-foreground">Loading diff...</div>
          </div>
        }
      />
    </div>
  );
});
