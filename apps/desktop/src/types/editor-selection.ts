export type EditorSelection = {
  text: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

/** A passage selected in a PDF; `page` is 1-based. */
export type PdfExcerpt = { text: string; page: number };

/** A passage attached to the next agent prompt, from a text editor or a PDF. */
export type SelectionAttachment = (EditorSelection | PdfExcerpt) & {
  id: string;
  /** Project-relative path of the source document. */
  path: string;
};

export function isPdfExcerpt(selection: EditorSelection | PdfExcerpt): selection is PdfExcerpt {
  return "page" in selection;
}
