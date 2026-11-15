// Test support: finds user-visible text written directly in components instead of the
// dictionary. Node only; never import this from application code.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Directories and files (relative to `apps/desktop/src`) whose components must take every
 * visible string from the dictionary. Add a path here once its strings are migrated.
 */
export const HARDCODED_STRING_SCAN_ROOTS: readonly string[] = [
  "features/agent",
  "features/settings",
  "features/onboarding",
  "features/i18n",
  "app/layout.tsx",
  "app/settings",
];

/** Attributes whose value is read or announced to the user. */
export const VISIBLE_ATTRIBUTES: readonly string[] = [
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "title",
  "alt",
  "label",
];

/** Names that read the same in every language. */
export const BRAND_TERMS: readonly string[] = [
  "Inkwell",
  "GitHub",
  "Git",
  "LaTeX",
  "BibTeX",
  "DOI",
  "arXiv",
  "PDF",
  "Markdown",
  "API",
  "URL",
  "ACP",
  "MCP",
  "Claude Code",
  "Codex",
  "OpenAI",
  "Anthropic",
  "Gemini",
  "MinerU",
  "PaddleOCR",
  "DeepL",
  "Google",
];

const LETTER = /[\p{L}]/u;
// Modifier and key names as printed on keycaps. Words that double as commands ("Delete",
// "Home", "Space") only count as keys inside a combination such as `Ctrl+Delete`.
const KEY_NAME = /^(?:Ctrl|Cmd|Alt|Shift|Mod|Esc|Enter|Tab|F\d{1,2}|[A-Z])$/;
const KEY_COMBINATION = /^(?:[A-Za-z]+\d{0,2}\+)+(?:[A-Za-z]+\d{0,2}|\S)$/;

/** Literal examples of formats and product tiers that are shown verbatim in every language. */
export const VERBATIM_TEXT: readonly string[] = [
  "Header-Name: value",
  "DeepL API Free",
  "DeepL API Pro",
  "global / eastasia",
];

// URLs, host names and file names (`https://api.example.com/v1`, `SKILL.md`).
const MACHINE_TOKEN = /^(?:\w+:\/\/)?[\w-]+(?:[._][\w-]+)+(?:[/:][\w./:-]*)?$/;
// API field names written in camel case (`SecretId`).
const IDENTIFIER = /^[A-Za-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/;

/** True when the text holds words a reader would need translated. */
export function isTranslatableText(text: string): boolean {
  if (VERBATIM_TEXT.includes(text.trim())) return false;
  let rest = text;
  for (const term of [...BRAND_TERMS].sort((a, b) => b.length - a.length))
    rest = rest.split(term).join(" ");
  // HTML entities such as `&nbsp;` or `&middot;` are punctuation, not words.
  rest = rest.replace(/&#?\w+;/g, " ");
  return rest
    .split(/\s+/)
    .filter(
      (token) =>
        !MACHINE_TOKEN.test(token) && !IDENTIFIER.test(token) && !KEY_COMBINATION.test(token),
    )
    .flatMap((token) => token.split(/[+/·•|,.:;()[\]<>→←↑↓⌘⌥⇧⌃↵⏎…-]+/))
    .some((word) => LETTER.test(word) && !KEY_NAME.test(word));
}

export interface HardcodedString {
  file: string;
  line: number;
  kind: "text" | "attribute";
  name?: string;
  text: string;
}

function literalTexts(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node))
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
  if (ts.isParenthesizedExpression(node)) return literalTexts(node.expression);
  if (ts.isConditionalExpression(node))
    return [...literalTexts(node.whenTrue), ...literalTexts(node.whenFalse)];
  if (ts.isBinaryExpression(node)) {
    const kind = node.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.BarBarToken ||
      kind === ts.SyntaxKind.QuestionQuestionToken ||
      kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      kind === ts.SyntaxKind.PlusToken
    )
      return [...literalTexts(node.left), ...literalTexts(node.right)];
  }
  return [];
}

/** Scans one TSX source for visible literals in JSX text, JSX expressions and attributes. */
export function findHardcodedStrings(fileName: string, sourceText: string): HardcodedString[] {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: HardcodedString[] = [];
  const report = (node: ts.Node, kind: HardcodedString["kind"], text: string, name?: string) => {
    if (!isTranslatableText(text)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.push({ file: fileName, line: line + 1, kind, name, text: text.trim() });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      report(node, "text", node.text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const text of literalTexts(node.expression)) report(node, "text", text);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(source);
      if (VISIBLE_ATTRIBUTES.includes(name)) {
        const value = node.initializer;
        const texts = ts.isStringLiteral(value)
          ? [value.text]
          : ts.isJsxExpression(value) && value.expression
            ? literalTexts(value.expression)
            : [];
        for (const text of texts) report(node, "attribute", text, name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function componentFiles(path: string): string[] {
  if (/\.tsx$/.test(path)) return [path];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return componentFiles(child);
    return /\.tsx$/.test(entry.name) && !entry.name.includes(".test.") ? [child] : [];
  });
}

/** Scans every component under `roots`, reporting paths relative to `sourceRoot`. */
export function scanHardcodedStrings(
  sourceRoot: string,
  roots: readonly string[] = HARDCODED_STRING_SCAN_ROOTS,
): HardcodedString[] {
  return roots
    .flatMap((root) => componentFiles(join(sourceRoot, root)))
    .flatMap((file) =>
      findHardcodedStrings(relative(sourceRoot, file), readFileSync(file, "utf8")),
    );
}
