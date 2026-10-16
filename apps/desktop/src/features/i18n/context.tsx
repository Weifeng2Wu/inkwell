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
import { resolveInitialLocale } from "./locale-detection";
import { en } from "./locales/en";
import { ko } from "./locales/ko";
import { zh } from "./locales/zh";
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
    saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
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

function resolveNestedKey(obj: unknown, keyPath: string): string | undefined {
  const parts = keyPath.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return typeof current === "string" ? current : undefined;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Always initialize with DEFAULT_LOCALE so client matches server-rendered HTML during hydration
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const manuallySelected = useRef(false);

  // Sync to user's saved locale or system locale immediately after mount
  useEffect(() => {
    let active = true;
    void detectInitialLocale().then((initial) => {
      if (active && !manuallySelected.current) setLocaleState(initial);
    });
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback((newLocale: Locale) => {
    manuallySelected.current = true;
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
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
    (key: string, params?: Record<string, string | number | undefined | null>): string => {
      // 1. Try current locale
      let text = resolveNestedKey(dictionary, key);

      // 2. Fall back to English
      if (text === undefined && locale !== "en") {
        text = resolveNestedKey(dictionaries.en, key);
      }

      // 3. Fall back to key itself
      if (text === undefined) {
        return key;
      }

      // 4. Parameter interpolation
      if (params) {
        return text.replace(/\{(\w+)\}/g, (_, paramName) => {
          if (paramName in params) {
            const val = params[paramName];
            return val !== undefined && val !== null ? String(val) : `{${paramName}}`;
          }
          return `{${paramName}}`;
        });
      }

      return text;
    },
    [dictionary, locale],
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
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Provide a fallback when outside provider (e.g. testing or early render)
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: (key: string, params?: Record<string, string | number | undefined | null>) => {
        let text = resolveNestedKey(dictionaries.en, key) ?? key;
        if (params) {
          text = text.replace(/\{(\w+)\}/g, (_, paramName) => {
            const val = params[paramName];
            return val !== undefined && val !== null ? String(val) : `{${paramName}}`;
          });
        }
        return text;
      },
      locales: LOCALES,
      dictionary: dictionaries.en,
    };
  }
  return ctx;
}

export const useTranslation = useI18n;
