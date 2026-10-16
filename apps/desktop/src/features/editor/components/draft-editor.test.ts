import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/features/i18n";
import { DraftEditor } from "./draft-editor";

vi.mock("./lazy", () => ({
  MonacoEditor: () => createElement("textarea", { "aria-label": "Source buffer" }),
}));
vi.mock("next/dynamic", () => ({
  default: () => () => createElement("div", { "data-preview": true }),
}));

describe("draft view", () => {
  it("opens source and live preview together using icon controls", () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(DraftEditor, {
          filePath: "draft.md",
          projectPath: "/project",
          content: "# Draft",
        }),
      ),
    );
    expect(markup).toContain('aria-label="Source buffer"');
    expect(markup).toContain('aria-label="Source and preview" aria-pressed="true"');
    expect(markup).toContain('aria-label="Preview"');
    expect(markup).toContain("grid-rows-2");
    expect(markup).toContain("overflow-auto");
    expect(markup).not.toContain(">Preview</button>");
  });
  it("shows a localized empty-draft hint", () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nProvider,
        null,
        createElement(DraftEditor, { filePath: "draft.md", projectPath: "/project", content: "" }),
      ),
    );
    expect(markup).toContain("Start writing to preview your draft.");
  });
});
