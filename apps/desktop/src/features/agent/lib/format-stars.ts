import { intlLocale, type Locale } from "@/features/i18n";

/** A compact star count in the reader's language: 1.2k, 1.2万, 1.2천. */
export function formatStars(count: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  })
    .format(count)
    .toLowerCase();
}
