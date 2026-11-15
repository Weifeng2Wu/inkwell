export type PdfDestination = string | readonly unknown[] | null;
export type PdfOutlineItem = { id: string; title: string; depth: number; dest: PdfDestination };

type DestinationDocument = {
  numPages: number;
  getDestination: (id: string) => Promise<readonly unknown[] | null>;
  getPageIndex: (ref: { num: number; gen: number }) => Promise<number>;
};

/** Flatten a PDF.js outline tree, depth first, into at most `limit` rows. */
export function flattenPdfOutline(value: unknown, limit = 2000) {
  const items: PdfOutlineItem[] = [];
  const visit = (nodes: unknown, depth: number, prefix: string) => {
    if (!Array.isArray(nodes)) return;
    for (const [index, node] of nodes.entries()) {
      if (items.length >= limit) return;
      if (!node || typeof node !== "object") continue;
      const id = `${prefix}${index}`;
      const title = "title" in node && typeof node.title === "string" ? node.title.trim() : "";
      const dest: unknown = "dest" in node ? node.dest : null;
      if (title)
        items.push({
          id,
          title,
          depth,
          dest: typeof dest === "string" || Array.isArray(dest) ? dest : null,
        });
      if ("items" in node) visit(node.items, title ? depth + 1 : depth, `${id}.`);
    }
  };
  visit(value, 0, "");
  return items;
}

function isPageReference(value: unknown): value is { num: number; gen: number } {
  return (
    !!value &&
    typeof value === "object" &&
    "num" in value &&
    typeof value.num === "number" &&
    "gen" in value &&
    typeof value.gen === "number"
  );
}

/** Resolve a named or explicit destination to a 1-based page, or null. */
export async function resolvePdfDestinationPage(pdf: DestinationDocument, dest: PdfDestination) {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    const target: unknown = explicit?.[0];
    const page = isPageReference(target)
      ? (await pdf.getPageIndex(target)) + 1
      : typeof target === "number" && Number.isInteger(target)
        ? target + 1
        : 0;
    return page >= 1 && page <= pdf.numPages ? page : null;
  } catch {
    return null;
  }
}
