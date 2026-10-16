import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { MARKDOWN_SNIPPETS } from "../lib/markdown";

const registered = new WeakSet<Monaco>();

export function registerMarkdownLanguage(monaco: Monaco) {
  if (registered.has(monaco)) return;
  registered.add(monaco);
  monaco.languages.registerCompletionItemProvider("markdown", {
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const word = model.getWordUntilPosition(position);
      return {
        suggestions: MARKDOWN_SNIPPETS.map((snippet) => ({
          label: snippet.prefix,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          },
        })),
      };
    },
  });
}
