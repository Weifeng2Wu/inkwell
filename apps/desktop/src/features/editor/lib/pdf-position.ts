import { appStorage, desktopStorage, storageRequest } from "@/lib/storage/app-storage";

export const PDF_POSITION_STORAGE = "inkwell-pdf-position-v1";
export const PDF_POSITION_LIMIT = 200;

export type PdfReadingMode = "read" | "write";
/** `mode` is the reader's choice for a compiled PDF; it is absent until they make one. */
export type PdfPosition = {
  page: number;
  scale: number;
  fitWidth: boolean;
  mode?: PdfReadingMode;
};

export function pdfPositionKey(projectPath: string, pdfPath: string) {
  return `${projectPath}\n${pdfPath}`;
}

function validPosition(value: unknown): value is PdfPosition {
  if (!value || typeof value !== "object") return false;
  const { page, scale, fitWidth, mode } = value as Record<string, unknown>;
  return (
    (mode === undefined || mode === "read" || mode === "write") &&
    typeof page === "number" &&
    Number.isInteger(page) &&
    page >= 1 &&
    typeof scale === "number" &&
    Number.isFinite(scale) &&
    scale >= 0.25 &&
    scale <= 4 &&
    typeof fitWidth === "boolean"
  );
}

/** Stored positions, oldest first. Damaged entries are dropped, never thrown. */
export function parsePdfPositions(raw: string | null | undefined): Map<string, PdfPosition> {
  const positions = new Map<string, PdfPosition>();
  if (!raw) return positions;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return positions;
    for (const [key, value] of Object.entries(parsed))
      if (validPosition(value))
        positions.set(key, {
          page: value.page,
          scale: value.scale,
          fitWidth: value.fitWidth,
          ...(value.mode ? { mode: value.mode } : {}),
        });
  } catch {
    /* A damaged preference only loses reading positions. */
  }
  return positions;
}

export function readPdfPosition(raw: string | null | undefined, key: string) {
  return parsePdfPositions(raw).get(key) ?? null;
}

/**
 * Record `position` as the most recent entry, keeping only the latest `limit`.
 * A position without a mode keeps the mode already stored for that PDF.
 */
export function writePdfPosition(
  raw: string | null | undefined,
  key: string,
  position: PdfPosition,
  limit = PDF_POSITION_LIMIT,
) {
  const positions = parsePdfPositions(raw);
  const mode = position.mode ?? positions.get(key)?.mode;
  positions.delete(key);
  positions.set(key, {
    page: Math.max(1, Math.trunc(position.page)),
    scale: Math.max(0.25, Math.min(position.scale, 4)),
    fitWidth: position.fitWidth,
    ...(mode ? { mode } : {}),
  });
  const entries = [...positions].slice(-Math.max(1, limit));
  // A null-prototype map keeps numeric-looking or `__proto__` paths in order.
  const output: Record<string, PdfPosition> = Object.create(null);
  for (const [entryKey, value] of entries) output[entryKey] = value;
  return JSON.stringify(output);
}

/**
 * The desktop settings database rejects keys missing from its allow-list
 * (`KEYS` in packages/academic-agent/src/storage.mjs), and one rejected key
 * fails every other preference queued in the same batch. The first desktop
 * write therefore goes out as its own request; only once that is accepted do
 * later writes join the shared queue. Until then positions last for the session.
 */
let desktopSupport: "unknown" | "probing" | "yes" | "no" = "unknown";
let sessionPositions: string | null = null;

function storedPositions() {
  if (desktopStorage() && sessionPositions !== null) return sessionPositions;
  try {
    return appStorage.getItem(PDF_POSITION_STORAGE);
  } catch {
    return null;
  }
}

function commit(value: string) {
  try {
    appStorage.setItem(PDF_POSITION_STORAGE, value);
  } catch {
    /* Reading positions are a convenience; the PDF stays usable. */
  }
}

export function loadPdfPosition(key: string) {
  return readPdfPosition(storedPositions(), key);
}

export function savePdfPosition(key: string, position: PdfPosition) {
  const next = writePdfPosition(storedPositions(), key, position);
  if (!desktopStorage()) {
    commit(next);
    return;
  }
  sessionPositions = next;
  if (desktopSupport === "yes") commit(next);
  if (desktopSupport !== "unknown") return;
  desktopSupport = "probing";
  void storageRequest({ type: "settings_write", entries: [[PDF_POSITION_STORAGE, next]] }).then(
    () => {
      desktopSupport = "yes";
      if (sessionPositions !== null) commit(sessionPositions);
    },
    () => {
      desktopSupport = "no";
    },
  );
}

/** Remember the reading mode chosen for a PDF, alongside its position. */
export function savePdfMode(key: string, mode: PdfReadingMode) {
  savePdfPosition(key, {
    ...(loadPdfPosition(key) ?? { page: 1, scale: 1, fitWidth: true }),
    mode,
  });
}
