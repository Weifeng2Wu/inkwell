export interface ParsedUnifiedDiff {
  original: string;
  modified: string;
  added: number;
  removed: number;
  hasRenderableHunks: boolean;
  isBinary: boolean;
}

/**
 * Splits a unified diff into its original and modified sides so the result can be fed to
 * Monaco's diff editor, counting added and removed lines along the way.
 *
 * Lines outside a hunk are dropped: git emits the file headers and index lines there, and
 * rendering them as content would show the reader a diff of the diff.
 */
export function parseUnifiedDiffContent(content: string): ParsedUnifiedDiff {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  let inHunk = false;
  let added = 0;
  let removed = 0;
  let isBinary = false;

  for (const line of lines) {
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      isBinary = true;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }

    if (!inHunk) continue;
    if (line === "\\ No newline at end of file") continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      modifiedLines.push(line.slice(1));
      added += 1;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      originalLines.push(line.slice(1));
      removed += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      const contextLine = line.slice(1);
      originalLines.push(contextLine);
      modifiedLines.push(contextLine);
      continue;
    }

    if (line.length === 0) {
      originalLines.push("");
      modifiedLines.push("");
    }
  }

  return {
    original: originalLines.join("\n"),
    modified: modifiedLines.join("\n"),
    added,
    removed,
    hasRenderableHunks: originalLines.length > 0 || modifiedLines.length > 0,
    isBinary,
  };
}
