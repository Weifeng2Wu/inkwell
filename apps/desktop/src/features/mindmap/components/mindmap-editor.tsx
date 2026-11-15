"use client";

import {
  ArrowsOutIcon,
  ArrowUUpLeftIcon,
  ArrowUUpRightIcon,
  DownloadSimpleIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";
import { Tooltip } from "@/components/ui/tooltip";
import type { MonacoEditor } from "@/features/editor/components/lazy";
import { useI18n } from "@/features/i18n";
import { savePosterExport } from "@/features/poster/lib/export";
import {
  layoutMindmap,
  type MindmapNode,
  type MindmapSide,
  type MindmapStyle,
  mindmapEdge,
  mindmapFontFamily,
  mindmapSvg,
  parseMindmap,
  serializeMindmap,
  updateMindmap,
} from "../lib/mindmap";
import { useMindmapPan } from "../lib/use-mindmap-pan";
import { useMindmapZoom } from "../lib/use-mindmap-zoom";
import { MindmapNodeMenu } from "./mindmap-node-menu";

type Props = ComponentProps<typeof MonacoEditor> & { filePath: string; projectPath: string };

export function MindmapEditor({ filePath, projectPath: _projectPath, ...props }: Props) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editingId = useRef<string | null>(null);
  const [selected, setSelected] = useState("0");
  const [label, setLabel] = useState("");
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [zoom, setZoom] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [exportError, setExportError] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const expected = useRef(props.content ?? "");
  const parsed = useMemo(() => {
    if (!props.content?.trim()) return { empty: true };
    try {
      return { root: parseMindmap(props.content) };
    } catch {
      return { error: true };
    }
  }, [props.content]);
  const layout = useMemo(() => (parsed.root ? layoutMindmap(parsed.root) : null), [parsed.root]);
  const positioned = layout?.nodes.find(({ node }) => node.id === selected) ?? layout?.nodes[0];
  const current = positioned?.node ?? parsed.root;
  const branchId = current?.id.split(".").slice(0, 2).join(".");
  const scale =
    zoom ??
    Math.min(
      1,
      Math.max(1, size.width - 56) / (layout?.width ?? 1),
      Math.max(1, size.height - 24) / (layout?.height ?? 1),
    );
  const readonly = props.readOnly ?? false;
  const pan = useMindmapPan(stage, !!layout && !menu);
  useMindmapZoom(stage, !!layout && !menu, { scale, offset: pan.offset }, (view) => {
    setZoom(view.scale);
    pan.setOffset(view.offset);
  });
  useEffect(() => {
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement.dataset.mindmapNode
    ) {
      stage.current?.querySelector<HTMLButtonElement>(`[data-mindmap-node="${selected}"]`)?.focus();
    }
  }, [selected]);
  useEffect(() => {
    if (editing && layout?.nodes.some(({ node }) => node.id === editing)) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing, layout]);
  useEffect(() => {
    if (expected.current === (props.content ?? "")) return;
    expected.current = props.content ?? "";
    setPast([]);
    setFuture([]);
    setSelected("0");
    setMenu(null);
    setEditing(null);
    editingId.current = null;
  }, [props.content]);
  const hasRoot = parsed.root !== undefined;
  useEffect(() => {
    if (!hasRoot || !stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [hasRoot]);
  function commit(root: MindmapNode, selection = selected) {
    if (readonly) return;
    const content = serializeMindmap(root);
    if (content === props.content) return;
    setPast((values) => [...values.slice(-49), props.content ?? ""]);
    setFuture([]);
    expected.current = content;
    setSelected(selection);
    props.onContentChange?.(content);
  }
  function beginEditing(id: string, text: string) {
    if (readonly) return;
    setSelected(id);
    setLabel(text);
    editingId.current = id;
    setEditing(id);
  }
  function finishEditing(save = true) {
    const id = editingId.current;
    editingId.current = null;
    setEditing(null);
    if (!save || !parsed.root || !id) return;
    const text = label.replace(/[\r\n]+/g, " ").trim();
    if (text)
      commit(
        updateMindmap(parsed.root, id, (node) => ({ ...node, text })),
        id,
      );
  }
  function add(sibling: boolean, side?: MindmapSide) {
    if (!parsed.root || !current || readonly || (layout?.nodes.length ?? 0) >= 500) return;
    const parent =
      sibling && current.id !== "0" ? current.id.slice(0, current.id.lastIndexOf(".")) : current.id;
    if (parent.split(".").length > 24) return;
    let selection = parent;
    const next = updateMindmap(parsed.root, parent, (node) => {
      selection = `${node.id}.${node.children.length}`;
      return {
        ...node,
        children: [
          ...node.children,
          {
            id: selection,
            text: t("mindmap.newNode"),
            children: [],
            ...(parent === "0" ? { side: side ?? positioned?.side ?? "right" } : {}),
          },
        ],
      };
    });
    commit(next, selection);
    beginEditing(selection, t("mindmap.newNode"));
  }
  function changeSide(side: MindmapSide) {
    if (!parsed.root || !branchId || current?.id === "0") return;
    commit(updateMindmap(parsed.root, branchId, (node) => ({ ...node, side })));
  }
  function changeStyle(style?: MindmapStyle) {
    if (!parsed.root || !current) return;
    commit(
      updateMindmap(parsed.root, current.id, (node) => ({
        ...node,
        style: style ? { ...node.style, ...style } : undefined,
      })),
    );
  }
  function remove() {
    if (!parsed.root || !current || current.id === "0") return;
    const parent = current.id.slice(0, current.id.lastIndexOf("."));
    commit(
      updateMindmap(parsed.root, parent, (node) => ({
        ...node,
        children: node.children.filter((child) => child.id !== current.id),
      })),
      parent,
    );
  }
  function undo(redo = false) {
    if (readonly) return;
    const history = redo ? future : past;
    const content = history.at(-1);
    if (content === undefined) return;
    (redo ? setFuture : setPast)(history.slice(0, -1));
    (redo ? setPast : setFuture)((values) => [...values, props.content ?? ""]);
    expected.current = content;
    setSelected("0");
    props.onContentChange?.(content);
  }
  async function exportSvg() {
    if (!parsed.root || !stage.current) return;
    try {
      const styles = getComputedStyle(stage.current);
      const svg = mindmapSvg(parsed.root, {
        background: styles.backgroundColor,
        foreground: styles.color,
        border: styles.getPropertyValue("--border-dark").trim(),
        surface: styles.getPropertyValue("--surface").trim(),
      });
      await savePosterExport(
        new TextEncoder().encode(svg),
        filePath
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.mindmap\.md$/i, ".svg") ?? "mindmap.svg",
        "svg",
      );
      setExportError(false);
    } catch {
      setExportError(true);
    }
  }
  const actions = [
    {
      label: t("mindmap.undo"),
      icon: ArrowUUpLeftIcon,
      run: () => undo(),
      disabled: readonly || !past.length,
    },
    {
      label: t("mindmap.redo"),
      icon: ArrowUUpRightIcon,
      run: () => undo(true),
      disabled: readonly || !future.length,
    },
    {
      label: t("mindmap.zoomOut"),
      icon: MinusIcon,
      run: () => setZoom(Math.max(0.1, scale / 1.2)),
      disabled: !layout,
    },
    {
      label: t("mindmap.zoomIn"),
      icon: PlusIcon,
      run: () => setZoom(Math.min(3, scale * 1.2)),
      disabled: !layout,
    },
    {
      label: t("mindmap.fit"),
      icon: ArrowsOutIcon,
      run: () => {
        setZoom(null);
        pan.reset();
      },
      disabled: !layout,
    },
    {
      label: t("mindmap.exportSvg"),
      icon: DownloadSimpleIcon,
      run: () => void exportSvg(),
      disabled: !layout,
    },
  ];
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      aria-label={t("mindmap.title")}
      onKeyDown={(event) => {
        if (
          menu ||
          event.nativeEvent.isComposing ||
          (event.target instanceof HTMLElement && event.target.closest("input,textarea"))
        )
          return;
        if (!(event.target instanceof HTMLElement) || !event.target.dataset.mindmapNode) return;
        const mod = event.ctrlKey || event.metaKey;
        let action: (() => void) | undefined;
        if (mod && event.key.toLowerCase() === "z") action = () => undo(event.shiftKey);
        else if (event.key === "Tab" && !event.shiftKey && !readonly) action = () => add(false);
        else if (event.key === "Enter" && !readonly) action = () => add(true);
        else if ((event.key === "Delete" || event.key === "Backspace") && !readonly)
          action = remove;
        else if (event.key === "F2" && current)
          action = () => beginEditing(current.id, current.text);
        else if (
          (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) &&
          !readonly
        ) {
          const rect = event.target.getBoundingClientRect();
          action = () => setMenu({ x: rect.right, y: rect.top });
        } else if (event.key.startsWith("Arrow") && current && layout) {
          const index = layout.nodes.findIndex(({ node }) => node.id === current.id);
          const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
          const direction = event.key === "ArrowLeft" ? "left" : "right";
          const target = horizontal
            ? current.id === "0"
              ? current.children.find((node) => (node.side ?? "right") === direction)?.id
              : direction === positioned?.side
                ? current.children[0]?.id
                : current.id.slice(0, current.id.lastIndexOf(".")) || "0"
            : layout.nodes[index + (event.key === "ArrowUp" ? -1 : 1)]?.node.id;
          if (target) action = () => setSelected(target);
        }
        if (action) {
          event.preventDefault();
          event.stopPropagation();
          action();
        }
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1">
        <span className="section-label mr-auto">{t("mindmap.title")}</span>
        {actions.map(({ label: name, icon: Icon, run, disabled }) => (
          <Tooltip key={name} label={name}>
            <button
              type="button"
              className="toolbar-icon-button"
              aria-label={name}
              disabled={disabled}
              onClick={run}
            >
              <Icon className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        ))}
      </div>
      {exportError && (
        <p role="alert" className="px-3 py-2 text-error">
          {t("mindmap.exportFailed")}
        </p>
      )}
      {parsed.empty ? (
        <div className="m-auto flex flex-col items-center gap-3 p-6 text-sm text-muted">
          <p>{t("mindmap.empty")}</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={readonly}
            onClick={() => commit({ id: "0", text: t("mindmap.root"), children: [] })}
          >
            {t("mindmap.create")}
          </button>
        </div>
      ) : !layout ? (
        <p role="alert" className="p-6 text-sm text-error">
          {t("mindmap.invalid")}
        </p>
      ) : (
        <>
          <div
            ref={stage}
            className="relative min-h-0 flex-1 overflow-hidden bg-background text-foreground"
            style={{ cursor: pan.cursor, touchAction: "none" }}
            {...pan.handlers}
          >
            <svg
              role="img"
              aria-label={t("mindmap.title")}
              width={layout.width * scale}
              height={layout.height * scale}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              className="absolute max-w-none select-none"
              style={{
                transform: `translate(${(size.width - layout.width * scale) / 2 + pan.offset.x}px, ${(size.height - layout.height * scale) / 2 + pan.offset.y}px)`,
              }}
            >
              {layout.edges.map(({ from, to }) => (
                <path
                  key={to.node.id}
                  d={mindmapEdge(from, to)}
                  fill="none"
                  stroke={to.style.borderColor ?? "var(--border-dark)"}
                  strokeWidth={1.5}
                />
              ))}
              {layout.nodes.map((node) => (
                <foreignObject
                  key={node.node.id}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                >
                  {editing === node.node.id && !readonly ? (
                    <textarea
                      ref={input}
                      aria-label={t("mindmap.nodeText")}
                      className="h-full w-full resize-none rounded-lg border border-accent bg-background px-3 py-2 text-foreground outline-none"
                      style={{
                        fontFamily: mindmapFontFamily(node.style.fontFamily),
                        fontSize: node.style.fontSize ?? 14,
                        lineHeight: `${node.lineHeight}px`,
                      }}
                      maxLength={2000}
                      value={label}
                      onChange={(event) => setLabel(event.target.value)}
                      onBlur={() => finishEditing()}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === "Enter" || event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          finishEditing(event.key === "Enter");
                          requestAnimationFrame(() =>
                            stage.current
                              ?.querySelector<HTMLButtonElement>(
                                `[data-mindmap-node="${node.node.id}"]`,
                              )
                              ?.focus(),
                          );
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      data-mindmap-node={node.node.id}
                      className={`h-full w-full whitespace-pre-wrap rounded-lg border px-3 text-left ${current?.id === node.node.id ? "outline-2 -outline-offset-2 outline-accent" : ""}`}
                      style={{
                        fontFamily: mindmapFontFamily(node.style.fontFamily),
                        fontSize: node.style.fontSize ?? 14,
                        lineHeight: `${node.lineHeight}px`,
                        color: node.style.color ?? "var(--foreground)",
                        backgroundColor: node.style.background ?? "var(--surface)",
                        borderColor: node.style.borderColor ?? "var(--border-dark)",
                        cursor: pan.cursor,
                      }}
                      aria-pressed={current?.id === node.node.id}
                      onClick={() => setSelected(node.node.id)}
                      onFocus={() => setSelected(node.node.id)}
                      onDoubleClick={() => beginEditing(node.node.id, node.node.text)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        if (readonly) return;
                        setSelected(node.node.id);
                        event.currentTarget.focus();
                        setMenu({ x: event.clientX, y: event.clientY });
                      }}
                    >
                      {node.lines.join("\n")}
                    </button>
                  )}
                </foreignObject>
              ))}
            </svg>
            {positioned &&
              !readonly &&
              !editing &&
              (["left", "right"] as const).map((side) => {
                const adding = current?.id === "0" || side === positioned.side;
                const name = adding
                  ? t(
                      current?.id === "0"
                        ? side === "left"
                          ? "mindmap.addLeft"
                          : "mindmap.addRight"
                        : "mindmap.addChild",
                    )
                  : t("common.delete");
                const Icon = adding ? PlusIcon : MinusIcon;
                return (
                  <Tooltip key={side} label={name}>
                    <button
                      type="button"
                      aria-label={name}
                      className="absolute flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted shadow-sm hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                      style={{
                        left:
                          (size.width - layout.width * scale) / 2 +
                          pan.offset.x +
                          (positioned.x + (side === "right" ? positioned.width : 0)) * scale +
                          (side === "right" ? 4 : -24),
                        top:
                          (size.height - layout.height * scale) / 2 +
                          pan.offset.y +
                          (positioned.y + positioned.height / 2) * scale -
                          10,
                      }}
                      onClick={() => (adding ? add(false, side) : remove())}
                    >
                      <Icon className="size-3" aria-hidden="true" />
                    </button>
                  </Tooltip>
                );
              })}
          </div>
          {menu && positioned && !readonly && (
            <MindmapNodeMenu
              x={menu.x}
              y={menu.y}
              root={current?.id === "0"}
              side={positioned.side}
              style={positioned.style}
              onAdd={add}
              onRemove={remove}
              onEdit={() => beginEditing(positioned.node.id, positioned.node.text)}
              onSide={changeSide}
              onStyle={changeStyle}
              onClose={() => setMenu(null)}
            />
          )}
          <p className="shrink-0 border-t border-border px-3 py-1 text-xs text-muted">
            {t("mindmap.panHint")}
          </p>
        </>
      )}
    </section>
  );
}
