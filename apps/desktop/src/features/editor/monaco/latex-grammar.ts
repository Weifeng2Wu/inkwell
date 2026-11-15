import type { languages } from "monaco-editor";

/**
 * LaTeX tokens for the editor.
 *
 * Running text is the default token, so a manuscript reads as prose and only structure is
 * tinted. Token names are a single segment (`keyword`, `math`, `reference`, …) followed by
 * the `.latex` postfix; `syntax-theme.ts` colours exactly these names.
 *
 * Every state entered by an argument (`{…}`, `[…]`, `$…$`) is left again at a blank line:
 * an unbalanced brace can then never recolour more than its own paragraph.
 */

const SECTIONING = "part|chapter|(?:sub){0,2}section|(?:sub)?paragraph|title";
const REFERENCES = "(?:eq|auto|page|name|sub|[cCvVfF])?ref|[cC]refrange|label";
const NAMED =
  "documentclass|usepackage|RequirePackage|LoadClass|bibliographystyle|bibliography|" +
  "addbibresource|input|include|includeonly|includegraphics|subfile|usetikzlibrary";
const MATH_ENVIRONMENTS =
  "equation|align|alignat|xalignat|flalign|gather|multline|eqnarray|displaymath|math|dmath";
const VERBATIM_ENVIRONMENTS = "verbatim|Verbatim|lstlisting|minted|alltt";

/** A command name must not run on into more letters: `\section`, not `\sectionmark`. */
const END = "(?![a-zA-Z@])";

const paragraphBreak: languages.IMonarchLanguageRule = [/^\s*$/, { token: "", next: "@popall" }];

