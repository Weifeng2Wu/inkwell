"use client";

import { isTauri } from "@tauri-apps/api/core";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { appStorage } from "@/lib/storage/app-storage";
import { resolveInitialLocale } from "./locale-detection";
import { en } from "./locales/en";
import { ko } from "./locales/ko";
import { zh } from "./locales/zh";
import { resolveMessage } from "./localized-error";
import {
  DEFAULT_LOCALE,
  type I18nContextValue,
  LOCALE_STORAGE_KEY,
  LOCALES,
  type Locale,
} from "./types";

const dictionaries = { en, zh, ko } as const;

async function detectInitialLocale(): Promise<Locale> {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }

  let saved: string | null = null;
  try {
    saved = appStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // Ignore localStorage errors
  }

  const languages =
    typeof navigator === "undefined"
      ? []
      : [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  return resolveInitialLocale({
    saved,
    languages,
    readSystemLocale: isTauri()
      ? async () => (await import("@tauri-apps/plugin-os")).locale()
      : undefined,
  });
}

/** The current language, then English, then the key itself so a missing entry stays visible. */
function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number | undefined | null>,
): string {
  return (
    resolveMessage(dictionaries[locale], key, params) ??
    (locale === "en" ? undefined : resolveMessage(dictionaries.en, key, params)) ??
    key
  );
}

// Shared by every caller outside a provider, so `t` keeps one identity across renders.
const FALLBACK_CONTEXT: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, params) => translate(DEFAULT_LOCALE, key, params),
  locales: LOCALES,
  dictionary: dictionaries.en,
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  locale: pinned,
}: {
  children?: ReactNode;
  /** Pins the language for tests and previews. Without it the saved or system language is used. */
  locale?: Locale;
}) {
  // Always initialize with DEFAULT_LOCALE so client matches server-rendered HTML during hydration
  const [detected, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const locale = pinned ?? detected;
  const manuallySelected = useRef(false);

  // Sync to user's saved locale or system locale immediately after mount
  useEffect(() => {
    if (pinned) return;
    let active = true;
    void detectInitialLocale().then((initial) => {
      if (active && !manuallySelected.current) setLocaleState(initial);
    });
    return () => {
      active = false;
    };
  }, [pinned]);

  const setLocale = useCallback((newLocale: Locale) => {
    manuallySelected.current = true;
    setLocaleState(newLocale);
    try {
      appStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const dictionary = dictionaries[locale] ?? dictionaries.en;

  const t = useCallback(
    (key: string, params?: Record<string, string | number | undefined | null>): string =>
      translate(locale, key, params),
    [locale],
  );

  const contextValue = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      locales: LOCALES,
      dictionary,
    }),
    [locale, setLocale, t, dictionary],
  );

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? FALLBACK_CONTEXT;
}

export const useTranslation = useI18n;
