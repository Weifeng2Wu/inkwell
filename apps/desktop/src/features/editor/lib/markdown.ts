export function isMarkdownFile(path: string): boolean {
  return /\.(md|markdown|mdown)$/i.test(path);
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}

export function resolveMarkdownImage(source: string, filePath: string, projectPath: string) {
  if (!source || hasControlCharacters(source)) return undefined;
  if (/^https?:\/\//i.test(source)) return source;
  let decoded: string;
  try {
    decoded = decodeURIComponent(source.split(/[?#]/)[0] ?? "").replace(/\\/g, "/");
  } catch {
    return undefined;
  }
  if (!decoded || hasControlCharacters(decoded) || decoded.includes(":") || decoded.startsWith("/"))
    return undefined;
  const root = projectPath.replace(/\\/g, "/").replace(/\/$/, "");
  if (!root) return undefined;
  let relative = filePath.replace(/\\/g, "/");
  const windows = /^[a-z]:/i.test(root) || root.startsWith("//");
  const compare = (value: string) => (windows ? value.toLowerCase() : value);
  if (compare(relative).startsWith(`${compare(root)}/`)) relative = relative.slice(root.length + 1);
  else if (/^(?:[a-z]:|\/)/i.test(relative)) return undefined;
  const segments = relative.split("/").slice(0, -1);
  if (segments.includes("..")) return undefined;
  for (const segment of decoded.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) return undefined;
      segments.pop();
    } else segments.push(segment);
  }
  return `${root}/${segments.join("/")}`;
}

export const MARKDOWN_SNIPPETS = [
  { key: "heading", prefix: "heading", body: `## \${1:Heading}\n\n$0` },

  { key: "link", prefix: "link", body: `[\${1:text}](\${2:https://example.com})$0` },

  { key: "image", prefix: "image", body: `![\${1:description}](\${2:images/figure.png})$0` },
  {
    key: "table",
    prefix: "table",

    body: `| \${1:Column 1} | \${2:Column 2} |\n| --- | --- |\n| \${3:Value} | \${4:Value} |\n$0`,
  },

  { key: "code", prefix: "code", body: `\`\`\`\${1:latex}\n\${2:code}\n\`\`\`\n$0` },

  { key: "math", prefix: "math", body: `$$\n\${1:E = mc^2}\n$$\n$0` },

  { key: "task", prefix: "task", body: `- [ ] \${1:Task}\n$0` },
] as const;
