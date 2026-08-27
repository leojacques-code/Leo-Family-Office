/**
 * Fixtures SYNTHÉTIQUES de relevés bancaires.
 *
 * Aucune donnée personnelle réelle : ni IBAN, ni nom, ni montant issu d'un vrai compte.
 * Elles reproduisent la STRUCTURE des exports rencontrés (séparateurs, encodages,
 * conventions décimales, colonnes débit/crédit), qui est la seule chose que le parseur ait
 * besoin de connaître.
 */

/** Octets UTF-8 d'un texte. */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Octets UTF-8 précédés du BOM, tel qu'Excel l'écrit. */
export function utf8Bom(text: string): Uint8Array {
  const body = utf8(text);
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

/**
 * Octets Windows-1252 d'un texte dont tous les caractères sont dans la plage Latin-1.
 * Suffisant pour des accents français, qui sont le seul écart réellement rencontré.
 */
export function windows1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code > 0xff) throw new Error(`Caractère hors Windows-1252 : ${text[index]}`);
    out[index] = code;
  }
  return out;
}

/** Format français courant : point-virgule, date jour/mois, virgule décimale, montant signé. */
export const FR_SIGNED = [
  "Date operation;Libelle;Montant;Devise",
  "13/08/2026;CARTE 1208 AMAZON EU;-54,28;EUR",
  "14/08/2026;VIR SEPA LOYER AOUT;-950,00;EUR",
  "29/08/2026;VIR SALAIRE;3 214,57;EUR",
].join("\n");

/** Colonnes débit et crédit séparées, magnitudes positives. */
export const FR_DEBIT_CREDIT = [
  "Date comptable;Date de valeur;Libelle operation;Debit;Credit",
  "13/08/2026;14/08/2026;CARTE 1208 LIBRAIRIE;54,28;",
  "20/08/2026;20/08/2026;REMBOURSEMENT MUTUELLE;;41,90",
].join("\n");

/** Format anglophone : virgule, date ISO, point décimal, référence de transaction. */
export const EN_SIGNED = [
  "Transaction Date,Description,Amount,Currency,Transaction ID",
  "2026-08-13,CARD PURCHASE COFFEE,-3.20,EUR,TX-0001",
  "2026-08-13,CARD PURCHASE COFFEE,-3.20,EUR,TX-0002",
  "2026-08-15,INTEREST PAID,1.05,EUR,TX-0003",
].join("\n");

/** Tabulations, en-tête Excel typique. */
export const TAB_SIGNED = [
  "Date\tLibelle\tMontant",
  "01/07/2026\tPRELEVEMENT ASSURANCE\t-32,10",
  "15/07/2026\tVIR RECU TIERS\t120,00",
].join("\n");

/** Accents, à écrire en Windows-1252 pour éprouver le repli d'encodage. */
export const FR_ACCENTED = [
  "Date operation;Libelle;Montant",
  "05/08/2026;PRÉLÈVEMENT ÉLECTRICITÉ;-84,90",
].join("\n");

/**
 * Fichier « réel » : lignes vides, ligne de solde, montant illisible, date inexistante,
 * doublon interne strict, et une devise non reconnue.
 */
export const MESSY = [
  "Date operation;Libelle;Montant;Devise",
  "13/08/2026;CARTE 1208 AMAZON EU;-54,28;EUR",
  "",
  "13/08/2026;CARTE 1208 AMAZON EU;-54,28;EUR",
  "31/02/2026;OPERATION IMPOSSIBLE;-10,00;EUR",
  "18/08/2026;MONTANT CASSE;abc;EUR",
  "20/08/2026;;-12,00;EUR",
  "Solde au 31/08/2026;Solde;1 234,00;EUR",
  "22/08/2026;VIR RECU REMBOURSEMENT;41,90;EURO",
].join("\n");

/** Toutes les dates sous 13 : l'ordre jour/mois est indécidable. */
export const AMBIGUOUS_DATES = [
  "Date operation;Libelle;Montant",
  "03/04/2026;OPERATION A;-10,00",
  "05/06/2026;OPERATION B;-20,00",
].join("\n");

/** Tous les montants de la forme `1,234` : la convention décimale est indécidable. */
export const AMBIGUOUS_AMOUNTS = [
  "Date operation;Libelle;Montant",
  "13/08/2026;OPERATION A;1,234",
  "20/08/2026;OPERATION B;2,500",
].join("\n");

/** Aucune colonne reconnaissable : le mapping doit être demandé, pas deviné. */
export const UNKNOWN_HEADERS = ["Col1;Col2;Col3", "13/08/2026;QUELQUE CHOSE;-10,00"].join("\n");

/** Colonne obligatoire absente : pas de montant du tout. */
export const NO_AMOUNT_COLUMN = [
  "Date operation;Libelle;Devise",
  "13/08/2026;OPERATION SANS MONTANT;EUR",
].join("\n");

/** Libellé contenant le séparateur, protégé par des guillemets. */
export const QUOTED_LABEL = [
  "Date operation;Libelle;Montant",
  '13/08/2026;"PAIEMENT ; BOUTIQUE";-15,00',
  '14/08/2026;"LIBELLE ""CITE"" INTERNE";-20,00',
].join("\n");

/** Génère un relevé volumineux, structurellement identique à `FR_SIGNED`. */
export function largeStatement(rowCount: number): string {
  const lines = ["Date operation;Libelle;Montant;Devise"];
  for (let index = 0; index < rowCount; index += 1) {
    const day = String((index % 28) + 1).padStart(2, "0");
    const month = String((Math.floor(index / 28) % 12) + 1).padStart(2, "0");
    const amount = (-(index % 900) - 1) / 100;
    lines.push(
      `${day}/${month}/2026;OPERATION ${index};${amount.toFixed(2).replace(".", ",")};EUR`,
    );
  }
  return lines.join("\n");
}
