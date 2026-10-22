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
  const { locale } = useI18n();
  const label =
    locale === "zh" ? "自定义 Header" : locale === "ko" ? "사용자 지정 헤더" : "Custom headers";
  return (
    <SettingsDisclosure
      title={locale === "zh" ? "高级选项" : locale === "ko" ? "고급 옵션" : "Advanced options"}
    >
      <label className="block text-xs" htmlFor={id}>
        {label}
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
