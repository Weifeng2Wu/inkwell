import type { Monaco } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import { documentOutline, type OutlineItem } from "@/features/navigator";

const registered = new WeakSet<Monaco>();
const LANGUAGES = ["latex", "markdown"] as const;

/**
 * Nests headings into a symbol tree. Each symbol's range runs to the line
 * before the next heading of the same or a higher level.
 */
export function outlineSymbols(
  items: readonly OutlineItem[],
  lineCount: number,
  lineMaxColumn: (line: number) => number,
  kind: languages.SymbolKind,
): languages.DocumentSymbol[] {
  const roots: languages.DocumentSymbol[] = [];
  const open: { level: number; symbol: languages.DocumentSymbol }[] = [];
  items.forEach((item, index) => {
    const next = items.slice(index + 1).find((other) => other.level <= item.level);
    const endLine = Math.max(item.line, Math.min(lineCount, next ? next.line - 1 : lineCount));
    const children: languages.DocumentSymbol[] = [];
    const symbol: languages.DocumentSymbol = {
      name: item.title || "…",
      detail: "",
      kind,
      tags: [],
      range: {
        startLineNumber: item.line,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn: lineMaxColumn(endLine),
      },
      selectionRange: {
        startLineNumber: item.line,
        startColumn: 1,
        endLineNumber: item.line,
        endColumn: lineMaxColumn(item.line),
      },
      children,
    };
    while ((open.at(-1)?.level ?? -1) >= item.level) open.pop();
    (open.at(-1)?.symbol.children ?? roots).push(symbol);
    open.push({ level: item.level, symbol });
  });
  return roots;
}

/** Powers Go to Symbol (Ctrl/Cmd+Shift+O), breadcrumbs and sticky scroll for manuscripts. */
export function registerDocumentSymbols(monaco: Monaco) {
  if (registered.has(monaco)) return;
  registered.add(monaco);
  for (const language of LANGUAGES) {
    monaco.languages.registerDocumentSymbolProvider(language, {
      displayName: "Inkwell",
      provideDocumentSymbols: (model: editor.ITextModel) =>
        outlineSymbols(
          documentOutline(model.getValue(), language),
          model.getLineCount(),
          (line) => model.getLineMaxColumn(line),
          monaco.languages.SymbolKind.String,
        ),
    });
  }
}
