import type { languages } from "monaco-editor";

/**
 * A new entry at the start of a line always starts over, so an unbalanced brace in one
 * entry cannot swallow the entries after it.
 */
const nextEntry: languages.IMonarchLanguageRule = [
  /^\s*@[a-z]+\s*[{(]/,
  { token: "@rematch", next: "@popall" },
];

/**
 * BibTeX tokens. Field values are the default token: a bibliography reads as a list of
 * titles and names, with entry types, keys and field names tinted around them.
 */
export const bibtexLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".bib",
  ignoreCase: true,

  tokenizer: {
    // BibTeX ignores everything between entries, so it is shown as a comment.
    root: [
      // `@@` is a literal at sign; a single one would name a lexer attribute.
      [/(@@comment)(\s*)(\{)/, ["comment", "comment", { token: "comment", next: "@comment" }]],
      [
        /(@(?:string|preamble))(\s*)([{(])/,
        ["keyword", "", { token: "delimiter", next: "@fields" }],
      ],
      [/(@[a-z]+)(\s*)([{(])/, ["keyword", "", { token: "delimiter", next: "@key" }]],
      [/@[a-z]+/, "keyword"],
      [/[^@]+/, "comment"],
      [/@/, "comment"],
    ],

    comment: [
      [/\{/, { token: "comment", next: "@push" }],
      [/\}/, { token: "comment", next: "@pop" }],
      [/[^{}]+/, "comment"],
    ],

    // The citation key, up to the first comma.
    key: [
      nextEntry,
      [/\s+/, ""],
      [/[^\s,{}()]+/, "reference"],
      [/,/, { token: "delimiter", switchTo: "@fields" }],
      [/[})]/, { token: "delimiter", next: "@pop" }],
      [/./, ""],
    ],

    fields: [
      nextEntry,
      [/\s+/, ""],
      [/([a-z_][\w:.+-]*)(\s*)(=)/, ["attribute", "", "delimiter"]],
      [/\{/, { token: "delimiter", next: "@braced" }],
      [/"/, { token: "delimiter", next: "@quoted" }],
      [/[,#=]/, "delimiter"],
      [/\d+/, ""],
      [/[a-z_][\w:.+-]*/, "variable"],
      [/[})]/, { token: "delimiter", next: "@pop" }],
      [/./, ""],
    ],

    braced: [
      nextEntry,
      [/\{/, { token: "delimiter", next: "@push" }],
      [/\}/, { token: "delimiter", next: "@pop" }],
      [/\\[a-z@]+|\\./, "escape"],
      [/[^{}\\]+/, ""],
    ],

    quoted: [
      nextEntry,
      [/"/, { token: "delimiter", next: "@pop" }],
      [/\{/, { token: "delimiter", next: "@braced" }],
      [/\\[a-z@]+|\\./, "escape"],
      [/[^"{\\]+/, ""],
    ],
  },
};

export const bibtexConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: "%" },
  brackets: [
    ["{", "}"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: '"', close: '"' },
  ],
  folding: {
    markers: {
      start: /^\s*@[a-zA-Z]+\s*[{(]/,
      end: /^\s*[})]\s*$/,
    },
  },
};
