import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { MAX_RESOURCE_BYTES } from "./library.mjs";

const TEXT = /\.(md|txt|json|yaml|yml|csv|bib|tex)$/i;
const MAX_ARCHIVE = 8 * 1024 * 1024;

function checksum(bytes) {
  let result = 0xffffffff;
  for (const byte of bytes) {
    result ^= byte;
    for (let bit = 0; bit < 8; bit += 1) result = (result >>> 1) ^ (result & 1 ? 0xedb88320 : 0);
  }
  return (result ^ 0xffffffff) >>> 0;
}

export function readZipEntries(bytes, options = {}) {
  const maxArchive = options.maxArchive ?? MAX_ARCHIVE;
  const maxExpanded = options.maxExpanded ?? MAX_ARCHIVE;
  const maxResource = options.maxResource ?? MAX_RESOURCE_BYTES;
  const maxFiles = options.maxFiles ?? 51;
  const accept = options.accept ?? ((name) => TEXT.test(name));
  if (bytes.length > maxArchive) throw new Error("ZIP exceeds the archive size limit.");
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset -= 1) {
    if (
      bytes.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    ) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error("Invalid ZIP archive.");
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt32LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    count > 500 ||
    start + bytes.readUInt32LE(end + 12) !== end
  )
    throw new Error("Unsupported or oversized ZIP archive.");
  const files = new Map();
  const skipped = [];
  const names = new Set();
  let total = 0;
  let cursor = start;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error("Invalid ZIP directory.");
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const mode = bytes.readUInt32LE(cursor + 38) >>> 16;
    const local = bytes.readUInt32LE(cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new Error("Invalid ZIP entry.");
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const relative = name.replace(/\/$/, "");
    if (
      !relative ||
      relative.length > 256 ||
      /[\\:\ufffd]/.test(relative) ||
      [...relative].some(
        (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      relative.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      names.has(relative) ||
      (mode & 0xf000) === 0xa000
    )
      throw new Error("Unsafe or duplicate ZIP path.");
    names.add(relative);
    total += size;
    if (
      (flags & 0x41) !== 0 ||
      ![0, 8].includes(method) ||
      total > maxExpanded ||
      bytes.readUInt16LE(cursor + 34) !== 0 ||
      local + 30 > start ||
      bytes.readUInt32LE(local) !== 0x04034b50
    )
      throw new Error("Unsupported or oversized ZIP entry.");
    const localNameLength = bytes.readUInt16LE(local + 26);
    const dataStart = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (
      dataStart + compressed > start ||
      bytes.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name ||
      bytes.readUInt16LE(local + 8) !== method ||
      bytes.readUInt16LE(local + 6) !== flags
    )
      throw new Error("Invalid ZIP local entry.");
    cursor = next;
    if (
      name.endsWith("/") ||
      relative.split("/").some((segment) => segment.startsWith(".")) ||
      relative.startsWith("__MACOSX/") ||
      !accept(relative)
    ) {
      if (!name.endsWith("/")) skipped.push(relative);
      continue;
    }
    if (size > maxResource || files.size >= maxFiles)
      throw new Error("ZIP exceeds the text resource limits.");
    const packed = bytes.subarray(dataStart, dataStart + compressed);
    const content =
      method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: maxResource });
    if (content.length !== size || checksum(content) !== crc)
      throw new Error("Corrupted or non-text ZIP resource.");
    files.set(relative, content);
  }
  if (cursor !== end) throw new Error("Invalid ZIP directory length.");
  return { files, skipped };
}

export function readRequirementZip(data) {
  if (
    typeof data !== "string" ||
    data.length > 16 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
  )
    throw new Error("Invalid or oversized author kit ZIP.");
  const { files, skipped } = readZipEntries(Buffer.from(data, "base64"), {
    maxArchive: 12 * 1024 * 1024,
    maxExpanded: 48 * 1024 * 1024,
    maxResource: 12 * 1024 * 1024,
    maxFiles: 80,
    accept: (name) =>
      /\.(pdf|txt|md|markdown|tex|latex|cls|sty|bst|bbx|cbx|def|cfg|dtx|ins|ltx|bib|csv|json|yaml|yml|html|htm|rst)$/i.test(
        name,
      ),
  });
  return {
    files: [...files].map(([name, content]) => ({ name, data: content.toString("base64") })),
    skipped,
  };
}

export function readSkillZip(bytes) {
  const { files } = readZipEntries(bytes);
  if ([...files.values()].some((content) => content.includes(0)))
    throw new Error("Corrupted or non-text ZIP resource.");
  const roots = [...files.keys()].filter((name) => path.posix.basename(name) === "SKILL.md");
  const entrypoint = files.has("SKILL.md") ? "SKILL.md" : roots.length === 1 ? roots[0] : undefined;
  if (!entrypoint) throw new Error("Choose a ZIP containing one skill folder with SKILL.md.");
  const prefix = entrypoint.slice(0, -"SKILL.md".length);
  return new Map(
    [...files]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, content]) => [name.slice(prefix.length), content]),
  );
}

export async function importSkillZip(filename, operation) {
  const files = readSkillZip(await readFile(filename));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "inkwell-skill-zip-"));
  try {
    for (const [relative, content] of files) {
      const destination = path.join(temporary, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content, { flag: "wx" });
    }
    return await operation(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
