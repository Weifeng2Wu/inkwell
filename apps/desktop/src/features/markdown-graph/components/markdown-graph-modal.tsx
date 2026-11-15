"use client";

import {
  ArrowClockwiseIcon,
  ArrowsOutIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Tooltip } from "@/components/ui/tooltip";
import { formatNumber, useI18n } from "@/features/i18n";
import { followGraphDrag, type GraphDrag } from "../lib/graph-drag";
import { GRAPH_HEIGHT, GRAPH_WIDTH, type GraphPoint, layoutGraph } from "../lib/graph-layout";
import {
  dragGraphPoint,
  type GraphView,
  graphNodeRadius,
  graphOrbitPath,
  graphStars,
  INITIAL_GRAPH_VIEW,
  projectGraphPoint,
  trimGraphEdge,
} from "../lib/graph-space";
import type { MarkdownGraphData, MarkdownGraphNode } from "../lib/markdown-links";
import { useGraphAnimation } from "../lib/use-graph-animation";
import { useGraphParallax } from "../lib/use-graph-parallax";
import styles from "./markdown-graph-modal.module.css";

type Camera = { x: number; y: number; scale: number };
const initialCamera: Camera = { x: 0, y: 0, scale: 1 };
// 节点数超过该值时只显示选中、相邻和悬停节点的标签，避免文字互相遮挡。
const LABEL_NODE_LIMIT = 60;
const LABEL_ZOOM = 1.5;
// 画布宽高比与视图框不一致时，边缘外仍可能露出一圈星空。
const STAR_MARGIN = 200;
// 俯仰限制在接近正上/正下，避免画面翻转；水平方向不设限。
const MAX_PITCH = 1.45;
const linkCount = (node: MarkdownGraphNode) => node.incoming.length + node.outgoing.length;
type Drag = {
  pointer: number;
  capture: Element;
  path?: string;
  start: GraphPoint;
  origin: GraphPoint;
  previousOverride?: GraphPoint;
  orbit?: GraphView;
  view: GraphView;
  moved: boolean;
};

