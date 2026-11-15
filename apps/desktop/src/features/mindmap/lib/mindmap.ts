export type MindmapSide = "left" | "right";
export type MindmapStyle = {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  background?: string;
  borderColor?: string;
};
export type MindmapNode = {
  id: string;
  text: string;
  children: MindmapNode[];
  style?: MindmapStyle;
  side?: MindmapSide;
};
export type PositionedNode = {
  node: MindmapNode;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: string[];
  style: MindmapStyle;
  side: MindmapSide;
  lineHeight: number;
};
export const isMindmapFile = (path: string) => /\.mindmap\.md$/i.test(path);

export const validMindmapFont = (font: string) => /^[\p{L}\p{N} _.()+-]{1,100}$/u.test(font);

export function mindmapFontFamily(font = "system-ui") {
  if (["system-ui", "serif", "sans-serif", "monospace"].includes(font)) return font;
  return `"${font}", sans-serif`;
}

function parseLabel(value: string): Pick<MindmapNode, "text" | "style" | "side"> {
  const marker = "<!-- inkwell-mindmap ";
  const start = value.indexOf(marker);
  const text = (start < 0 ? value : value.slice(0, start)).trim();
  if (!text || text.length > 2000) throw new Error("mindmap.invalid");
  if (start < 0) return { text };
  if (!value.endsWith(" -->")) throw new Error("mindmap.invalid");
  const metadata = JSON.parse(value.slice(start + marker.length, -4));
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    Object.keys(metadata).some((key) => !["style", "side"].includes(key)) ||
    (metadata.side !== undefined && !["left", "right"].includes(metadata.side))
  )
    throw new Error("mindmap.invalid");
  const style = metadata.style;
  if (style !== undefined) {
    if (!style || typeof style !== "object" || Array.isArray(style))
      throw new Error("mindmap.invalid");
    for (const [key, value] of Object.entries(style)) {
      if (key === "fontFamily" && typeof value === "string" && validMindmapFont(value)) continue;
      if (
        key === "fontSize" &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 10 &&
        value <= 48
      )
        continue;
      if (
        ["color", "background", "borderColor"].includes(key) &&
        typeof value === "string" &&
        /^#[\da-f]{6}$/i.test(value)
      )
        continue;
      throw new Error("mindmap.invalid");
    }
  }
  return { text, ...metadata };
}

export function parseMindmap(content: string): MindmapNode {
  if (content.length > 1024 * 1024) throw new Error("mindmap.invalid");
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let root: MindmapNode | undefined;
  const stack: { indent: number; node: MindmapNode }[] = [];
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (!root) {
      const title = /^#\s+(.+)$/.exec(line);
      if (!title?.[1]) throw new Error("mindmap.invalid");
      root = { id: "0", ...parseLabel(title[1]), children: [] };
      if (root.side) throw new Error("mindmap.invalid");
      stack.push({ indent: -1, node: root });
      continue;
    }
    const match = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (!match?.[2] || ++count > 500) throw new Error("mindmap.invalid");
    const indent = (match[1] ?? "").replace(/\t/g, "    ").length;
    while (stack.length > 1 && (stack.at(-1)?.indent ?? -1) >= indent) stack.pop();
    if (stack.length > 24 || (stack.length === 1 && indent !== 0))
      throw new Error("mindmap.invalid");
    const parent = stack.at(-1)?.node;
    if (!parent) throw new Error("mindmap.invalid");
    const node: MindmapNode = {
      id: `${parent.id}.${parent.children.length}`,
      ...parseLabel(match[2]),
      children: [],
    };
    if (node.side && parent !== root) throw new Error("mindmap.invalid");
    parent.children.push(node);
    stack.push({ indent, node });
  }
  if (!root) throw new Error("mindmap.invalid");
  return root;
}

export function serializeMindmap(root: MindmapNode): string {
  const label = (node: MindmapNode) => {
    const metadata = {
      ...(node.style && Object.keys(node.style).length ? { style: node.style } : {}),
      ...(node.side ? { side: node.side } : {}),
    };
    return `${node.text}${Object.keys(metadata).length ? ` <!-- inkwell-mindmap ${JSON.stringify(metadata)} -->` : ""}`;
  };
  const lines = [`# ${label(root)}`, ""];
  function visit(node: MindmapNode, depth: number) {
    lines.push(`${"  ".repeat(depth)}- ${label(node)}`);
    for (const child of node.children) visit(child, depth + 1);
  }
  for (const child of root.children) visit(child, 0);
  return `${lines.join("\n")}\n`;
}

export function updateMindmap(
  root: MindmapNode,
  id: string,
  change: (node: MindmapNode) => MindmapNode,
): MindmapNode {
  if (root.id === id) return change(root);
  return { ...root, children: root.children.map((child) => updateMindmap(child, id, change)) };
}

function labelLines(text: string, width: number, fontSize: number, mono: boolean): string[] {
  const lines: string[] = [];
  let line = "";
  let units = 0;
  for (const char of text) {
    const advance = ((char.codePointAt(0) ?? 0) > 255 ? 1 : mono ? 0.62 : 0.6) * fontSize;
    if (units + advance > width && line) {
      lines.push(line);
      line = "";
      units = 0;
    }
    line += char;
    units += advance;
  }
  if (line) lines.push(line);
  return lines;
}

