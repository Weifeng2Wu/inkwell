import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { localizeSkill } from "../agent/lib/skill-presentation";
import { posterLabels } from "../poster/lib/labels";
import { SHORTCUTS } from "../settings/lib/keyboard-shortcuts";
import {
  findHardcodedStrings,
  HARDCODED_STRING_SCAN_ROOTS,
  isTranslatableText,
  scanHardcodedStrings,
} from "./copy-scan";
import { en } from "./locales/en";
import { ko } from "./locales/ko";
import { zh } from "./locales/zh";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALES } from "./types";

function getLeafEntries(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, getLeafEntries(value as Record<string, unknown>, path));
    } else if (typeof value === "string") {
      result[path] = value;
    }
  }
  return result;
}

function extractParams(str: string): string[] {
  const matches = str.match(/\{(\w+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1)).sort();
}

describe("Agent translations", () => {
  it("preserves skill names while localizing app-owned descriptions", () => {
    const translated = localizeSkill(
      {
        id: "academic-poster",
        name: "Academic Poster",
        description: "Original description",
        version: "1",
        source: "Inkwell built-in",
      },
      (key) => (key === "skillCatalog.posterDescription" ? "Localized description" : key),
    );
    expect(translated.name).toBe("Academic Poster");
    expect(translated.description).toBe("Localized description");
  });

  it("localizes shared controls instead of falling back to English", () => {
    const baseline = getLeafEntries(en.interface);
    for (const dictionary of [zh, ko]) {
      for (const [key, text] of Object.entries(getLeafEntries(dictionary.interface))) {
        expect(text, key).not.toBe(baseline[key]);
      }
    }
  });
});

describe("poster translations", () => {
  it("does not fall back to English for Korean poster controls", () => {
    for (const key of ["help", "width", "height", "resize"] as const) {
      expect(posterLabels("ko")[key], key).not.toBe(posterLabels("en")[key]);
    }
  });
});

describe("keyboard shortcut names", () => {
  it("names every shortcut in every language", () => {
    for (const [locale, dictionary] of Object.entries({ en, zh, ko })) {
      const actions: Record<string, string | undefined> = dictionary.shortcuts.actions;
      for (const { id } of SHORTCUTS) {
        expect(actions[id]?.trim(), `${locale}.shortcuts.actions.${id}`).toBeTruthy();
      }
    }
  });

  it("names every shortcut category in every language", () => {
    for (const [locale, dictionary] of Object.entries({ en, zh, ko })) {
      const categories: Record<string, string | undefined> = dictionary.shortcuts.categories;
      for (const category of new Set(SHORTCUTS.map((shortcut) => shortcut.category))) {
        expect(
          categories[category]?.trim(),
          `${locale}.shortcuts.categories.${category}`,
        ).toBeTruthy();
      }
    }
  });
});

describe("hardcoded interface text", () => {
  it("recognizes words but not symbols, numbers, key names or brand names", () => {
    for (const text of [
      "Save changes",
      "保存",
      "저장",
      "Open in GitHub",
      "Press Enter to send",
      "Delete",
    ])
      expect(isTranslatableText(text), text).toBe(true);
    for (const text of [
      "",
      " · ",
      "12",
      "100%",
      "Glossa",
      "LaTeX / BibTeX",
      "Ctrl+Shift+P",
      "Ctrl+Delete",
      "⌘K",
    ])
      expect(isTranslatableText(text), text).toBe(false);
    for (const text of ["https://api.openai.com/v1", "SKILL.md", "SecretId"])
      expect(isTranslatableText(text), text).toBe(false);
  });

  it("finds literals in JSX text, expressions and visible attributes", () => {
    const found = findHardcodedStrings(
      "sample.tsx",
      [
        "export const Sample = ({ busy, t }: { busy: boolean; t: (key: string) => string }) => (",
        '  <button type="button" title="Remove file" aria-label={busy ? "Working" : t("a.b")}>',
        "    Delete {busy ? `Wait $".concat("{1}` : null}"),
        '    <input placeholder={t("a.c")} className="text-sm" data-kind="plain" />',
        "  </button>",
        ");",
      ].join("\n"),
    );
    expect(found.map(({ kind, name, text }) => [kind, name, text])).toEqual([
      ["attribute", "title", "Remove file"],
      ["attribute", "aria-label", "Working"],
      ["text", undefined, "Delete"],
      ["text", undefined, "Wait"],
    ]);
  });

  it("keeps migrated components free of hardcoded text", () => {
    expect(HARDCODED_STRING_SCAN_ROOTS.length).toBeGreaterThan(0);
    const found = scanHardcodedStrings(fileURLToPath(new URL("../../", import.meta.url)));
    expect(
      found.map(({ file, line, name, text }) => `${file}:${line} ${name ?? "text"} ${text}`),
    ).toEqual([]);
  });
});

describe("i18n configuration", () => {
  it("defines default locale as en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("defines correct storage key", () => {
    expect(LOCALE_STORAGE_KEY).toBe("inkwell-locale");
  });

  it("supports en, zh, and ko", () => {
    const localeIds = LOCALES.map((l) => l.id);
    expect(localeIds).toEqual(["en", "zh", "ko"]);
  });
});

