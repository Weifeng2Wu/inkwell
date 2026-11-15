"use client";

import { useId } from "react";
import { SettingsDisclosure } from "@/components/ui/settings-disclosure";
import { useI18n } from "@/features/i18n";

export function CustomHeadersInput({
  value,
  onChange,
}: {
  value?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const { t } = useI18n();
  return (
    <SettingsDisclosure title={t("agent.settings.advanced")}>
      <label className="block text-xs" htmlFor={id}>
        {t("agent.settings.customHeaders")}
        <textarea
          id={id}
          className="settings-control mt-1 min-h-20 w-full font-mono"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          maxLength={32768}
          autoComplete="off"
          spellCheck={false}
          placeholder="Header-Name: value"
        />
      </label>
    </SettingsDisclosure>
  );
}
