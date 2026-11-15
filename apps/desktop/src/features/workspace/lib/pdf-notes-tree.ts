import { pdfPathFromNotes } from "@/features/editor/lib/pdf-notes";
import type { FileNode } from "@/types/files";

/**
 * Presents each PDF's notes sidecar as a child of the PDF instead of a sibling.
 * The child is listed only while the PDF or its notes are open in a tab; notes
 * whose PDF is missing stay ordinary files so they are never hidden for good.
 */
export function nestPdfNotes(nodes: readonly FileNode[], open: ReadonlySet<string>): FileNode[] {
  const files = new Set(nodes.filter((node) => node.type === "file").map((node) => node.path));
  const notes = new Map<string, FileNode>();
  for (const node of nodes) {
    const pdf = node.type === "file" ? pdfPathFromNotes(node.path) : undefined;
    if (pdf && files.has(pdf)) notes.set(pdf, node);
  }
  const hidden = new Set([...notes.values()].map((node) => node.path));
  return nodes
    .filter((node) => !hidden.has(node.path))
    .map((node) => {
      if (node.type === "directory")
        return node.children ? { ...node, children: nestPdfNotes(node.children, open) } : node;
      const sidecar = notes.get(node.path);
      return sidecar && (open.has(node.path) || open.has(sidecar.path))
        ? { ...node, children: [sidecar] }
        : node;
    });
}
