import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../lib/keyboard-shortcuts";
import { KeyboardShortcutSettings } from "./keyboard-shortcut-settings";

describe("shortcut settings layout", () => {
  it("shows one row per shortcut under four categories", () => {
    const markup = renderToStaticMarkup(createElement(KeyboardShortcutSettings));
    expect(markup.match(/<li /g)).toHaveLength(SHORTCUTS.length);
    for (const category of ["Workspace", "LaTeX", "Markdown drafts", "Agent chat"])
      expect(markup).toContain(category);
    expect(markup).toContain('data-shortcut-recorder="true"');
    expect(markup).toContain("Restore defaults");
    expect(markup).not.toContain('role="dialog"');
  });
  it("filters rows by action name", () => {
    const markup = renderToStaticMarkup(createElement(KeyboardShortcutSettings, { query: "Bold" }));
    expect(markup.match(/<li /g)).toHaveLength(1);
    expect(markup).toContain("Change shortcut for Bold");
    expect(markup).not.toContain("Close current tab");
  });
});
