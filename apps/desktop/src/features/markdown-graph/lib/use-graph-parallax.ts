import { useEffect } from "react";
import type { GraphPoint } from "./graph-layout";

export function useGraphParallax(
  svg: SVGSVGElement | null,
  enabled: boolean,
  onMove?: (point: GraphPoint) => void,
) {
  useEffect(() => {
    if (!svg || !enabled) return;
    let current: GraphPoint = { x: 0, y: 0 };
    let target = current;
    let frame: number | undefined;
    let previousTime = 0;
    let draggedPointer: number | undefined;

    const paint = () => {
      svg.style.setProperty("--graph-offset-x", `${current.x}px`);
      svg.style.setProperty("--graph-offset-y", `${current.y}px`);
      onMove?.(current);
    };
    const advance = (now: number) => {
      frame = undefined;
      const factor = 1 - Math.exp(-Math.max(0, Math.min(64, now - previousTime)) / 65);
      previousTime = now;
      current = {
        x: current.x + (target.x - current.x) * factor,
        y: current.y + (target.y - current.y) * factor,
      };
      if (Math.hypot(target.x - current.x, target.y - current.y) < 0.03) {
        current = target;
      } else frame = requestAnimationFrame(advance);
      paint();
    };
    const move = (point: GraphPoint) => {
      target = point;
      if (frame !== undefined || (target.x === current.x && target.y === current.y)) return;
      previousTime = performance.now();
      frame = requestAnimationFrame(advance);
    };
    const freeze = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      target = current;
    };
    const follow = (event: PointerEvent) => {
      if (event.pointerType === "touch" || draggedPointer !== undefined || event.buttons !== 0)
        return;
      if (event.target instanceof Element && event.target.closest('[role="button"]')) {
        freeze();
        return;
      }
      const bounds = svg.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      const across = (event.clientX - bounds.left) / bounds.width;
      const down = (event.clientY - bounds.top) / bounds.height;
      if (across < 0 || across > 1 || down < 0 || down > 1) {
        move({ x: 0, y: 0 });
        return;
      }
      move({ x: (across - 0.5) * 44, y: (down - 0.5) * 28 });
    };
    const leave = () => {
      if (draggedPointer === undefined) move({ x: 0, y: 0 });
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || draggedPointer !== undefined) return;
      draggedPointer = event.pointerId;
      freeze();
    };
    const stop = (event: PointerEvent) => {
      if (draggedPointer !== event.pointerId) return;
      draggedPointer = undefined;
      if (event.type === "pointercancel") move({ x: 0, y: 0 });
      else follow(event);
    };

    svg.addEventListener("pointermove", follow, { passive: true });
    svg.addEventListener("pointerleave", leave);
    svg.addEventListener("pointerdown", start, true);
    svg.addEventListener("pointerup", stop, true);
    svg.addEventListener("pointercancel", stop, true);
    svg.addEventListener("wheel", freeze, { capture: true, passive: true });
    return () => {
      freeze();
      svg.removeEventListener("pointermove", follow);
      svg.removeEventListener("pointerleave", leave);
      svg.removeEventListener("pointerdown", start, true);
      svg.removeEventListener("pointerup", stop, true);
      svg.removeEventListener("pointercancel", stop, true);
      svg.removeEventListener("wheel", freeze, true);
      svg.style.removeProperty("--graph-offset-x");
      svg.style.removeProperty("--graph-offset-y");
      onMove?.({ x: 0, y: 0 });
    };
  }, [svg, enabled, onMove]);
}
