import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRequirementFiles } from "./requirement-files";

const parser = vi.hoisted(() => ({ parse: vi.fn(), ready: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/features/settings", () => ({
  parseLayoutPdf: parser.parse,
  requireLayoutConfig: parser.ready,
}));

beforeEach(() => {
  vi.clearAllMocks();
  parser.ready.mockResolvedValue({});
});

const errors = {
  limit: "limit",
  unsupported: "unsupported",
  unreadable: "unreadable",
  emptyPdf: "empty PDF",
  tooLong: "too long",
  layoutMissing: "configure layout parser",
};

describe("submission requirement uploads", () => {
  it("expands author kit ZIPs, preserves source paths and reports skipped entries", async () => {
    vi.mocked(invoke).mockResolvedValue({
      files: Array.from({ length: 12 }, (_, index) => ({
        name: `kit/latex/rules${index}.sty`,
        data: btoa("Use anonymous submission."),
      })),
      skipped: ["kit/logo.png", "kit/nested.zip"],
    });
    const report = vi.fn();
    const sources = await readRequirementFiles(
      [new File(["zip"], "author-kit.zip")],
      errors,
      report,
    );
    expect(sources).toHaveLength(12);
    expect(sources[11]).toEqual({
      id: "S12",
      name: "author-kit.zip/kit/latex/rules11.sty",
      text: "Use anonymous submission.",
    });
    expect(report).toHaveBeenCalledWith([
      "author-kit.zip/kit/logo.png",
      "author-kit.zip/kit/nested.zip",
    ]);
    expect(invoke).toHaveBeenCalledWith("agent_shared_skills", {
      request: { type: "format_requirements_zip", data: btoa("zip") },
    });
  });

  it("reports unreadable archive members without silently losing readable requirements", async () => {
    vi.mocked(invoke).mockResolvedValue({
      files: [
        { name: "rules.txt", data: btoa("At most 8 pages.") },
        { name: "binary.sty", data: btoa("\0") },
      ],
      skipped: [],
    });
    const report = vi.fn();
    const sources = await readRequirementFiles([new File(["zip"], "kit.zip")], errors, report);
    expect(sources).toHaveLength(1);
    expect(report.mock.calls[0]?.[0][0]).toContain("kit.zip/binary.sty");
  });

  it("rejects ZIP extraction failures and total text overflow instead of partial import", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Unsafe ZIP path"));
    await expect(readRequirementFiles([new File(["zip"], "kit.zip")], errors)).rejects.toThrow(
      "Unsafe ZIP",
    );
    vi.mocked(invoke).mockResolvedValue({
      files: [{ name: "rules.txt", data: btoa("x".repeat(80001)) }],
      skipped: [],
    });
    await expect(readRequirementFiles([new File(["zip"], "kit.zip")], errors)).rejects.toThrow(
      "too long",
    );
  });
  it("reads multiple LaTeX and UTF-8 text sources without executing them", async () => {
    const sources = await readRequirementFiles(
      [
        new File(["\\documentclass{article}"], "template.tex"),
        new File(["正文不超过8页"], "rules.txt"),
      ],
      errors,
    );
    expect(sources.map(({ id }) => id)).toEqual(["S1", "S2"]);
    expect(sources[1]?.text).toBe("正文不超过8页");
  });
  it("rejects unsupported, binary and empty inputs", async () => {
    await expect(readRequirementFiles([new File(["x"], "script.exe")], errors)).rejects.toThrow(
      "unsupported",
    );
    await expect(
      readRequirementFiles([new File([new Uint8Array([255])], "rules.txt")], errors),
    ).rejects.toThrow("unreadable");
    await expect(readRequirementFiles([new File([""], "rules.txt")], errors)).rejects.toThrow(
      "unreadable",
    );
  });
  it("fails explicitly instead of silently truncating oversized requirements", async () => {
    await expect(
      readRequirementFiles([new File(["a".repeat(80001)], "rules.txt")], errors),
    ).rejects.toThrow("too long");
    await expect(
      readRequirementFiles(
        Array.from({ length: 9 }, () => new File(["x"], "rules.txt")),
        errors,
      ),
    ).rejects.toThrow("limit");
  });

  it("routes PDFs through the selected layout parser and preserves parsed evidence", async () => {
    parser.parse.mockResolvedValue("[Page 1]\nUse 10 pt font.\n[Page 2]\nMaximum 8 pages.");
    const file = new File(["pdf"], "rules.pdf");
    const sources = await readRequirementFiles([file], errors);
    expect(parser.ready).toHaveBeenCalledOnce();
    expect(parser.parse).toHaveBeenCalledWith(file, errors.layoutMissing);
    expect(sources[0]?.text).toContain("[Page 2]\nMaximum 8 pages.");
  });

  it("blocks missing parser configuration even for PDFs inside an author kit", async () => {
    vi.mocked(invoke).mockResolvedValue({
      files: [{ name: "rules.pdf", data: btoa("pdf") }],
      skipped: [],
    });
    parser.ready.mockRejectedValueOnce(new Error("configure layout parser"));
    await expect(readRequirementFiles([new File(["zip"], "kit.zip")], errors)).rejects.toThrow(
      "configure layout parser",
    );
    expect(parser.parse).not.toHaveBeenCalled();
  });

  it("does not silently skip a cloud parser failure in an archive", async () => {
    vi.mocked(invoke).mockResolvedValue({
      files: [{ name: "rules.pdf", data: btoa("pdf") }],
      skipped: [],
    });
    parser.parse.mockRejectedValueOnce(new Error("Parser HTTP 401"));
    await expect(readRequirementFiles([new File(["zip"], "kit.zip")], errors)).rejects.toThrow(
      "Parser HTTP 401",
    );
  });
});
