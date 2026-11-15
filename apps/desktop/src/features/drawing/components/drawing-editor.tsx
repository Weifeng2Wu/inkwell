"use client";

import { Excalidraw, hashElementsVersion, MainMenu, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawInitialDataState, ExcalidrawProps } from "@excalidraw/excalidraw/types";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import {
  Component,
  type ComponentProps,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MonacoEditor } from "@/features/editor/components/lazy";
import { useI18n } from "@/features/i18n";
import { useThemeMode } from "@/features/settings";
import { MAX_DRAWING_BYTES, parseDrawing } from "../lib/scene";
import "@excalidraw/excalidraw/index.css";
import "./drawing-editor.css";

type Props = ComponentProps<typeof MonacoEditor> & { filePath: string; projectPath: string };

class CanvasBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function DrawingCanvas({
  initialData,
  onChange,
  readOnly,
  name,
}: {
  initialData: ExcalidrawInitialDataState;
  onChange: (content: string) => void;
  readOnly: boolean;
  name: string;
}) {
  const { locale } = useI18n();
  const theme = useThemeMode();
  const previous = useRef<string | null>(null);
  const signature = useRef<{ elements: number; state: string; files: unknown } | null>(null);
  const changed: ExcalidrawProps["onChange"] = (elements, state, files) => {
    const next = {
      elements: hashElementsVersion(elements),
      state: serializeAsJSON([], state, {}, "local"),
      files,
    };
    if (
      signature.current?.elements === next.elements &&
      signature.current.state === next.state &&
      signature.current.files === files
    )
      return;
    signature.current = next;
    const content = serializeAsJSON(elements, state, files, "local");
    const before = previous.current;
    previous.current = content;
    if (before !== null && before !== content && !readOnly) onChange(`${content}\n`);
  };
  return (
    <Excalidraw
      initialData={initialData}
      onChange={changed}
      name={name}
      theme={theme}
      langCode={locale === "zh" ? "zh-CN" : locale === "ko" ? "ko-KR" : "en"}
      viewModeEnabled={readOnly}
      handleKeyboardGlobally={false}
      autoFocus={false}
      validateEmbeddable={false}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: false,
          export: false,
        },
      }}
      onLinkOpen={(element, event) => {
        event.preventDefault();
        if (!element.link || !/^https?:\/\//i.test(element.link)) return;
        if (isTauri()) void open(element.link).catch(() => {});
        else window.open(element.link, "_blank", "noopener,noreferrer");
      }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}

export function DrawingEditor({ filePath, projectPath: _projectPath, ...props }: Props) {
  const { t } = useI18n();
  const [source, setSource] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const expected = useRef(props.content ?? "");
  const parsed = useMemo(() => {
    try {
      return { scene: parseDrawing(props.content ?? "") };
    } catch {
      return { error: true };
    }
  }, [props.content]);
  useEffect(() => {
    if (expected.current === (props.content ?? "")) return;
    expected.current = props.content ?? "";
    setRevision((value) => value + 1);
    setError("");
  }, [props.content]);
  const invalid = (
    <p role="alert" className="p-6 text-sm text-error">
      {t("drawing.invalid")}
    </p>
  );
  return (
    <section className="flex h-full min-h-0 flex-col bg-background" aria-label={t("drawing.title")}>
      <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span className="section-label">{t("drawing.title")}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={!source}
            onClick={() => setSource(false)}
          >
            {t("drawing.canvas")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={source}
            onClick={() => setSource(true)}
          >
            {t("markdown.source")}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
      {source ? (
        <MonacoEditor {...props} language="json" />
      ) : parsed.scene ? (
        <div className="inkwell-drawing min-h-0 flex-1">
          <CanvasBoundary key={revision} fallback={invalid}>
            <DrawingCanvas
              initialData={parsed.scene}
              readOnly={props.readOnly ?? false}
              name={filePath.replace(/\.excalidraw$/i, "")}
              onChange={(content) => {
                if (new TextEncoder().encode(content).length > MAX_DRAWING_BYTES) {
                  setError(t("drawing.tooLarge"));
                  return;
                }
                setError("");
                expected.current = content;
                props.onContentChange?.(content);
              }}
            />
          </CanvasBoundary>
        </div>
      ) : (
        invalid
      )}
    </section>
  );
}
