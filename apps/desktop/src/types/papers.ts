/** A reference from the project library, as other features see it. */
export type Paper = {
  /** BibTeX citation key. */
  key: string;
  title: string;
  /** Display names in "Given Family" order. */
  authors: string[];
  year: string;
  venue: string;
  /** Project-relative path of the linked PDF, when it exists in the project. */
  file?: string;
  /** Project-relative path of the PDF's notes sidecar, when it exists. */
  notes?: string;
};
