/**
 * Fixtures SYNTHÉTIQUES de fichiers des écritures comptables.
 *
 * Aucune donnée réelle : ni SIREN, ni nom d'entreprise existante, ni montant issu d'une
 * comptabilité réelle. Elles reproduisent la STRUCTURE réglementaire, qui est la seule chose
 * que le parseur ait besoin de connaître. Un FEC est un document extrêmement sensible : il
 * n'en existe aucun, même partiel, dans ce dépôt.
 */

import { FEC_FIELDS } from "@/lib/acquisition/fec/spec";

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function windows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) throw new Error(`Caractère hors Windows-1252 : ${text[index]}`);
    out[index] = code;
  }
  return out;
}

/** En-tête réglementaire, dans l'ordre imposé. */
export const FEC_HEADER = FEC_FIELDS.join("\t");

export interface LineSpec {
  journal?: string;
  journalLib?: string;
  entry?: string;
  date?: string;
  account?: string;
  accountLib?: string;
  auxNum?: string;
  auxLib?: string;
  piece?: string;
  pieceDate?: string;
  label?: string;
  debit?: string;
  credit?: string;
  letter?: string;
  letterDate?: string;
  validDate?: string;
  currencyAmount?: string;
  currency?: string;
}

/** Construit une ligne FEC dans l'ordre réglementaire. Un champ omis est VIDE, pas zéro. */
export function line(spec: LineSpec): string {
  return [
    spec.journal ?? "VTE",
    spec.journalLib ?? "Ventes",
    spec.entry ?? "1",
    spec.date ?? "20250131",
    spec.account ?? "701000",
    spec.accountLib ?? "Ventes de produits",
    spec.auxNum ?? "",
    spec.auxLib ?? "",
    spec.piece ?? "FA-001",
    spec.pieceDate ?? "20250131",
    spec.label ?? "Facture client",
    spec.debit ?? "",
    spec.credit ?? "",
    spec.letter ?? "",
    spec.letterDate ?? "",
    spec.validDate ?? "20250210",
    spec.currencyAmount ?? "",
    spec.currency ?? "",
  ].join("\t");
}

export function fec(lines: string[]): string {
  return [FEC_HEADER, ...lines].join("\n");
}

/**
 * Exercice nominal, équilibré, minimal mais complet : une vente, un achat, du personnel,
 * une immobilisation, un emprunt, un compte courant d'associé, de la trésorerie.
 */
