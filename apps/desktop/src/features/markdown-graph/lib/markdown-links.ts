import {
  type DocumentLink,
  extractDocumentLinks,
  isLocalDocumentLink,
  type MarkdownLinkKind,
} from "@/lib/markdown-links";
import type { FileNode } from "@/types/files";

export interface MarkdownGraphNode {
  path: string;
  kind: "markdown" | "pdf";
  label: string;
  directory: string;
  outgoing: string[];
  incoming: string[];
  unresolved: string[];
}

export interface MarkdownGraphEdge {
  source: string;
  target: string;
}
export interface MarkdownGraphData {
  nodes: MarkdownGraphNode[];
  edges: MarkdownGraphEdge[];
}
export type LinkResolution =
  | { status: "resolved"; path: string; heading: string }
  | { status: "missing" | "ambiguous" | "invalid" | "external"; candidates: string[] };

export function isMarkdownPath(path: string) {
  return /\.(md|markdown|mdown)$/i.test(path);
}

export function isGraphDocumentPath(path: string) {
  return isMarkdownPath(path) || /\.pdf$/i.test(path);
}

export function normalizeNotePath(path: string): string | undefined {
  if (
    /^[\\/]/.test(path) ||
    path.includes(":") ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32)
  )
    return undefined;
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return segments.join("/") || undefined;
}

function withoutExtension(path: string) {
  return path.replace(/\.(md|markdown|mdown|pdf)$/i, "");
}
function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}
function dirname(path: string) {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function graphFilePaths(files: FileNode[]): string[] {
  const paths = new Set<string>();
  const stack = [...files];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const path = normalizeNotePath(node.path);
    if (node.type === "file" && path && isGraphDocumentPath(path)) paths.add(path);
    if (node.children) stack.push(...node.children);
  }
  return [...paths].sort();
}

export function resolveDocumentLink(
  target: string,
  sourcePath: string,
  paths: readonly string[],
  kind: MarkdownLinkKind = "wiki",
  caseInsensitive = false,
): LinkResolution {
  const value = target.trim().replace(/\\/g, "/");
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//"))
    return { status: "external", candidates: [] };
  const hash = value.indexOf("#");
  let pathname = (hash < 0 ? value : value.slice(0, hash)).split("?")[0] ?? "";
  let heading = hash < 0 ? "" : value.slice(hash + 1);
  try {
    pathname = decodeURIComponent(pathname).replace(/\\/g, "/");
    heading = decodeURIComponent(heading);
  } catch {
    return { status: "invalid", candidates: [] };
  }
  if (
    Array.from(pathname).some((character) => character.charCodeAt(0) < 32) ||
    pathname.includes(":") ||
    pathname.startsWith("//")
  )
    return { status: "invalid", candidates: [] };
  const source = normalizeNotePath(sourcePath);
  if (!source) return { status: "invalid", candidates: [] };
  const compare = (path: string) => (caseInsensitive ? path.toLowerCase() : path);
  const match = (candidate: string): string[] => {
    const exact = paths.filter((path) => compare(path) === compare(candidate));
    if (exact.length) return exact;
    if (isGraphDocumentPath(candidate)) return [];
    return paths.filter((path) => compare(withoutExtension(path)) === compare(candidate));
  };
  const finish = (matches: string[]): LinkResolution =>
    matches.length === 1 && matches[0]
      ? { status: "resolved", path: matches[0], heading }
      : { status: matches.length ? "ambiguous" : "missing", candidates: matches };
  if (!pathname) return finish(match(source));
  const relative = normalizeNotePath(`${dirname(source) ? `${dirname(source)}/` : ""}${pathname}`);
  const root = normalizeNotePath(pathname.replace(/^\//, ""));
  if (pathname.startsWith("/"))
    return root ? finish(match(root)) : { status: "invalid", candidates: [] };
  if (kind === "markdown" || /^\.\.?\//.test(pathname))
    return relative ? finish(match(relative)) : { status: "invalid", candidates: [] };
  if (pathname.includes("/"))
    return root ? finish(match(root)) : { status: "invalid", candidates: [] };
  const sibling = relative ? match(relative) : [];
  if (sibling.length) return finish(sibling);
  return finish(
    paths.filter(
      (path) =>
        compare(
          isGraphDocumentPath(pathname) ? basename(path) : withoutExtension(basename(path)),
        ) === compare(pathname),
    ),
  );
}

export function buildMarkdownGraph(
  sources: ReadonlyMap<string, string>,
  caseInsensitive = false,
  cachedLinks?: ReadonlyMap<string, DocumentLink[]>,
): MarkdownGraphData {
  const nodes = [...sources.keys()]
    .filter(isGraphDocumentPath)
    .sort()
    .map(
      (path): MarkdownGraphNode => ({
        path,
        kind: isMarkdownPath(path) ? "markdown" : "pdf",
        label: withoutExtension(basename(path)),
        directory: dirname(path),
        outgoing: [],
        incoming: [],
        unresolved: [],
      }),
    );
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const paths = nodes.map((node) => node.path);
  const edges: MarkdownGraphEdge[] = [];
  const connect = (source: MarkdownGraphNode, target: string) => {
    if (target === source.path || source.outgoing.includes(target)) return;
    source.outgoing.push(target);
    byPath.get(target)?.incoming.push(source.path);
    edges.push({ source: source.path, target });
  };
  for (const node of nodes) {
    if (node.kind === "pdf") continue;
    const links = cachedLinks?.get(node.path) ?? extractDocumentLinks(sources.get(node.path) ?? "");
    for (const link of links) {
      const result = resolveDocumentLink(link.target, node.path, paths, link.kind, caseInsensitive);
      if (result.status !== "resolved") {
        const local = link.kind === "wiki" || isLocalDocumentLink(link.target);
        if (local && result.status !== "external" && !node.unresolved.includes(link.target))
          node.unresolved.push(link.target);
        continue;
      }
      connect(node, result.path);
    }
    if (/\.pdf\.notes\.md$/i.test(node.path)) {
      const pdfPath = node.path.slice(0, -".notes.md".length);
      const pdf = paths.find((path) =>
        caseInsensitive ? path.toLowerCase() === pdfPath.toLowerCase() : path === pdfPath,
      );
      if (pdf) connect(node, pdf);
    }
  }
  return { nodes, edges };
}

export function markdownGraphNode(graph: MarkdownGraphData, path?: string) {
  return graph.nodes.find((node) => node.path === path?.replace(/\\/g, "/"));
}
