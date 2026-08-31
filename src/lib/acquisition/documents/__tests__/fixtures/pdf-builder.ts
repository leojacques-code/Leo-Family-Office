/**
 * GÉNÉRATEUR DE PDF DE TEST
 *
 * Écrit un PDF RÉEL, non compressé, avec sa table d'objets calculée. Il ne sert qu'aux tests,
 * et il existe pour une raison précise : sans lui, l'adaptateur `pdf-extract.ts` ne serait
 * jamais éprouvé sur un vrai fichier, et la chaîne complète — octets → couche texte → cases —
 * resterait une supposition.
 *
 * Aucun formulaire officiel n'est reproduit ici, et aucune donnée réelle n'y figure : les
 * fixtures sont des mises en page SYNTHÉTIQUES, avec des SIREN calculés et des montants
 * inventés qui s'équilibrent.
 *
 * L'encodage est `WinAnsiEncoding` : c'est celui qui permet d'écrire les accents d'un libellé
 * comptable français dans un flux PDF non compressé, donc de vérifier que la lecture les
 * restitue.
 */

export interface PdfTextPlacement {
  /** Abscisse, repère PDF (origine en bas à gauche). */
  x: number;
  y: number;
  text: string;
  fontSize?: number;
}

export interface PdfPageSpec {
  width?: number;
  height?: number;
  lines: PdfTextPlacement[];
}

const DEFAULT_WIDTH = 595;
const DEFAULT_HEIGHT = 842;
const DEFAULT_FONT_SIZE = 9;

function escapeText(value: string): string {
  return value.replace(/([()\\])/g, "\\$1");
}

function contentStream(page: PdfPageSpec): string {
  const parts: string[] = ["BT"];
  let currentSize = 0;
  for (const line of page.lines) {
    const size = line.fontSize ?? DEFAULT_FONT_SIZE;
    if (size !== currentSize) {
      parts.push(`/F1 ${size} Tf`);
      currentSize = size;
    }
    parts.push(`1 0 0 1 ${line.x} ${line.y} Tm`);
    parts.push(`(${escapeText(line.text)}) Tj`);
  }
  parts.push("ET");
  return parts.join("\n");
}

/**
 * Assemble un PDF multi-pages.
 *
 * La table `xref` est calculée sur les décalages RÉELS des objets. Un lecteur tolérant
 * reconstruirait un PDF à table fausse, mais le test ne prouverait alors rien sur la lecture
 * d'un fichier conforme.
 */
export function buildPdf(pages: readonly PdfPageSpec[]): Uint8Array {
  const streams = pages.map((page) => contentStream(page));

  // Numérotation : 1 = catalogue, 2 = arbre des pages, 3 = police,
  // puis un couple (page, contenu) par page.
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
  ];

  pages.forEach((page, index) => {
    const contentNumber = pageObjectNumbers[index] + 1;
    const width = page.width ?? DEFAULT_WIDTH;
    const height = page.height ?? DEFAULT_HEIGHT;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    );
    const stream = streams[index];
    objects.push(
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  });

  let output = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(output, "latin1"));
}

/**
 * PDF sans AUCUN texte : une page vide.
 *
 * C'est le substitut d'un document scanné pour les tests. Un scan réel porte une image, que
 * l'extracteur ne lit pas davantage : ce qui compte est l'absence de couche texte, et elle est
 * ici exactement celle d'un scan.
 */
export function buildImageOnlyPdf(pageCount = 1): Uint8Array {
  return buildPdf(Array.from({ length: pageCount }, () => ({ lines: [] })));
}