export const NOMINAL = fec([
  // Vente 1 200 TTC : client 1 200, produit 1 000, TVA 200
  line({ journal: "VTE", entry: "1", account: "411000", accountLib: "Clients", debit: "1200,00" }),
  line({ journal: "VTE", entry: "1", account: "701000", credit: "1000,00" }),
  line({
    journal: "VTE",
    entry: "1",
    account: "445710",
    accountLib: "TVA collectee",
    credit: "200,00",
  }),
  // Achat 600 TTC
  line({
    journal: "ACH",
    journalLib: "Achats",
    entry: "2",
    date: "20250215",
    account: "601000",
    accountLib: "Achats",
    debit: "500,00",
  }),
  line({
    journal: "ACH",
    journalLib: "Achats",
    entry: "2",
    date: "20250215",
    account: "445660",
    accountLib: "TVA deductible",
    debit: "100,00",
  }),
  line({
    journal: "ACH",
    journalLib: "Achats",
    entry: "2",
    date: "20250215",
    account: "401000",
    accountLib: "Fournisseurs",
    credit: "600,00",
  }),
  // Services extérieurs
  line({
    journal: "ACH",
    journalLib: "Achats",
    entry: "3",
    date: "20250228",
    account: "613000",
    accountLib: "Locations",
    debit: "300,00",
  }),
  line({
    journal: "ACH",
    journalLib: "Achats",
    entry: "3",
    date: "20250228",
    account: "401000",
    accountLib: "Fournisseurs",
    credit: "300,00",
  }),
  // Personnel
  line({
    journal: "PAI",
    journalLib: "Paie",
    entry: "4",
    date: "20250331",
    account: "641000",
    accountLib: "Salaires",
    debit: "800,00",
  }),
  line({
    journal: "PAI",
    journalLib: "Paie",
    entry: "4",
    date: "20250331",
    account: "421000",
    accountLib: "Personnel",
    credit: "800,00",
  }),
  // Impôts et taxes
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "5",
    date: "20250430",
    account: "635000",
    accountLib: "Autres impots",
    debit: "50,00",
  }),
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "5",
    date: "20250430",
    account: "447000",
    accountLib: "Autres impots a payer",
    credit: "50,00",
  }),
  // Immobilisation financée par emprunt
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "6",
    date: "20250531",
    account: "215000",
    accountLib: "Installations",
    debit: "5000,00",
  }),
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "6",
    date: "20250531",
    account: "164000",
    accountLib: "Emprunts",
    credit: "5000,00",
  }),
  // Dotation aux amortissements
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "7",
    date: "20251231",
    account: "681100",
    accountLib: "Dotations",
    debit: "500,00",
  }),
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "7",
    date: "20251231",
    account: "281500",
    accountLib: "Amort installations",
    credit: "500,00",
  }),
  // Encaissement client
  line({
    journal: "BQ",
    journalLib: "Banque",
    entry: "8",
    date: "20250630",
    account: "512000",
    accountLib: "Banque",
    debit: "1200,00",
    letter: "AA",
    letterDate: "20250630",
  }),
  line({
    journal: "BQ",
    journalLib: "Banque",
    entry: "8",
    date: "20250630",
    account: "411000",
    accountLib: "Clients",
    credit: "1200,00",
    letter: "AA",
    letterDate: "20250630",
  }),
  // Apport en compte courant d'associé
  line({
    journal: "BQ",
    journalLib: "Banque",
    entry: "9",
    date: "20250715",
    account: "512000",
    accountLib: "Banque",
    debit: "2000,00",
  }),
  line({
    journal: "BQ",
    journalLib: "Banque",
    entry: "9",
    date: "20250715",
    account: "455100",
    accountLib: "Associe compte courant",
    credit: "2000,00",
  }),
  // Charge financière
  line({
    journal: "BQ",
    journalLib: "Banque",
    entry: "10",
    date: "20250930",
    account: "661100",
    accountLib: "Interets",
    debit: "120,00",
  }),
  line({
    journal: "BQ",
    journalLib: "Banque",
    entry: "10",
    date: "20250930",
    account: "512000",
    accountLib: "Banque",
    credit: "120,00",
  }),
  // Impôt sur les bénéfices
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "11",
    date: "20251231",
    account: "695000",
    accountLib: "Impot societes",
    debit: "60,00",
  }),
  line({
    journal: "OD",
    journalLib: "Operations diverses",
    entry: "11",
    date: "20251231",
    account: "444000",
    accountLib: "Etat impot",
    credit: "60,00",
  }),
]);

/** Négoce : ventes de marchandises (707), achats (607) et variation de stock (6037). */
export const TRADING = fec([
  line({
    journal: "VTE",
    entry: "1",
    account: "707000",
    accountLib: "Ventes marchandises",
    credit: "3000,00",
  }),
  line({ journal: "VTE", entry: "1", account: "411000", accountLib: "Clients", debit: "3000,00" }),
  line({
    journal: "ACH",
    entry: "2",
    date: "20250210",
    account: "607000",
    accountLib: "Achats marchandises",
    debit: "1800,00",
  }),
  line({
    journal: "ACH",
    entry: "2",
    date: "20250210",
    account: "401000",
    accountLib: "Fournisseurs",
    credit: "1800,00",
  }),
  line({
    journal: "OD",
    entry: "3",
    date: "20251231",
    account: "603700",
    accountLib: "Variation stock marchandises",
    debit: "200,00",
  }),
  line({
    journal: "OD",
    entry: "3",
    date: "20251231",
    account: "370000",
    accountLib: "Stock marchandises",
    credit: "200,00",
  }),
  line({
    journal: "ACH",
    entry: "4",
    date: "20250315",
    account: "613000",
    accountLib: "Locations",
    debit: "400,00",
  }),
  line({
    journal: "ACH",
    entry: "4",
    date: "20250315",
    account: "401000",
    accountLib: "Fournisseurs",
    credit: "400,00",
  }),
]);

