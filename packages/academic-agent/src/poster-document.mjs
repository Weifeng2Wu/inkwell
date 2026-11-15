export const POSTER_DEFAULTS = {
  background: "#ffffff",
  ink: "#14253d",
  accent: "#174a7e",
  panel: "#eef3f8",
  font: "Arial",
};

const color = (value) => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
const finite = (value, min, max) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const text = (value, limit) => typeof value === "string" && value.length <= limit;

export function validImageSource(value) {
  return (
    typeof value === "string" &&
    (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ||
      (!!value &&
        !/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(value) &&
        ![...value].some((char) => char.charCodeAt(0) < 32) &&
        /\.(png|jpe?g|webp)$/i.test(value)))
  );
}

export function parsePosterDocument(content) {
  if (new TextEncoder().encode(content).length > 20 * 1024 * 1024)
    throw new Error("Poster exceeds 20 MiB.");
  const poster = JSON.parse(content);
  if (
    !poster ||
    ![1, 2].includes(poster.version) ||
    !text(poster.title, 1000) ||
    !finite(poster.width, 100, 1400) ||
    !finite(poster.height, 100, 1400) ||
    !color(poster.background)
  ) {
    throw new Error("Invalid poster document.");
  }
  if (poster.version === 1) {
    if (!Array.isArray(poster.elements) || poster.elements.length > 500)
      throw new Error("Invalid poster document.");
    const ids = new Set();
    for (const element of poster.elements) {
      if (
        !element ||
        !text(element.id, 1000) ||
        !element.id ||
        ids.has(element.id) ||
        !["text", "rect", "image"].includes(element.type) ||
        !finite(element.x, 0, poster.width) ||
        !finite(element.y, 0, poster.height) ||
        !finite(element.width, 1, poster.width) ||
        !finite(element.height, 1, poster.height) ||
        element.x + element.width > poster.width + 0.01 ||
        element.y + element.height > poster.height + 0.01 ||
        (element.color !== undefined && !color(element.color)) ||
        (element.fill !== undefined && !color(element.fill)) ||
        (element.fontSize !== undefined && !finite(element.fontSize, 1, 120)) ||
        (element.bold !== undefined && typeof element.bold !== "boolean") ||
        (element.align !== undefined && !["left", "center", "right"].includes(element.align)) ||
        (element.text !== undefined && !text(element.text, 20000)) ||
        (element.alt !== undefined && !text(element.alt, 1000)) ||
        (element.type === "text" && typeof element.text !== "string") ||
        (element.type === "image" && !validImageSource(element.src))
      )
        throw new Error("Invalid poster element.");
      ids.add(element.id);
    }
    delete poster.style;
    return poster;
  }
  if (
    ![1, 2, 3].includes(poster.columns) ||
    !Array.isArray(poster.sections) ||
    poster.sections.length > 30 ||
    ["authors", "affiliation", "subtitle", "footer"].some(
      (key) => poster[key] !== undefined && !text(poster[key], 2000),
    ) ||
    ["accent", "color", "panel"].some((key) => poster[key] !== undefined && !color(poster[key]))
  )
    throw new Error("Invalid structured poster.");
  const ids = new Set();
  let blocks = 0;
  for (const section of poster.sections) {
    if (
      !section ||
      !text(section.id, 100) ||
      !section.id ||
      ids.has(section.id) ||
      !text(section.title, 300) ||
      !Array.isArray(section.blocks) ||
      section.blocks.length > 30
    )
      throw new Error("Invalid poster section.");
    ids.add(section.id);
    for (const [blockIndex, block] of section.blocks.entries()) {
      if (++blocks > 100 || !block || !["text", "image"].includes(block.type))
        throw new Error("Invalid poster block.");
      block.id ??= `${section.id}-block-${blockIndex}`;
      if (!text(block.id, 200) || !block.id || ids.has(block.id))
        throw new Error("Invalid poster block id.");
      ids.add(block.id);
      if (block.type === "text" && !text(block.text, 20000))
        throw new Error("Invalid poster text.");
      if (
        block.type === "image" &&
        (!validImageSource(block.src) ||
          (block.alt !== undefined && !text(block.alt, 1000)) ||
          (block.caption !== undefined && !text(block.caption, 3000)) ||
          (block.aspectRatio !== undefined && !finite(block.aspectRatio, 0.1, 10)))
      )
        throw new Error("Invalid poster image.");
    }
  }
  return poster;
}

export function parseFreeformPoster(content) {
  const poster = parsePosterDocument(content);
  if (poster.version !== 1) throw new Error("Expected a freeform poster.");
  return poster;
}

export function parsePosterCanvas(content) {
  const document = parsePosterDocument(content);
  return document.version === 2 ? layoutStructuredPoster(document).poster : document;
}

