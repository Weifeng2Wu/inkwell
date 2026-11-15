"use client";

import type { Monaco } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import { CITATION_COMMANDS } from "../lib/bibliography";
import { bibtexConfiguration, bibtexLanguage } from "./bibtex-grammar";
import { registerCitationCompletion } from "./citation-completion";
import { registerDocumentSymbols } from "./document-symbols";
import { latexConfiguration, latexLanguage } from "./latex-grammar";
import { registerLatexReferences } from "./latex-references";

const registered = new WeakSet<Monaco>();

/** Commands offered after a backslash, as snippet bodies without the backslash. */
const COMMANDS = [
  // Document structure
  `documentclass{\${1:article}}`,
  `usepackage{\${1:package}}`,
  `begin{\${1:environment}}\n\t$0\n\\end{\${1:environment}}`,
  `part{\${1:title}}`,
  `chapter{\${1:title}}`,
  `section{\${1:title}}`,
  `subsection{\${1:title}}`,
  `subsubsection{\${1:title}}`,
  `paragraph{\${1:title}}`,
  `title{\${1:title}}`,
  `author{\${1:name}}`,
  `date{\${1:\\today}}`,
  "maketitle",
  "tableofcontents",
  // Text
  `textbf{\${1:text}}`,
  `textit{\${1:text}}`,
  `texttt{\${1:text}}`,
  `emph{\${1:text}}`,
  `underline{\${1:text}}`,
  `footnote{\${1:text}}`,
  `caption{\${1:text}}`,
  "item ",
  "newline",
  "newpage",
  `hspace{\${1:1cm}}`,
  `vspace{\${1:1cm}}`,
  // References
  `label{\${1:key}}`,
  "ref{$1}$0",
  "eqref{$1}$0",
  "autoref{$1}$0",
  ...["cite", "citep", "citet", "parencite", "textcite", "autocite"].map(
    (command) => `${command}{$1}$0`,
  ),
  // Files
  `input{\${1:file}}`,
  `include{\${1:file}}`,
  `includegraphics[width=\${1:\\linewidth}]{\${2:file}}`,
  `bibliography{\${1:references}}`,
  // Mathematics
  `frac{\${1:num}}{\${2:den}}`,
  `sqrt{\${1:x}}`,
  `sum_{\${1:i=1}}^{\${2:n}}`,
  `int_{\${1:a}}^{\${2:b}}`,
  `lim_{\${1:x \\to \\infty}}`,
];

/** Symbol commands, previewed by the character they print. */
const SYMBOLS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  omega: "ω",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  times: "×",
  cdot: "·",
  leq: "≤",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  in: "∈",
  to: "→",
};

const ENVIRONMENTS = [
  "document",
  "abstract",
  "figure",
  "table",
  "tabular",
  "equation",
  "align",
  "gather",
  "itemize",
  "enumerate",
  "description",
  "center",
  "quote",
  "verbatim",
  "minipage",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "cases",
  "theorem",
  "lemma",
  "proof",
  "definition",
];

/** A snippet body as the text it inserts: placeholders become their default words. */
function preview(snippet: string) {
  return `\\${snippet}`
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\d+/g, "")
    .replace(/\s*\n\s*/g, " … ")
    .trim();
}

/** Registers LaTeX and BibTeX: grammar, brackets, completions and cross-references. */
export const registerLaTeXLanguage = (monaco: Monaco) => {
  if (registered.has(monaco)) return;
  registered.add(monaco);
  registerCitationCompletion(monaco);
  registerDocumentSymbols(monaco);

  monaco.languages.register({ id: "latex", extensions: [".tex", ".sty", ".cls"] });
  monaco.languages.setLanguageConfiguration("latex", latexConfiguration);
  monaco.languages.setMonarchTokensProvider("latex", latexLanguage);

  monaco.languages.register({ id: "bibtex", extensions: [".bib"], aliases: ["BibTeX"] });
  monaco.languages.setLanguageConfiguration("bibtex", bibtexConfiguration);
  monaco.languages.setMonarchTokensProvider("bibtex", bibtexLanguage);

  monaco.languages.registerCompletionItemProvider("latex", {
    triggerCharacters: ["\\", "{"],
    provideCompletionItems: (
      model: editor.ITextModel,
      position: { lineNumber: number; column: number },
    ) => {
      const word = model.getWordUntilPosition(position);
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const suggestions: languages.CompletionItem[] = [];
      const snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

      if (/\\[a-zA-Z]*$/.test(before)) {
        for (const insertText of COMMANDS) {
          const label = /^[a-zA-Z]+/.exec(insertText)?.[0] ?? insertText;
          suggestions.push({
            label,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText,
            insertTextRules: snippet,
            detail: preview(insertText),
            ...(CITATION_COMMANDS.has(label) || /^(?:eq|auto)?ref$/.test(label)
              ? { command: { id: "editor.action.triggerSuggest", title: "" } }
              : {}),
            range,
          });
        }
        for (const [label, symbol] of Object.entries(SYMBOLS))
          suggestions.push({
            label,
            kind: monaco.languages.CompletionItemKind.Constant,
            insertText: label,
            detail: symbol,
            range,
          });
      }

      if (/\\begin\{[a-zA-Z*]*$/.test(before)) {
        // Typing `{` closes the brace automatically; the snippet brings its own.
        const closed = line[range.endColumn - 1] === "}";
        for (const name of ENVIRONMENTS)
          suggestions.push({
            label: name,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: `${name}}\n\t$0\n\\\\end{${name}}`,
            insertTextRules: snippet,
            range: closed ? { ...range, endColumn: range.endColumn + 1 } : range,
          });
      }

      return { suggestions };
    },
  });

  registerLatexReferences(monaco);
};
