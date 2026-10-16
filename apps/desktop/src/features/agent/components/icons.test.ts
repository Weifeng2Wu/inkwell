import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolIcon } from "./icons";

describe("tool icon theme semantics", () => {
  it.each([
    ["read", "info"],
    ["glob", "accent"],
    ["grep", "accent"],
    ["task", "accent"],
    ["todowrite", "success"],
    ["question", "info"],
    ["write", "success"],
    ["edit", "warning"],
  ])("uses a semantic token for %s", (tool, token) => {
    const markup = renderToStaticMarkup(createElement(ToolIcon, { tool }));
    expect(markup).toContain(`text-${token}`);
    expect(markup).not.toMatch(/text-(sky|violet|purple|teal|pink)-\d/);
  });
});