/** Intérêts (661) et pertes de change (666) : deux natures de la classe 66. */
export const FINANCIAL_EXPENSES_SPLIT = fec([
  line({
    journal: "BQ",
    entry: "1",
    account: "661100",
    accountLib: "Interets emprunt",
    debit: "120,00",
  }),
  line({
    journal: "BQ",
    entry: "1",
    account: "666000",
    accountLib: "Pertes de change",
    debit: "30,00",
  }),
  line({ journal: "BQ", entry: "1", account: "512000", accountLib: "Banque", credit: "150,00" }),
]);

/** Écriture déséquilibrée : débits 1 200, crédits 1 000. */
export const UNBALANCED = fec([
  line({ entry: "1", account: "411000", debit: "1200,00" }),
  line({ entry: "1", account: "701000", credit: "1000,00" }),
]);

/** Débit et crédit explicitement à zéro : c'est une VALEUR, pas une absence. */
export const EXPLICIT_ZERO = fec([
  line({ entry: "1", account: "411000", debit: "1000,00", credit: "0,00" }),
  line({ entry: "1", account: "701000", debit: "0,00", credit: "1000,00" }),
]);

/** Les deux côtés absents : la ligne n'a aucun montant. */
export const NO_AMOUNT = fec([line({ entry: "1", account: "411000" })]);

/** Débit et crédit tous deux non nuls sur la même ligne. */
export const BOTH_SIDES = fec([
  line({ entry: "1", account: "411000", debit: "1000,00", credit: "200,00" }),
  line({ entry: "1", account: "701000", credit: "800,00" }),
]);

/** Date inexistante au calendrier. */
export const INVALID_DATE = fec([
  line({ entry: "1", account: "411000", date: "20250231", debit: "100,00" }),
  line({ entry: "1", account: "701000", date: "20250231", credit: "100,00" }),
]);

/** Compte absent. */
export const MISSING_ACCOUNT = fec([
  line({ entry: "1", account: "", debit: "100,00" }),
  line({ entry: "1", account: "701000", credit: "100,00" }),
]);

/** Journal absent. */
export const MISSING_JOURNAL = fec([
  line({ journal: "", entry: "1", account: "411000", debit: "100,00" }),
  line({ entry: "1", account: "701000", credit: "100,00" }),
]);

/** En-tête privé d'un champ réglementaire structurant. */
export const HEADER_WITHOUT_ACCOUNT = [
  FEC_FIELDS.filter((field) => field !== "CompteNum").join("\t"),
  "VTE\tVentes\t1\t20250131\tClients\t\t\tFA-001\t20250131\tFacture\t1200,00\t\t\t\t20250210\t\t",
].join("\n");

/** Séparateur barre verticale. */
export const PIPE_DELIMITED = [
  FEC_FIELDS.join("|"),
  ...[
    [
      "VTE",
      "Ventes",
      "1",
      "20250131",
      "411000",
      "Clients",
      "",
      "",
      "FA-001",
      "20250131",
      "Facture",
      "1200,00",
      "",
      "",
      "",
      "20250210",
      "",
      "",
    ].join("|"),
    [
      "VTE",
      "Ventes",
      "1",
      "20250131",
      "701000",
      "Produits",
      "",
      "",
      "FA-001",
      "20250131",
      "Facture",
      "",
      "1200,00",
      "",
      "",
      "20250210",
      "",
      "",
    ].join("|"),
  ],
].join("\n");

