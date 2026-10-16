type ChatNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: ChatNode[];
};

const allowedTags = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "input",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
]);
const blockedTags = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
  "form",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
  "base",
  "img",
  "video",
  "audio",
  "source",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function serialize(node: ChatNode): string {
  if (node.type === "raw") return node.value ?? "";
  if (node.type === "text") return escapeHtml(node.value ?? "");
  const children = node.children?.map(serialize).join("") ?? "";
  if (node.type !== "element" || !node.tagName) return children;
  const attributes = Object.entries(node.properties ?? {})
    .map(([name, value]) => {
      if (name === "style" && typeof value === "object" && value !== null && "textAlign" in value) {
        return ` align="${escapeHtml(String(value.textAlign))}"`;
      }
      const attribute = name === "className" ? "class" : name;
      if (value === false || value === undefined || value === null) return "";
      return ` ${attribute}="${escapeHtml(Array.isArray(value) ? value.join(" ") : String(value))}"`;
    })
    .join("");
  if (["br", "hr", "input", "img"].includes(node.tagName)) return `<${node.tagName}${attributes}>`;
  return `<${node.tagName}${attributes}>${children}</${node.tagName}>`;
}

export function sanitizeChatHtmlNode(node: Node, allowImages = false): ChatNode[] {
  if (node.nodeType === 3) return [{ type: "text", value: node.textContent ?? "" }];
  if (node.nodeType !== 1) return [];
  const element = node as Element;
  const tagName = element.localName.toLowerCase();
  if (
    (blockedTags.has(tagName) && !(allowImages && tagName === "img")) ||
    element.namespaceURI !== "http://www.w3.org/1999/xhtml"
  )
    return [];
  const children = Array.from(element.childNodes).flatMap((child) =>
    sanitizeChatHtmlNode(child, allowImages),
  );
  if (!allowedTags.has(tagName) && !(allowImages && tagName === "img")) return children;
  const properties: Record<string, unknown> = {};
  if (tagName === "img") {
    properties.src = element.getAttribute("src") ?? "";
    properties.alt = element.getAttribute("alt") ?? "";
  }
  if (tagName === "a") {
    properties.href = element.getAttribute("href") ?? "";
    properties.title = element.getAttribute("title") ?? undefined;
  }
  if (tagName === "code") {
    properties.className = (element.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(
        (name) =>
          /^language-[\w-]+$/.test(name) || name === "math-inline" || name === "math-display",
      );
  }
  if (tagName === "input") {
    if (element.getAttribute("type") !== "checkbox") return [];
    properties.type = "checkbox";
    properties.checked = element.hasAttribute("checked");
    properties.disabled = true;
  }
  if (tagName === "ol") {
    const start = element.getAttribute("start");
    if (start && /^-?\d+$/.test(start)) properties.start = Number(start);
  }
  if (tagName === "td" || tagName === "th") {
    const align = element.getAttribute("align");
    if (align && ["left", "right", "center"].includes(align)) properties.align = align;
  }
  if ((tagName === "div" || tagName === "span") && element.classList.contains("math-inline")) {
    properties.className = ["math-inline"];
  }
  if ((tagName === "div" || tagName === "span") && element.classList.contains("math-display")) {
    properties.className = ["math-display"];
  }
  return [{ type: "element", tagName, properties, children }];
}

export function rehypeChatHtml(options: { allowImages?: boolean } = {}) {
  return (tree: ChatNode) => {
    if (typeof document === "undefined") return;
    const hasHtml = (node: ChatNode): boolean =>
      node.type === "raw" || Boolean(node.children?.some(hasHtml));
    if (!hasHtml(tree)) return;
    const template = document.createElement("template");
    template.innerHTML = serialize(tree);
    tree.children = Array.from(template.content.childNodes).flatMap((child) =>
      sanitizeChatHtmlNode(child, options.allowImages),
    );
  };
}
