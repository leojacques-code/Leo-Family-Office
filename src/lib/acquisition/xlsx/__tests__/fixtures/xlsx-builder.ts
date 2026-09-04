/**
 * CONSTRUCTEUR DE CLASSEURS XLSX RÉELS
 *
 * Il écrit de vraies archives ZIP contenant de vrais documents XML, avec répertoire central
 * calculé et CRC-32 corrects. Ce n'est pas un simulacre : le lecteur testé est exactement
 * celui de production, et il ouvre ces fichiers comme il ouvrirait un export de courtier.
 *
 * Écrire ce constructeur plutôt que joindre un fichier binaire d'exemple a deux raisons :
 * un cas limite se décrit en trois lignes ici (une formule sans valeur en cache, une
 * cellule en erreur, un index de chaîne hors bornes), et aucun fichier personnel n'entre
 * dans le dépôt.
 */

import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  name: string;
  content: string | Uint8Array;
  /** `false` pour écrire l'entrée non compressée (méthode STORED). */
  deflate?: boolean;
}

/** Écrit une archive ZIP. Chaque entrée porte son CRC et ses deux tailles. */
export function buildZip(inputs: readonly ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const input of inputs) {
    const nameBytes = encoder.encode(input.name);
    const rawBytes =
      typeof input.content === "string" ? encoder.encode(input.content) : input.content;
    const useDeflate = input.deflate ?? true;
    const stored = useDeflate ? new Uint8Array(deflateRawSync(rawBytes)) : rawBytes;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(rawBytes);

    const local = new Uint8Array(30 + nameBytes.length + stored.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, rawBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(stored, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, rawBytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((total, entry) => total + entry.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, inputs.length, true);
  eocdView.setUint16(10, inputs.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const archive = new Uint8Array(total);
  let cursor = 0;
  for (const local of locals) {
    archive.set(local, cursor);
    cursor += local.length;
  }
  for (const central of centrals) {
    archive.set(central, cursor);
    cursor += central.length;
  }
  archive.set(eocd, cursor);
  return archive;
}

/** Une cellule à écrire. `type` suit la nomenclature du format (`s`, `str`, `n`, `b`, `e`). */
export interface CellInput {
  ref: string;
  value?: string;
  type?: "s" | "str" | "n" | "b" | "e" | "inlineStr";
  /** Formule éventuelle. Le lecteur ne doit JAMAIS l'évaluer. */
  formula?: string;
  /** Index de style, pour éprouver le décodage des dates. */
  style?: number;
}

function cellXml(cell: CellInput): string {
  const attributes = [`r="${cell.ref}"`];
  if (cell.type !== undefined && cell.type !== "n") attributes.push(`t="${cell.type}"`);
  if (cell.style !== undefined) attributes.push(`s="${cell.style}"`);
  const parts: string[] = [];
  if (cell.formula !== undefined) parts.push(`<f>${cell.formula}</f>`);
  if (cell.type === "inlineStr") {
    parts.push(`<is><t>${cell.value ?? ""}</t></is>`);
  } else if (cell.value !== undefined) {
    parts.push(`<v>${cell.value}</v>`);
  }
  if (parts.length === 0) return `<c ${attributes.join(" ")}/>`;
  return `<c ${attributes.join(" ")}>${parts.join("")}</c>`;
}

export interface WorkbookInput {
  sheetName?: string;
  /** Lignes de cellules. La première ligne du classeur est la ligne 1. */
  rows: CellInput[][];
  sharedStrings?: string[];
  /** Déclare l'époque 1904. */
  date1904?: boolean;
  /** Ajoute un projet VBA : le lecteur doit REFUSER le classeur. */
  withMacro?: boolean;
  /** Ajoute un lien externe : le lecteur doit le signaler sans le suivre. */
  withExternalLink?: boolean;
  /**
   * Relations BRUTES ajoutées telles quelles au `.rels` du classeur. Sert à prouver qu'une
   * relation externe, d'un autre type ou hors de `worksheets/` n'est pas suivie.
   */
  externalRelationships?: readonly string[];
  /** Styles date, par index de `cellXfs`. */
  dateStyleIndexes?: number[];
  /** Feuilles supplémentaires, pour éprouver le plafond. */
  extraSheets?: number;
  encrypted?: boolean;
}

export function buildWorkbook(input: WorkbookInput): Uint8Array {
  const sheetName = input.sheetName ?? "Feuil1";
  const rowsXml = input.rows
    .map((cells, index) => `<row r="${index + 1}">${cells.map(cellXml).join("")}</row>`)
    .join("");

  const extra = input.extraSheets ?? 0;
  const sheetDeclarations = [
    `<sheet name="${sheetName}" sheetId="1" r:id="rId1"/>`,
    ...Array.from(
      { length: extra },
      (_, index) => `<sheet name="Extra${index}" sheetId="${index + 2}" r:id="rId${index + 2}"/>`,
    ),
  ].join("");
  // Type de relation RÉEL. Le lecteur n'accepte qu'une relation de feuille interne : une
  // fixture qui abrège le type ne testerait pas ce que le lecteur voit d'un vrai classeur.
  const WORKSHEET_TYPE =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
  const relationships = [
    `<Relationship Id="rId1" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet1.xml"/>`,
    ...Array.from(
      { length: extra },
      (_, index) =>
        `<Relationship Id="rId${index + 2}" Type="${WORKSHEET_TYPE}" Target="worksheets/sheet${index + 2}.xml"/>`,
    ),
    ...(input.externalRelationships ?? []),
  ].join("");

  // Les styles : chaque `<xf>` porte un `numFmtId`. 14 est un format de date intégré.
  const dateIndexes = new Set(input.dateStyleIndexes ?? []);
  const maxStyle = Math.max(0, ...[...dateIndexes]) + 1;
  const cellXfs = Array.from(
    { length: maxStyle },
    (_, index) => `<xf numFmtId="${dateIndexes.has(index) ? 14 : 0}" xfId="0"/>`,
  ).join("");

  const files: ZipInput[] = [
    {
      name: "[Content_Types].xml",
      content: '<?xml version="1.0"?><Types/>',
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0"?><workbook xmlns:r="r">' +
        (input.date1904 ? '<workbookPr date1904="1"/>' : "") +
        `<sheets>${sheetDeclarations}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0"?><Relationships>${relationships}</Relationships>`,
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: `<?xml version="1.0"?><worksheet><sheetData>${rowsXml}</sheetData></worksheet>`,
    },
    {
      name: "xl/styles.xml",
      content: `<?xml version="1.0"?><styleSheet><cellXfs count="${maxStyle}">${cellXfs}</cellXfs></styleSheet>`,
    },
  ];

  for (let index = 0; index < extra; index += 1) {
    files.push({
      name: `xl/worksheets/sheet${index + 2}.xml`,
      content: '<?xml version="1.0"?><worksheet><sheetData/></worksheet>',
    });
  }

  if (input.sharedStrings !== undefined) {
    files.push({
      name: "xl/sharedStrings.xml",
      content:
        '<?xml version="1.0"?><sst>' +
        input.sharedStrings.map((value) => `<si><t>${value}</t></si>`).join("") +
        "</sst>",
    });
  }
  if (input.withMacro) {
    files.push({ name: "xl/vbaProject.bin", content: new Uint8Array([0, 1, 2, 3]) });
  }
  if (input.withExternalLink) {
    files.push({
      name: "xl/externalLinks/externalLink1.xml",
      content: '<?xml version="1.0"?><externalLink/>',
    });
  }
  if (input.encrypted) {
    files.push({ name: "EncryptedPackage", content: new Uint8Array([9, 9, 9]) });
  }

  return buildZip(files);
}
