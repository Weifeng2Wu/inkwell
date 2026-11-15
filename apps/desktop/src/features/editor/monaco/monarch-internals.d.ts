/**
 * Monaco's Monarch compiler and tokenizer ship without type declarations. The grammar
 * tests run the real tokenizer over sample manuscripts, so only what they use is typed.
 */
declare module "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js" {
  export function compile(
    languageId: string,
    language: import("monaco-editor").languages.IMonarchLanguage,
  ): unknown;
}

declare module "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js" {
  type LineState = { equals(other: LineState): boolean };
  export class MonarchTokenizer {
    constructor(
      languageService: unknown,
      themeService: unknown,
      languageId: string,
      lexer: unknown,
      configurationService: unknown,
    );
    getInitialState(): LineState;
    tokenize(
      line: string,
      hasEOL: boolean,
      state: LineState,
    ): { tokens: { offset: number; type: string }[]; endState: LineState };
  }
}
