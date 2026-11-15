import { describe, expect, it } from "vitest";
import { GRAPH_HEIGHT, GRAPH_RADIUS, GRAPH_WIDTH, layoutGraph } from "./graph-layout";
import { buildMarkdownGraph } from "./markdown-links";

describe("knowledge graph layout", () => {
  it("handles empty and singleton graphs", () => {
    expect(layoutGraph({ nodes: [], edges: [] }).size).toBe(0);
    expect(layoutGraph(buildMarkdownGraph(new Map([["note.md", ""]]))).get("note.md")).toEqual({
      x: GRAPH_WIDTH / 2,
      y: GRAPH_HEIGHT / 2,
      z: 0,
    });
  });

  it("spreads nodes through depth inside a sphere around the canvas centre", () => {
    const graph = buildMarkdownGraph(
      new Map(
        Array.from({ length: 40 }, (_, index) => [
          `note${index}.md`,
          index < 30 ? `[[note${index + 1}]]` : "",
        ]),
      ),
    );
    const depths = [...layoutGraph(graph).values()].map((point) => {
      const depth = point.z ?? 0;
      expect(
        Math.hypot(point.x - GRAPH_WIDTH / 2, point.y - GRAPH_HEIGHT / 2, depth),
      ).toBeLessThanOrEqual(GRAPH_RADIUS + 0.001);
      return depth;
    });
    expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(GRAPH_RADIUS / 4);
  });

  it("is deterministic, finite and fits connected and isolated notes into the canvas", () => {
    const graph = buildMarkdownGraph(
      new Map(
        Array.from({ length: 80 }, (_, index) => [
          `note${index}.md`,
          index < 60 ? `[[note${index + 1}]]` : "",
        ]),
      ),
    );
    const positions = layoutGraph(graph);
    expect(positions).toEqual(layoutGraph(graph));
    expect(positions.size).toBe(80);
    for (const point of positions.values()) {
      expect(point.x).toBeGreaterThanOrEqual(100);
      expect(point.x).toBeLessThanOrEqual(GRAPH_WIDTH - 100);
      expect(point.y).toBeGreaterThanOrEqual(80);
      expect(point.y).toBeLessThanOrEqual(GRAPH_HEIGHT - 80);
    }
  });
});
