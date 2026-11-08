export type PdfReadingMode = "read" | "write";
export type PdfAnnotationKind = "highlight" | "underline";
export const PDF_ANNOTATION_COLORS = ["warning", "success", "info", "accent", "error"] as const;
export type PdfAnnotationColor = (typeof PDF_ANNOTATION_COLORS)[number];
export function isPdfAnnotationColor(value: unknown): value is PdfAnnotationColor {
  return PDF_ANNOTATION_COLORS.some((color) => color === value);
}
export type PdfAnnotationRect = { x: number; y: number; width: number; height: number };
export type PdfAnnotation = {
  id: string;
  page: number;
  kind: PdfAnnotationKind;
  color?: PdfAnnotationColor;
  quote: string;
  fingerprint: string;
  rects: PdfAnnotationRect[];
  note: string;
};

const HEADER = "<!-- inkwell-pdf-notes ";
const START = "<!-- inkwell-pdf-annotation ";
const COMMENT = "<!-- inkwell-pdf-comment -->";
const END = "<!-- /inkwell-pdf-annotation -->";
const RESERVED = /<!--\s*\/?inkwell-pdf-/;

function metadata(value: unknown) {
  return JSON.stringify(value).replace(
    /[<>&]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function pdfNotesPath(pdfPath: string) {
  return `${pdfPath}.notes.md`;
}

export function pdfPathFromNotes(path: string) {
  return /\.pdf\.notes\.md$/i.test(path) ? path.slice(0, -".notes.md".length) : undefined;
}

export function createPdfNotes(pdfPath: string, title: string, introduction: string) {
  const name = pdfPath.replace(/\\/g, "/").split("/").pop() ?? pdfPath;
  const safeName = name.replace(/[\\`*_{}[\]<>#]/g, "\\$&");
  return `${HEADER}${metadata({ version: 1, pdf: name })} -->\n\n# ${title}: ${safeName}\n\n${introduction}\n`;
}

function isRect(value: unknown): value is PdfAnnotationRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as Record<string, unknown>;
  const { x, y, width, height } = rect;
  return (
    [x, y, width, height].every(
      (number) => typeof number === "number" && Number.isFinite(number),
    ) &&
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number" &&
    x >= 0 &&
    y >= 0 &&
    width > 0 &&
    height > 0 &&
    x + width <= 1.001 &&
    y + height <= 1.001
  );
}

function readAnnotation(value: unknown, note: string): PdfAnnotation {
  if (!value || typeof value !== "object") throw new Error("PDF_NOTES_INVALID");
  const data = value as Record<string, unknown>;
  if (
    typeof data.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(data.id) ||
    typeof data.page !== "number" ||
    !Number.isSafeInteger(data.page) ||
    data.page < 1 ||
    !["highlight", "underline"].includes(String(data.kind)) ||
    (data.color !== undefined && !isPdfAnnotationColor(data.color)) ||
    typeof data.quote !== "string" ||
    data.quote.length > 20000 ||
    typeof data.fingerprint !== "string" ||
    !data.fingerprint ||
    data.fingerprint.length > 256 ||
    !Array.isArray(data.rects) ||
    data.rects.length < 1 ||
    data.rects.length > 500 ||
    !data.rects.every(isRect)
  )
    throw new Error("PDF_NOTES_INVALID");
  return {
    id: data.id,
    page: data.page,
    kind: data.kind as PdfAnnotationKind,
    ...(isPdfAnnotationColor(data.color) ? { color: data.color } : {}),
    quote: data.quote,
    fingerprint: data.fingerprint,
    rects: data.rects,
    note,
  };
}

export function parsePdfNotes(content: string) {
  const header = content.match(/^<!-- inkwell-pdf-notes (.+) -->\r?\n/);
  if (!header?.[1]) throw new Error("PDF_NOTES_INVALID");
  const info: unknown = JSON.parse(header[1]);
  if (
    !info ||
    typeof info !== "object" ||
    !("version" in info) ||
    info.version !== 1 ||
    !("pdf" in info) ||
    typeof info.pdf !== "string" ||
    ("mode" in info && info.mode !== "read" && info.mode !== "write")
  ) {
    throw new Error("PDF_NOTES_INVALID");
  }
  const blocks = [
    ...content.matchAll(
      /<!-- inkwell-pdf-annotation (.+) -->\r?\n([\s\S]*?)<!-- inkwell-pdf-comment -->\r?\n([\s\S]*?)<!-- \/inkwell-pdf-annotation -->/g,
    ),
  ];
  if (
    blocks.length > 5000 ||
    blocks.length !== content.split(START).length - 1 ||
    blocks.length !== content.split(END).length - 1 ||
    blocks.length !== content.split(COMMENT).length - 1
  )
    throw new Error("PDF_NOTES_INVALID");
  const ids = new Set<string>();
  const annotations = blocks.map((block) => {
    const annotation = readAnnotation(
      JSON.parse(block[1] ?? ""),
      (block[3] ?? "").replace(/\r?\n$/, ""),
    );
    if (ids.has(annotation.id) || RESERVED.test(annotation.note))
      throw new Error("PDF_NOTES_INVALID");
    ids.add(annotation.id);
    return { ...annotation, offset: block.index ?? 0, length: block[0].length };
  });
  return {
    pdf: info.pdf,
    mode: "mode" in info ? (info.mode as PdfReadingMode) : undefined,
    annotations,
  };
}

export function setPdfReadingMode(content: string, mode: PdfReadingMode) {
  parsePdfNotes(content);
  return content.replace(
    /^<!-- inkwell-pdf-notes (.+) -->/,
    (_, json: string) => `${HEADER}${metadata({ ...JSON.parse(json), mode })} -->`,
  );
}

export function upsertPdfAnnotation(content: string, annotation: PdfAnnotation, heading: string) {
  const { annotations } = parsePdfNotes(content);
  readAnnotation(annotation, annotation.note);
  if (RESERVED.test(annotation.note)) throw new Error("PDF_NOTES_INVALID");
  const existing = annotations.find((item) => item.id === annotation.id);
  // The Markdown note body is authoritative; geometry alone is hidden metadata.
  const { note, id, page, kind, color, quote: selectedQuote, fingerprint, rects } = annotation;
  const anchor = { id, page, kind, color, quote: selectedQuote, fingerprint, rects };
  const quote = annotation.quote.replace(/[\\`*_{}[\]<>]/g, "\\$&").replace(/\r?\n/g, "\n> ");
  const block = `${START}${metadata(anchor)} -->\n### ${heading}\n\n> ${quote}\n\n${COMMENT}\n${note}\n${END}`;
  if (!existing)
    return `${content}${content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n"}${block}\n`;
  return (
    content.slice(0, existing.offset) + block + content.slice(existing.offset + existing.length)
  );
}

export function removePdfAnnotation(content: string, id: string) {
  const annotation = parsePdfNotes(content).annotations.find((item) => item.id === id);
  return annotation
    ? content.slice(0, annotation.offset) + content.slice(annotation.offset + annotation.length)
    : content;
}

export function normalizedPdfRect(
  rect: { left: number; top: number; right: number; bottom: number },
  page: { left: number; top: number; width: number; height: number },
): PdfAnnotationRect | undefined {
  if (page.width <= 0 || page.height <= 0) return undefined;
  const left = Math.max(rect.left, page.left);
  const top = Math.max(rect.top, page.top);
  const right = Math.min(rect.right, page.left + page.width);
  const bottom = Math.min(rect.bottom, page.top + page.height);
  if (right - left < 0.5 || bottom - top < 0.5) return undefined;
  return {
    x: (left - page.left) / page.width,
    y: (top - page.top) / page.height,
    width: (right - left) / page.width,
    height: (bottom - top) / page.height,
  };
}
