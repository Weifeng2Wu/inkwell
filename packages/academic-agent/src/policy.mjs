import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { isWithin } from "./library.mjs";

const DOCUMENT_EXTENSIONS = new Set([".tex", ".bib", ".cls", ".sty", ".md", ".txt", ".csv"]);
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

export class ProjectPolicy {
  constructor(root, approve, permissionMode = "ask") {
    if (!["restricted", "ask", "auto"].includes(permissionMode))
      throw new Error("Invalid permission mode.");
    this.root = root;
    this.approve = approve;
    this.permissionMode = permissionMode;
  }

  async resolve(filename) {
    const target = path.resolve(this.root, filename);
    const relative = path.relative(this.root, target);
    if (
      !isWithin(this.root, target) ||
      !relative ||
      relative.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules") ||
      !DOCUMENT_EXTENSIONS.has(path.extname(target).toLowerCase())
    ) {
      throw new Error("Only non-hidden manuscript text files inside the project are accessible.");
    }
    let current = this.root;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Symlinks are not allowed for agent file operations.");
    }
    const canonical = await realpath(target);
    const metadata = await stat(canonical);
    if (
      !isWithin(this.root, canonical) ||
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size > MAX_DOCUMENT_BYTES
    ) {
      throw new Error("Invalid, hard-linked or oversized manuscript file.");
    }
    return canonical;
  }

  async read(filename) {
    const target = await this.resolve(filename);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > MAX_DOCUMENT_BYTES)
        throw new Error("Invalid manuscript file.");
      const content = await handle.readFile();
      if (content.length > MAX_DOCUMENT_BYTES) throw new Error("Manuscript file is too large.");
      return content;
    } finally {
      await handle.close();
    }
  }

  async edit(filename, content, signal) {
    if (this.permissionMode === "restricted")
      throw new Error("Editing is disabled in restricted permission mode.");
    if (Buffer.byteLength(content) > MAX_DOCUMENT_BYTES)
      throw new Error("Proposed edit is too large.");
    const target = await this.resolve(filename);
    const before = await this.read(target);
    if (this.permissionMode === "ask")
      await this.approve(
        { path: path.relative(this.root, target), before: before.toString("utf8"), after: content },
        signal,
      );
    signal?.throwIfAborted();
    await this.resolve(target);
    if (!(await this.read(target)).equals(before))
      throw new Error("File changed while awaiting approval. Read it and propose the edit again.");
    const temporary = path.join(path.dirname(target), `.inkwell-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", (await stat(target)).mode & 0o777);
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      signal?.throwIfAborted();
      await this.resolve(target);
      if (!(await readFile(target)).equals(before))
        throw new Error("File changed before the edit was applied.");
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
