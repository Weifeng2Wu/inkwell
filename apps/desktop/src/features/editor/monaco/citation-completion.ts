import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { type BibliographyEntry, citationContext, searchBibliography } from "../lib/bibliography";

const bibliographies = new WeakMap<editor.ITextModel, readonly BibliographyEntry[]>();

export function bindBibliography(model: editor.ITextModel, entries: readonly BibliographyEntry[]) {
  bibliographies.set(model, entries);
  return () => {
    bibliographies.delete(model);
  };
}

export function registerCitationCompletion(monaco: Monaco) {
  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["{", ",", " "],
    provideCompletionItems(
      model: editor.ITextModel,
      position: { lineNumber: number; column: number },
    ) {
      const context = citationContext(model.getValue(), model.getOffsetAt(position));
      if (!context) return { suggestions: [] };
      const start = model.getPositionAt(context.start);
      const end = model.getPositionAt(context.end);
      if (start.lineNumber !== position.lineNumber || end.lineNumber !== position.lineNumber)
        return { suggestions: [] };
      return {
        incomplete: true,
        suggestions: searchBibliography(
          bibliographies.get(model) ?? [],
          context.query,
          context.usedKeys,
        ).map((entry, index) => ({
          label: { label: entry.key, description: entry.title },
          kind: monaco.languages.CompletionItemKind.Reference,
          detail: [entry.title, entry.author, entry.year, entry.source].filter(Boolean).join(" · "),
          documentation: [entry.title, entry.author, entry.year, entry.source]
            .filter(Boolean)
            .join("\n"),
          insertText: entry.key,
          filterText: context.query || entry.key,
          sortText: String(index).padStart(8, "0"),
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          },
        })),
      };
    },
  });
}
