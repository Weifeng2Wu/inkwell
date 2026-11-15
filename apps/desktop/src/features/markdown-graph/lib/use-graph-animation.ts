import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { GRAPH_HEIGHT, GRAPH_WIDTH, type GraphPoint } from "./graph-layout";

const motionQuery = "(prefers-reduced-motion: reduce)";
const transitionDuration = 480;

function subscribeMotion(onChange: () => void) {
  const preference = window.matchMedia?.(motionQuery);
  preference?.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    preference?.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function motionEnabled() {
  return !document.hidden && !window.matchMedia?.(motionQuery).matches;
}

function mix(from: GraphPoint, to: GraphPoint, amount: number): GraphPoint {
  const depth = from.z ?? to.z;
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    ...(to.z === undefined || depth === undefined ? {} : { z: depth + (to.z - depth) * amount }),
  };
}

function enterPoint(point: GraphPoint): GraphPoint {
  return mix({ x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2, z: 0 }, point, 0.82);
}

export function useGraphAnimation(
  layout: Map<string, GraphPoint>,
  overrides: Map<string, GraphPoint>,
) {
  const enabled = useSyncExternalStore(subscribeMotion, motionEnabled, () => false);
  const [positions, setPositions] = useState(new Map<string, GraphPoint>());
  const current = useRef(positions);

  useLayoutEffect(() => {
    const target = new Map(
      [...layout].map(([path, point]) => [path, overrides.get(path) ?? point]),
    );
    const start = new Map(
      [...target].map(([path, point]) => [
        path,
        overrides.get(path) ?? current.current.get(path) ?? enterPoint(point),
      ]),
    );
    const changed = [...target].some(([path, point]) => {
      const previous = start.get(path);
      return previous?.x !== point.x || previous?.y !== point.y || previous?.z !== point.z;
    });

    if (!enabled || !changed) {
      current.current = target;
      setPositions(target);
      return;
    }

    current.current = start;
    setPositions(start);
    const started = performance.now();
    let frame: number;
    const advance = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / transitionDuration));
      if (progress === 1) {
        current.current = target;
        setPositions(target);
        return;
      }
      const eased = 1 - (1 - progress) ** 3;
      const next = new Map(
        [...target].map(([path, point]) => [path, mix(start.get(path) ?? point, point, eased)]),
      );
      current.current = next;
      setPositions(next);
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [layout, overrides, enabled]);

  return { positions, motionEnabled: enabled };
}
