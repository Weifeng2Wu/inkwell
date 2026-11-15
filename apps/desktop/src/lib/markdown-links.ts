import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  identifier?: string;
  depth?: number;
  children?: MarkdownNode[];
  position?: { start: { offset?: number; line: number }; end: { offset?: number } };
};

export type MarkdownLinkKind = "wiki" | "markdown";
export type DocumentLink = { target: string; label: string; kind: MarkdownLinkKind };

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const wikiPrefix = "#inkwell-wiki=";
const excludedTypes = new Set([
  "code",
  "inlineCode",
  "math",
  "inlineMath",
  "html",
  "link",
  "linkReference",
  "image",
  "imageReference",
  "definition",
]);

function walk(node: MarkdownNode, visit: (node: MarkdownNode) => boolean | undefined) {
  if (visit(node) === false) return;
  for (const child of node.children ?? []) walk(child, visit);
}

function withoutFrontmatter(text: string) {
  return text.replace(
    /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,
    (match) => match.replace(/[^\r\n]/g, " "),
  );
}

export function wikiLinkTargetFromHref(href?: string): string | undefined {
  if (!href?.startsWith(wikiPrefix)) return undefined;
  try {
    return decodeURIComponent(href.slice(wikiPrefix.length));
  } catch {
    return undefined;
  }
}

export function isLocalDocumentLink(href: string): boolean {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return false;
  if (href.startsWith("#")) return true;
  try {
    return /\.(md|markdown|mdown|pdf)$/i.test(decodeURIComponent(href.split(/[?#]/)[0] ?? ""));
  } catch {
    return false;
  }
}

export function transformWikiLinks(text: string): string {
  const source = withoutFrontmatter(text);
  const excluded: { start: number; end: number }[] = [];
  walk(parser.parse(source), (node) => {
    if (!excludedTypes.has(node.type)) return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) excluded.push({ start, end });
    return false;
  });
  let interval = 0;
  return source.replace(/\[\[([^[\]\r\n]+)\]\]/g, (match, inner: string, offset: number) => {
    while (excluded[interval] && (excluded[interval]?.end ?? 0) <= offset) interval += 1;
    const blocked = excluded[interval];
    if (blocked && blocked.start <= offset && blocked.end > offset) return match;
    let escapes = 0;
    for (let index = offset - 1; source[index] === "\\"; index -= 1) escapes += 1;
    if (escapes % 2 || source[offset - 1] === "!") return match;
    const [rawTarget = "", ...alias] = inner.replace(/\\\|/g, "|").split("|");
    const target = rawTarget.trim();
    if (!target) return match;
    const label = alias.join("|").trim() || target.replace(/\.(md|markdown|mdown)(?=#|$)/i, "");
    const escaped = label.replace(/[\\`*_[\]<>!|]/g, "\\$&");
    const encoded = encodeURIComponent(target).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16)}`,
    );
    return `[${escaped}](${wikiPrefix}${encoded})`;
  });
}

function nodeText(node: MarkdownNode): string {
  return node.value ?? node.children?.map(nodeText).join("") ?? "";
}

export function extractDocumentLinks(text: string): DocumentLink[] {
  const tree = parser.parse(transformWikiLinks(text));
  const definitions = new Map<string, string>();
  walk(tree, (node) => {
    if (
      node.type === "definition" &&
      node.identifier &&
      node.url &&
      !definitions.has(node.identifier)
    )
      definitions.set(node.identifier, node.url);
  });
  const links: DocumentLink[] = [];
  walk(tree, (node) => {
    const url =
      node.type === "link"
        ? node.url
        : node.type === "linkReference"
          ? definitions.get(node.identifier ?? "")
          : undefined;
    if (url === undefined) return;
    const wiki = wikiLinkTargetFromHref(url);
    links.push({
      target: wiki ?? url,
      label: nodeText(node),
      kind: wiki === undefined ? "markdown" : "wiki",
    });
    return false;
  });
  return links;
}

export function markdownHeadingLine(content: string, heading: string): number | undefined {
  let line: number | undefined;
  const slugs = new Map<string, number>();
  walk(parser.parse(withoutFrontmatter(content)), (node) => {
    if (node.type !== "heading") return;
    const title = nodeText(node);
    const slug = title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    const count = slugs.get(slug) ?? 0;
    slugs.set(slug, count + 1);
    if (
      line === undefined &&
      (title === heading || (count ? `${slug}-${count}` : slug) === heading)
    )
      line = node.position?.start.line;
  });
  return line;
}
