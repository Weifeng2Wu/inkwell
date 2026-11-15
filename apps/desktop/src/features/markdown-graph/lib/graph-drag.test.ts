import { describe, expect, it } from "vitest";
import { followGraphDrag } from "./graph-drag";
import type { GraphPoint } from "./graph-layout";

const layout = new Map<string, GraphPoint>([
  ["source.md", { x: 100, y: 100 }],
  ["outgoing.md", { x: 300, y: 100 }],
  ["incoming.md", { x: 200, y: 300 }],
  ["isolated.md", { x: 500, y: 500 }],
]);
const edges = [
  { source: "source.md", target: "outgoing.md" },
  { source: "outgoing.md", target: "source.md" },
  { source: "incoming.md", target: "source.md" },
  { source: "source.md", target: "source.md" },
];
const drag = { path: "source.md", origin: { x: 100, y: 100 } };

describe("graph drag following", () => {
  it("gently moves direct neighbors once, including incoming links", () => {
    const overrides = new Map([["source.md", { x: 200, y: 150 }]]);
    const positions = followGraphDrag(layout, edges, overrides, drag);
    expect(positions.get("outgoing.md")).toEqual({ x: 322, y: 111 });
    expect(positions.get("incoming.md")).toEqual({ x: 222, y: 311 });
    expect(positions.get("isolated.md")).toBe(layout.get("isolated.md"));
    expect(positions.get("source.md")).toBe(layout.get("source.md"));
    expect(layout.get("outgoing.md")).toEqual({ x: 300, y: 100 });
  });

  it("bounds the displacement and respects other manually placed nodes", () => {
    const overrides = new Map([
      ["source.md", { x: 10100, y: 10100 }],
      ["outgoing.md", { x: 800, y: 200 }],
    ]);
    const positions = followGraphDrag(layout, edges, overrides, drag);
    const point = positions.get("incoming.md") ?? { x: 0, y: 0 };
    expect(Math.hypot(point.x - 200, point.y - 300)).toBeCloseTo(36);
    expect(positions.get("outgoing.md")).toBe(layout.get("outgoing.md"));
    expect(overrides.get("outgoing.md")).toEqual({ x: 800, y: 200 });
  });

  it("starts each drag from the grabbed position and restores the layout on release", () => {
    const overrides = new Map([["source.md", { x: 800, y: 500 }]]);
    const nextDrag = { path: "source.md", origin: { x: 800, y: 500 } };
    expect(followGraphDrag(layout, edges, overrides, nextDrag)).toBe(layout);
    overrides.set("source.md", { x: 850, y: 500 });
    expect(followGraphDrag(layout, edges, overrides, nextDrag).get("outgoing.md")).toEqual({
      x: 311,
      y: 100,
    });
    expect(followGraphDrag(layout, edges, overrides, null)).toBe(layout);
    expect(followGraphDrag(layout, edges, new Map(), drag)).toBe(layout);
  });
});
