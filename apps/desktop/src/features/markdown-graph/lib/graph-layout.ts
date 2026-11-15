import type { MarkdownGraphData } from "./markdown-links";

export type GraphPoint = { x: number; y: number; z?: number };
type Vector = { x: number; y: number; z: number };
export const GRAPH_WIDTH = 1000;
export const GRAPH_HEIGHT = 680;
/** 布局收进以画布中心为球心的球体，任意角度旋转都不会出界。 */
export const GRAPH_RADIUS = 260;
const cellSize = 90;

function cellKey(column: number, row: number, layer: number): number {
  return (column + 512) * 1048576 + (row + 512) * 1024 + (layer + 512);
}

export function layoutGraph(graph: MarkdownGraphData): Map<string, GraphPoint> {
  const count = graph.nodes.length;
  // 初始位置沿斐波那契球面展开并错开半径，保证结果确定且不共面。
  const points = new Map<string, Vector>(
    graph.nodes.map((node, index) => {
      const height = 1 - (2 * (index + 0.5)) / count;
      const ring = Math.sqrt(1 - height * height);
      const angle = index * 2.399963;
      const radius = 26 * Math.cbrt(count) * (0.4 + 0.6 * ((index * 0.754877666) % 1));
      return [
        node.path,
        {
          x: radius * ring * Math.cos(angle),
          y: radius * height,
          z: radius * ring * Math.sin(angle),
        },
      ];
    }),
  );
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const cells = new Map<number, Vector[]>();
    for (const point of points.values()) {
      const key = cellKey(
        Math.floor(point.x / cellSize),
        Math.floor(point.y / cellSize),
        Math.floor(point.z / cellSize),
      );
      const cell = cells.get(key) ?? [];
      cell.push(point);
      cells.set(key, cell);
    }
    const forces = new Map<string, Vector>();
    for (const [path, point] of points) {
      const force = { x: -point.x * 0.0015, y: -point.y * 0.0015, z: -point.z * 0.0015 };
      const column = Math.floor(point.x / cellSize);
      const row = Math.floor(point.y / cellSize);
      const layer = Math.floor(point.z / cellSize);
      for (let across = column - 1; across <= column + 1; across += 1) {
        for (let down = row - 1; down <= row + 1; down += 1) {
          for (let deep = layer - 1; deep <= layer + 1; deep += 1) {
            for (const other of cells.get(cellKey(across, down, deep)) ?? []) {
              if (point === other) continue;
              const deltaX = point.x - other.x;
              const deltaY = point.y - other.y;
              const deltaZ = point.z - other.z;
              const distance = Math.max(1, Math.hypot(deltaX, deltaY, deltaZ));
              const strength = Math.min(12, 900 / (distance * distance));
              force.x += (deltaX / distance) * strength;
              force.y += (deltaY / distance) * strength;
              force.z += (deltaZ / distance) * strength;
            }
          }
        }
      }
      forces.set(path, force);
    }
    for (const edge of graph.edges) {
      const source = points.get(edge.source);
      const target = points.get(edge.target);
      const sourceForce = forces.get(edge.source);
      const targetForce = forces.get(edge.target);
      if (!source || !target || !sourceForce || !targetForce) continue;
      const distance = Math.max(
        1,
        Math.hypot(target.x - source.x, target.y - source.y, target.z - source.z),
      );
      const strength = (distance - 105) * 0.018;
      const deltaX = ((target.x - source.x) / distance) * strength;
      const deltaY = ((target.y - source.y) / distance) * strength;
      const deltaZ = ((target.z - source.z) / distance) * strength;
      sourceForce.x += deltaX;
      sourceForce.y += deltaY;
      sourceForce.z += deltaZ;
      targetForce.x -= deltaX;
      targetForce.y -= deltaY;
      targetForce.z -= deltaZ;
    }
    for (const [path, point] of points) {
      const force = forces.get(path);
      if (!force) continue;
      point.x += Math.max(-12, Math.min(12, force.x));
      point.y += Math.max(-12, Math.min(12, force.y));
      point.z += Math.max(-12, Math.min(12, force.z));
    }
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of points.values()) {
    min.x = Math.min(min.x, point.x);
    max.x = Math.max(max.x, point.x);
    min.y = Math.min(min.y, point.y);
    max.y = Math.max(max.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.z = Math.max(max.z, point.z);
  }
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  let reach = 0;
  for (const point of points.values()) {
    reach = Math.max(reach, Math.hypot(point.x - center.x, point.y - center.y, point.z - center.z));
  }
  const scale = Math.min(3.2, GRAPH_RADIUS / Math.max(1, reach));
  for (const point of points.values()) {
    point.x = (point.x - center.x) * scale + GRAPH_WIDTH / 2;
    point.y = (point.y - center.y) * scale + GRAPH_HEIGHT / 2;
    point.z = (point.z - center.z) * scale;
  }
  return points;
}
