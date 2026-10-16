import { describe, expect, it } from "vitest";
import { sanitizeChatHtmlNode } from "./safe-html";

describe("draft HTML image handling", () => {
  const image = {
    nodeType: 1,
    localName: "img",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    childNodes: [],
    getAttribute: (name: string) =>
      ({ src: "images/plot.png", alt: "Result", onerror: "alert(1)", style: "position:fixed" })[
        name
      ],
  } as unknown as Node;

  it("keeps chat image blocking unchanged", () => {
    expect(sanitizeChatHtmlNode(image)).toEqual([]);
  });
  it("only passes draft image source and description to the controlled renderer", () => {
    expect(sanitizeChatHtmlNode(image, true)).toEqual([
      {
        type: "element",
        tagName: "img",
        properties: { src: "images/plot.png", alt: "Result" },
        children: [],
      },
    ]);
  });
});
