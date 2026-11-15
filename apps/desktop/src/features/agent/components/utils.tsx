import { formatRelativeTime as formatRelative } from "@/features/i18n";

/**
 * @deprecated Use `formatRelativeTime(date, locale)` from `@/features/i18n`, which follows the
 * interface language. Kept, in English, for callers that have not been given a locale yet.
 */
export function formatRelativeTime(date: Date): string {
  return formatRelative(date, "en", { style: "narrow" });
}
