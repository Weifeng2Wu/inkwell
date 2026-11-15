import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./markdown-content";

describe("draft Markdown preview", () => {
  function render(text: string) {
    return renderToStaticMarkup(
      createElement(MarkdownContent, {
        text,
        variant: "document",
        resolveImage: (source) => (source.startsWith("https://") ? source : undefined),
      }),
    );
  }
  it("uses document typography and renders GFM and math", () => {
    const markup = render(
      "# Draft\n\n## Section\n\n**Bold** and ~~removed~~\n\n- [x] Complete\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$x^2$\n\n$$\nx+y\n$$",
    );
    expect(markup).toContain("text-3xl");
    expect(markup).toContain("text-2xl");
    expect(markup).toContain("<del>");
    expect(markup).toContain("<table");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("katex-display");
  });
  it("renders resolved images with accessible descriptions", () => {
    const markup = render("![Experiment](https://example.com/plot.png)");
    expect(markup).toContain('alt="Experiment"');
    expect(markup).toContain('src="https://example.com/plot.png"');
    expect(markup).toContain("<img");
  });
  it("blocks scripts, embeds and executable links", () => {
    const markup = render(
      '[bad](javascript:alert(1))\n\n<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>',
    );
    expect(markup).not.toContain("<script");
    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain('href="javascript:');
  });
  it("keeps fenced code literal", () => {
    const markup = render("```html\n<script>alert(1)</script>\n```");
    expect(markup).toContain("language-html");
    expect(markup).toContain("&lt;script&gt;");
  });
  it("renders wiki aliases and local Markdown links as document navigation controls", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: "[[notes/实验 (一).md|实验结果]] [details](note%2Emd#results) [web](https://example.com) `[[literal]]`",
        variant: "document",
        onWikiLinkClick: () => {},
      }),
    );
    expect(markup.match(/<button /g)).toHaveLength(2);
    expect(markup).toContain("实验结果</button>");
    expect(markup).toContain("details</button>");
    expect(markup).toContain('href="https://example.com"');
    expect(markup).toContain("[[literal]]");
  });
  it("keeps wiki syntax literal in chat and escapes document aliases", () => {
    expect(renderToStaticMarkup(createElement(MarkdownContent, { text: "[[note]]" }))).toContain(
      "[[note]]",
    );
    const markup = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: "[[note|<script>alert(1)</script>]]",
        variant: "document",
        onWikiLinkClick: () => {},
      }),
    );
    expect(markup).not.toContain("<script");
    expect(markup).toContain("&lt;script&gt;");
  });
  it("routes PDF links through document navigation while keeping external PDFs as URLs", () => {
    const markup = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text: "[论文](papers/研究%20结果.pdf) [[papers/研究 结果.pdf|PDF]] [remote](https://example.com/paper.pdf)",
        variant: "document",
        onWikiLinkClick: () => {},
      }),
    );
    expect(markup.match(/<button /g)).toHaveLength(2);
    expect(markup).toContain("论文</button>");
    expect(markup).toContain("PDF</button>");
    expect(markup).toContain('href="https://example.com/paper.pdf"');
  });
});
