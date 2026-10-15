import { pathSync } from "@/lib/path";

export interface TreeNode {
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

/**
 * Indexes every file in the tree by its basename.
 *
 * A LaTeX project often holds several `main.tex` files, so a basename alone is ambiguous.
 * The index keeps every full path that shares a basename, letting callers detect the
 * ambiguous case instead of silently picking one.
 */
export function buildBasenameIndex(nodes: TreeNode[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;

    if (node.type === "file") {
      const name = pathSync.basename(node.path);
      const existing = index.get(name);
      if (existing) {
        existing.push(node.path);
      } else {
        index.set(name, [node.path]);
      }
    }

    if (node.children && node.children.length > 0) {
      stack.push(...node.children);
    }
  }

  return index;
}
