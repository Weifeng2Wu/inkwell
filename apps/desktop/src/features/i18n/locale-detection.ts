import { DEFAULT_LOCALE, type Locale } from "./types";

export function supportedLocale(language: string | null | undefined): Locale | undefined {
  const base = language?.trim().toLowerCase().split(/[-_]/)[0];
  return base === "en" || base === "zh" || base === "ko" ? base : undefined;
}

export function preferredLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const supported = supportedLocale(language);
    if (supported) return supported;
  }
  return DEFAULT_LOCALE;
}

export async function resolveInitialLocale({
  saved,
  languages,
  readSystemLocale,
}: {
  saved: string | null;
  languages: readonly string[];
  readSystemLocale?: () => Promise<string | null>;
}): Promise<Locale> {
  if (saved === "en" || saved === "zh" || saved === "ko") return saved;
  if (readSystemLocale) {
    try {
      const system = supportedLocale(await readSystemLocale());
      if (system) return system;
    } catch {
      return preferredLocale(languages);
    }
  }
  return preferredLocale(languages);
}
