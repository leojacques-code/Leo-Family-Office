/**
 * MISE EN PAGE SYNTHÉTIQUE D'UNE LIASSE
 *
 * Aucun formulaire officiel n'est reproduit, aucune société réelle n'y figure. Les codes de
 * case sont des codes PLAUSIBLES placés dans des colonnes réalistes ; les montants sont
 * inventés et s'équilibrent, ce qui est le seul point qui compte pour éprouver les contrôles.
 *
 * Ce que ces fixtures prouvent :
 *
 *   * la détection de formulaire par le CONTENU, avec sa preuve ;
 *   * la reconnaissance de la colonne d'une case par ses EN-TÊTES imprimés ;
 *   * la lecture d'une case vide comme une absence, et non comme un zéro ;
 *   * la résolution des contrôles par ancres de libellé, puis leur verdict ;
 *   * le blocage d'un montant dont la convention décimale est indécidable ;
 *   * le refus de lire un scan.
 *
 * Ce qu'elles ne prouvent PAS : que la mise en page réelle des formulaires DGFiP est celle-ci.
 * Les formulaires officiels n'ont pas pu être téléchargés depuis cet environnement, et c'est
 * un point BLOQUÉ documenté dans `docs/DOCUMENT_INTELLIGENCE.md`.
 */

import { buildPdf, type PdfPageSpec, type PdfTextPlacement } from "./pdf-builder";

/** SIREN synthétique à clé de contrôle calculée. */
export const FIXTURE_SIREN = "900000001";

/** Abscisses des colonnes, choisies pour ressembler à un tableau de bilan A4. */
const X_LABEL = 40;
const X_CODE_1 = 250;
const X_VALUE_1 = 292;
const X_CODE_2 = 362;
const X_VALUE_2 = 396;
const X_CODE_3 = 462;
const X_VALUE_3 = 496;

interface ThreeColumnRow {
  label: string;
  codes: [string, string, string];
  values: [string, string | null, string];
}

function threeColumnRow(y: number, row: ThreeColumnRow): PdfTextPlacement[] {
  const placements: PdfTextPlacement[] = [
    { x: X_LABEL, y, text: row.label },
    { x: X_CODE_1, y, text: row.codes[0] },
    { x: X_VALUE_1, y, text: row.values[0] },
    { x: X_CODE_2, y, text: row.codes[1] },
    { x: X_CODE_3, y, text: row.codes[2] },
    { x: X_VALUE_3, y, text: row.values[2] },
  ];
  // Une case laissée BLANCHE sur le formulaire : son code est imprimé, sa valeur non.
  if (row.values[1] !== null) {
    placements.push({ x: X_VALUE_2, y, text: row.values[1] });
  }
  return placements;
}

function singleColumnRow(
  y: number,
  label: string,
  code: string,
  value: string | null,
): PdfTextPlacement[] {
  const placements: PdfTextPlacement[] = [
    { x: X_LABEL, y, text: label },
    { x: X_CODE_1, y, text: code },
  ];
  if (value !== null) placements.push({ x: X_VALUE_3, y, text: value });
  return placements;
}

/** Page 1 — bilan actif, trois colonnes. Brut 470 000, amortissements 120 000, net 350 000. */
function actifPage(): PdfPageSpec {
  return {
    lines: [
      { x: X_LABEL, y: 812, text: "Formulaire n° 2050-SD", fontSize: 10 },
      {
        x: X_LABEL,
        y: 796,
        text: `SIREN ${FIXTURE_SIREN.slice(0, 3)} ${FIXTURE_SIREN.slice(3, 6)} ${FIXTURE_SIREN.slice(6)}`,
      },
      { x: X_LABEL, y: 782, text: "Exercice du 01/01/2025 au 31/12/2025" },
      { x: X_LABEL, y: 764, text: "BILAN - ACTIF" },
      { x: X_VALUE_1, y: 748, text: "Brut" },
      { x: 362, y: 748, text: "Amortissements" },
      { x: 490, y: 748, text: "Net" },
      ...threeColumnRow(726, {
        label: "Immobilisations incorporelles",
        codes: ["AB", "AC", "AD"],
        values: ["120 000", "20 000", "100 000"],
      }),
      ...threeColumnRow(710, {
        label: "Immobilisations corporelles",
        codes: ["AN", "AO", "AP"],
        values: ["300 000", "100 000", "200 000"],
      }),
      ...threeColumnRow(694, {
        label: "Clients et comptes rattachés",
        codes: ["BX", "BY", "BZ"],
        // Aucun amortissement : la case est BLANCHE, elle ne déclare rien.
        values: ["50 000", null, "50 000"],
      }),
      ...threeColumnRow(670, {
        label: "TOTAL GÉNÉRAL",
        codes: ["CO", "CP", "CQ"],
        values: ["470 000", "120 000", "350 000"],
      }),
    ],
  };
}

