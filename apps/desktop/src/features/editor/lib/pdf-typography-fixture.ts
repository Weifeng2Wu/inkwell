type PdfTypographyFixtureOptions = {
  rotation?: number;
  crop?: boolean;
  body?: string;
  bodySize?: number;
  script?: string;
  scriptSize?: number;
  scriptFont?: "F1" | "F2" | "F4";
  rise?: number;
  after?: string;
  heading?: string;
  headingSize?: number;
  leading?: number;
};

/** Small real PDF with independent typography; no browser geometry or font mocks. */
export function pdfTypographyFixture({
  rotation = 0,
  crop = false,
  body = "Body",
  bodySize = 16,
  script = "1",
  scriptSize = 8,
  scriptFont = "F1",
  rise = 7,
  after = "(paper).",
  heading = "Heading",
  headingSize = bodySize,
  leading = 26,
}: PdfTypographyFixtureOptions = {}) {
  const hex = (text: string) =>
    Array.from(text, (character) => {
      const code = character === "†" ? 134 : character === "‡" ? 135 : character.charCodeAt(0);
      if (code > 255) throw new Error("Fixture requires WinAnsi text");
      return code.toString(16).padStart(2, "0");
    }).join("");
  const stream = `${heading ? `BT /F3 ${headingSize} Tf 72 754 Td <${hex(heading)}> Tj ET\n` : ""}BT /F1 ${bodySize} Tf 72 720 Td <${hex(body)}> Tj /${scriptFont} ${scriptSize} Tf ${rise} Ts <${hex(script)}> Tj 0 Ts /F1 ${bodySize} Tf <${hex(after)}> Tj 0 -${leading} Td <${hex("Normal text below.")}> Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${crop ? "/CropBox [20 30 592 762]" : ""} /Rotate ${rotation} /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> >> /Contents 8 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
