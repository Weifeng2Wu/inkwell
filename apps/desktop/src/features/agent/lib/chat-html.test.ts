import { describe, expect, it } from "vitest";
import { sanitizeChatHtmlNode } from "./chat-html";

function text(value: string): Node {
  return { nodeType: 3, textContent: value } as Node;
}

function element(tagName: string, attributes: Record<string, string> = {}, children: Node[] = []): Node {
  return {
    nodeType: 1,
    localName: tagName,
    namespaceURI: "http://www.w3.org/1999/xhtml",
    childNodes: children,
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
    classList: { contains: (name: string) => (attributes.class ?? "").split(/\s+/).includes(name) },
  } as unknown as Node;
}

describe("chat HTML allowlist", () => {
  it("allows semantic HTML without event handlers, styles or application classes", () => {
    const result = sanitizeChatHtmlNode(element("details", { open: "", onclick: "alert(1)", style: "position:fixed", class: "toolbar" }, [element("summary", {}, [text("More")]), element("strong", {}, [text("Result")])]));
    expect(result).toEqual([{ type: "element", tagName: "details", properties: {}, children: [{ type: "element", tagName: "summary", properties: {}, children: [{ type: "text", value: "More" }] }, { type: "element", tagName: "strong", properties: {}, children: [{ type: "text", value: "Result" }] }] }]);
  });

  it("drops executable, embedded, remote-resource and form elements including their children", () => {
    for (const tag of ["script", "style", "iframe", "object", "svg", "math", "form", "img", "video"]) {
      expect(sanitizeChatHtmlNode(element(tag, {}, [text("unsafe")]))).toEqual([]);
    }
  });

  it("only permits disabled checkboxes and language hints", () => {
    expect(sanitizeChatHtmlNode(element("input", { type: "text" }))).toEqual([]);
    expect(sanitizeChatHtmlNode(element("input", { type: "checkbox", checked: "", onchange: "alert(1)" }))[0]?.properties).toEqual({ type: "checkbox", checked: true, disabled: true });
    expect(sanitizeChatHtmlNode(element("code", { class: "language-html fixed", style: "display:none" }))[0]?.properties).toEqual({ className: ["language-html"] });
  });

  it("preserves math markers, table alignment and numbered list starts", () => {
    expect(sanitizeChatHtmlNode(element("code", { class: "language-math math-display" }))[0]?.properties).toEqual({ className: ["language-math", "math-display"] });
    expect(sanitizeChatHtmlNode(element("span", { class: "math-inline" }))[0]?.properties).toEqual({ className: ["math-inline"] });
    expect(sanitizeChatHtmlNode(element("td", { align: "right" }))[0]?.properties).toEqual({ align: "right" });
    expect(sanitizeChatHtmlNode(element("ol", { start: "3" }))[0]?.properties).toEqual({ start: 3 });
  });
});
