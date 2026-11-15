export type PaletteMode = "open" | "command" | "cite" | "heading";

const PREFIXES: Record<string, PaletteMode> = { ">": "command", "@": "cite", "#": "heading" };

/** Splits what the user typed into a mode (from its prefix character) and a query. */
export function parseInput(input: string): { mode: PaletteMode; query: string } {
  const mode = PREFIXES[input[0] ?? ""];
  return mode ? { mode, query: input.slice(1).trim() } : { mode: "open", query: input.trim() };
}

export function modePrefix(mode: PaletteMode): string {
  return Object.entries(PREFIXES).find(([, value]) => value === mode)?.[0] ?? "";
}

export type Range = [start: number, end: number];
export type Match = { score: number; ranges: Range[] };

const BOUNDARY = /[\s/\\._\-:([{]/;

/** Scores one search term against text: a substring beats a scattered subsequence. */
function matchTerm(text: string, term: string): Match | null {
  let best: Match | null = null;
  for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + 1)) {
    const boundary = index === 0 || BOUNDARY.test(text[index - 1] ?? "");
    const score = 100 + (boundary ? 40 : 0) - Math.min(index, 40) * 0.5;
    if (!best || score > best.score) best = { score, ranges: [[index, index + term.length]] };
    if (boundary) break;
  }
  if (best) return best;
  const ranges: Range[] = [];
  let cursor = 0;
  for (const character of term) {
    const index = text.indexOf(character, cursor);
    if (index < 0) return null;
    const last = ranges.at(-1);
    if (last && last[1] === index) last[1] = index + 1;
    else ranges.push([index, index + 1]);
    cursor = index + 1;
  }
  return { score: 30 - ranges.length * 4 - Math.min(ranges[0]?.[0] ?? 0, 20) * 0.5, ranges };
}

/**
 * Matches a query of space-separated terms. Every term must occur in `primary` or in
 * `secondary`; the returned ranges highlight `primary` only.
 */
export function fuzzyMatch(primary: string, query: string, secondary = ""): Match | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { score: 0, ranges: [] };
  const first = primary.toLowerCase();
  const second = secondary.toLowerCase();
  let score = 0;
  const ranges: Range[] = [];
  for (const term of terms) {
    const inPrimary = matchTerm(first, term);
    const inSecondary = second ? matchTerm(second, term) : null;
    if (inPrimary && (!inSecondary || inPrimary.score >= inSecondary.score * 0.6)) {
      score += inPrimary.score;
      ranges.push(...inPrimary.ranges);
    } else if (inSecondary) score += inSecondary.score * 0.6;
    else return null;
  }
  return { score: score - primary.length * 0.05, ranges: mergeRanges(ranges) };
}

function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export type Ranked<T> = { item: T; ranges: Range[] };

/** The best `limit` items for a query, best first; an empty query keeps the given order. */
export function rank<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => { primary: string; secondary?: string },
  limit: number,
): Ranked<T>[] {
  if (!query.trim()) return items.slice(0, limit).map((item) => ({ item, ranges: [] }));
  const matches: (Ranked<T> & { score: number; order: number })[] = [];
  for (const [order, item] of items.entries()) {
    const { primary, secondary } = text(item);
    const match = fuzzyMatch(primary, query, secondary);
    if (match) matches.push({ item, ranges: match.ranges, score: match.score, order });
  }
  return matches
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ item, ranges }) => ({ item, ranges }));
}

/** Splits text into plain and highlighted segments for rendering. */
export function highlight(
  text: string,
  ranges: readonly Range[],
): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}
