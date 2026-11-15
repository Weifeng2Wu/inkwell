import { type RefObject, useEffect, useRef } from "react";

type View = { scale: number; offset: { x: number; y: number } };

export function useMindmapZoom(
  stage: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  view: View,
  onChange: (view: View) => void,
) {
  const latest = useRef({ view, onChange });
  latest.current = { view, onChange };
  useEffect(() => {
    const element = stage.current;
    if (!enabled || !element) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !Number.isFinite(event.deltaY)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      const { view: previous, onChange: update } = latest.current;
      const bounds = element.getBoundingClientRect();
      const delta =
        event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      if (!delta || previous.scale <= 0) return;
      const scale = Math.min(
        3,
        Math.max(0.1, previous.scale * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002)),
      );
      const ratio = scale / previous.scale;
      const pointer = {
        x: event.clientX - bounds.left - bounds.width / 2,
        y: event.clientY - bounds.top - bounds.height / 2,
      };
      const next = {
        scale,
        offset: {
          x: pointer.x - (pointer.x - previous.offset.x) * ratio,
          y: pointer.y - (pointer.y - previous.offset.y) * ratio,
        },
      };
      latest.current.view = next;
      update(next);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [stage, enabled]);
}
