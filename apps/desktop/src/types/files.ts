// File system domain types shared across workspace, editor, and LaTeX features.

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}
