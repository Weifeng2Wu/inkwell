import type { Monaco } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import {
  type LatexLabel,
  latexLabels,
  latexReferenceAt,
  referenceContext,
} from "../lib/latex-labels";

type Position = { lineNumber: number; column: number };

function rangeOf(model: editor.ITextModel, start: number, end: number) {
  const from = model.getPositionAt(start);
  const to = model.getPositionAt(end);
  return {
    startLineNumber: from.lineNumber,
    startColumn: from.column,
    endLineNumber: to.lineNumber,
    endColumn: to.column,
  };
}

/** Label text is shown literally, never interpreted as Markdown. */
const literal = (text: string) => text.replace(/[\\`*_{}[\]<>()#+!|~-]/g, "\\$&");

/** The first label with this key; LaTeX itself warns about duplicates. */
function findLabel(model: editor.ITextModel, key: string): LatexLabel | undefined {
  return latexLabels(model.getValue()).find((label) => label.key === key);
}

/**
 * Cross-references within one file: `\ref{`, `\eqref{`, `\autoref{` and their relatives
 * complete the document's `\label`s, a hovered key shows the caption, heading or formula
 * it points at, and Ctrl/Cmd+click (or F12) jumps to the `\label`.
 */
export function registerLatexReferences(monaco: Monaco) {
  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["{", ","],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const text = model.getValue();
      const context = referenceContext(text, model.getOffsetAt(position));
      if (!context) return { suggestions: [] };
      const range = rangeOf(model, context.start, context.end);
      const seen = new Set<string>();
      const suggestions: languages.CompletionItem[] = [];
      for (const label of latexLabels(text)) {
        if (seen.has(label.key)) continue;
        seen.add(label.key);
        suggestions.push({
          label: { label: label.key, description: label.title },
          kind: monaco.languages.CompletionItemKind.Reference,
          detail: [label.scope, label.title].filter(Boolean).join(" · "),
          insertText: label.key,
          sortText: String(suggestions.length).padStart(6, "0"),
          range,
        });
      }
      return { suggestions };
    },
  });

  monaco.languages.registerHoverProvider("latex", {
    provideHover(model: editor.ITextModel, position: Position) {
      const reference = latexReferenceAt(model.getValue(), model.getOffsetAt(position));
      const label = reference && findLabel(model, reference.key);
      if (!reference || !label) return null;
      const source = model.getLineContent(label.line).trim();
      return {
        range: rangeOf(model, reference.start, reference.end),
        contents: [
          { value: label.title ? `**${literal(label.title)}**` : literal(source) },
          ...(label.scope ? [{ value: `\`${label.scope}\`` }] : []),
        ],
      };
    },
  });

  monaco.languages.registerDefinitionProvider("latex", {
    provideDefinition(model: editor.ITextModel, position: Position) {
      const reference = latexReferenceAt(model.getValue(), model.getOffsetAt(position));
      const label = reference && findLabel(model, reference.key);
      if (!reference || !label) return null;
      return [
        {
          uri: model.uri,
          range: rangeOf(model, label.start, label.end),
          originSelectionRange: rangeOf(model, reference.start, reference.end),
        },
      ];
    },
  });
}
