/**
 * ÉCHÉANCIER TABULAIRE — registre des en-têtes (B19).
 *
 * Un en-tête est reconnu par son LIBELLÉ, jamais par sa position : la troisième colonne d'un
 * export n'est le capital amorti que si elle le dit. Le registre ne porte que des libellés ;
 * aucun montant, aucune colonne n'est déduit.
 *
 * Trois règles :
 *
 *   * un libellé reconnu donne un RÔLE à sa colonne ;
 *   * un libellé ambigu (« capital restant dû » sans « avant » ni « après ») ne reçoit AUCUN
 *     rôle : choisir l'ouverture ou la clôture fausserait tous les contrôles de la ligne ;
 *   * deux colonnes qui revendiquent le même rôle n'en reçoivent AUCUNE : en choisir une
 *     rendrait la lecture arbitraire.
 *
 * Une colonne sans rôle est conservée (ses cases restent consultables), elle n'entre dans
 * aucun contrôle.
 */

import { foldLabel } from "../text-layer";

export const SCHEDULE_COLUMN_ROLES = [
  "DUE_DATE",
  "OPENING_BALANCE",
  "PRINCIPAL",
  "INTEREST",
  "INSURANCE",
  "FEES",
  "TOTAL_PAYMENT",
  "CLOSING_BALANCE",
  "CURRENCY",
] as const;
export type ScheduleColumnRole = (typeof SCHEDULE_COLUMN_ROLES)[number];

/** Clé de case : `L{ligne}.{clé}`. Elle adresse une cellule précise dans les contrôles. */
export const ROLE_KEYS: Record<ScheduleColumnRole, string> = {
  DUE_DATE: "date",
  OPENING_BALANCE: "opening",
  PRINCIPAL: "principal",
  INTEREST: "interest",
  INSURANCE: "insurance",
  FEES: "fees",
  TOTAL_PAYMENT: "total",
  CLOSING_BALANCE: "closing",
  CURRENCY: "currency",
};

/** Rôles portant un montant : les seuls lus comme des nombres. */
export const MONEY_ROLES: ReadonlySet<ScheduleColumnRole> = new Set([
  "OPENING_BALANCE",
  "PRINCIPAL",
  "INTEREST",
  "INSURANCE",
  "FEES",
  "TOTAL_PAYMENT",
  "CLOSING_BALANCE",
]);

/** Libellés reconnus, en forme repliée (majuscules, sans accent, espaces simples). */
const LABELS: Record<ScheduleColumnRole, readonly string[]> = {
  DUE_DATE: [
    "DATE",
    "DATE D'ECHEANCE",
    "DATE ECHEANCE",
    "DATE DE PRELEVEMENT",
    "DATE DU PRELEVEMENT",
    "DUE DATE",
    "PAYMENT DATE",
  ],
  OPENING_BALANCE: [
    "OUVERTURE",
    "SOLDE D'OUVERTURE",
    "SOLDE DEBUT",
    "SOLDE DE DEBUT",
    "CAPITAL RESTANT DU AVANT",
    "CAPITAL RESTANT DU AVANT ECHEANCE",
    "CAPITAL RESTANT DU DEBUT",
    "CRD AVANT",
    "CRD DEBUT",
    "OPENING BALANCE",
  ],
  CLOSING_BALANCE: [
    "CLOTURE",
    "SOLDE DE CLOTURE",
    "SOLDE FIN",
    "SOLDE DE FIN",
    "CAPITAL RESTANT DU APRES",
    "CAPITAL RESTANT DU APRES ECHEANCE",
    "CAPITAL RESTANT DU FIN",
    "CRD APRES",
    "CRD FIN",
    "CLOSING BALANCE",
  ],
  PRINCIPAL: [
    "PRINCIPAL",
    "CAPITAL",
    "CAPITAL AMORTI",
    "CAPITAL REMBOURSE",
    "AMORTISSEMENT",
    "AMORTISSEMENT DU CAPITAL",
  ],
  INTEREST: ["INTERET", "INTERETS"],
  INSURANCE: [
    "ASSURANCE",
    "ASSURANCES",
    "PRIME D'ASSURANCE",
    "COTISATION ASSURANCE",
    "COTISATION D'ASSURANCE",
    "INSURANCE",
  ],
  FEES: ["FRAIS", "COMMISSION", "COMMISSIONS", "ACCESSOIRES", "FEES"],
  TOTAL_PAYMENT: [
    "TOTAL",
    "TOTAL ECHEANCE",
    "ECHEANCE TOTALE",
    "MONTANT DE L'ECHEANCE",
    "MONTANT ECHEANCE",
    "MONTANT PRELEVE",
    "MENSUALITE",
    "PAYMENT",
  ],
  CURRENCY: ["DEVISE", "MONNAIE", "CURRENCY"],
};

/** Libellés connus et AMBIGUS : reconnus comme tels, jamais attribués. */
const AMBIGUOUS_LABELS: readonly string[] = [
  "CAPITAL RESTANT DU",
  "CRD",
  "SOLDE",
  "CAPITAL DU",
  "ENCOURS",
];

const ROLE_BY_LABEL = new Map<string, ScheduleColumnRole>(
  SCHEDULE_COLUMN_ROLES.flatMap((role) => LABELS[role].map((label) => [label, role] as const)),
);

/** Mention de devise accolée à un en-tête : « Intérêts (EUR) », « Capital en € ». */
const HEADER_CURRENCY = /(?:\(|\s|^)(EUR|USD|CHF|GBP|€|\$|£)\)?\s*$/i;
const SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };

/**
 * « Échéance » seule désigne, selon la banque, la DATE ou le MONTANT de l'échéance. Le
 * libellé ne tranche pas : c'est le reste de l'en-tête qui le fait (voir `buildColumns`).
 */
export const DATE_OR_TOTAL_LABEL = "ECHEANCE";

export interface HeaderReading {
  role: ScheduleColumnRole | null;
  ambiguous: boolean;
  /** Libellé « Échéance » seul : date ou montant, tranché par les autres colonnes. */
  dateOrTotal: boolean;
  /** Devise mentionnée dans l'en-tête, en code ISO, ou `null`. */
  currency: string | null;
}

/** Lit un en-tête : rôle reconnu, ambiguïté déclarée, devise éventuellement mentionnée. */
export function readHeader(label: string): HeaderReading {
  let folded = foldLabel(label);
  let currency: string | null = null;
  const mention = HEADER_CURRENCY.exec(folded);
  if (mention) {
    const code = mention[1]!.toUpperCase();
    currency = SYMBOLS[code] ?? code;
    folded = folded.slice(0, mention.index).trim();
  }
  folded = folded
    .replace(/\s+EN$/, "")
    .replace(/[.:;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const role = ROLE_BY_LABEL.get(folded) ?? null;
  return {
    role,
    ambiguous: role === null && AMBIGUOUS_LABELS.includes(folded),
    dateOrTotal: folded === DATE_OR_TOTAL_LABEL,
    currency,
  };
}

/** Lettre de colonne façon tableur : 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}