/** Montant en devise avec code, et un montant en devise sans code. */
export const FOREIGN_CURRENCY = fec([
  line({
    entry: "1",
    account: "411000",
    debit: "1000,00",
    currencyAmount: "1100,00",
    currency: "USD",
  }),
  line({ entry: "1", account: "701000", credit: "1000,00" }),
  line({
    entry: "2",
    date: "20250201",
    account: "411000",
    debit: "500,00",
    currencyAmount: "550,00",
  }),
  line({ entry: "2", date: "20250201", account: "701000", credit: "500,00" }),
]);

/** Libellés accentués, à écrire en Windows-1252. */
export const ACCENTED = fec([
  line({
    entry: "1",
    account: "411000",
    accountLib: "Clients divers",
    label: "Prestation réalisée à Nîmes",
    debit: "100,00",
  }),
  line({
    entry: "1",
    account: "701000",
    accountLib: "Prestations",
    label: "Prestation réalisée à Nîmes",
    credit: "100,00",
  }),
]);

/** Deux exercices dans le même fichier. */
export const TWO_FISCAL_YEARS = fec([
  line({ entry: "1", date: "20241215", account: "411000", debit: "100,00" }),
  line({ entry: "1", date: "20241215", account: "701000", credit: "100,00" }),
  line({ entry: "2", date: "20250115", account: "411000", debit: "200,00" }),
  line({ entry: "2", date: "20250115", account: "701000", credit: "200,00" }),
]);

/** Date de validation antérieure à l'écriture, et lettrage sans code. */
export const ATYPICAL_ORDER = fec([
  line({
    entry: "1",
    account: "411000",
    debit: "100,00",
    validDate: "20250101",
    letterDate: "20250301",
  }),
  line({ entry: "1", account: "701000", credit: "100,00" }),
]);

/** Découvert : la banque est créditrice. */
export const NEGATIVE_CASH = fec([
  line({ journal: "BQ", entry: "1", account: "512000", accountLib: "Banque", credit: "500,00" }),
  line({
    journal: "BQ",
    entry: "1",
    account: "401000",
    accountLib: "Fournisseurs",
    debit: "500,00",
  }),
]);

/** Concours bancaire courant : un passif, pas une trésorerie négative. */
export const OVERDRAFT_ACCOUNT = fec([
  line({
    journal: "BQ",
    entry: "1",
    account: "519000",
    accountLib: "Concours bancaires",
    credit: "800,00",
  }),
  line({ journal: "BQ", entry: "1", account: "512000", accountLib: "Banque", debit: "800,00" }),
]);

/** Compte hors nomenclature reconnue. */
export const UNKNOWN_ACCOUNT_CLASS = fec([
  line({ entry: "1", account: "911000", accountLib: "Compte analytique", debit: "100,00" }),
  line({ entry: "1", account: "912000", accountLib: "Compte analytique", credit: "100,00" }),
]);

/** Format de date non réglementaire. */
export const NON_STANDARD_DATE = fec([
  line({ entry: "1", date: "31/01/2025", account: "411000", debit: "100,00" }),
  line({ entry: "1", date: "31/01/2025", account: "701000", credit: "100,00" }),
]);

/** Génère un FEC volumineux, structurellement conforme et équilibré. */
export function largeFec(entryCount: number): string {
  const lines: string[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    const day = String((index % 28) + 1).padStart(2, "0");
    const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, "0");
    const date = `2025${month}${day}`;
    const value = `${100 + (index % 900)},00`;
    lines.push(
      line({
        journal: "VTE",
        entry: String(index + 1),
        date,
        account: "411000",
        accountLib: "Clients",
        debit: value,
      }),
    );
    lines.push(
      line({
        journal: "VTE",
        entry: String(index + 1),
        date,
        account: "701000",
        accountLib: "Ventes",
        credit: value,
      }),
    );
  }
  return fec(lines);
}