export function MarkdownGraphModal({
  graph,
  activePath,
  isLoading,
  errors = [],
  onRefresh,
  onClose,
  onOpenFile,
}: {
  graph: MarkdownGraphData;
  activePath?: string;
  isLoading: boolean;
  errors?: string[];
  onRefresh?: () => void;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { t, locale } = useI18n();
  const [focusPath, setFocusPath] = useState(activePath);
  const [scope, setScope] = useState<"all" | "local">("all");
  const [query, setQuery] = useState("");
  const [hoverPath, setHoverPath] = useState<string>();
  const [camera, setCamera] = useState(initialCamera);
  const [orbit, setOrbit] = useState(INITIAL_GRAPH_VIEW);
  const [tilt, setTilt] = useState<GraphPoint>({ x: 0, y: 0 });
  const [overrides, setOverrides] = useState(new Map<string, GraphPoint>());
  const [draggedNode, setDraggedNode] = useState<GraphDrag | null>(null);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const scene = useRef<SVGGElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const drag = useRef<Drag | null>(null);
  const markerId = useId().replace(/:/g, "");
  const selectedNode =
    graph.nodes.find((node) => node.path === focusPath) ??
    graph.nodes.find((node) => node.path === activePath) ??
    graph.nodes[0];
  const nodeByPath = useMemo(
    () => new Map(graph.nodes.map((node) => [node.path, node])),
    [graph.nodes],
  );
  const connected = useMemo(
    () =>
      new Set(
        selectedNode ? [selectedNode.path, ...selectedNode.incoming, ...selectedNode.outgoing] : [],
      ),
    [selectedNode],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const nodes = graph.nodes.filter(
      (node) =>
        (scope === "all" || connected.has(node.path)) &&
        (node.path.toLowerCase().includes(needle) || node.label.toLowerCase().includes(needle)),
    );
    const paths = new Set(nodes.map((node) => node.path));
    return {
      nodes,
      edges: graph.edges.filter((edge) => paths.has(edge.source) && paths.has(edge.target)),
    };
  }, [graph, connected, query, scope]);
  // 视差每帧都会触发渲染，序列化只在可见集合变化时执行。
  const topology = useMemo(
    () =>
      JSON.stringify({
        nodes: visible.nodes.map((node) => ({ path: node.path })),
        edges: visible.edges,
      }),
    [visible],
  );
  const showAllLabels =
    visible.nodes.length <= LABEL_NODE_LIMIT || camera.scale >= LABEL_ZOOM || query.trim() !== "";
  const layout = useMemo(() => layoutGraph(JSON.parse(topology)), [topology]);
  const influencedLayout = useMemo(
    () => followGraphDrag(layout, visible.edges, overrides, draggedNode),
    [layout, visible.edges, overrides, draggedNode],
  );
  const { positions, motionEnabled } = useGraphAnimation(influencedLayout, overrides);
  useGraphParallax(svg, motionEnabled, setTilt);
  const view = useMemo(
    () => ({ yaw: orbit.yaw + tilt.x * 0.012, pitch: orbit.pitch - tilt.y * 0.012 }),
    [orbit, tilt],
  );
  const projected = useMemo(
    () =>
      new Map(
        [...positions].map(([path, point]) => [
          path,
          projectGraphPoint({ x: point.x, y: point.y, z: point.z ?? 0 }, view),
        ]),
      ),
    [positions, view],
  );
  const orderedNodes = useMemo(
    () =>
      [...visible.nodes].sort(
        (first, second) =>
          (projected.get(first.path)?.depth ?? 0) - (projected.get(second.path)?.depth ?? 0),
      ),
    [visible.nodes, projected],
  );
  const stars = useMemo(
    () =>
      graphStars
        .map((star) => ({ ...star, ...projectGraphPoint(star, view) }))
        .filter(
          (star) =>
            star.visible &&
            star.x > -STAR_MARGIN &&
            star.x < GRAPH_WIDTH + STAR_MARGIN &&
            star.y > -STAR_MARGIN &&
            star.y < GRAPH_HEIGHT + STAR_MARGIN,
        ),
    [view],
  );
  const orbitPaths = useMemo(
    () => [graphOrbitPath(view, false), graphOrbitPath(view, true)],
    [view],
  );
  const position = (path: string) => positions.get(path);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  function scenePoint(clientX: number, clientY: number): GraphPoint | undefined {
    const matrix = scene.current?.getScreenCTM?.() ?? svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function zoom(factor: number) {
    const bounds = svg?.getBoundingClientRect();
    const anchor = (bounds &&
      scenePoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)) ?? {
      x: GRAPH_WIDTH / 2,
      y: GRAPH_HEIGHT / 2,
    };
    setCamera((current) => {
      const scale = Math.max(0.2, Math.min(5, current.scale * factor));
      return {
        scale,
        x: anchor.x - ((anchor.x - current.x) * scale) / current.scale,
        y: anchor.y - ((anchor.y - current.y) * scale) / current.scale,
      };
    });
  }

  useEffect(() => {
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = scene.current?.getScreenCTM?.() ?? svg.getScreenCTM();
      if (!matrix) return;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const anchor = point.matrixTransform(matrix.inverse());
      const factor = Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.003);
      setCamera((current) => {
        const scale = Math.max(0.2, Math.min(5, current.scale * factor));
        return {
          scale,
          x: anchor.x - ((anchor.x - current.x) * scale) / current.scale,
          y: anchor.y - ((anchor.y - current.y) * scale) / current.scale,
        };
      });
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
  }, [svg]);

  function startDrag(event: ReactPointerEvent, path?: string) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const start = scenePoint(event.clientX, event.clientY);
    if (!start) return;
    const origin = path ? position(path) : { x: camera.x, y: camera.y };
    if (!origin) return;
    const capture = event.currentTarget;
    drag.current = {
      pointer: event.pointerId,
      capture,
      path,
      start,
      origin,
      previousOverride: path ? overrides.get(path) : undefined,
      orbit: !path && !event.shiftKey ? orbit : undefined,
      view,
      moved: false,
    };
    if (path) {
      setDraggedNode({ path, origin });
      setOverrides((previous) => new Map(previous).set(path, origin));
    }
    capture.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const point = scenePoint(event.clientX, event.clientY);
    if (!point) return;
    const deltaX = point.x - current.start.x;
    const deltaY = point.y - current.start.y;
    if (Math.hypot(deltaX, deltaY) > 3) current.moved = true;
    if (!current.moved) return;
    if (current.path) {
      const path = current.path;
      const scale = cameraRef.current.scale;
      const moved = dragGraphPoint(
        { x: current.origin.x, y: current.origin.y, z: current.origin.z ?? 0 },
        { x: deltaX / scale, y: deltaY / scale },
        current.view,
      );
      setOverrides((previous) => new Map(previous).set(path, moved));
    } else if (current.orbit) {
      setOrbit({
        yaw: current.orbit.yaw + deltaX * 0.006,
        pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, current.orbit.pitch - deltaY * 0.006)),
      });
    } else
      setCamera((previous) => ({
        ...previous,
        x: current.origin.x + deltaX,
        y: current.origin.y + deltaY,
      }));
  }

  function stopDrag(event: ReactPointerEvent) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    if (current.capture.hasPointerCapture(event.pointerId))
      current.capture.releasePointerCapture(event.pointerId);
    if (!current.moved && current.path) {
      const path = current.path;
      setOverrides((previous) => {
        const next = new Map(previous);
        if (current.previousOverride) next.set(path, current.previousOverride);
        else next.delete(path);
        return next;
      });
      if (event.type !== "pointercancel") setFocusPath(path);
    }
    drag.current = null;
    setDraggedNode(null);
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="motion-fade fixed inset-0 z-[10000] bg-black/45 backdrop-blur-[1px]" />
        <Dialog.Content
          className="fixed inset-4 z-[10001] mx-auto flex max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-2xl md:inset-y-8"
          onPointerDownOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current?.focus();
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-medium">
                {t("markdown.graphTitle")}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted">
                {t("markdown.graphSummary", {
                  nodes: graph.nodes.length,
                  links: graph.edges.length,
                })}
              </Dialog.Description>
            </div>
            <Tooltip label={t("common.close")} keys="Esc">
              <Dialog.Close className="toolbar-icon-button" aria-label={t("common.close")}>
                <XIcon className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </Tooltip>
          </header>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <div className="relative min-w-32 flex-1">
              <MagnifyingGlassIcon
                className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted"
                aria-hidden="true"
              />
              <input
                className="h-8 w-full rounded-md border border-border bg-background pr-3 pl-8 text-xs focus:border-accent focus:outline-none"
                aria-label={t("markdown.graphSearch")}
                placeholder={t("markdown.graphSearch")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <fieldset className="flex gap-1" aria-label={t("markdown.graphScope")}>
              {(["all", "local"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="btn btn-sm aria-pressed:border-accent aria-pressed:text-accent"
                  aria-pressed={scope === value}
                  onClick={() => {
                    setScope(value);
                    setCamera(initialCamera);
                  }}
                >
                  {t(value === "all" ? "markdown.graphAll" : "markdown.graphLocal")}
                </button>
              ))}
            </fieldset>
            <Tooltip label={t("common.refresh")}>
              <button
                type="button"
                className="toolbar-icon-button"
                aria-label={t("common.refresh")}
                onClick={onRefresh}
                disabled={isLoading}
              >
                <ArrowClockwiseIcon className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>
          {errors.length > 0 && (
            <p
              role="status"
              className="border-b border-border px-4 py-2 text-xs text-warning"
              title={errors.join("\n")}
            >
              {t("markdown.graphReadErrors", { count: errors.length })}
            </p>
          )}
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <div className="relative min-h-48 min-w-0 flex-1 overflow-hidden bg-surface-secondary">
              {/* biome-ignore lint/a11y/useSemanticElements: SVG groups contain interactive graph nodes and cannot use an HTML fieldset. */}
              <svg
                ref={setSvg}
                viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                className={`${styles.canvas} h-full w-full touch-none select-none`}
                data-motion={motionEnabled ? "running" : "paused"}
                data-view-yaw={view.yaw}
                data-view-pitch={view.pitch}
                role="group"
                aria-label={t("markdown.graphTitle")}
                onPointerDown={(event) => startDrag(event)}
                onPointerMove={moveDrag}
                onPointerUp={stopDrag}
                onPointerCancel={stopDrag}
              >
                <title>{t("markdown.graphTitle")}</title>
                <defs>
                  <marker
                    id={markerId}
                    viewBox="0 0 10 10"
                    refX="10"
                    refY="5"
                    markerUnits="userSpaceOnUse"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
                  </marker>
                  <radialGradient id={`${markerId}-glow`}>
                    <stop offset="0" stopColor="var(--accent)" stopOpacity="0.5" />
                    <stop offset="0.35" stopColor="var(--accent)" stopOpacity="0.16" />
                    <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id={`${markerId}-sphere`} cx="30%" cy="25%" r="80%">
                    <stop offset="0" stopColor="var(--foreground)" />
                    <stop offset="0.35" stopColor="var(--accent)" />
                    <stop offset="1" stopColor="var(--background)" />
                  </radialGradient>
                </defs>
                <rect width={GRAPH_WIDTH} height={GRAPH_HEIGHT} fill="transparent" />
                <ellipse
                  cx="500"
                  cy="340"
                  rx="480"
                  ry="340"
                  fill={`url(#${markerId}-glow)`}
                  opacity="0.22"
                  pointerEvents="none"
                />
                <g data-graph-stars="" pointerEvents="none">
                  {stars.map((star) => (
                    <circle
                      key={star.id}
                      className={styles.star}
                      cx={star.x}
                      cy={star.y}
                      r={star.radius * star.scale}
                      fill={star.bright ? "var(--foreground)" : "var(--muted)"}
                      fillOpacity={Math.max(0.25, Math.min(1, star.scale * 1.4))}
                      style={{
                        animationDuration: `${star.duration}s`,
                        animationDelay: `${star.delay}s`,
                      }}
                    />
                  ))}
                </g>
                <g ref={scene} data-graph-scene="">
                  <g
                    data-graph-camera=""
                    transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}
                  >
                    {orbitPaths.map((path, index) => (
                      <path
                        key={index === 0 ? "equator" : "meridian"}
                        d={path}
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="1"
                        opacity={index === 0 ? 0.13 : 0.07}
                        strokeDasharray={index === 0 ? undefined : "3 8"}
                        pointerEvents="none"
                      />
                    ))}
                    {visible.edges.map((edge, index) => {
                      const source = projected.get(edge.source);
                      const target = projected.get(edge.target);
                      if (!source?.visible || !target?.visible) return null;
                      const sourceNode = nodeByPath.get(edge.source);
                      const targetNode = nodeByPath.get(edge.target);
                      if (!sourceNode || !targetNode) return null;
                      const line = trimGraphEdge(
                        source,
                        target,
                        graphNodeRadius(linkCount(sourceNode)) * source.scale,
                        (graphNodeRadius(linkCount(targetNode)) + 3) * target.scale,
                      );
                      if (!line) return null;
                      const highlighted =
                        edge.source === selectedNode?.path || edge.target === selectedNode?.path;
                      const hovered = edge.source === hoverPath || edge.target === hoverPath;
                      return (
                        <g key={JSON.stringify([edge.source, edge.target])} pointerEvents="none">
                          <line
                            className={styles.edge}
                            x1={line.source.x}
                            y1={line.source.y}
                            x2={line.target.x}
                            y2={line.target.y}
                            stroke="var(--accent)"
                            strokeWidth={
                              (highlighted ? 1.4 : hovered ? 1.1 : 0.8) *
                              Math.min(1.5, (source.scale + target.scale) / 2)
                            }
                            opacity={
                              (highlighted ? 0.65 : hovered ? 0.45 : 0.18) *
                              Math.min(1, (source.scale + target.scale) / 2)
                            }
                            markerEnd={`url(#${markerId})`}
                          />
                          {highlighted && (
                            <path
                              className={styles.flow}
                              d={`M ${line.source.x} ${line.source.y} L ${line.target.x} ${line.target.y}`}
                              pathLength="100"
                              fill="none"
                              stroke="var(--accent)"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              style={{ animationDelay: `${-(index % 7) * 0.4}s` }}
                            />
                          )}
                        </g>
                      );
                    })}
                    {orderedNodes.map((node) => {
                      const point = projected.get(node.path);
                      if (!point?.visible) return null;
                      const selected = node.path === selectedNode?.path;
                      const hovered = node.path === hoverPath;
                      const related = connected.has(node.path);
                      const linked = linkCount(node) > 0;
                      const radius = graphNodeRadius(linkCount(node));
                      return (
                        // biome-ignore lint/a11y/useSemanticElements: A keyboard-accessible SVG node cannot be an HTML button.
                        <g
                          key={node.path}
                          transform={`translate(${point.x} ${point.y}) scale(${point.scale})`}
                          data-depth={point.depth}
                          data-kind={node.kind}
                          className={`${styles.node} cursor-pointer outline-none`}
                          role="button"
                          tabIndex={0}
                          aria-label={node.path}
                          aria-pressed={selected}
                          opacity={
                            selected || hovered
                              ? 1
                              : Math.max(0.5, Math.min(1, point.scale * 0.85)) *
                                (related ? 1 : 0.45)
                          }
                          onPointerEnter={() => setHoverPath(node.path)}
                          onPointerLeave={() =>
                            setHoverPath((current) => (current === node.path ? undefined : current))
                          }
                          onFocus={() => setFocusPath(node.path)}
                          onDoubleClick={() => onOpenFile(node.path)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              onOpenFile(node.path);
                            } else if (event.key === " ") {
                              event.preventDefault();
                              setFocusPath(node.path);
                            }
                          }}
                          onPointerDown={(event) => startDrag(event, node.path)}
                        >
                          <title>{node.path}</title>
                          <circle r={radius + 28} fill="transparent" />
                          <circle
                            className={styles.halo}
                            r={radius + 20}
                            fill={`url(#${markerId}-glow)`}
                            opacity={selected ? 0.9 : linked ? 0.35 : 0.12}
                            pointerEvents="none"
                          />
                          <circle
                            className={styles.core}
                            r={radius}
                            fill={`url(#${markerId}-sphere)`}
                            stroke={linked || selected ? "var(--accent)" : "var(--border-dark)"}
                            strokeWidth={selected ? 2.5 : 1.5}
                          />
                          {node.kind === "pdf" && (
                            <text
                              textAnchor="middle"
                              y="2.5"
                              fill="var(--accent-foreground)"
                              fontSize="6.5"
                              fontWeight="600"
                              pointerEvents="none"
                            >
                              PDF
                            </text>
                          )}
                          {(showAllLabels || selected || hovered || related) && (
                            <text
                              y={radius + 18 / Math.sqrt(camera.scale)}
                              textAnchor="middle"
                              fill={selected || hovered ? "var(--foreground)" : "var(--muted)"}
                              fontWeight={selected ? 600 : 400}
                              className="pointer-events-none"
                              style={{
                                paintOrder: "stroke",
                                stroke: "var(--surface-secondary)",
                                strokeWidth: 3 / Math.sqrt(camera.scale),
                                // 放大画布时标签只温和变大，保持可读而不遮挡邻居。
                                fontSize: 12 / Math.sqrt(point.scale * camera.scale),
                              }}
                            >
                              {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </g>
              </svg>
              {visible.nodes.length === 0 && (
                <p
                  className="motion-fade pointer-events-none absolute inset-0 mx-auto flex max-w-sm items-center justify-center px-6 text-center text-[13px] text-muted leading-relaxed"
                  role="status"
                >
                  {t(
                    isLoading
                      ? "markdown.graphLoading"
                      : graph.nodes.length
                        ? "markdown.graphNoResults"
                        : "markdown.graphEmpty",
                  )}
                </p>
              )}
              <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md border border-border bg-background/90 p-1 shadow-lg">
                <Tooltip label={t("markdown.zoomOut")} side="top">
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={() => zoom(1 / 1.2)}
                    aria-label={t("markdown.zoomOut")}
                  >
                    <MinusIcon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
                <span className="w-12 text-center text-xs text-muted">
                  {formatNumber(camera.scale, locale, {
                    style: "percent",
                    maximumFractionDigits: 0,
                  })}
                </span>
                <Tooltip label={t("markdown.zoomIn")} side="top">
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={() => zoom(1.2)}
                    aria-label={t("markdown.zoomIn")}
                  >
                    <PlusIcon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
                <Tooltip label={t("markdown.graphReset")} side="top">
                  <button
                    type="button"
                    className="toolbar-icon-button"
                    onClick={() => {
                      setCamera(initialCamera);
                      setOrbit(INITIAL_GRAPH_VIEW);
                      setOverrides(new Map());
                    }}
                    aria-label={t("markdown.graphReset")}
                  >
                    <ArrowsOutIcon className="size-4" aria-hidden="true" />
                  </button>
                </Tooltip>
              </div>
            </div>
            <aside className="flex max-h-[35%] w-full shrink-0 flex-col border-t border-border md:max-h-none md:w-64 md:border-t-0 md:border-l">
              <div className="min-h-0 flex-1 overflow-auto p-4">
                {query.trim() && (
                  <div className="mb-5 border-b border-border pb-4 [&>div]:mt-0">
                    <GraphLinkList
                      title={t("markdown.graphSearchResults")}
                      empty={t("markdown.graphNoResults")}
                      paths={visible.nodes.map((node) => node.path)}
                      nodeByPath={nodeByPath}
                      selectedPath={selectedNode?.path}
                      onSelect={setFocusPath}
                      onHover={setHoverPath}
                    />
                  </div>
                )}
                {selectedNode && (
                  <>
                    <button
                      type="button"
                      className="w-full rounded-md border border-border bg-surface-secondary px-3 py-2 text-left transition-colors hover:border-border-dark focus-visible:border-accent focus-visible:outline-none"
                      onClick={() => onOpenFile(selectedNode.path)}
                      aria-label={`${t("markdown.graphOpen")}: ${selectedNode.label}`}
                    >
                      <span className="font-reading block truncate text-sm">
                        {selectedNode.label}
                      </span>
                      <span className="mt-1 block break-all font-mono text-[11px] text-muted">
                        {selectedNode.path}
                      </span>
                    </button>
                    <GraphLinkList
                      title={t("markdown.backlinks")}
                      empty={t("markdown.noBacklinks")}
                      paths={selectedNode.incoming}
                      nodeByPath={nodeByPath}
                      onSelect={setFocusPath}
                      onHover={setHoverPath}
                    />
                    <GraphLinkList
                      title={t("markdown.outgoingLinks")}
                      empty={t("markdown.noOutgoingLinks")}
                      paths={selectedNode.outgoing}
                      nodeByPath={nodeByPath}
                      onSelect={setFocusPath}
                      onHover={setHoverPath}
                    />
                    {selectedNode.unresolved.length > 0 && (
                      <div className="mt-5">
                        <h3 className="section-label mb-2 text-warning">
                          {t("markdown.unresolvedLinks")}
                        </h3>
                        {selectedNode.unresolved.map((target) => (
                          <p key={target} className="break-all font-mono text-[11px] text-muted">
                            {target}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
              <p className="border-t border-border px-4 py-3 text-[11px] text-muted">
                {t("markdown.graphHint")}
              </p>
            </aside>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GraphLinkList({
  title,
  empty,
  paths,
  nodeByPath,
  selectedPath,
  onSelect,
  onHover,
}: {
  title: string;
  empty: string;
  paths: string[];
  nodeByPath: Map<string, MarkdownGraphNode>;
  selectedPath?: string;
  onSelect: (path: string) => void;
  onHover: (path: string | undefined) => void;
}) {
  return (
    <div className="mt-5">
      <h3 className="section-label mb-2">
        {title} · {paths.length}
      </h3>
      {paths.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-0.5">
          {paths.map((path) => (
            <button
              type="button"
              key={path}
              className="block w-full rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent-hover focus-visible:bg-accent-hover focus-visible:outline-none aria-[current=true]:bg-accent-hover aria-[current=true]:text-accent"
              aria-current={path === selectedPath}
              onClick={() => onSelect(path)}
              onPointerEnter={() => onHover(path)}
              onPointerLeave={() => onHover(undefined)}
              title={path}
            >
              <span className="block truncate">{nodeByPath.get(path)?.label ?? path}</span>
              <span className="block truncate font-mono text-[10px] text-muted">{path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
