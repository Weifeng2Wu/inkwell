// Local resources are copied from the installed PDF.js package by next.config.ts.
// CMaps are required even for embedded Japanese and Korean CID fonts.
export const PDF_DOCUMENT_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
} as const;
