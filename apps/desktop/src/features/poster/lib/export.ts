import { invoke, isTauri } from "@tauri-apps/api/core";
import { resolveMarkdownImage } from "@/features/editor/lib/markdown";
import { POSTER_STYLES, type PosterDocument, wrapText } from "./model";

const escapeXml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );
export function posterSvg(p: PosterDocument): string {
  const elements = p.elements
    .map((e) => {
      if (e.type === "rect")
        return `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${e.fill ?? "#ffffff"}"/>`;
      if (e.type === "image") {
        if (!e.src?.startsWith("data:image/"))
          throw new Error("Embed poster images before exporting.");
        return `<image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${escapeXml(e.src)}" preserveAspectRatio="xMidYMid meet"><title>${escapeXml(e.alt ?? "")}</title></image>`;
      }
      const size = e.fontSize ?? 8;
      const x = e.x + (e.align === "center" ? e.width / 2 : e.align === "right" ? e.width : 0);
      const lines = wrapText(e.text ?? "", e.width, size);
      return `<svg x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" overflow="hidden"><text fill="${e.color ?? "#14253d"}" font-family="${POSTER_STYLES[p.style].font}" font-size="${size}" font-weight="${e.bold ? "bold" : "normal"}" text-anchor="${e.align === "center" ? "middle" : e.align === "right" ? "end" : "start"}">${lines.map((line, i) => `<tspan x="${x - e.x}" y="${size + i * size * 1.25}">${escapeXml(line)}</tspan>`).join("")}</text></svg>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width}mm" height="${p.height}mm" viewBox="0 0 ${p.width} ${p.height}"><title>${escapeXml(p.title)}</title><rect width="100%" height="100%" fill="${p.background}"/>${elements}</svg>`;
}
export async function embedPosterImages(
  p: PosterDocument,
  filePath: string,
  projectPath: string,
): Promise<PosterDocument> {
  return {
    ...p,
    elements: await Promise.all(
      p.elements.map(async (e) => {
        if (e.type !== "image" || !e.src || e.src.startsWith("data:")) return e;
        const path = resolveMarkdownImage(e.src, filePath, projectPath);
        if (!path || !isTauri()) throw new Error(`Cannot load local figure: ${e.src}`);
        const bytes = await invoke<number[]>("read_poster_image", { path });
        const mime = /\.jpe?g$/i.test(e.src) ? "jpeg" : /\.webp$/i.test(e.src) ? "webp" : "png";
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.slice(i, i + 8192));
        return { ...e, src: `data:image/${mime};base64,${btoa(binary)}` };
      }),
    ),
  };
}
export async function posterPptx(p: PosterDocument): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  const inch = (mm: number) => mm / 25.4;
  pptx.defineLayout({ name: "POSTER", width: inch(p.width), height: inch(p.height) });
  pptx.layout = "POSTER";
  pptx.title = p.title;
  pptx.author = "Inkwell";
  const slide = pptx.addSlide();
  slide.background = { color: p.background.slice(1) };
  for (const e of p.elements) {
    const box = { x: inch(e.x), y: inch(e.y), w: inch(e.width), h: inch(e.height) };
    if (e.type === "rect")
      slide.addShape(pptx.ShapeType.rect, {
        ...box,
        fill: { color: (e.fill ?? "#ffffff").slice(1) },
        line: { transparency: 100 },
      });
    else if (e.type === "image") {
      if (!e.src?.startsWith("data:")) throw new Error("Embed poster images before exporting.");
      slide.addImage({
        ...box,
        sizing: { type: "contain", ...box },
        data: e.src,
        altText: e.alt ?? "Figure",
      });
    } else
      slide.addText(wrapText(e.text ?? "", e.width, e.fontSize ?? 8).join("\n"), {
        ...box,
        fontFace: POSTER_STYLES[p.style].font,
        fontSize: ((e.fontSize ?? 8) * 72) / 25.4,
        bold: e.bold,
        color: (e.color ?? "#14253d").slice(1),
        align: e.align ?? "left",
        valign: "top",
        margin: 0,
        breakLine: false,
        paraSpaceAfter: 0,
        lineSpacingMultiple: 1.25,
        fit: "none",
      });
  }
  return (await pptx.write({ outputType: "uint8array", compression: true })) as Uint8Array;
}
async function rasterizePoster(p: PosterDocument, mime: "image/png" | "image/jpeg") {
  const svg = posterSvg(p);
  const scale = Math.min(2, 4096 / Math.max(p.width, p.height));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not rasterize poster"));
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(p.width * scale));
  canvas.height = Math.max(1, Math.round(p.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = p.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const quality = mime === "image/jpeg" ? 0.95 : undefined;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error("Could not encode poster image");
  return new Uint8Array(await blob.arrayBuffer());
}

function pdfFromJpeg(jpeg: Uint8Array, widthMm: number, heightMm: number) {
  const read = (offset: number) => (((jpeg[offset] ?? 0) << 8) | (jpeg[offset + 1] ?? 0)) >>> 0;
  let offset = 2;
  let width = 0;
  let height = 0;
  while (offset < jpeg.length - 9) {
    if (jpeg[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = jpeg[offset + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xc3) {
      height = read(offset + 5);
      width = read(offset + 7);
      break;
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    offset += 2 + read(offset + 2);
  }
  if (!width || !height) throw new Error("Could not inspect JPEG dimensions");
  const pageW = (widthMm * 72) / 25.4;
  const pageH = (heightMm * 72) / 25.4;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream`,
    `<< /Length ${`q ${pageW} 0 0 ${pageH} 0 0 cm /Im Do Q`.length} >>\nstream\nq ${pageW} 0 0 ${pageH} 0 0 cm /Im Do Q\nendstream`,
  ];
  const header = new TextEncoder().encode("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");
  const chunks: Uint8Array[] = [header];
  const offsets = [0];
  let length = header.length;
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(length);
    const head = new TextEncoder().encode(`${i + 1} 0 obj\n${objects[i]}\n`);
    chunks.push(head);
    length += head.length;
    if (i === 3) {
      const tail = new TextEncoder().encode("\nendstream\nendobj\n");
      chunks.push(jpeg, tail);
      length += jpeg.length + tail.length;
    } else {
      const tail = new TextEncoder().encode("endobj\n");
      chunks.push(tail);
      length += tail.length;
    }
  }
  const xref = length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1)
    trailer += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  chunks.push(new TextEncoder().encode(trailer));
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    result.set(chunk, cursor);
    cursor += chunk.length;
  }
  return result;
}

export async function posterRaster(p: PosterDocument, format: "png" | "jpeg" | "pdf") {
  const jpeg = await rasterizePoster(p, "image/jpeg");
  if (format === "pdf") return pdfFromJpeg(jpeg, p.width, p.height);
  return format === "png" ? rasterizePoster(p, "image/png") : jpeg;
}

export async function savePosterExport(
  bytes: Uint8Array,
  name: string,
  extension: "svg" | "pptx" | "png" | "jpeg" | "pdf",
) {
  if (isTauri()) return invoke("save_poster_export", { bytes: Array.from(bytes), name, extension });
  const blob = new Blob([new Uint8Array(bytes)], {
    type:
      extension === "svg"
        ? "image/svg+xml"
        : extension === "pptx"
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          : extension === "pdf"
            ? "application/pdf"
            : `image/${extension}`,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
