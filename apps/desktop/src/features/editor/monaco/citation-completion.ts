import type { Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  type BibliographyEntry,
  citationContext,
  citedKeys,
  markdownCitationContext,
  searchBibliography,
} from "../lib/bibliography";

const bibliographies = new WeakMap<editor.ITextModel, readonly BibliographyEntry[]>();

export function bindBibliography(model: editor.ITextModel, entries: readonly BibliographyEntry[]) {
  bibliographies.set(model, entries);
  return () => {
    bibliographies.delete(model);
  };
}

type Context = NonNullable<ReturnType<typeof citationContext>>;

function describe(entry: BibliographyEntry) {
  return [entry.title, entry.author, entry.year, entry.source].filter(Boolean);
}

function completions(monaco: Monaco, context: (text: string, offset: number) => Context | null) {
  return (model: editor.ITextModel, position: { lineNumber: number; column: number }) => {
    const found = context(model.getValue(), model.getOffsetAt(position));
    if (!found) return { suggestions: [] };
    const start = model.getPositionAt(found.start);
    const end = model.getPositionAt(found.end);
    if (start.lineNumber !== position.lineNumber || end.lineNumber !== position.lineNumber)
      return { suggestions: [] };
    return {
      incomplete: true,
      suggestions: searchBibliography(
        bibliographies.get(model) ?? [],
        found.query,
        found.usedKeys,
      ).map((entry, index) => ({
        label: { label: entry.key, description: entry.title },
        kind: monaco.languages.CompletionItemKind.Reference,
        detail: describe(entry).join(" · "),
        documentation: describe(entry).join("\n"),
        insertText: entry.key,
        filterText: found.query || entry.key,
        sortText: String(index).padStart(8, "0"),
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
      })),
    };
  };
}

/** Shows the cited reference when hovering a citation key. */
function hover(language: string) {
  return {
    provideHover(model: editor.ITextModel, position: { lineNumber: number; column: number }) {
      const offset = model.getOffsetAt(position);
      const cited = citedKeys(model.getValue(), language).find(
        (candidate) => offset >= candidate.start && offset <= candidate.end,
      );
      const entry = bibliographies.get(model)?.find((candidate) => candidate.key === cited?.key);
      if (!cited || !entry) return null;
      const start = model.getPositionAt(cited.start);
      const end = model.getPositionAt(cited.end);
      const [title = entry.key, ...rest] = describe(entry);
      // Bibliography text is shown literally, never interpreted as Markdown.
      const literal = (text: string) => text.replace(/[\\`*_{}[\]<>()#+!|~-]/g, "\\$&");
      return {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        contents: [{ value: `**${literal(title)}**` }, { value: literal(rest.join(" · ")) }],
      };
    },
  };
}

export function registerCitationCompletion(monaco: Monaco) {
  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["{", ",", " "],
    provideCompletionItems: completions(monaco, citationContext),
  });
  monaco.languages.registerCompletionItemProvider("markdown", {
    triggerCharacters: ["@"],
    provideCompletionItems: completions(monaco, markdownCitationContext),
  });
  monaco.languages.registerHoverProvider("latex", hover("latex"));
  monaco.languages.registerHoverProvider("markdown", hover("markdown"));
}
