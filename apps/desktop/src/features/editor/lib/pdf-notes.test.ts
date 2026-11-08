import { describe, expect, it } from "vitest";
import {
  createPdfNotes,
  normalizedPdfRect,
  type PdfAnnotation,
  parsePdfNotes,
  pdfNotesPath,
  pdfPathFromNotes,
  removePdfAnnotation,
  setPdfReadingMode,
  upsertPdfAnnotation,
} from "./pdf-notes";

const initial = createPdfNotes("papers/example.pdf", "Reading notes", "Free-form notes here.");
const annotation: PdfAnnotation = {
  id: "annotation-1",
  page: 2,
  kind: "highlight",
  quote: "Important **quoted** text\nand a second line",
  fingerprint: "revision-1",
  rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.02 }],
  note: "My **comment**.\n\n- A detail",
};

describe("PDF Markdown sidecars", () => {
  it("round-trips all annotation colors and remains compatible with uncolored anchors", () => {
    expect(parsePdfNotes(upsertPdfAnnotation(initial, annotation, "Page 2")).annotations[0]?.color).toBeUndefined();
    for (const color of ["warning", "success", "info", "accent", "error"] as const) {
      const colored = { ...annotation, color };
      const content = upsertPdfAnnotation(initial, colored, "Page 2");
      expect(parsePdfNotes(content).annotations[0]).toMatchObject(colored);
      expect(content).not.toContain('"note":');
      expect(content).toContain(annotation.note);
    }
    const invalid = upsertPdfAnnotation(initial, { ...annotation, color: "info" }, "Page 2").replace('"color":"info"', '"color":"unknown"');
    expect(() => parsePdfNotes(invalid)).toThrow("PDF_NOTES_INVALID");
  });
  it("keeps the full PDF name and directory for an unambiguous association", () => {
    expect(pdfNotesPath("papers/example.pdf")).toBe("papers/example.pdf.notes.md");
    expect(pdfNotesPath("references/example.pdf")).not.toBe(pdfNotesPath("papers/example.pdf"));
    expect(pdfPathFromNotes("papers/example.PDF.notes.md")).toBe("papers/example.PDF");
    expect(pdfPathFromNotes("ordinary.notes.md")).toBeUndefined();
    expect(parsePdfNotes(initial)).toMatchObject({
      pdf: "example.pdf",
      mode: undefined,
      annotations: [],
    });
  });

  it("round-trips highlight anchors and human-readable Markdown without rewriting the PDF", () => {
    const content = upsertPdfAnnotation(initial, annotation, "Page 2 · Highlight");
    expect(parsePdfNotes(content).annotations[0]).toMatchObject(annotation);
    expect(content).toContain("> Important \\*\\*quoted\\*\\* text\n> and a second line");
    expect(content).toContain("My **comment**.\n\n- A detail");
    expect(content).not.toContain('"note":');
  });

  it("uses manually edited Markdown comments as the authoritative popup text", () => {
    const content = upsertPdfAnnotation(initial, annotation, "Page 2").replace(
      "My **comment**.",
      "Edited in Markdown.",
    );
    const parsed = parsePdfNotes(content).annotations[0];
    expect(parsed?.note).toBe("Edited in Markdown.\n\n- A detail");
    expect(parsed?.rects).toEqual(annotation.rects);
  });

  it("updates and removes only the selected annotation while preserving free-form notes", () => {
    const free = `${initial}\n## My summary\n\nKeep all of this.\n`;
    const first = upsertPdfAnnotation(free, annotation, "Page 2");
    const second = upsertPdfAnnotation(
      first,
      { ...annotation, id: "annotation-2", kind: "underline", page: 3 },
      "Page 3",
    );
    const updated = upsertPdfAnnotation(second, { ...annotation, note: "Changed." }, "Page 2");
    expect(parsePdfNotes(updated).annotations.map((item) => item.note)).toEqual([
      "Changed.",
      annotation.note,
    ]);
    const removed = removePdfAnnotation(updated, annotation.id);
    expect(removed).toContain("Keep all of this.");
    expect(parsePdfNotes(removed).annotations.map((item) => item.id)).toEqual(["annotation-2"]);
    expect(removePdfAnnotation(removed, "absent")).toBe(removed);
  });

  it("persists a per-document mode without changing note bodies", () => {
    const content = upsertPdfAnnotation(initial, annotation, "Page 2");
    const reading = setPdfReadingMode(content, "read");
    expect(parsePdfNotes(reading).mode).toBe("read");
    expect(parsePdfNotes(setPdfReadingMode(reading, "write")).mode).toBe("write");
    expect(reading.slice(reading.indexOf("\n"))).toBe(content.slice(content.indexOf("\n")));
  });

  it("supports Windows CRLF notes", () => {
    const content = upsertPdfAnnotation(initial, annotation, "Page 2").replaceAll("\n", "\r\n");
    expect(parsePdfNotes(content).annotations[0]?.note).toBe(
      annotation.note.replaceAll("\n", "\r\n"),
    );
  });

  it("preserves Markdown indentation, hard breaks and free-form trailing whitespace", () => {
    const free = `${initial}\nSummary with a hard break  \n\n`;
    const note = "    indented code\n\nA hard break  \nNext line\n";
    const content = upsertPdfAnnotation(free, { ...annotation, note }, "Page 2");
    expect(content.startsWith(free)).toBe(true);
    expect(parsePdfNotes(content).annotations[0]?.note).toBe(note);
  });

  it("escapes hostile PDF text so it cannot break hidden metadata or become active HTML", () => {
    const content = upsertPdfAnnotation(
      initial,
      { ...annotation, quote: "<img src=x onerror=alert(1)> -->" },
      "Page 2",
    );
    expect(parsePdfNotes(content).annotations[0]?.quote).toBe("<img src=x onerror=alert(1)> -->");
    expect(content).not.toContain("> <img");
    expect(content).toContain("\\u003cimg");
  });

  it("fails closed on truncated, duplicate, or malformed anchors", () => {
    const content = upsertPdfAnnotation(initial, annotation, "Page 2");
    expect(() => parsePdfNotes(content.replace("<!-- /inkwell-pdf-annotation -->", ""))).toThrow();
    expect(() =>
      parsePdfNotes(content + content.slice(content.indexOf("<!-- inkwell-pdf-annotation "))),
    ).toThrow();
    expect(() => parsePdfNotes(content.replace('"page":2', '"page":0'))).toThrow();
    expect(() => parsePdfNotes(content.replace('"width":0.5', '"width":9'))).toThrow();
    expect(() =>
      upsertPdfAnnotation(
        content,
        { ...annotation, note: "<!-- /inkwell-pdf-annotation -->" },
        "Page 2",
      ),
    ).toThrow();
    expect(() =>
      upsertPdfAnnotation("My unrelated existing notes", annotation, "Page 2"),
    ).toThrow();
  });
});

describe("normalized PDF annotation geometry", () => {
  it("has identical page coordinates at different zoom and scroll offsets", () => {
    const small = normalizedPdfRect(
      { left: 160, top: 360, right: 460, bottom: 376 },
      { left: 100, top: 200, width: 600, height: 800 },
    );
    const large = normalizedPdfRect(
      { left: 220, top: 320, right: 820, bottom: 352 },
      { left: 100, top: 0, width: 1200, height: 1600 },
    );
    expect(small).toEqual(large);
    expect(small).toEqual({ x: 0.1, y: 0.2, width: 0.5, height: 0.02 });
  });

  it("clips rectangles to the page and ignores empty/outside selections", () => {
    const page = { left: 100, top: 200, width: 600, height: 800 };
    expect(normalizedPdfRect({ left: 80, top: 190, right: 160, bottom: 216 }, page)).toEqual({
      x: 0,
      y: 0,
      width: 0.1,
      height: 0.02,
    });
    expect(normalizedPdfRect({ left: 0, top: 0, right: 50, bottom: 50 }, page)).toBeUndefined();
    expect(
      normalizedPdfRect({ left: 100, top: 200, right: 100, bottom: 216 }, page),
    ).toBeUndefined();
  });
});
