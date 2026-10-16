import type { Monaco } from "@monaco-editor/react";
import type { CancellationToken, editor, languages, Position } from "monaco-editor";
import { describe, expect, it, vi } from "vitest";
import { parseBibliography } from "../lib/bibliography";
import { bindBibliography, registerCitationCompletion } from "./citation-completion";
import { registerLaTeXLanguage } from "./latex";

const entries = parseBibliography(
  "@article{alpha2024,title={Attention Is All You Need},author={Smith},year={2024}} @article{beta2025,title={Another Paper},author={Kim},year={2025}}",
  "refs.bib",
);

function modelFor(text: string) {
  return {
    getValue: () => text,
    getOffsetAt: (position: { column: number }) => position.column - 1,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    getWordUntilPosition: (position: { column: number }) => ({
      word: text.slice(1, position.column - 1),
      startColumn: 2,
      endColumn: position.column,
    }),
    getLineContent: () => text,
  } as unknown as editor.ITextModel;
}

function setup() {
  const providers: languages.CompletionItemProvider[] = [];
  const register = vi.fn((_language: string, provider: languages.CompletionItemProvider) =>
    providers.push(provider),
  );
  const monaco = {
    languages: {
      registerCompletionItemProvider: register,
      register: vi.fn(),
      setLanguageConfiguration: vi.fn(),
      setMonarchTokensProvider: vi.fn(),
      CompletionItemKind: { Reference: 17, Function: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    },
  } as unknown as Monaco;
  const token: CancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: vi.fn() }),
  };
  async function complete(
    provider: languages.CompletionItemProvider | undefined,
    model: editor.ITextModel,
    column: number,
  ) {
    if (!provider) throw new Error("Missing completion provider");
    const result = await provider.provideCompletionItems(
      model,
      { lineNumber: 1, column } as Position,
      { triggerKind: 0 },
      token,
    );
    return result?.suggestions ?? [];
  }
  return { monaco, providers, complete };
}

describe("citation completions", () => {
  it("shows all indexed references after an opening brace", async () => {
    const { monaco, providers, complete } = setup();
    registerCitationCompletion(monaco);
    const model = modelFor("\\cite{}");
    bindBibliography(model, entries);
    const suggestions = await complete(providers[0], model, 7);
    expect(suggestions.map((item) => item.insertText)).toEqual(["alpha2024", "beta2025"]);
    expect(suggestions[0]?.detail).toContain("Attention Is All You Need");
  });

  it("matches titles independently of keys and replaces the entire typed title", async () => {
    const { monaco, providers, complete } = setup();
    registerCitationCompletion(monaco);
    const text = "\\cite{All You}";
    const model = modelFor(text);
    bindBibliography(model, entries);
    const suggestions = await complete(providers[0], model, text.indexOf("}") + 1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.insertText).toBe("alpha2024");
    expect(suggestions[0]?.filterText).toBe("All You");
    expect(suggestions[0]?.range).toEqual({
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 7,
      endColumn: 14,
    });
  });

  it("isolates editor models and removes bindings when disposed", async () => {
    const { monaco, providers, complete } = setup();
    registerCitationCompletion(monaco);
    const first = modelFor("\\cite{}");
    const second = modelFor("\\cite{}");
    const dispose = bindBibliography(first, entries);
    expect(await complete(providers[0], second, 7)).toEqual([]);
    dispose();
    expect(await complete(providers[0], first, 7)).toEqual([]);
  });

  it("registers once and opens reference suggestions after accepting a cite snippet", async () => {
    const { monaco, providers, complete } = setup();
    registerLaTeXLanguage(monaco);
    registerLaTeXLanguage(monaco);
    expect(providers).toHaveLength(2);
    const suggestions = await complete(providers[1], modelFor("\\ci"), 4);
    const cite = suggestions.find((item) => item.label === "cite");
    expect(cite?.insertText).toBe("cite{$1}$0");
    expect(cite?.command?.id).toBe("editor.action.triggerSuggest");
    expect(suggestions.some((item) => item.label === "citet")).toBe(true);
  });
});
