import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises";
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

  async resolve(filename, allowMissing = false) {
    const root = await realpath(this.root);
    const requested = path.resolve(this.root, filename);
    const target = isWithin(this.root, requested)
      ? path.resolve(root, path.relative(this.root, requested))
      : requested;
    const relative = path.relative(root, target);
    if (
      !isWithin(root, target) ||
      !relative ||
      relative.split(path.sep).some((part) => part.startsWith(".") || part === "node_modules") ||
      (!DOCUMENT_EXTENSIONS.has(path.extname(target).toLowerCase()) &&
        !/\.poster\.json$/i.test(target))
    ) {
      throw new Error("Only non-hidden manuscript text files inside the project are accessible.");
    }
    let current = root;
    let missing = false;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error("Symlinks are not allowed for agent file operations.");
      } catch (error) {
        if (!allowMissing || error.code !== "ENOENT") throw error;
        missing = true;
      }
    }
    if (missing) return target;
    const canonical = await realpath(target);
    const metadata = await stat(canonical);
    if (
      !isWithin(root, canonical) ||
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
        {
          path: path.relative(await realpath(this.root), target),
          before: before.toString("utf8"),
          after: content,
        },
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

  async writePoster(filename, content, signal) {
    if (this.permissionMode === "restricted")
      throw new Error("Editing is disabled in restricted permission mode.");
    if (typeof filename !== "string" || !/\.poster\.json$/i.test(filename))
      throw new Error("Choose a .poster.json file.");
    if (
      typeof content !== "string" ||
      Buffer.byteLength(content) > MAX_DOCUMENT_BYTES ||
      content.includes("\0")
    )
      throw new Error("Poster proposal exceeds the 1 MiB agent limit.");
    const poster = JSON.parse(content);
    if (poster?.version !== 1 || !Array.isArray(poster.elements) || poster.elements.length > 500)
      throw new Error("Invalid poster document.");
    try {
      await this.resolve(filename);
      return await this.edit(filename, content, signal);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const target = await this.resolve(filename, true);
    const root = await realpath(this.root);
    if (this.permissionMode === "ask")
      await this.approve(
        { path: path.relative(root, target), before: null, after: content },
        signal,
      );
    signal?.throwIfAborted();
    let current = root;
    for (const segment of path
      .relative(root, path.dirname(target))
      .split(path.sep)
      .filter(Boolean)) {
      current = path.join(current, segment);
      await mkdir(current).catch((error) => {
        if (error.code !== "EEXIST") throw error;
      });
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink() || !isWithin(root, await realpath(current)))
        throw new Error("Invalid poster directory.");
    }
    await this.resolve(filename, true);
    signal?.throwIfAborted();
    // Exclusive creation preserves files created by the user during approval.
    const handle = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } catch (error) {
      await unlink(target).catch(() => {});
      throw error;
    } finally {
      await handle.close();
    }
  }
}
