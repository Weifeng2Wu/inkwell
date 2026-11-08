import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPdfNotes,
  type PdfAnnotation,
  parsePdfNotes,
  upsertPdfAnnotation,
} from "./pdf-notes";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mock.listen }));

import { getPdfNotesSession, PdfNotesSession } from "./pdf-notes-session";

const annotation: PdfAnnotation = {
  id: "note-1",
  page: 1,
  kind: "highlight",
  quote: "A sentence",
  fingerprint: "revision-1",
  rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.02 }],
  note: "Original comment",
};
let disk: string;

beforeEach(() => {
  disk = createPdfNotes("paper.pdf", "Notes", "Free notes");
  mock.invoke.mockReset();
  mock.listen.mockReset();
  mock.listen.mockResolvedValue(() => {});
  mock.invoke.mockImplementation(async (command: string, request: Record<string, unknown>) => {
    if (command === "pdf_notes_load")
      return { path: "paper.pdf.notes.md", content: disk, canSyncSource: false };
    if (command === "pdf_notes_save") {
      if (request.expectedContent !== disk) throw new Error("PDF_NOTES_CONFLICT");
      disk = String(request.content);
      return;
    }
    throw new Error("Unexpected IPC command");
  });
});

describe("shared PDF notes persistence", () => {
  it("uses one shared session for the same project/PDF but isolates other projects and directories", () => {
    const one = getPdfNotesSession("C:/project", "paper.pdf", "");
    expect(getPdfNotesSession("c:\\project", "paper.pdf", "")).toBe(one);
    expect(getPdfNotesSession("C:/project", "C:\\project\\paper.pdf", "")).toBe(one);
    expect(getPdfNotesSession("C:/other", "paper.pdf", "")).not.toBe(one);
    expect(getPdfNotesSession("C:/project", "references/paper.pdf", "")).not.toBe(one);
  });

  it("serializes simultaneous highlights rather than losing one of them", async () => {
    const session = new PdfNotesSession("/project", "paper.pdf", disk);
    await Promise.all([
      session.upsert(annotation, "Page 1"),
      session.upsert({ ...annotation, id: "note-2" }, "Page 1"),
    ]);
    expect(parsePdfNotes(disk).annotations.map((item) => item.id)).toEqual(["note-1", "note-2"]);
    expect(session.getSnapshot().annotations).toHaveLength(2);
    expect(
      mock.invoke.mock.calls.every(([, request]) => request.expectedProject === "/project"),
    ).toBe(true);
  });

  it("saves a cross-page selection in a single atomic Markdown replacement", async () => {
    const session = new PdfNotesSession("/project", "paper.pdf", disk);
    await session.addMany(
      [annotation, { ...annotation, id: "note-2", page: 2 }],
      ["Page 1", "Page 2"],
    );
    expect(parsePdfNotes(disk).annotations).toHaveLength(2);
    expect(mock.invoke.mock.calls.filter(([command]) => command === "pdf_notes_save")).toHaveLength(
      1,
    );
  });

  it("detects concurrent Markdown edits and retains the newer disk content", async () => {
    const session = new PdfNotesSession("/project", "paper.pdf", disk);
    const baseline = disk;
    disk += "\nNew external notes\n";
    await expect(
      session.replaceMarkdown(`${baseline}\nMy local draft\n`, baseline),
    ).rejects.toThrow("PDF_NOTES_CONFLICT");
    expect(disk).toContain("New external notes");
    expect(disk).not.toContain("My local draft");
    expect(session.getSnapshot().content).toBe(disk);
  });

  it("does not overwrite a comment edited directly in the Markdown while its popup was open", async () => {
    const session = new PdfNotesSession("/project", "paper.pdf", disk);
    disk = upsertPdfAnnotation(disk, { ...annotation, note: "Edited in Markdown" }, "Page 1");
    await expect(
      session.upsert({ ...annotation, note: "Older popup draft" }, "Page 1", annotation.note),
    ).rejects.toThrow("PDF_NOTES_CONFLICT");
    expect(parsePdfNotes(disk).annotations[0]?.note).toBe("Edited in Markdown");
    await expect(session.remove(annotation.id, annotation.note)).rejects.toThrow(
      "PDF_NOTES_CONFLICT",
    );
  });

  it("exposes damaged Markdown for repair but blocks annotation writes", async () => {
    const session = new PdfNotesSession("/project", "paper.pdf", disk);
    disk = "Keep my damaged notes";
    await session.reload();
    expect(session.getSnapshot()).toMatchObject({
      content: disk,
      error: "PDF_NOTES_INVALID",
      annotations: [],
    });
    await expect(session.upsert(annotation, "Page 1")).rejects.toThrow("PDF_NOTES_INVALID");
    expect(disk).toBe("Keep my damaged notes");
  });

  it("does not block closing after a load error in a read-only or unavailable PDF folder", async () => {
    const session = new PdfNotesSession("/project", "paper.pdf", disk);
    mock.invoke.mockRejectedValue(new Error("Permission denied"));
    await expect(session.reload()).rejects.toThrow("Permission denied");
    await expect(session.flush()).resolves.toBeUndefined();
  });

  it("keeps old revision anchors in Markdown instead of deleting them on reload", async () => {
    const session = new PdfNotesSession("/project", "paper.pdf", disk);
    await session.upsert(annotation, "Page 1");
    await session.upsert(
      { ...annotation, id: "new-revision", fingerprint: "revision-2" },
      "Page 1",
    );
    expect(session.getSnapshot().annotations.map((item) => item.fingerprint)).toEqual([
      "revision-1",
      "revision-2",
    ]);
  });
});
