import {
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

type Position = { x: number; y: number };
type Drag = Position & { pointerId: number; start: Position };

export function useMindmapPan(stage: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [offset, setOffset] = useState<Position>({ x: 0, y: 0 });
  const [space, setSpace] = useState(false);
  const [dragging, setDragging] = useState(false);
  const held = useRef(false);
  const hovered = useRef(false);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const release = () => {
      held.current = false;
      setSpace(false);
      const pointer = drag.current;
      drag.current = null;
      setDragging(false);
      if (pointer && stage.current?.hasPointerCapture(pointer.pointerId))
        stage.current.releasePointerCapture(pointer.pointerId);
    };
    const keydown = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input,textarea,select,[contenteditable=true],.monaco-editor")
      )
        return;
      if (!hovered.current && !(target instanceof Node && stage.current?.contains(target))) return;
      event.preventDefault();
      held.current = true;
      setSpace(true);
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") release();
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release);
      hovered.current = false;
      release();
    };
  }, [enabled, stage]);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    offset,
    setOffset,
    reset: () => setOffset({ x: 0, y: 0 }),
    cursor: dragging ? "grabbing" : space ? "grab" : undefined,
    handlers: {
      onPointerEnter: () => {
        hovered.current = true;
      },
      onPointerLeave: () => {
        hovered.current = false;
      },
      onPointerDownCapture: (event: PointerEvent<HTMLDivElement>) => {
        suppressClick.current = false;
        if (!enabled || event.button !== 0 || !held.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = true;
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          start: offset,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      },
      onPointerMoveCapture: (event: PointerEvent<HTMLDivElement>) => {
        const pointer = drag.current;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        setOffset({
          x: pointer.start.x + event.clientX - pointer.x,
          y: pointer.start.y + event.clientY - pointer.y,
        });
      },
      onPointerUpCapture: finish,
      onPointerCancel: finish,
      onLostPointerCapture: () => {
        drag.current = null;
        setDragging(false);
      },
      onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      },
    },
  };
}
