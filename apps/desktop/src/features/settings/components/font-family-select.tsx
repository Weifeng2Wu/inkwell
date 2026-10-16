"use client";

import { useI18n } from "@/features/i18n";
import type { useSystemFonts } from "../lib/use-system-fonts";

type FontPreset = { value: string; label: string };

export function FontFamilySelect({
  id,
  describedBy,
  value,
  onChange,
  presets,
  fonts,
}: {
  id: string;
  describedBy: string;
  value: string;
  onChange: (value: string) => void;
  presets: readonly FontPreset[];
  fonts: string[];
}) {
  const { t } = useI18n();
  const isPreset = presets.some((preset) => preset.value === value);

  return (
    <select
      id={id}
      aria-describedby={describedBy}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="settings-control settings-select"
    >
      <optgroup label={t("settings.fonts.presets")}>
        {presets.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
      </optgroup>
      {!isPreset && !fonts.includes(value) && <option value={value}>{value}</option>}
      {fonts.length > 0 && (
        <optgroup label={t("settings.fonts.systemFonts")}>
          {fonts
            .filter((font) => !presets.some((preset) => preset.value === font))
            .map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
        </optgroup>
      )}
    </select>
  );
}

export function SystemFontStatus({ fonts, status, retry }: ReturnType<typeof useSystemFonts>) {
  const { t } = useI18n();

  return (
    <p className="text-xs text-muted" role="status">
      {status === "loading" && t("settings.fonts.loading")}
      {status === "ready" && t("settings.fonts.loaded", { count: fonts.length })}
      {status === "unavailable" && t("settings.fonts.unavailable")}
      {status === "error" && (
        <>
          {t("settings.fonts.error")}{" "}
          <button type="button" className="text-accent hover:underline" onClick={retry}>
            {t("settings.fonts.retry")}
          </button>
        </>
      )}
    </p>
  );
}
