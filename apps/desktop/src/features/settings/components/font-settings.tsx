"use client";

import { useId } from "react";
import { useI18n } from "@/features/i18n";
import type { EditorSettings } from "../lib/editor-settings";
import { FONT_PRESETS } from "../lib/font-stacks";
import { useSystemFonts } from "../lib/use-system-fonts";
import { FontFamilySelect, SystemFontStatus } from "./font-family-select";

const FONT_FIELDS = ["uiFontFamily", "textFontFamily", "codeFontFamily"] as const;

export function FontSettings({
  settings,
  onChange,
}: {
  settings: EditorSettings;
  onChange: (updates: Partial<EditorSettings>) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const { fonts, status, retry } = useSystemFonts();

  return (
    <div className="space-y-4 py-2">
      {FONT_FIELDS.map((field) => {
        const value = settings[field];
        return (
          <div key={field} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <label
                  htmlFor={`${id}-${field}`}
                  className="text-sm font-medium text-foreground-secondary"
                >
                  {t(`settings.fonts.${field}`)}
                </label>
                <p id={`${id}-${field}-description`} className="text-xs text-muted mt-1">
                  {t(`settings.fonts.${field}Desc`)}
                </p>
              </div>
              <FontFamilySelect
                id={`${id}-${field}`}
                describedBy={`${id}-${field}-description`}
                value={value}
                onChange={(font) => onChange({ [field]: font })}
                presets={FONT_PRESETS.map((preset) => ({
                  value: preset,
                  label: t(`settings.fonts.${preset}`),
                }))}
                fonts={fonts}
              />
            </div>
          </div>
        );
      })}
      <SystemFontStatus fonts={fonts} status={status} retry={retry} />
    </div>
  );
}
