import { CheckIcon } from "@phosphor-icons/react";
import { useI18n } from "@/features/i18n";
import { PDF_ANNOTATION_COLORS, type PdfAnnotationColor } from "../lib/pdf-notes";

export function PdfColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PdfAnnotationColor;
  onChange: (color: PdfAnnotationColor) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <fieldset aria-label={t("pdfReading.color")} className="flex items-center gap-1">
      {PDF_ANNOTATION_COLORS.map((color) => (
        <button
          type="button"
          key={color}
          className="flex size-7 items-center justify-center rounded-full border border-transparent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
          style={{ borderColor: color === value ? `var(--${color})` : undefined }}
          aria-label={t(`pdfReading.colors.${color}`)}
          title={t(`pdfReading.colors.${color}`)}
          aria-pressed={value === color}
          disabled={disabled}
          onClick={() => onChange(color)}
        >
          <span
            className="flex size-5 items-center justify-center rounded-full"
            style={{ backgroundColor: `var(--${color})`, color: "var(--background)" }}
          >
            {value === color && <CheckIcon aria-hidden="true" className="size-3.5" weight="bold" />}
          </span>
        </button>
      ))}
    </fieldset>
  );
}