export function layoutMindmap(root: MindmapNode) {
  const nodes: PositionedNode[] = [];
  const edges: { from: PositionedNode; to: PositionedNode }[] = [];
  const spans = new Map<string, number>();
  const metrics = new Map<
    string,
    Pick<PositionedNode, "width" | "height" | "lines" | "lineHeight" | "style">
  >();
  const widths: Record<MindmapSide, number[]> = { left: [], right: [] };
  function measure(
    node: MindmapNode,
    inherited: MindmapStyle,
    side: MindmapSide,
    depth: number,
  ): number {
    const style = { ...inherited, ...node.style };
    const fontSize = style.fontSize ?? 14;
    const width = Math.max(210, fontSize * 13 + 28);
    const lineHeight = Math.round(fontSize * 1.3);
    const lines = labelLines(node.text, width - 28, fontSize, style.fontFamily === "monospace");
    const height = lines.length * lineHeight + 24;
    metrics.set(node.id, { width, height, lines, lineHeight, style });
    widths[side][depth] = Math.max(widths[side][depth] ?? 0, width);
    const childSpans = node.children.map((child) =>
      measure(child, style, depth === 0 ? (child.side ?? "right") : side, depth + 1),
    );
    const childrenHeight =
      depth === 0
        ? Math.max(
            ...(["left", "right"] as const).map((direction) =>
              node.children.reduce(
                (sum, child, index) =>
                  sum + ((child.side ?? "right") === direction ? (childSpans[index] ?? 0) : 0),
                0,
              ),
            ),
          )
        : childSpans.reduce((sum, span) => sum + span, 0);
    const span = Math.max(height + 24, childrenHeight);
    spans.set(node.id, span);
    return span;
  }
  const height = measure(root, {}, "right", 0) + 48;
  function place(
    node: MindmapNode,
    side: MindmapSide,
    depth: number,
    x: number,
    top: number,
  ): PositionedNode {
    const metric = metrics.get(node.id);
    if (!metric) throw new Error("mindmap.invalid");
    const span = spans.get(node.id) ?? metric.height;
    const placed: PositionedNode = {
      node,
      x,
      y: top + (span - metric.height) / 2,
      ...metric,
      side,
    };
    nodes.push(placed);
    for (const direction of depth === 0 ? (["left", "right"] as const) : [side]) {
      const children = node.children.filter(
        (child) => depth !== 0 || (child.side ?? "right") === direction,
      );
      let childTop =
        top + (span - children.reduce((sum, child) => sum + (spans.get(child.id) ?? 0), 0)) / 2;
      for (const child of children) {
        const childWidth = metrics.get(child.id)?.width ?? 210;
        const nextX =
          direction === "right"
            ? x + (widths[direction][depth] ?? metric.width) + 50
            : x - 50 - (widths[direction][depth + 1] ?? childWidth);
        const target = place(child, direction, depth + 1, nextX, childTop);
        edges.push({ from: placed, to: target });
        childTop += spans.get(child.id) ?? 0;
      }
    }
    return placed;
  }
  place(root, "right", 0, 0, 24);
  const offset = 24 - Math.min(...nodes.map((node) => node.x));
  for (const node of nodes) node.x += offset;
  return {
    nodes,
    edges,
    width: Math.max(...nodes.map((node) => node.x + node.width)) + 24,
    height,
  };
}

export function mindmapEdge(from: PositionedNode, to: PositionedNode) {
  const direction = to.side === "left" ? -1 : 1;
  const start = from.x + (direction === 1 ? from.width : 0);
  const end = to.x + (direction === 1 ? 0 : to.width);
  const startY = from.y + from.height / 2;
  const endY = to.y + to.height / 2;
  return `M${start},${startY} C${start + direction * 25},${startY} ${end - direction * 25},${endY} ${end},${endY}`;
}

export function mindmapSvg(
  root: MindmapNode,
  colors: { background: string; foreground: string; border: string; surface?: string },
): string {
  const { nodes, edges, width, height } = layoutMindmap(root);
  const escapeXml = (value: string) =>
    value.replace(
      /[<>&"']/g,
      (char) =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${escapeXml(root.text)}</title><rect width="100%" height="100%" fill="${escapeXml(colors.background)}"/>${edges.map(({ from, to }) => `<path d="${mindmapEdge(from, to)}" fill="none" stroke="${escapeXml(to.style.borderColor ?? colors.border)}"/>`).join("")}${nodes.map((node) => `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${escapeXml(node.style.background ?? colors.surface ?? colors.background)}" stroke="${escapeXml(node.style.borderColor ?? colors.border)}"/><text fill="${escapeXml(node.style.color ?? colors.foreground)}" font-family="${escapeXml(mindmapFontFamily(node.style.fontFamily))}" font-size="${node.style.fontSize ?? 14}">${node.lines.map((line, index) => `<tspan x="${node.x + 14}" y="${node.y + 12 + (node.style.fontSize ?? 14) + index * node.lineHeight}">${escapeXml(line)}</tspan>`).join("")}</text>`).join("")}</svg>`;
}
