import { describe, expect, it, vi } from "vitest";
import { flattenPdfOutline, resolvePdfDestinationPage } from "./pdf-outline";

describe("PDF outline", () => {
  it("flattens nested entries with their depth and stable ids", () => {
    const items = flattenPdfOutline([
      {
        title: " 1 Introduction ",
        dest: "intro",
        items: [
          { title: "1.1 Scope", dest: [{ num: 4, gen: 0 }], items: [] },
          { title: "", dest: null, items: [{ title: "Orphan", dest: null, items: [] }] },
        ],
      },
      { title: "2 Method", dest: 7 },
      "not an entry",
    ]);
    expect(items.map(({ title, depth }) => [title, depth])).toEqual([
      ["1 Introduction", 0],
      ["1.1 Scope", 1],
      ["Orphan", 1],
      ["2 Method", 0],
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(4);
    expect(items[0]?.dest).toBe("intro");
    expect(items[3]?.dest).toBeNull();
  });

  it("returns nothing for a missing outline and bounds very large ones", () => {
    expect(flattenPdfOutline(null)).toEqual([]);
    expect(flattenPdfOutline(undefined)).toEqual([]);
    const many = Array.from({ length: 50 }, (_, index) => ({ title: `Item ${index}`, items: [] }));
    expect(flattenPdfOutline(many, 10)).toHaveLength(10);
  });

  it("resolves named, explicit and numeric destinations to 1-based pages", async () => {
    const pdf = {
      numPages: 10,
      getDestination: vi.fn(async (id: string) => (id === "intro" ? [{ num: 12, gen: 0 }] : null)),
      getPageIndex: vi.fn(async (ref: { num: number }) => {
        if (ref.num === 99) throw new Error("unknown reference");
        return ref.num === 12 ? 2 : 40;
      }),
    };
    expect(await resolvePdfDestinationPage(pdf, "intro")).toBe(3);
    expect(await resolvePdfDestinationPage(pdf, [{ num: 12, gen: 0 }, { name: "Fit" }])).toBe(3);
    expect(await resolvePdfDestinationPage(pdf, [4, { name: "XYZ" }])).toBe(5);
    expect(await resolvePdfDestinationPage(pdf, "missing")).toBeNull();
    expect(await resolvePdfDestinationPage(pdf, [{ num: 99, gen: 0 }])).toBeNull();
    expect(await resolvePdfDestinationPage(pdf, [{ num: 5, gen: 0 }])).toBeNull();
    expect(await resolvePdfDestinationPage(pdf, [])).toBeNull();
    expect(await resolvePdfDestinationPage(pdf, null)).toBeNull();
  });
});
