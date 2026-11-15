import { describe, expect, it } from "vitest";
import { dragGraphPoint, projectGraphPoint, trimGraphEdge } from "./graph-space";

describe("graph perspective", () => {
  it("projects near nodes larger and farther from the vanishing point", () => {
    const view = { yaw: 0, pitch: 0 };
    const near = projectGraphPoint({ x: 600, y: 440, z: 250 }, view);
    const far = projectGraphPoint({ x: 600, y: 440, z: -250 }, view);
    expect(near.scale).toBeGreaterThan(far.scale);
    expect(near.x - 500).toBeGreaterThan(far.x - 500);
    expect(near.y - 340).toBeGreaterThan(far.y - 340);
  });

  it("rotates different depths by different amounts instead of translating a plane", () => {
    const front = { x: 600, y: 340, z: 220 };
    const back = { x: 600, y: 340, z: -220 };
    const start = { yaw: 0, pitch: 0 };
    const turned = { yaw: 0.5, pitch: 0.2 };
    const frontDelta = projectGraphPoint(front, turned).x - projectGraphPoint(front, start).x;
    const backDelta = projectGraphPoint(back, turned).x - projectGraphPoint(back, start).x;
    expect(Math.abs(frontDelta - backDelta)).toBeGreaterThan(100);
  });

  it("drags nodes with the pointer at any angle while keeping their view depth", () => {
    const delta = { x: 37, y: -22 };
    for (const view of [
      { yaw: -0.28, pitch: 0.2 },
      { yaw: Math.PI / 2, pitch: 0 },
      { yaw: Math.PI, pitch: 1.2 },
      { yaw: 4, pitch: -1.4 },
    ]) {
      for (const point of [
        { x: 200, y: 170, z: -220 },
        { x: 720, y: 510, z: 240 },
        { x: 500, y: 340, z: 0 },
      ]) {
        const before = projectGraphPoint(point, view);
        const after = projectGraphPoint(dragGraphPoint(point, delta, view), view);
        expect(after.x - before.x).toBeCloseTo(delta.x, 8);
        expect(after.y - before.y).toBeCloseTo(delta.y, 8);
        expect(after.depth).toBeCloseTo(before.depth, 8);
      }
    }
  });

  it("clips the near plane and repeats after a full turn", () => {
    const projected = projectGraphPoint({ x: 600, y: 400, z: 1200 }, { yaw: 0, pitch: 0 });
    expect(projected.visible).toBe(false);
    expect(Number.isFinite(projected.x)).toBe(true);
    const point = { x: 640, y: 250, z: 120 };
    const front = projectGraphPoint(point, { yaw: 0.3, pitch: 0.2 });
    const turned = projectGraphPoint(point, { yaw: 0.3 + Math.PI * 2, pitch: 0.2 });
    expect(turned.x).toBeCloseTo(front.x, 8);
    expect(turned.y).toBeCloseTo(front.y, 8);
  });

  it("trims edges to node rims and drops edges hidden under overlapping nodes", () => {
    expect(trimGraphEdge({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 20)).toEqual({
      source: { x: 10, y: 0 },
      target: { x: 80, y: 0 },
    });
    expect(trimGraphEdge({ x: 0, y: 0 }, { x: 0, y: 25 }, 10, 20)).toBeUndefined();
  });
});
