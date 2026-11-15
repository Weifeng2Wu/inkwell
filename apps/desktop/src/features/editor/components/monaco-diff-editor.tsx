"use client";

import "@/features/editor/monaco/config";
import { DiffEditor, type DiffOnMount, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { memo, useCallback, useEffect, useRef } from "react";
import { type EditorSettings, resolveEditorFontFamily, useThemeMode } from "@/features/settings";
import { fileLanguage } from "@/lib/file-types";
import { mountReviewZones } from "../lib/review-zones";
import { registerLaTeXLanguage } from "../monaco/latex";
import { defineEditorThemes } from "../monaco/themes";
import { EditorSkeleton } from "./editor-skeleton";

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

  // Text and diff editors share one pair of themes; Monaco applies a theme to every editor.
  const diffTheme = themeMode === "dark" ? "one-dark" : "one-light";
  const detectedLanguage = language || (filePath ? fileLanguage(filePath) : "plaintext");
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
    defineEditorThemes(monaco);
    registerLaTeXLanguage(monaco);
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
        defineEditorThemes(monacoRef.current);
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
        loading={<EditorSkeleton className="h-full w-full" />}
      />
    </div>
  );
});
