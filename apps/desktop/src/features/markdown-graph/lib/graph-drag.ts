import type { GraphPoint } from "./graph-layout";
import type { MarkdownGraphData } from "./markdown-links";

export type GraphDrag = { path: string; origin: GraphPoint };

export function followGraphDrag(
  layout: Map<string, GraphPoint>,
  edges: MarkdownGraphData["edges"],
  overrides: Map<string, GraphPoint>,
  drag: GraphDrag | null,
): Map<string, GraphPoint> {
  if (!drag) return layout;
  const point = overrides.get(drag.path);
  if (!point) return layout;
  const deltaX = (point.x - drag.origin.x) * 0.22;
  const deltaY = (point.y - drag.origin.y) * 0.22;
  const deltaZ = ((point.z ?? 0) - (drag.origin.z ?? 0)) * 0.22;
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  if (distance === 0) return layout;
  const strength = Math.min(1, 36 / distance);
  const neighbors = new Set<string>();
  for (const edge of edges) {
    if (edge.source === drag.path) neighbors.add(edge.target);
    if (edge.target === drag.path) neighbors.add(edge.source);
  }
  const next = new Map(layout);
  for (const path of neighbors) {
    const origin = layout.get(path);
    if (!origin || overrides.has(path)) continue;
    next.set(path, {
      x: origin.x + deltaX * strength,
      y: origin.y + deltaY * strength,
      ...(origin.z === undefined ? {} : { z: origin.z + deltaZ * strength }),
    });
  }
  return next;
}
