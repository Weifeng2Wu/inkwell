import { describe, expect, it } from "vitest";
import {
  layoutMindmap,
  mindmapEdge,
  mindmapSvg,
  parseMindmap,
  serializeMindmap,
  updateMindmap,
} from "./mindmap";

describe("mind maps", () => {
  it("round trips nested Unicode ideas and wiki links as Markdown", () => {
    const markdown =
      "# 研究问题\n\n- Evidence [[papers/result.pdf|论文]]\n  - 方法 α\n    - 결과\n- Next steps\n";
    const root = parseMindmap(markdown);
    expect(serializeMindmap(root)).toBe(markdown);
    expect(root.children[0]?.children[0]?.children[0]?.text).toBe("결과");
    const renamed = updateMindmap(root, "0.0.0", (node) => ({ ...node, text: "Revised method" }));
    expect(parseMindmap(serializeMindmap(renamed)).children[0]?.children[0]?.text).toBe(
      "Revised method",
    );
    expect(root.children[0]?.children[0]?.text).toBe("方法 α");
  });

  it("rejects prose and unsupported outlines instead of silently dropping content", () => {
    for (const source of [
      "# Root\nParagraph",
      "# Root\n## Section",
      "- No root",
      "# Root\n  - Indented first item",
      `# Root\n${"- Idea\n".repeat(501)}`,
      `# Root\n${Array.from({ length: 25 }, (_, depth) => `${"  ".repeat(depth)}- Deep`).join("\n")}`,
    ]) {
      expect(() => parseMindmap(source), source.slice(0, 50)).toThrow();
    }
  });

  it("lays out long labels without sibling overlap and escapes SVG text", () => {
    const root = parseMindmap(
      `# Root <script>\n- ${"long label ".repeat(25)}\n  - Child\n- Second\n  - Another`,
    );
    const layout = layoutMindmap(root);
    for (const left of layout.nodes) {
      for (const right of layout.nodes) {
        if (left === right || left.x !== right.x) continue;
        expect(left.y + left.height <= right.y || right.y + right.height <= left.y).toBe(true);
      }
    }
    expect(layoutMindmap(root)).toEqual(layout);
    const svg = mindmapSvg(root, { background: "white", foreground: "black", border: "gray" });
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
  });

  it("persists inherited styles and branch directions through Markdown and SVG", () => {
    const markdown =
      '# 研究 <!-- inkwell-mindmap {"style":{"fontFamily":"Microsoft YaHei","fontSize":24,"color":"#123456"}} -->\n\n- 左边 <!-- inkwell-mindmap {"style":{"background":"#eef3f8","borderColor":"#174a7e"},"side":"left"} -->\n  - 证据\n- 右边\n';
    const root = parseMindmap(markdown);
    expect(parseMindmap(serializeMindmap(root))).toEqual(root);
    const layout = layoutMindmap(root);
    const center = layout.nodes.find((node) => node.node.id === "0");
    const left = layout.nodes.find((node) => node.node.id === "0.0");
    const child = layout.nodes.find((node) => node.node.id === "0.0.0");
    const right = layout.nodes.find((node) => node.node.id === "0.1");
    if (!center || !left || !child || !right) throw new Error("Missing nodes");
    expect(left.x + left.width).toBeLessThan(center.x);
    expect(child.x + child.width).toBeLessThan(left.x);
    expect(right.x).toBeGreaterThan(center.x + center.width);
    expect(child.style).toEqual({
      fontFamily: "Microsoft YaHei",
      fontSize: 24,
      color: "#123456",
      background: "#eef3f8",
      borderColor: "#174a7e",
    });
    expect(mindmapEdge(center, left)).toContain(`M${center.x},`);
    const svg = mindmapSvg(root, { background: "white", foreground: "black", border: "gray" });
    expect(svg).toContain('font-size="24"');
    expect(svg).toContain("&quot;Microsoft YaHei&quot;");
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill="#eef3f8"');
    expect(svg).toContain('stroke="#174a7e"');
    expect(svg).not.toContain("inkwell-mindmap");
  });

  it("keeps mixed-size nodes disjoint on both sides", () => {
    const root = parseMindmap(
      '# Center\n- Left <!-- inkwell-mindmap {"side":"left","style":{"fontSize":48}} -->\n  - A long label with 中文 and multiple words\n  - Another label\n- Smaller left <!-- inkwell-mindmap {"side":"left"} -->\n  - Child\n- Right\n  - Child\n',
    );
    const { nodes, width, height } = layoutMindmap(root);
    for (const node of nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.width).toBeLessThanOrEqual(width);
      expect(node.y + node.height).toBeLessThanOrEqual(height);
      for (const other of nodes) {
        if (node === other) continue;
        expect(
          node.x + node.width <= other.x ||
            other.x + other.width <= node.x ||
            node.y + node.height <= other.y ||
            other.y + other.height <= node.y,
        ).toBe(true);
      }
    }
  });

  it("rejects invalid style metadata without discarding source content", () => {
    for (const metadata of [
      '{"side":"up"}',
      '{"style":{"fontSize":500}}',
      '{"style":{"color":"url(https://example.com)"}}',
      '{"style":{"fontFamily":"a; color:red"}}',
      '{"unknown":true}',
      '{"style":{"fontSize":null}}',
      '{"style":[]}',
    ]) {
      expect(() => parseMindmap(`# Root\n- Child <!-- inkwell-mindmap ${metadata} -->`)).toThrow();
    }
    expect(() => parseMindmap('# Root <!-- inkwell-mindmap {"side":"left"} -->')).toThrow();
    expect(() =>
      parseMindmap('# Root\n- Branch\n  - Child <!-- inkwell-mindmap {"side":"left"} -->'),
    ).toThrow();
  });
});
