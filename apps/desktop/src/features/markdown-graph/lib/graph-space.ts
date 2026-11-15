import { GRAPH_HEIGHT, GRAPH_WIDTH, type GraphPoint } from "./graph-layout";

export type GraphView = { yaw: number; pitch: number };
export type SpatialPoint = { x: number; y: number; z: number };
export type ProjectedPoint = GraphPoint & { depth: number; scale: number; visible: boolean };
export const INITIAL_GRAPH_VIEW: GraphView = { yaw: -0.28, pitch: 0.2 };
const focalLength = 1000;

function rotate(point: SpatialPoint, view: GraphView): SpatialPoint {
  const across = point.x * Math.cos(view.yaw) + point.z * Math.sin(view.yaw);
  const depth = -point.x * Math.sin(view.yaw) + point.z * Math.cos(view.yaw);
  return {
    x: across,
    y: point.y * Math.cos(view.pitch) - depth * Math.sin(view.pitch),
    z: point.y * Math.sin(view.pitch) + depth * Math.cos(view.pitch),
  };
}

function unrotate(point: SpatialPoint, view: GraphView): SpatialPoint {
  const down = point.y * Math.cos(view.pitch) + point.z * Math.sin(view.pitch);
  const depth = -point.y * Math.sin(view.pitch) + point.z * Math.cos(view.pitch);
  return {
    x: point.x * Math.cos(view.yaw) - depth * Math.sin(view.yaw),
    y: down,
    z: point.x * Math.sin(view.yaw) + depth * Math.cos(view.yaw),
  };
}

export function projectGraphPoint(point: SpatialPoint, view: GraphView): ProjectedPoint {
  const rotated = rotate(
    { x: point.x - GRAPH_WIDTH / 2, y: point.y - GRAPH_HEIGHT / 2, z: point.z },
    view,
  );
  const distance = focalLength - rotated.z;
  const scale = focalLength / Math.max(160, distance);
  return {
    x: GRAPH_WIDTH / 2 + rotated.x * scale,
    y: GRAPH_HEIGHT / 2 + rotated.y * scale,
    depth: rotated.z,
    scale,
    visible: distance > 160,
  };
}

/**
 * 在正对视线的平面内移动节点：保持节点到相机的深度不变，
 * 因此任意旋转角度下节点都紧跟指针。`delta` 为画面坐标中的位移。
 */
export function dragGraphPoint(
  origin: SpatialPoint,
  delta: GraphPoint,
  view: GraphView,
): SpatialPoint {
  const rotated = rotate(
    { x: origin.x - GRAPH_WIDTH / 2, y: origin.y - GRAPH_HEIGHT / 2, z: origin.z },
    view,
  );
  const scale = focalLength / Math.max(160, focalLength - rotated.z);
  const moved = unrotate(
    { x: rotated.x + delta.x / scale, y: rotated.y + delta.y / scale, z: rotated.z },
    view,
  );
  return { x: moved.x + GRAPH_WIDTH / 2, y: moved.y + GRAPH_HEIGHT / 2, z: moved.z };
}

export function graphNodeRadius(linkCount: number): number {
  return Math.min(15, 7 + Math.sqrt(linkCount) * 1.5);
}

/** 把连线两端收到节点边缘，让箭头落在节点外沿而不是被节点遮住。 */
export function trimGraphEdge(
  source: GraphPoint,
  target: GraphPoint,
  sourceGap: number,
  targetGap: number,
): { source: GraphPoint; target: GraphPoint } | undefined {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance <= sourceGap + targetGap) return;
  const across = deltaX / distance;
  const down = deltaY / distance;
  return {
    source: { x: source.x + across * sourceGap, y: source.y + down * sourceGap },
    target: { x: target.x - across * targetGap, y: target.y - down * targetGap },
  };
}

export function graphOrbitPath(view: GraphView, vertical: boolean): string {
  return Array.from({ length: 97 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    const point = projectGraphPoint(
      {
        x: GRAPH_WIDTH / 2 + Math.cos(angle) * (vertical ? 390 : 420),
        y: GRAPH_HEIGHT / 2 + (vertical ? Math.sin(angle) * 270 : 145),
        z: vertical ? -200 : Math.sin(angle) * 340,
      },
      view,
    );
    return `${index ? "L" : "M"} ${point.x} ${point.y}`;
  }).join(" ");
}

// 星空是包住整个场景的球壳（斐波那契分布），任意角度旋转都有均匀的背景。
export const graphStars = Array.from({ length: 640 }, (_, index) => {
  const height = 1 - (2 * (index + 0.5)) / 640;
  const ring = Math.sqrt(1 - height * height);
  const angle = index * 2.399963;
  const distance = 1000 + ((index * 271) % 500);
  return {
    id: `star-${index}`,
    x: GRAPH_WIDTH / 2 + distance * ring * Math.cos(angle),
    y: GRAPH_HEIGHT / 2 + distance * height,
    z: distance * ring * Math.sin(angle),
    radius: 1.1 + (index % 4) * 0.45,
    bright: index % 3 === 0,
    duration: 3.2 + (index % 7) * 0.55,
    delay: -(index * 0.61) % 6,
  };
});
