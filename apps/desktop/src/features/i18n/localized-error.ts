import { en } from "./locales/en";

export type MessageParams = Record<string, string | number | undefined | null>;
export type Translate = (key: string, params?: MessageParams) => string;

/** Looks up a dotted key and fills `{name}` placeholders. Unknown keys return `undefined`. */
export function resolveMessage(
  dictionary: unknown,
  key: string,
  params?: MessageParams,
): string | undefined {
  let current: unknown = dictionary;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current !== "string") return undefined;
  if (!params) return current;
  return current.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined || value === null ? placeholder : String(value);
  });
}

/** English text for a key, for code that runs outside React (logs, tests, defaults). */
export const englishMessage: Translate = (key, params) => resolveMessage(en, key, params) ?? key;

/**
 * An error whose message is a dictionary key. Code outside React throws it; the
 * interface shows it with `errorMessage(error, t)` in the current language.
 * `message` holds the English text, so logs and uncaught errors stay readable.
 */
export class LocalizedError extends Error {
  readonly key: string;
  readonly params?: MessageParams;

  constructor(key: string, params?: MessageParams) {
    super(englishMessage(key, params));
    this.name = "LocalizedError";
    this.key = key;
    this.params = params;
  }
}

/** What to show for a caught value: translated when possible, never prefixed with "Error:". */
export function errorMessage(caught: unknown, t: Translate): string {
  if (caught instanceof LocalizedError) return t(caught.key, caught.params);
  if (caught instanceof Error) return caught.message || caught.name;
  return String(caught);
}