export function wrapPosterText(value, width, fontSize) {
  const lines = [];
  const units = (part) =>
    [...part].reduce(
      (sum, char) =>
        sum + ((char.codePointAt(0) ?? 0) > 255 ? 1 : /[il.,' ]/.test(char) ? 0.3 : 0.58),
      0,
    ) * fontSize;
  for (const paragraph of value.split("\n")) {
    let line = "";
    let used = 0;
    for (const token of paragraph.match(/\S+\s*|\s+/g) ?? [""]) {
      if (units(token) <= width) {
        if (used + units(token) > width && line) {
          lines.push(line.trimEnd());
          line = "";
          used = 0;
        }
        line += token;
        used += units(token);
      } else {
        for (const char of token) {
          const next = units(char);
          if (used + next > width && line) {
            lines.push(line.trimEnd());
            line = "";
            used = 0;
          }
          line += char;
          used += next;
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function layoutStructuredPoster(document) {
  const scale = Math.min(document.width / 841, document.height / 1189);
  const margin = Math.max(5, 24 * scale);
  const gap = Math.max(3, 16 * scale);
  const padding = Math.max(2, 8 * scale);
  const color = document.color ?? POSTER_DEFAULTS.ink;
  const accent = document.accent ?? POSTER_DEFAULTS.accent;
  const panel = document.panel ?? POSTER_DEFAULTS.panel;
  const pageWidth = document.width - margin * 2;
  const elements = [];
  let top = margin;
  function textElement(id, value, width, size, bold = false, ink = color) {
    return {
      id,
      type: "text",
      text: value,
      x: 0,
      y: 0,
      width,
      height: wrapPosterText(value, width, size).length * size * 1.25 + 0.1,
      fontSize: size,
      bold,
      color: ink,
    };
  }
  for (const [id, value, size, bold] of [
    ["title", document.title, Math.max(6, 22 * scale), true],
    ["authors", document.authors, Math.max(3, 9 * scale), false],
    ["affiliation", document.affiliation, Math.max(3, 7 * scale), false],
    ["subtitle", document.subtitle, Math.max(3, 10 * scale), true],
  ]) {
    if (!value) continue;
    const element = textElement(id, value, pageWidth, size, bold);
    elements.push({ ...element, x: margin, y: top });
    top += element.height + padding;
  }
  top += gap;
  let bottom = document.height - margin;
  if (document.footer) {
    const footer = textElement("footer", document.footer, pageWidth, Math.max(3, 6 * scale));
    bottom -= footer.height;
    elements.push({ ...footer, x: margin, y: bottom });
    bottom -= gap;
  }
  const available = bottom - top;
  const columns = Math.min(document.columns, Math.max(1, document.sections.length));
  const weights = columns === 3 ? [0.9, 1.3, 0.9] : Array(columns).fill(1);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map(
    (weight) => ((pageWidth - gap * (columns - 1)) * weight) / totalWeight,
  );
  const baseFont = Math.max(3, 8 * scale);
  const minFont = Math.max(3, 6 * scale);
  for (let step = 0; step <= 12; step++) {
    const fontSize = baseFont - ((baseFont - minFont) * step) / 12;
    const measured = widths.map((width) =>
      document.sections.map((section, sectionIndex) => {
        const content = [];
        const inner = width - padding * 2;
        let cursor = padding;
        const addText = (id, value, size, bold = false, ink = color) => {
          const element = textElement(id, value, inner, size, bold, ink);
          content.push({ ...element, x: padding, y: cursor });
          cursor += element.height + padding;
        };
        if (section.title)
          addText(`section-${sectionIndex}-title`, section.title, fontSize * 1.25, true, accent);
        section.blocks.forEach((block, blockIndex) => {
          const id = `section-${sectionIndex}-block-${blockIndex}`;
          if (block.type === "text") {
            addText(id, block.text, fontSize);
            return;
          }
          const height = inner / (block.aspectRatio ?? 1.5);
          content.push({
            id,
            type: "image",
            src: block.src,
            alt: block.alt,
            x: padding,
            y: cursor,
            width: inner,
            height,
          });
          cursor += height + padding;
          if (block.caption) addText(`${id}-caption`, block.caption, fontSize * 0.9);
        });
        return { elements: content, height: cursor };
      }),
    );
    function partition(limit) {
      const failed = new Set();
      function arrange(column, start) {
        if (start === document.sections.length) return [];
        if (column === columns || failed.has(`${column}:${start}`)) return null;
        let used = 0;
        for (let end = start; end < document.sections.length; end++) {
          used += measured[column][end].height + (end === start ? 0 : gap);
          if (used > limit) break;
          const rest = arrange(column + 1, end + 1);
          if (rest) return [[start, end + 1], ...rest];
        }
        failed.add(`${column}:${start}`);
        return null;
      }
      return arrange(0, 0);
    }
    if (available <= 0) break;
    let ranges = partition(available);
    if (!ranges) continue;
    let low = 0;
    let high = available;
    for (let iteration = 0; iteration < 14; iteration++) {
      const middle = (low + high) / 2;
      const balanced = partition(middle);
      if (balanced) {
        ranges = balanced;
        high = middle;
      } else low = middle;
    }
    let left = margin;
    const body = [];
    ranges.forEach(([start, end], column) => {
      let cursor = top;
      for (let index = start; index < end; index++) {
        const section = measured[column][index];
        body.push({
          id: `section-${index}-panel`,
          type: "rect",
          x: left,
          y: cursor,
          width: widths[column],
          height: section.height,
          fill: panel,
        });
        body.push(
          ...section.elements.map((element) => ({
            ...element,
            x: left + element.x,
            y: cursor + element.y,
          })),
        );
        cursor += section.height + gap;
      }
      left += widths[column] + gap;
    });
    const poster = {
      version: 1,
      title: document.title,
      width: document.width,
      height: document.height,
      background: document.background,
      elements: [...elements, ...body],
    };
    return { poster: parseFreeformPoster(JSON.stringify(poster)), fontSize };
  }
  throw new Error(
    "Poster content does not fit. Shorten text, split long sections, or increase the page size.",
  );
}
