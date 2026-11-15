import type { Locale } from "./types";

/** BCP 47 tags for `Intl`; the interface locale alone would pick the wrong Chinese script. */
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", zh: "zh-CN", ko: "ko-KR" };

export function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale];
}

type DateInput = Date | number | string;

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * "5 minutes ago", "yesterday", then a calendar date after a week.
 * `style: "narrow"` gives the compact form for dense lists ("5m ago", "5分钟前").
 */
export function formatRelativeTime(
  date: DateInput,
  locale: Locale,
  { now = Date.now(), style = "short" }: { now?: number; style?: "long" | "short" | "narrow" } = {},
): string {
  const time = new Date(date).getTime();
  if (Number.isNaN(time)) return "";
  const elapsed = now - time;
  const relative = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto", style });
  if (Math.abs(elapsed) < MINUTE) return relative.format(0, "second");
  if (Math.abs(elapsed) < HOUR) return relative.format(-Math.trunc(elapsed / MINUTE), "minute");
  if (Math.abs(elapsed) < DAY) return relative.format(-Math.trunc(elapsed / HOUR), "hour");
  if (Math.abs(elapsed) < 7 * DAY) return relative.format(-Math.trunc(elapsed / DAY), "day");
  return formatDate(time, locale, {
    month: "short",
    day: "numeric",
    year: new Date(time).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}

export function formatDate(
  date: DateInput,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(value);
}

export function formatDateTime(date: DateInput, locale: Locale): string {
  return formatDate(date, locale, { dateStyle: "medium", timeStyle: "short" });
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(intlLocale(locale), options).format(value);
}
