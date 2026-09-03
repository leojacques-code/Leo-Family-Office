import type { InstitutionalReport } from "./report-types";
import { safeText } from "./report-formatters";

// Unicode → Windows-1252, explicitly. Undefined C1/control code points and all
// unrepresentable Unicode scalars become "?". NFC preserves composed French accents.
// Octal PDF escapes keep every non-ASCII byte out of the PDF syntax itself.
const WIN_ANSI = new Map(
  Array.from("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ").map((character, index) => [
    character,
    [
      0x80, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8e, 0x91, 0x92,
      0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9e, 0x9f,
    ][index]!,
  ]),
);
export function winAnsiLiteral(value: string): string {
  return Array.from(value.slice(0, 2_000).normalize("NFC"), (character) => {
    const code = character.codePointAt(0)!;
    const byte =
      WIN_ANSI.get(character) ??
      ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) ? code : 63);
    if (byte >= 128) return `\\${byte.toString(8).padStart(3, "0")}`;
    const ascii = String.fromCharCode(byte);
    return ["\\", "(", ")"].includes(ascii) ? `\\${ascii}` : ascii;
  }).join("");
}
const wrap = (text: string, width = 92) => {
  const words = safeText(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > width) {
      if (line) lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
};

/** Minimal server-side PDF writer: no HTML, JavaScript, URL or remote resource is evaluated. */
export function renderReportPdf(report: InstitutionalReport, generatedAt: string): Uint8Array {
  const lines = [
    report.title,
    `Période : ${report.manifest.period.from} — ${report.manifest.period.to}`,
    `Date financière : ${report.manifest.observationDate}`,
    `Généré le : ${safeText(generatedAt, 64)}`,
    `Devise : ${report.manifest.currency}`,
    "",
  ];
  for (const section of report.sections) {
    lines.push(`${section.title} [${section.status}]`, ...wrap(section.summary));
    for (const item of section.amounts)
      lines.push(
        ...wrap(
          `${item.label}: ${item.value === null ? "non calculable" : item.value} ${item.currency} · ${item.date} · ${item.nature} · ${item.source}`,
        ),
      );
    for (const item of section.items.slice(0, 20)) lines.push(...wrap(`• ${item}`));
    for (const blocker of section.blockers) lines.push(...wrap(`Blocker: ${blocker}`));
    lines.push("");
  }
  lines.push(
    "Méthodologie et preuves",
    `Fingerprint financier : ${report.manifest.financialFingerprint}`,
    `Opening fingerprint : ${report.manifest.openingFingerprint}`,
    `Event set version : ${report.manifest.eventSetVersion}`,
    `Format : ${report.manifest.formatVersion}`,
  );
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += 46) pages.push(lines.slice(index, index + 46));
  const objects: string[] = [];
  const add = (body: string) => (objects.push(body), objects.length);
  const font = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const pagesId = 2; // catalog is object 1, pages object 2
  objects.unshift("", "");
  const pageIds: number[] = [];
  for (const [pageIndex, page] of pages.entries()) {
    const commands = [
      `BT /F1 10 Tf 44 800 Td 13 TL`,
      ...page.map((line) => `(${winAnsiLiteral(line)}) Tj T*`),
      `ET`,
      `BT /F1 8 Tf 280 24 Td (Page ${pageIndex + 1} / ${pages.length}) Tj ET`,
    ].join("\n");
    const content = add(
      `<< /Length ${Buffer.byteLength(commands, "latin1")} >>\nstream\n${commands}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font + 2} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[0] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let output = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n `)
    .join(
      "\n",
    )}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(output, "latin1"));
}
