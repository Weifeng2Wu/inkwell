"use client";

import { useId } from "react";
import { useI18n } from "@/features/i18n";
import { useSystemFonts } from "../lib/use-system-fonts";
import { FontFamilySelect, SystemFontStatus } from "./font-family-select";

export function TerminalFontSettings({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const systemFonts = useSystemFonts();

  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-foreground-secondary">
            {t("settings.terminalSection.fontFamily")}
          </label>
          <p id={`${id}-description`} className="text-xs text-muted mt-1">
            {t("settings.terminalSection.fontFamilyDesc")}
          </p>
        </div>
        <FontFamilySelect
          id={id}
          describedBy={`${id}-description`}
          value={value}
          onChange={onChange}
          presets={[
            { value: "", label: t("settings.terminalSection.fontAuto") },
            { value: "geist-mono", label: "Geist Mono" },
            { value: "monospace", label: t("settings.terminalSection.fontSystemMono") },
          ]}
          fonts={systemFonts.fonts}
        />
      </div>
      <SystemFontStatus {...systemFonts} />
    </div>
  );
}
