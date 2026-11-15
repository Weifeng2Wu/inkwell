import type { languages } from "monaco-editor";
import { compile } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js";
import { MonarchTokenizer } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js";

export type Span = { text: string; type: string };

/**
 * Runs Monaco's own Monarch tokenizer over a document and returns, per line, the text of
 * each token with its type (without the language postfix). Test helper.
 */
export function tokenizeDocument(language: languages.IMonarchLanguage, source: string): Span[][] {
  const postfix = language.tokenPostfix ?? "";
  const configuration = {
    getValue: () => 20000,
    onDidChangeConfiguration: () => ({ dispose() {} }),
  };
  const tokenizer = new MonarchTokenizer({}, {}, "test", compile("test", language), configuration);
  let state = tokenizer.getInitialState();
  return source.split("\n").map((line) => {
    const { tokens, endState } = tokenizer.tokenize(line, true, state);
    state = endState;
    return tokens
      .map((token, index) => ({
        text: line.slice(token.offset, tokens[index + 1]?.offset ?? line.length),
        type:
          postfix && token.type.endsWith(postfix)
            ? token.type.slice(0, -postfix.length)
            : token.type,
      }))
      .filter((span) => span.text.trim());
  });
}

/** Token type of the first token whose text is `text`, exactly or apart from spaces around it. */
export function typeOf(lines: Span[][], text: string): string | undefined {
  const spans = lines.flat();
  return (
    spans.find((span) => span.text === text) ?? spans.find((span) => span.text.trim() === text)
  )?.type;
}
