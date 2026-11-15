// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));

import {
  loadPdfPosition,
  PDF_POSITION_STORAGE,
  parsePdfPositions,
  pdfPositionKey,
  readPdfPosition,
  writePdfPosition,
} from "./pdf-position";

const position = { page: 3, scale: 1.25, fitWidth: false };

describe("PDF reading positions", () => {
  it("keys a position by project and PDF path", () => {
    expect(pdfPositionKey("/project", "papers/a.pdf")).toBe("/project\npapers/a.pdf");
    expect(pdfPositionKey("/a", "b/c.pdf")).not.toBe(pdfPositionKey("/a/b", "c.pdf"));
  });

  it("round-trips a position as a JSON object map", () => {
    const raw = writePdfPosition(null, "/p\na.pdf", position);
    expect(JSON.parse(raw)).toEqual({ "/p\na.pdf": position });
    expect(readPdfPosition(raw, "/p\na.pdf")).toEqual(position);
    expect(readPdfPosition(raw, "/p\nb.pdf")).toBeNull();
    expect(readPdfPosition(null, "/p\na.pdf")).toBeNull();
  });

  it("moves an updated PDF to the most recent slot and keeps the others", () => {
    let raw = writePdfPosition(null, "a", position);
    raw = writePdfPosition(raw, "b", position);
    raw = writePdfPosition(raw, "a", { page: 9, scale: 2, fitWidth: true });
    expect([...parsePdfPositions(raw).keys()]).toEqual(["b", "a"]);
    expect(readPdfPosition(raw, "a")).toEqual({ page: 9, scale: 2, fitWidth: true });
    expect(readPdfPosition(raw, "b")).toEqual(position);
  });

  it("keeps the chosen reading mode when only the position is saved again", () => {
    let raw = writePdfPosition(null, "a", { ...position, mode: "read" });
    raw = writePdfPosition(raw, "a", { page: 9, scale: 2, fitWidth: true });
    expect(readPdfPosition(raw, "a")).toEqual({ page: 9, scale: 2, fitWidth: true, mode: "read" });
    raw = writePdfPosition(raw, "a", { ...position, mode: "write" });
    expect(readPdfPosition(raw, "a")?.mode).toBe("write");
    expect(
      readPdfPosition('{"a":{"page":1,"scale":1,"fitWidth":true,"mode":"edit"}}', "a"),
    ).toBeNull();
  });

  it("keeps only the 200 most recently read PDFs", () => {
    let raw: string | null = null;
    for (let index = 0; index < 205; index += 1)
      raw = writePdfPosition(raw, `/p\n${index}.pdf`, { ...position, page: index + 1 });
    raw = writePdfPosition(raw, "/p\n10.pdf", position);
    const keys = [...parsePdfPositions(raw).keys()];
    expect(keys).toHaveLength(200);
    expect(keys[0]).toBe("/p\n5.pdf");
    expect(keys.at(-1)).toBe("/p\n10.pdf");
    expect(readPdfPosition(raw, "/p\n4.pdf")).toBeNull();
    expect(readPdfPosition(raw, "/p\n204.pdf")?.page).toBe(205);
  });

  it("ignores damaged storage and invalid entries instead of failing", () => {
    for (const raw of ["", "not json", "[]", "null", '"text"', "42"])
      expect(parsePdfPositions(raw).size).toBe(0);
    const raw = JSON.stringify({
      good: position,
      zero: { ...position, page: 0 },
      fraction: { ...position, page: 1.5 },
      tiny: { ...position, scale: 0.1 },
      huge: { ...position, scale: 40 },
      text: { ...position, fitWidth: "yes" },
      partial: { page: 2 },
      nothing: null,
    });
    expect([...parsePdfPositions(raw).keys()]).toEqual(["good"]);
    expect(readPdfPosition(writePdfPosition("not json", "a", position), "a")).toEqual(position);
  });

  it("normalizes what it stores and handles unusual paths", () => {
    const raw = writePdfPosition(null, "__proto__", { page: 2.7, scale: 9, fitWidth: true });
    expect(readPdfPosition(raw, "__proto__")).toEqual({ page: 2, scale: 4, fitWidth: true });
    expect(readPdfPosition(writePdfPosition(raw, "x", { ...position, page: -4 }), "x")?.page).toBe(
      1,
    );
  });
});

describe("PDF reading position storage", () => {
  const key = pdfPositionKey("/project", "paper.pdf");
  async function load() {
    vi.resetModules();
    return await import("./pdf-position");
  }
  beforeEach(() => {
    localStorage.clear();
    mock.invoke.mockReset();
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("reads and writes browser storage outside the desktop shell", async () => {
    const { savePdfPosition } = await load();
    expect(loadPdfPosition(key)).toBeNull();
    savePdfPosition(key, position);
    expect(JSON.parse(localStorage.getItem(PDF_POSITION_STORAGE) ?? "{}")).toEqual({
      [key]: position,
    });
    expect(loadPdfPosition(key)).toEqual(position);
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("keeps positions for the session when the desktop database rejects the key", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    mock.invoke.mockRejectedValue(new Error("Invalid setting."));
    const module = await load();
    module.savePdfPosition(key, position);
    module.savePdfPosition(key, { ...position, page: 7 });
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    // One isolated probe; the rejected key never joins the shared settings batch.
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke.mock.calls[0]?.[1]).toMatchObject({
      request: { type: "settings_write", entries: [[PDF_POSITION_STORAGE, expect.any(String)]] },
    });
    expect(module.loadPdfPosition(key)?.page).toBe(7);
  });
});
