import type { Monaco } from "@monaco-editor/react";
import type { CancellationToken, editor, languages } from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { registerDocumentSymbols } from "./document-symbols";
import { registerLaTeXLanguage } from "./latex";

function modelFor(text: string) {
  const lines = text.split("\n");
  return {
    getValue: () => text,
    getLineCount: () => lines.length,
    getLineMaxColumn: (line: number) => (lines[line - 1] ?? "").length + 1,
  } as unknown as editor.ITextModel;
}

function setup() {
  const providers = new Map<string, languages.DocumentSymbolProvider>();
  const register = vi.fn((language: string, provider: languages.DocumentSymbolProvider) => {
    providers.set(language, provider);
  });
  const monaco = {
    languages: {
      registerDocumentSymbolProvider: register,
      registerCompletionItemProvider: vi.fn(),
      registerHoverProvider: vi.fn(),
      registerDefinitionProvider: vi.fn(),
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      SymbolKind: { String: 14 },
      CompletionItemKind: { Reference: 17, Function: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
  } as unknown as Monaco;
  const token: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: vi.fn() }),
  };
  async function symbols(language: string, text: string) {
    const provider = providers.get(language);
    if (!provider) throw new Error(`Missing symbol provider for ${language}`);
    return (await provider.provideDocumentSymbols(modelFor(text), token)) ?? [];
  }
  return { monaco, register, symbols };
}

type Shape = { name: string; lines: [number, number]; children: Shape[] };
const shape = (symbols: languages.DocumentSymbol[]): Shape[] =>
  symbols.map((symbol) => ({
    name: symbol.name,
    lines: [symbol.range.startLineNumber, symbol.range.endLineNumber],
    children: shape(symbol.children ?? []),
  }));

describe("document symbols", () => {
  it("registers LaTeX and Markdown providers once per Monaco instance", () => {
    const { monaco, register } = setup();
    registerDocumentSymbols(monaco);
    registerDocumentSymbols(monaco);
    expect(register.mock.calls.map(([language]) => language)).toEqual(["latex", "markdown"]);
    const other = setup();
    registerDocumentSymbols(other.monaco);
    expect(other.register).toHaveBeenCalledTimes(2);
  });

  it("is registered together with the LaTeX language", () => {
    const { monaco, register } = setup();
    registerLaTeXLanguage(monaco);
    registerLaTeXLanguage(monaco);
    registerDocumentSymbols(monaco);
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("nests LaTeX sections with ranges ending before the next peer", async () => {
    const { monaco, symbols } = setup();
    registerDocumentSymbols(monaco);
    const text = [
      "\\documentclass{article}", // 1
      "\\section{Intro}", // 2
      "text", // 3
      "\\subsection{Background}", // 4
      "text", // 5
      "\\subsubsection{Detail}", // 6
      "\\subsection{Scope}", // 7
      "\\section{Method}", // 8
      "\\paragraph{Note}", // 9
      "the end", // 10
    ].join("\n");
    const result = await symbols("latex", text);
    expect(shape(result)).toEqual([
      {
        name: "Intro",
        lines: [2, 7],
        children: [
          {
            name: "Background",
            lines: [4, 6],
            children: [{ name: "Detail", lines: [6, 6], children: [] }],
          },
          { name: "Scope", lines: [7, 7], children: [] },
        ],
      },
      {
        name: "Method",
        lines: [8, 10],
        children: [{ name: "Note", lines: [9, 10], children: [] }],
      },
    ]);
    const intro = result[0];
    expect(intro?.kind).toBe(14);
    expect(intro?.range).toEqual({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 7,
      endColumn: 19,
    });
    expect(intro?.selectionRange).toEqual({
      startLineNumber: 2,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 16,
    });
  });

  it("nests Markdown headings that skip levels or start deep", async () => {
    const { monaco, symbols } = setup();
    registerDocumentSymbols(monaco);
    const text = [
      "### Deep start",
      "# Top",
      "### Skipped",
      "## Middle",
      "```",
      "# code",
      "```",
    ].join("\n");
    expect(shape(await symbols("markdown", text))).toEqual([
      { name: "Deep start", lines: [1, 1], children: [] },
      {
        name: "Top",
        lines: [2, 7],
        children: [
          { name: "Skipped", lines: [3, 3], children: [] },
          { name: "Middle", lines: [4, 7], children: [] },
        ],
      },
    ]);
  });

  it("keeps every selection range inside its range and names empty titles", async () => {
    const { monaco, symbols } = setup();
    registerDocumentSymbols(monaco);
    expect(await symbols("latex", "no headings")).toEqual([]);
    const [symbol] = await symbols("latex", "\\section{}\n\\section{Next}");
    expect(symbol?.name).toBe("…");
    expect(symbol?.range.endLineNumber).toBe(1);
  });
});
