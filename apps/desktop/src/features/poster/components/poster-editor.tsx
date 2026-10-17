"use client";

import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  type ComponentProps,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MonacoEditor } from "@/features/editor/components/lazy";
import { resolveMarkdownImage } from "@/features/editor/lib/markdown";
import { useI18n } from "@/features/i18n";
import {
  embedPosterImages,
  posterPptx,
  posterRaster,
  posterSvg,
  savePosterExport,
} from "../lib/export";
import { posterLabels } from "../lib/labels";
import {
  createPoster,
  POSTER_SIZES,
  POSTER_STYLES,
  type PosterDocument,
  type PosterElement,
  type PosterSize,
  type PosterStyle,
  parsePoster,
  resizePoster,
  restylePoster,
  serializePoster,
  textOverflows,
  wrapText,
} from "../lib/model";

type Props = ComponentProps<typeof MonacoEditor> & { filePath: string; projectPath: string };
type Gesture = {
  id: string;
  x: number;
  y: number;
  scale: number;
  resize: boolean;
  original: PosterDocument;
  target: Element;
};
const buttonClass =
  "rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-40";
const inputClass = "w-full rounded border border-border bg-background px-2 py-1 text-xs";

export function PosterEditor({ filePath, projectPath, ...props }: Props) {
  const { locale } = useI18n();
  const l = posterLabels(locale);
  const [source, setSource] = useState(false);
  const [style, setStyle] = useState<PosterStyle>("classic");
  const [size, setSize] = useState<PosterSize>("A0");
  const [landscape, setLandscape] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const [zoom, setZoom] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(800);
  const [preview, setPreview] = useState<PosterDocument>();
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const expected = useRef(props.content ?? "");
  const gesture = useRef<Gesture | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => {
    if (!props.content?.trim()) return { empty: true };
    try {
      return { poster: parsePoster(props.content) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [props.content]);
  const poster = preview ?? parsed.poster;
  const element = poster?.elements.find((e) => e.id === selected);
  const scale = poster
    ? zoom || Math.max(0.1, Math.min(1.5, (availableWidth - 48) / poster.width))
    : 1;
  const readonly = props.readOnly ?? false;
  useEffect(() => {
    if (expected.current !== (props.content ?? "")) {
      expected.current = props.content ?? "";
      setPast([]);
      setFuture([]);
      setPreview(undefined);
      setEditing(undefined);
      gesture.current = null;
    }
  }, [props.content]);
  const hasPoster = !!poster;
  useEffect(() => {
    if (source || !hasPoster || !stage.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setAvailableWidth(entries[0].contentRect.width);
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [source, hasPoster]);
  function commit(next: PosterDocument) {
    if (readonly) return;
    const content = serializePoster(next);
    if (content === props.content) return;
    setPast((values) => [...values.slice(-49), props.content ?? ""]);
    setFuture([]);
    expected.current = content;
    props.onContentChange?.(content);
  }
  function history(redo: boolean) {
    const from = redo ? future : past;
    const content = from.at(-1);
    if (readonly || content === undefined) return;
    (redo ? setFuture : setPast)(from.slice(0, -1));
    (redo ? setPast : setFuture)((values) => [...values, props.content ?? ""]);
    expected.current = content;
    props.onContentChange?.(content);
    setEditing(undefined);
    setPreview(undefined);
  }
  function patch(change: Partial<PosterElement>) {
    if (!poster || !element) return;
    const e = { ...element, ...change };
    e.width = Math.max(1, Math.min(poster.width, e.width));
    e.height = Math.max(1, Math.min(poster.height, e.height));
    e.x = Math.max(0, Math.min(poster.width - e.width, e.x));
    e.y = Math.max(0, Math.min(poster.height - e.height, e.y));
    commit({ ...poster, elements: poster.elements.map((item) => (item.id === e.id ? e : item)) });
  }
  function add(type: PosterElement["type"], src?: string) {
    if (!poster) return;
    const theme = POSTER_STYLES[poster.style];
    const next: PosterElement = {
      id: crypto.randomUUID(),
      type,
      x: 30,
      y: Math.round(poster.height * 0.25),
      width: Math.min(220, poster.width - 60),
      height: 100,
      ...(type === "text"
        ? { text: l.content, fontSize: 8, color: theme.ink }
        : type === "rect"
          ? { fill: theme.panel }
          : { src, alt: l.alt }),
    };
    commit({ ...poster, elements: [...poster.elements, next] });
    setSelected(next.id);
  }
  function remove() {
    if (poster && element) {
      commit({ ...poster, elements: poster.elements.filter((e) => e.id !== element.id) });
      setSelected(undefined);
      setEditing(undefined);
    }
  }
  function duplicate() {
    if (!poster || !element) return;
    const copy = {
      ...element,
      id: crypto.randomUUID(),
      x: Math.min(poster.width - element.width, element.x + 10),
      y: Math.min(poster.height - element.height, element.y + 10),
    };
    commit({ ...poster, elements: [...poster.elements, copy] });
    setSelected(copy.id);
  }
  function layer(direction: number) {
    if (!poster || !element) return;
    const elements = [...poster.elements],
      index = elements.findIndex((e) => e.id === element.id),
      target = index + direction;
    if (target < 0 || target >= elements.length) return;
    elements.splice(index, 1);
    elements.splice(target, 0, element);
    commit({ ...poster, elements });
  }
  function start(event: PointerEvent, e: PosterElement, resize = false) {
    event.stopPropagation();
    setSelected(e.id);
    if (readonly || editing === e.id || !poster) return;
    const actualScale = svg.current
      ? svg.current.getBoundingClientRect().width / poster.width
      : scale;
    gesture.current = {
      id: e.id,
      x: event.clientX,
      y: event.clientY,
      scale: actualScale,
      resize,
      original: poster,
      target: event.currentTarget,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = (event.clientX - g.x) / g.scale,
      dy = (event.clientY - g.y) / g.scale;
    setPreview({
      ...g.original,
      elements: g.original.elements.map((e) =>
        e.id !== g.id
          ? e
          : g.resize
            ? {
                ...e,
                width: Math.max(1, Math.min(g.original.width - e.x, e.width + dx)),
                height: Math.max(1, Math.min(g.original.height - e.y, e.height + dy)),
              }
            : {
                ...e,
                x: Math.max(0, Math.min(g.original.width - e.width, e.x + dx)),
                y: Math.max(0, Math.min(g.original.height - e.height, e.y + dy)),
              },
      ),
    });
  }
  function end(event: PointerEvent, cancel = false) {
    if (!gesture.current) return;
    const target = gesture.current.target;
    gesture.current = null;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (!cancel && preview) commit(preview);
    setPreview(undefined);
  }
  function imageSource(e: PosterElement) {
    if (e.src?.startsWith("data:")) return e.src;
    const path = resolveMarkdownImage(e.src ?? "", filePath, projectPath);
    return path && isTauri() ? convertFileSrc(path) : undefined;
  }
  async function exportPoster(format: "svg" | "pptx" | "png" | "jpeg" | "pdf") {
    if (!poster) return;
    setBusy(true);
    setMessage("");
    try {
      const embedded = await embedPosterImages(poster, filePath, projectPath);
      const bytes =
        format === "svg"
          ? new TextEncoder().encode(posterSvg(embedded))
          : format === "pptx"
            ? await posterPptx(embedded)
            : await posterRaster(embedded, format);
      const name =
        filePath
          .split(/[\\/]/)
          .at(-1)
          ?.replace(/\.poster\.json$/i, "") ?? "poster";
      const result = await savePosterExport(bytes, `${name}.${format}`, format);
      if (result !== false) setMessage(l.savedExport);
    } catch (error) {
      setMessage(`${l.failedExport}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }
  function choices(
    currentStyle: PosterStyle,
    currentSize: PosterSize,
    horizontal: boolean,
    changeStyle: (s: PosterStyle) => void,
    changeSize: (s: PosterSize) => void,
    changeOrientation: (v: boolean) => void,
  ) {
    return (
      <>
        <select
          aria-label={l.style}
          className={inputClass}
          value={currentStyle}
          disabled={readonly}
          onChange={(e) => changeStyle(e.target.value as PosterStyle)}
        >
          {Object.keys(POSTER_STYLES).map((s) => (
            <option key={s} value={s}>
              {l[s as PosterStyle]}
            </option>
          ))}
        </select>
        <select
          aria-label={l.size}
          className={inputClass}
          value={currentSize}
          disabled={readonly}
          onChange={(e) => changeSize(e.target.value as PosterSize)}
        >
          {Object.keys(POSTER_SIZES).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label={l.orientation}
          className={inputClass}
          value={horizontal ? "landscape" : "portrait"}
          disabled={readonly}
          onChange={(e) => changeOrientation(e.target.value === "landscape")}
        >
          <option value="portrait">{l.portrait}</option>
          <option value="landscape">{l.landscape}</option>
        </select>
      </>
    );
  }
  return (
    <section
      aria-label={l.editor}
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
      onKeyDown={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "input,textarea,select,[contenteditable=true],.monaco-editor",
          )
        )
          return;
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          history(event.shiftKey);
        }
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          remove();
        }
        if (event.key === "Escape") {
          setSelected(undefined);
          setEditing(undefined);
        }
        if (element && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
          event.preventDefault();
          const step = event.shiftKey ? 10 : 1;
          patch({
            x:
              element.x +
              (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0),
            y: element.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0),
          });
        }
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className="mr-auto text-xs font-medium">{l.editor}</span>
        <button
          type="button"
          className={buttonClass}
          aria-pressed={!source}
          onClick={() => setSource(false)}
        >
          {l.canvas}
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-pressed={source}
          onClick={() => setSource(true)}
        >
          {l.source}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={readonly || !past.length}
          onClick={() => history(false)}
        >
          {l.undo}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={readonly || !future.length}
          onClick={() => history(true)}
        >
          {l.redo}
        </button>
        {poster && (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void exportPoster("svg")}
            >
              {l.exportSvg}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void exportPoster("pdf")}
            >
              {l.exportPdf}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void exportPoster("png")}
            >
              {l.exportPng}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void exportPoster("jpeg")}
            >
              {l.exportJpeg}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void exportPoster("pptx")}
            >
              {busy ? l.exporting : l.exportPptx}
            </button>
          </>
        )}
      </header>
      {message && (
        <p role="status" className="border-b border-border px-3 py-2 text-xs">
          {message}
        </p>
      )}
      {source ? (
        <MonacoEditor {...props} language="json" className="h-full" />
      ) : !poster ? (
        <div className="m-auto max-w-lg space-y-4 p-6">
          {parsed.error ? (
            <>
              <p role="alert">{l.invalid}</p>
              <p className="text-xs text-muted-foreground">{parsed.error}</p>
              <button type="button" className={buttonClass} onClick={() => setSource(true)}>
                {l.source}
              </button>
            </>
          ) : (
            <>
              <p>{l.empty}</p>
              <div className="flex gap-2">
                {choices(style, size, landscape, setStyle, setSize, setLandscape)}
              </div>
              <button
                type="button"
                className={buttonClass}
                disabled={readonly}
                onClick={() => commit(createPoster(style, size, landscape))}
              >
                {l.create}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <button
              type="button"
              className={buttonClass}
              disabled={readonly}
              onClick={() => add("text")}
            >
              {l.text}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={readonly}
              onClick={() => add("rect")}
            >
              {l.rect}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={readonly}
              onClick={() => upload.current?.click()}
            >
              {l.image}
            </button>
            <input
              ref={upload}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/webp"
              aria-label={l.image}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (
                  file.size > 8 * 1024 * 1024 ||
                  !["image/png", "image/jpeg", "image/webp"].includes(file.type)
                ) {
                  setMessage(l.unsupportedImage);
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => add("image", String(reader.result));
                reader.onerror = () => setMessage(l.unsupportedImage);
                reader.readAsDataURL(file);
              }}
            />
            <select
              aria-label={l.zoom}
              value={zoom}
              className="ml-auto rounded border border-border bg-background text-xs"
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              <option value={0}>{l.fit}</option>
              {[0.25, 0.5, 0.75, 1, 1.5, 2].map((z) => (
                <option key={z} value={z}>
                  {z * 100}%
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-h-0 flex-1">
            <div
              ref={stage}
              className="min-w-0 flex-1 overflow-auto bg-accent/40 p-6"
              role="application"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Canvas receives keyboard movement shortcuts.
              tabIndex={0}
              aria-label={l.canvas}
            >
              <svg
                ref={svg}
                role="img"
                aria-label={poster.title}
                width={poster.width * scale}
                height={poster.height * scale}
                viewBox={`0 0 ${poster.width} ${poster.height}`}
                className="block shadow-lg"
                style={{ touchAction: "none", maxWidth: "none" }}
                onPointerDown={() => {
                  setSelected(undefined);
                  setEditing(undefined);
                }}
                onPointerMove={move}
                onPointerUp={(e) => end(e)}
                onPointerCancel={(e) => end(e, true)}
              >
                <title>{poster.title}</title>
                <rect width={poster.width} height={poster.height} fill={poster.background} />
                {poster.elements.map((e) => (
                  // biome-ignore lint/a11y/useSemanticElements: SVG canvas objects cannot be HTML buttons.
                  <g
                    key={e.id}
                    role="button"
                    aria-label={e.type === "text" ? e.text?.slice(0, 100) : (e.alt ?? e.id)}
                    tabIndex={0}
                    onFocus={() => setSelected(e.id)}
                    onPointerDown={(event) => start(event, e)}
                    onDoubleClick={() => {
                      if (e.type === "text" && !readonly) {
                        setSelected(e.id);
                        setEditing(e.id);
                      }
                    }}
                    style={{ cursor: readonly ? "default" : "move" }}
                  >
                    {e.type === "rect" ? (
                      <rect
                        x={e.x}
                        y={e.y}
                        width={e.width}
                        height={e.height}
                        fill={e.fill ?? "#ffffff"}
                      />
                    ) : e.type === "image" ? (
                      <>
                        <rect x={e.x} y={e.y} width={e.width} height={e.height} fill="#e5e7eb" />
                        <image
                          href={imageSource(e)}
                          x={e.x}
                          y={e.y}
                          width={e.width}
                          height={e.height}
                          preserveAspectRatio="xMidYMid meet"
                        >
                          <title>{e.alt}</title>
                        </image>
                      </>
                    ) : (
                      <>
                        <rect
                          x={e.x}
                          y={e.y}
                          width={e.width}
                          height={e.height}
                          fill="transparent"
                        />
                        {editing === e.id ? (
                          <foreignObject
                            x={e.x}
                            y={e.y}
                            width={e.width}
                            height={e.height}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <textarea
                              ref={(node) => node?.focus()}
                              aria-label={l.content}
                              value={e.text}
                              onChange={(event) => patch({ text: event.target.value })}
                              onBlur={() => setEditing(undefined)}
                              className="h-full w-full resize-none border-0 bg-transparent p-0 outline-none"
                              style={{
                                fontSize: e.fontSize ?? 8,
                                lineHeight: 1.25,
                                fontFamily: POSTER_STYLES[poster.style].font,
                                fontWeight: e.bold ? "bold" : "normal",
                                color: e.color,
                                textAlign: e.align ?? "left",
                              }}
                            />
                          </foreignObject>
                        ) : (
                          <svg
                            x={e.x}
                            y={e.y}
                            width={e.width}
                            height={e.height}
                            overflow="hidden"
                            style={{ pointerEvents: "none" }}
                            aria-hidden="true"
                          >
                            <text
                              fill={e.color ?? "#14253d"}
                              fontFamily={POSTER_STYLES[poster.style].font}
                              fontSize={e.fontSize ?? 8}
                              fontWeight={e.bold ? "bold" : "normal"}
                              textAnchor={
                                e.align === "center"
                                  ? "middle"
                                  : e.align === "right"
                                    ? "end"
                                    : "start"
                              }
                            >
                              {wrapText(e.text ?? "", e.width, e.fontSize ?? 8).map((line, i) => (
                                <tspan
                                  // biome-ignore lint/suspicious/noArrayIndexKey: Stateless wrapped lines use their position.
                                  key={`${i}-${line}`}
                                  x={
                                    e.align === "center"
                                      ? e.width / 2
                                      : e.align === "right"
                                        ? e.width
                                        : 0
                                  }
                                  y={(e.fontSize ?? 8) * (1 + i * 1.25)}
                                >
                                  {line}
                                </tspan>
                              ))}
                            </text>
                          </svg>
                        )}
                      </>
                    )}
                  </g>
                ))}
                {element && (
                  <g style={{ pointerEvents: "none" }}>
                    <rect
                      x={element.x}
                      y={element.y}
                      width={element.width}
                      height={element.height}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={2 / scale}
                    />
                    {!readonly && (
                      // biome-ignore lint/a11y/useSemanticElements: SVG resize handle cannot be an HTML button.
                      <rect
                        role="button"
                        aria-label={l.resize}
                        tabIndex={0}
                        x={element.x + element.width - 5 / scale}
                        y={element.y + element.height - 5 / scale}
                        width={10 / scale}
                        height={10 / scale}
                        fill="#3b82f6"
                        style={{ pointerEvents: "all", cursor: "nwse-resize" }}
                        onPointerDown={(event) => start(event, element, true)}
                      />
                    )}
                  </g>
                )}
              </svg>
            </div>
            <aside
              aria-label={l.editor}
              className="w-56 shrink-0 space-y-3 overflow-y-auto border-l border-border p-3 text-xs"
            >
              <label className="block space-y-1">
                <span>{l.title}</span>
                <input
                  className={inputClass}
                  disabled={readonly}
                  value={poster.title}
                  maxLength={1000}
                  onChange={(e) => commit({ ...poster, title: e.target.value })}
                />
              </label>
              <div className="space-y-2">
                {choices(
                  poster.style,
                  (Object.keys(POSTER_SIZES) as PosterSize[]).find(
                    (s) => Math.abs(Math.min(poster.width, poster.height) - POSTER_SIZES[s][0]) < 1,
                  ) ?? size,
                  poster.width > poster.height,
                  (s) => commit(restylePoster(poster, s)),
                  (s) => {
                    setSize(s);
                    const [a, b] = POSTER_SIZES[s];
                    commit(
                      resizePoster(
                        poster,
                        poster.width > poster.height ? b : a,
                        poster.width > poster.height ? a : b,
                      ),
                    );
                  },
                  (horizontal) => {
                    if (horizontal !== poster.width > poster.height)
                      commit(resizePoster(poster, poster.height, poster.width));
                  },
                )}
              </div>
              <label className="flex items-center justify-between">
                {l.background}
                <input
                  aria-label={l.background}
                  type="color"
                  value={poster.background}
                  disabled={readonly}
                  onChange={(e) => commit({ ...poster, background: e.target.value })}
                />
              </label>
              <p className="text-muted-foreground">
                {poster.width.toFixed(1)} × {poster.height.toFixed(1)} mm · {l.save}
              </p>
              {!element ? (
                <p className="text-muted-foreground">{l.select}</p>
              ) : (
                <fieldset disabled={readonly} className="space-y-3 border-t border-border pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    {(["x", "y", "width", "height"] as const).map((key) => (
                      <label key={key} className="space-y-1">
                        <span>{l[key]}</span>
                        <input
                          type="number"
                          className={inputClass}
                          step={1}
                          min={key === "width" || key === "height" ? 1 : 0}
                          value={Math.round(element[key] * 10) / 10}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value)) patch({ [key]: value });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  {element.type === "text" && (
                    <>
                      <label className="block space-y-1">
                        <span>{l.content}</span>
                        <textarea
                          className={inputClass}
                          rows={6}
                          value={element.text}
                          maxLength={20000}
                          onChange={(e) => patch({ text: e.target.value })}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span>{l.fontSize}</span>
                        <input
                          className={inputClass}
                          type="number"
                          min={1}
                          max={120}
                          step={0.5}
                          value={element.fontSize ?? 8}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (n >= 1 && n <= 120) patch({ fontSize: n });
                          }}
                        />
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={element.bold ?? false}
                          onChange={(e) => patch({ bold: e.target.checked })}
                        />
                        {l.bold}
                      </label>
                      <label className="flex items-center justify-between">
                        {l.color}
                        <input
                          aria-label={l.color}
                          type="color"
                          value={element.color ?? "#14253d"}
                          onChange={(e) => patch({ color: e.target.value })}
                        />
                      </label>
                      <select
                        aria-label={l.align}
                        className={inputClass}
                        value={element.align ?? "left"}
                        onChange={(e) => patch({ align: e.target.value as PosterElement["align"] })}
                      >
                        {(["left", "center", "right"] as const).map((a) => (
                          <option key={a} value={a}>
                            {l[a]}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {element.type === "rect" && (
                    <label className="flex items-center justify-between">
                      {l.fill}
                      <input
                        aria-label={l.fill}
                        type="color"
                        value={element.fill ?? "#ffffff"}
                        onChange={(e) => patch({ fill: e.target.value })}
                      />
                    </label>
                  )}
                  {element.type === "image" && (
                    <label className="block space-y-1">
                      <span>{l.figure}</span>
                      <input
                        className={inputClass}
                        value={element.alt ?? ""}
                        maxLength={1000}
                        onChange={(e) => patch({ alt: e.target.value })}
                      />
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={buttonClass} onClick={duplicate}>
                      {l.duplicate}
                    </button>
                    <button type="button" className={buttonClass} onClick={remove}>
                      {l.remove}
                    </button>
                    <button type="button" className={buttonClass} onClick={() => layer(1)}>
                      {l.front}
                    </button>
                    <button type="button" className={buttonClass} onClick={() => layer(-1)}>
                      {l.back}
                    </button>
                  </div>
                </fieldset>
              )}
              {poster.elements.some(textOverflows) && (
                <p role="alert" className="rounded bg-amber-100 p-2 text-amber-900">
                  {l.overflow}
                </p>
              )}
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