/** Page 2 — bilan passif, une colonne. Total 350 000, égal à l'actif net. */
function passifPage(): PdfPageSpec {
  return {
    lines: [
      { x: X_LABEL, y: 812, text: "Formulaire n° 2051-SD", fontSize: 10 },
      { x: X_LABEL, y: 782, text: "Exercice clos le 31/12/2025" },
      { x: X_LABEL, y: 764, text: "BILAN - PASSIF" },
      { x: 490, y: 748, text: "Net" },
      ...singleColumnRow(726, "Capital social ou individuel", "DA", "50 000"),
      ...singleColumnRow(710, "Réserves", "DG", "230 000"),
      ...singleColumnRow(694, "RÉSULTAT DE L'EXERCICE", "DL", "20 000"),
      ...singleColumnRow(678, "Emprunts et dettes financières", "DU", "50 000"),
      ...singleColumnRow(654, "TOTAL GÉNÉRAL", "EE", "350 000"),
    ],
  };
}

/** Page 3 — compte de résultat, 1re partie. Chiffre d'affaires 900 000. */
function resultatPart1Page(): PdfPageSpec {
  return {
    lines: [
      { x: X_LABEL, y: 812, text: "Formulaire n° 2052-SD", fontSize: 10 },
      { x: X_LABEL, y: 782, text: "Exercice clos le 31/12/2025" },
      { x: 490, y: 748, text: "Net" },
      ...singleColumnRow(726, "Chiffres d'affaires nets", "FL", "900 000"),
      ...singleColumnRow(710, "Achats de marchandises", "FS", "400 000"),
      ...singleColumnRow(694, "Autres charges externes", "FW", "480 000"),
    ],
  };
}

/** Page 4 — compte de résultat, 2e partie. Résultat 20 000, égal au passif. */
function resultatPart2Page(): PdfPageSpec {
  return {
    lines: [
      { x: X_LABEL, y: 812, text: "Formulaire n° 2053-SD", fontSize: 10 },
      { x: X_LABEL, y: 782, text: "Exercice clos le 31/12/2025" },
      { x: 490, y: 748, text: "Net" },
      ...singleColumnRow(726, "Total des produits", "HL", "900 000"),
      ...singleColumnRow(710, "Total des charges", "HM", "880 000"),
      ...singleColumnRow(694, "RÉSULTAT DE L'EXERCICE", "HN", "20 000"),
    ],
  };
}

/** Liasse cohérente et équilibrée. */
export function buildCoherentLiassePdf(): Uint8Array {
  return buildPdf([actifPage(), passifPage(), resultatPart1Page(), resultatPart2Page()]);
}

/**
 * Liasse DÉSÉQUILIBRÉE : le total du passif est faux de 10 000. Le contrôle bloquant doit
 * échouer, et la validation doit être refusée.
 */
export function buildUnbalancedLiassePdf(): Uint8Array {
  const passif = passifPage();
  const broken: PdfPageSpec = {
    lines: passif.lines.map((line) =>
      line.text === "350 000" ? { ...line, text: "360 000" } : line,
    ),
  };
  return buildPdf([actifPage(), broken, resultatPart1Page(), resultatPart2Page()]);
}

/**
 * Liasse dont la convention décimale est CONTRADICTOIRE : une valeur en virgule décimale
 * (`1 234,56`) et une valeur en point décimal (`2 345.67`) coexistent. Seules les valeurs
 * réellement ambiguës doivent être bloquées.
 */
export function buildAmbiguousConventionLiassePdf(): Uint8Array {
  const page: PdfPageSpec = {
    lines: [
      { x: X_LABEL, y: 812, text: "Formulaire n° 2052-SD", fontSize: 10 },
      { x: X_LABEL, y: 782, text: "Exercice clos le 31/12/2025" },
      { x: 490, y: 748, text: "Net" },
      // Ces deux valeurs se contredisent : l'une impose la virgule décimale, l'autre le point.
      ...singleColumnRow(726, "Poste en virgule", "FA", "1 234,56"),
      ...singleColumnRow(710, "Poste en point", "FB", "2 345.67"),
      // Ambiguë : « 3,456 » vaut 3,456 ou 3 456 selon la convention.
      ...singleColumnRow(694, "Poste ambigu", "FC", "3,456"),
      // Non ambiguë malgré la contradiction : l'espace est un séparateur de milliers partout.
      ...singleColumnRow(678, "Poste non ambigu", "FD", "5 000"),
    ],
  };
  return buildPdf([page]);
}
