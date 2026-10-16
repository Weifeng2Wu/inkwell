import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./markdown-text";

function render(text: string) {
  return renderToStaticMarkup(createElement(MarkdownText, { text }));
}

describe("chat Markdown rendering", () => {
  it("renders headings, emphasis, tables and task lists", () => {
    const markup = render("# Title\n\n**Bold**\n\n- [x] Done\n\n| A | B |\n| --- | ---: |\n| One | Two |");
    expect(markup).toContain("<h1");
    expect(markup).toContain("<strong");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("<table");
    expect(markup).toContain("text-align:right");
  });

  it("keeps unlabelled fenced code separate from inline code", () => {
    const markup = render("`inline`\n\n```\nfirst\nsecond\n```\n\n```tex\n\\alpha\n```");
    expect(markup).toContain("first\nsecond\n</code>");
    expect(markup).toContain('class="language-tex"');
    expect(markup).toContain("overflow-x-auto");
  });

  it("preserves ordered list numbering and math", () => {
    const markup = render("3. Third\n4. Fourth\n\n$x^2$\n\n$$\nx+y\n$$");
    expect(markup).toContain('start="3"');
    expect(markup).toContain("katex");
    expect(markup).toContain("katex-display");
  });

  it("blocks executable links and does not execute raw HTML before hydration", () => {
    const markup = render('[unsafe](javascript:alert)\n\n<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>');
    expect(markup).not.toContain('href="javascript:');
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<iframe");
  });
});