describe("locale parity and consistency", () => {
  const enEntries = getLeafEntries(en);
  const zhEntries = getLeafEntries(zh);
  const koEntries = getLeafEntries(ko);

  it("resolves every literal UI translation key", () => {
    const missing: string[] = [];
    function scan(directory: URL) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const location = new URL(entry.name, directory);
        if (entry.isDirectory()) {
          scan(new URL(`${entry.name}/`, directory));
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
          const source = ts.createSourceFile(
            fileURLToPath(location),
            readFileSync(location, "utf8"),
            ts.ScriptTarget.Latest,
            true,
          );
          function visit(node: ts.Node) {
            if (
              ts.isCallExpression(node) &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === "t" &&
              node.arguments[0] &&
              ts.isStringLiteral(node.arguments[0]) &&
              !(node.arguments[0].text in enEntries)
            ) {
              missing.push(`${source.fileName}: ${node.arguments[0].text}`);
            }
            ts.forEachChild(node, visit);
          }
          visit(source);
        }
      }
    }
    scan(new URL("../../", import.meta.url));
    expect(missing).toEqual([]);
  });

  it("zh has 100% key parity with en", () => {
    const enKeys = Object.keys(enEntries).sort();
    const zhKeys = Object.keys(zhEntries).sort();

    const missingInZh = enKeys.filter((k) => !(k in zhEntries));
    const extraInZh = zhKeys.filter((k) => !(k in enEntries));

    expect(missingInZh).toEqual([]);
    expect(extraInZh).toEqual([]);
  });

  it("ko has 100% key parity with en", () => {
    const enKeys = Object.keys(enEntries).sort();
    const koKeys = Object.keys(koEntries).sort();

    const missingInKo = enKeys.filter((k) => !(k in koEntries));
    const extraInKo = koKeys.filter((k) => !(k in enEntries));

    expect(missingInKo).toEqual([]);
    expect(extraInKo).toEqual([]);
  });

  it("all interpolation parameters are valid across all languages", () => {
    for (const [key, enText] of Object.entries(enEntries)) {
      const enParams = extractParams(enText);
      const zhParams = extractParams(zhEntries[key] || "");
      const koParams = extractParams(koEntries[key] || "");

      // All parameters in zh and ko must exist in en (no invalid/hallucinated parameters)
      for (const p of zhParams) {
        expect(enParams, `zh.${key} uses unknown param {${p}}`).toContain(p);
      }
      for (const p of koParams) {
        expect(enParams, `ko.${key} uses unknown param {${p}}`).toContain(p);
      }

      // All parameters in en (except optional plural suffix 's') must exist in zh and ko
      for (const p of enParams) {
        if (p === "s") continue; // Asian languages don't inflect nouns with plural 's'
        expect(zhParams, `zh.${key} is missing required param {${p}}`).toContain(p);
        expect(koParams, `ko.${key} is missing required param {${p}}`).toContain(p);
      }
    }
  });

  it("no translations are empty strings", () => {
    for (const [key, val] of Object.entries(enEntries)) {
      expect(val.trim().length, `en.${key} is empty`).toBeGreaterThan(0);
    }
    for (const [key, val] of Object.entries(zhEntries)) {
      expect(val.trim().length, `zh.${key} is empty`).toBeGreaterThan(0);
    }
    for (const [key, val] of Object.entries(koEntries)) {
      expect(val.trim().length, `ko.${key} is empty`).toBeGreaterThan(0);
    }
  });
});
