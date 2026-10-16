import type { TranslationDictionary } from "./locales/en";

export type Locale = "en" | "zh" | "ko";

export interface LocaleInfo {
  id: Locale;
  label: string;
  nativeName: string;
}

export const LOCALES: LocaleInfo[] = [
  { id: "en", label: "English", nativeName: "English" },
  { id: "zh", label: "简体中文", nativeName: "简体中文" },
  { id: "ko", label: "한국어", nativeName: "한국어" },
];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "inkwell-locale";

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];

export type TranslationKey = NestedKeyOf<TranslationDictionary>;

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number | undefined | null>) => string;
  locales: LocaleInfo[];
  dictionary: TranslationDictionary;
}
