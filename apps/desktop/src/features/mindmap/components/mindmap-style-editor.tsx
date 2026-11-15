"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/features/i18n";
import { readThemePalette, useSystemFonts } from "@/features/settings";
import { type MindmapStyle, validMindmapFont } from "../lib/mindmap";

export function MindmapStyleEditor({
  style,
  disabled,
  onChange,
  onReset,
}: {
  style: MindmapStyle;
  disabled: boolean;
  onChange: (style: MindmapStyle) => void;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const { fonts, status, retry } = useSystemFonts();
  const [palette, setPalette] = useState(readThemePalette);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(readThemePalette()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);
  const family = style.fontFamily ?? "system-ui";
  const presets = ["system-ui", "serif", "monospace"] as const;
  const available = fonts.filter(
    (font) => validMindmapFont(font) && !presets.some((preset) => preset === font),
  );
  return (
    <fieldset
      disabled={disabled}
      className="mt-2 flex flex-wrap items-end gap-3 border-t border-border px-2 pt-3 pb-1 text-xs"
    >
      <legend className="sr-only">{t("mindmap.appearance")}</legend>
      <label className="grid gap-1">
        <span>{t("mindmap.fontFamily")}</span>
        <select
          className="settings-control max-w-48"
          value={family}
          onChange={(event) => onChange({ fontFamily: event.target.value })}
        >
          {presets.map((font) => (
            <option key={font} value={font}>
              {t(`settings.fonts.${font}`)}
            </option>
          ))}
          {!presets.some((font) => font === family) && !available.includes(family) && (
            <option value={family}>{family}</option>
          )}
          {available.length > 0 && (
            <optgroup label={t("settings.fonts.systemFonts")}>
              {available.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="grid gap-1">
        <span>{t("mindmap.fontSize")}</span>
        <input
          className="settings-control w-20"
          type="number"
          min={10}
          max={48}
          value={style.fontSize ?? 14}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (value >= 10 && value <= 48) onChange({ fontSize: value });
          }}
        />
      </label>
      {(["color", "background", "borderColor"] as const).map((key) => (
        <label key={key} className="grid gap-1">
          <span>{t(`mindmap.${key}`)}</span>
          <input
            type="color"
            className="h-8 w-10 cursor-pointer rounded border border-border bg-background p-0.5"
            value={
              style[key] ??
              (key === "color"
                ? palette.foreground
                : key === "background"
                  ? palette.surface
                  : palette.border)
            }
            onChange={(event) => onChange({ [key]: event.target.value })}
          />
        </label>
      ))}
      <button type="button" className="btn btn-sm" onClick={onReset}>
        {t("mindmap.resetStyle")}
      </button>
      {status === "error" && (
        <button type="button" className="text-accent" onClick={retry}>
          {t("settings.fonts.error")} {t("common.retry")}
        </button>
      )}
    </fieldset>
  );
}
