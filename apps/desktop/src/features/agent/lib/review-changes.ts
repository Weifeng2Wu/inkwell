export type ReviewChange = { path: string; before: string | null; after: string | null };
export type ReviewHunk = {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
};

export function applyReviewedHunks(
  before: string,
  after: string,
  hunks: ReviewHunk[],
  accepted: number[],
): string {
  const original = before.split("\n");
  const modified = after.split("\n");
  const result: string[] = [];
  let cursor = 0;
  for (const [index, hunk] of hunks.entries()) {
    if (!accepted.includes(index)) continue;
    const start =
      hunk.originalEndLineNumber === 0
        ? hunk.originalStartLineNumber
        : hunk.originalStartLineNumber - 1;
    const end = hunk.originalEndLineNumber === 0 ? start : hunk.originalEndLineNumber;
    result.push(...original.slice(cursor, start));
    if (hunk.modifiedEndLineNumber !== 0)
      result.push(...modified.slice(hunk.modifiedStartLineNumber - 1, hunk.modifiedEndLineNumber));
    cursor = end;
  }
  result.push(...original.slice(cursor));
  return result.join("\n");
}
