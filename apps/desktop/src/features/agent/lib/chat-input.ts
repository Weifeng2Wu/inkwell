import type { FileNode } from "@/types/files";

export type ChatImage = { id?: string; name: string; mimeType: string; data: string };
export const MAX_IMAGE_BYTES = 240 * 1024;
export const MAX_CHAT_IMAGES = 4;
export function fileMentions(files: FileNode[], directory?: string): string[] {
  const root = directory?.replace(/\\/g, "/").replace(/\/$/, "");
  return files.flatMap((file) =>
    file.type === "directory"
      ? fileMentions(file.children ?? [], directory)
      : [
          root && file.path.replace(/\\/g, "/").startsWith(`${root}/`)
            ? file.path.replace(/\\/g, "/").slice(root.length + 1)
            : file.path.replace(/\\/g, "/"),
        ],
  );
}
export function workspaceMentions(
  files: FileNode[],
  directory: string | undefined,
  query: string,
): { path: string; name: string; folder: boolean }[] {
  const root = directory?.replace(/\\/g, "/").replace(/\/$/, "");
  const slash = query.lastIndexOf("/");
  const parent = slash < 0 ? "" : query.slice(0, slash);
  const leaf = query.slice(slash + 1).toLowerCase();
  const entries: { path: string; name: string; folder: boolean }[] = [];
  const collect = (nodes: FileNode[]) => {
    for (const node of nodes) {
      let path = node.path.replace(/\\/g, "/");
      if (root && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
      else path = path.replace(/^\/+/, "");
      entries.push({
        path,
        name: path.split("/").at(-1) ?? node.name,
        folder: node.type === "directory",
      });
      if (node.type === "directory") collect(node.children ?? []);
    }
  };
  collect(files);
  return entries.filter((entry) => {
    const entryParent = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
    return entryParent === parent && entry.name.toLowerCase().includes(leaf);
  });
}
export function mentionQuery(text: string, caret: number) {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return match
    ? { query: match[1] ?? "", start: caret - match[0].trimStart().length, end: caret }
    : null;
}
export async function readChatImage(
  file: File,
  errors = {
    type: "PNG / JPEG / WebP only",
    size: "Image limit: 240 KB each",
    read: "Could not read image",
  },
): Promise<ChatImage> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error(errors.type);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(errors.size);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(errors.read));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
  return { id: crypto.randomUUID(), name: file.name, mimeType: file.type, data };
}
