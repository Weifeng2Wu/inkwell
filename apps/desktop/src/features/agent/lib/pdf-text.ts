import { PDF_DOCUMENT_OPTIONS } from "@/features/editor/lib/pdf-options";

export type PdfText = {
  /** Page texts joined in order, each introduced by a `[page N]` line. */
  text: string;
  pages: number;
  /** Non-whitespace characters found in the text layer, excluding page markers. */
  characters: number;
  /** True when extraction stopped early because `maxChars` was reached. */
  truncated: boolean;
};

/**
 * Reads the embedded text layer of a PDF locally with PDF.js. Nothing leaves the
 * machine. Scanned documents have no text layer and yield (almost) no characters.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  maxChars: number,
  signal?: AbortSignal,
): Promise<PdfText> {
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const task = pdfjs.getDocument({
    ...PDF_DOCUMENT_OPTIONS,
    data: bytes,
    isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    const parts: string[] = [];
    let length = 0;
    let characters = 0;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      signal?.throwIfAborted();
      if (length > maxChars) {
        truncated = true;
        break;
      }
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const body = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("")
        .trim();
      page.cleanup();
      characters += body.replace(/\s+/g, "").length;
      const part = `[page ${pageNumber}]\n${body}`;
      parts.push(part);
      length += part.length + 2;
    }
    return { text: parts.join("\n\n"), pages: pdf.numPages, characters, truncated };
  } finally {
    await task.destroy();
  }
}