export const latexLanguage: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".latex",

  tokenizer: {
    root: [{ include: "@inline" }, [/[{}]/, "delimiter"], [/[^\\{}$%&#]+/, ""]],

    // Everything that can appear in running text or inside an argument.
    inline: [
      [/%.*$/, "comment"],
      [/\\\\\*?/, "escape"],

      // Formulas
      [/\\\[/, { token: "math", next: "@mathBracket" }],
      [/\\\(/, { token: "math", next: "@mathParen" }],
      [/\$\$/, { token: "math", next: "@mathDisplay" }],
      [/\$/, { token: "math", next: "@mathInline" }],
      [
        new RegExp(`(\\\\begin)(\\s*)(\\{)((?:${MATH_ENVIRONMENTS})\\*?)(\\})`),
        ["keyword", "", "delimiter", "name", { token: "delimiter", next: "@mathEnvironment" }],
      ],

      // Literal text: nothing inside is a command, a comment or a formula.
      [
        new RegExp(`(\\\\begin)(\\s*)(\\{)((?:${VERBATIM_ENVIRONMENTS})\\*?)(\\})`),
        ["keyword", "", "delimiter", "name", { token: "delimiter", next: "@verbatim" }],
      ],
      [
        /(\\(?:verb|lstinline)\*?)([^a-zA-Z*\s])(.*?)(\2)/,
        ["keyword", "delimiter", "verbatim", "delimiter"],
      ],
      [
        /(\\(?:url|path|nolinkurl|href))(\s*)(\{)([^{}]*)(\})/,
        ["keyword", "", "delimiter", "verbatim", "delimiter"],
      ],

      // Environments
      [
        /(\\(?:begin|end))(\s*)(\{)([^{}\\%]*)(\})(\[)/,
        [
          "keyword",
          "",
          "delimiter",
          "name",
          "delimiter",
          { token: "delimiter", next: "@optional" },
        ],
      ],
      [
        /(\\(?:begin|end))(\s*)(\{)([^{}\\%]*)(\})/,
        ["keyword", "", "delimiter", "name", "delimiter"],
      ],

      // Commands whose argument has a meaning of its own
      [
        new RegExp(`\\\\(?:${SECTIONING})\\*?${END}`),
        { token: "keyword", next: "@arguments.text.heading" },
      ],
      [
        new RegExp(`\\\\(?:[a-zA-Z]*[cC]ite[a-zA-Z]*|${REFERENCES})\\*?${END}`),
        { token: "keyword", next: "@arguments.keys.reference" },
      ],
      [
        new RegExp(`\\\\(?:${NAMED})\\*?${END}`),
        { token: "keyword", next: "@arguments.keys.name" },
      ],
      [
        /(\\(?:textbf|mathbf))(\s*)(\{)/,
        ["keyword", "", { token: "delimiter", next: "@text.strong" }],
      ],
      [
        /(\\(?:textit|emph|textsl))(\s*)(\{)/,
        ["keyword", "", { token: "delimiter", next: "@text.emphasis" }],
      ],

      // Any other command, with its optional argument when one follows directly
      [/(\\[a-zA-Z@]+\*?)(\[)/, ["keyword", { token: "delimiter", next: "@optional" }]],
      [/\\[a-zA-Z@]+\*?/, "keyword"],
      [/\\[^a-zA-Z@\s]/, "escape"],
      [/\\/, "escape"],
      [/#+\d/, "escape"],
      [/&/, "delimiter"],
    ],

    // Between a command and its braces: `\section*[Short]{Long}` or `\cite[p.~4]{key}`.
    // The state is `arguments.<state>.<token>` and hands over to `<state>.<token>`.
    arguments: [
      paragraphBreak,
      [/\s+/, ""],
      [/\[/, { token: "delimiter", next: "@optional" }],
      [/\{/, { token: "delimiter", switchTo: "@$S2.$S3" }],
      [/(?=.)/, { token: "", next: "@pop" }],
    ],

    optional: [
      paragraphBreak,
      [/\]/, { token: "delimiter", next: "@pop" }],
      [/\[/, { token: "delimiter", next: "@push" }],
      [/%.*$/, "comment"],
      [/\$/, { token: "math", next: "@mathInline" }],
      [/\\[a-zA-Z@]+\*?/, "keyword"],
      [/\\[^a-zA-Z@\s]|\\/, "escape"],
      [/[{}]/, "delimiter"],
      [/[^\][\\%{}$]+/, "attribute"],
    ],

    // Prose in braces that carries a style: `text.heading`, `text.strong`, `text.emphasis`.
    text: [
      paragraphBreak,
      [/\{/, { token: "delimiter", next: "@push" }],
      [/\}/, { token: "delimiter", next: "@pop" }],
      { include: "@inline" },
      [/[^\\{}$%&#]+/, { token: "$S2" }],
    ],

    // A comma-separated list in braces: `keys.reference` or `keys.name`.
    keys: [
      paragraphBreak,
      [/\}/, { token: "delimiter", next: "@pop" }],
      [/,/, "delimiter"],
      [/%.*$/, "comment"],
      [/\s+/, ""],
      [/[^{}%,\s\\]+/, { token: "$S2" }],
      [/./, ""],
    ],

    mathInline: [
      paragraphBreak,
      [/\$/, { token: "math", next: "@pop" }],
      { include: "@mathContent" },
    ],
    mathParen: [
      paragraphBreak,
      [/\\\)/, { token: "math", next: "@pop" }],
      { include: "@mathContent" },
      [/\$/, "math"],
    ],
    mathDisplay: [
      [/\$\$/, { token: "math", next: "@pop" }],
      { include: "@mathContent" },
      [/\$/, "math"],
    ],
    mathBracket: [
      [/\\\]/, { token: "math", next: "@pop" }],
      { include: "@mathContent" },
      [/\$/, "math"],
    ],
    // Environments nest, so an inner `aligned` or `cases` does not end the formula.
    mathEnvironment: [
      [
        /(\\end)(\s*)(\{)([^{}\\%]*)(\})/,
        ["keyword", "", "delimiter", "name", { token: "delimiter", next: "@pop" }],
      ],
      [/\\begin\s*\{[^{}\\%]*\}/, { token: "math", next: "@mathNested" }],
      { include: "@mathContent" },
      [/\$/, "math"],
    ],
    mathNested: [
      [/\\end\s*\{[^{}\\%]*\}/, { token: "math", next: "@pop" }],
      [/\\begin\s*\{[^{}\\%]*\}/, { token: "math", next: "@push" }],
      { include: "@mathContent" },
      [/\$/, "math"],
    ],
    mathContent: [
      [/%.*$/, "comment"],
      [/(\\label)(\s*)(\{)([^{}]*)(\})/, ["keyword", "", "delimiter", "reference", "delimiter"]],
      [/\\[a-zA-Z@]+\*?/, "math"],
      [/\\[^a-zA-Z@\s]|\\/, "math"],
      [/[^\\$%]+/, "math"],
    ],

    verbatim: [
      [
        new RegExp(`(\\\\end)(\\s*)(\\{)((?:${VERBATIM_ENVIRONMENTS})\\*?)(\\})`),
        ["keyword", "", "delimiter", "name", { token: "delimiter", next: "@pop" }],
      ],
      [/[^\\]+/, "verbatim"],
      [/\\/, "verbatim"],
    ],
  },
};

export const latexConfiguration: languages.LanguageConfiguration = {
  comments: { lineComment: "%" },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
    { open: "$$", close: "$$" },
    { open: '"', close: '"' },
    { open: "`", close: "'" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: "$", close: "$" },
    { open: '"', close: '"' },
  ],
  folding: {
    markers: {
      start: /\\begin\{/,
      end: /\\end\{/,
    },
  },
  indentationRules: {
    increaseIndentPattern: /\\begin\{(?!document)/,
    decreaseIndentPattern: /\\end\{(?!document)/,
  },
};
