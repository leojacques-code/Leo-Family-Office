/**
 * DÉDUPLICATION — reconnaître ce qui existe déjà, sans jamais effacer ce qui existe
 * vraiment.
 *
 * Deux erreurs symétriques sont possibles, et elles ne coûtent pas la même chose. Compter
 * deux fois la même opération fausse le patrimoine et les flux sans laisser de trace
 * visible. Écarter une opération réelle laisse un trou que l'utilisateur voit et peut
 * corriger. La couche d'acquisition choisit donc, à égalité de doute, de ne PAS écrire, et
 * de le dire — mais elle ne se donne jamais le droit de DÉCIDER seule qu'une opération
 * réelle n'existe pas.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE ÉGALITÉ DE TUPLE NE DÉMONTRE PAS UNE IDENTITÉ
 *
 * Historique canonique :
 *
 *     13/08  COFFEE SHOP  -3,20 €
 *     13/08  COFFEE SHOP  -3,20 €
 *
 * Deux opérations réelles. Plus tard, un relevé partiel contient une seule ligne :
 *
 *     13/08  COFFEE SHOP  -3,20 €
 *
 * S'agit-il d'une des deux déjà connues, ou d'un TROISIÈME café réel ? Rien dans le
 * fichier ne permet de le savoir. Un rang d'occurrence calculé sur le fichier candidat ne
 * le dit pas non plus : il compte les lignes de CE fichier, pas les opérations du monde.
 *
 * Conclure `EXACT_DUPLICATE` reviendrait à supprimer une dépense réelle en silence. Cette
 * égalité produit donc `PROBABLE_DUPLICATE` : visible, non écrite par défaut, et
 * écrivable sur décision explicite.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * CE QUI DÉMONTRE UNE IDENTITÉ
 *
 *   1. l'empreinte du FICHIER, au niveau session : un contenu déjà validé pour cette
 *      source est refusé avant même d'arriver ici (invariant de base) ;
 *   2. un identifiant de transaction dont la STABILITÉ est garantie — par le contrat d'un
 *      provider, ou par une déclaration explicite de l'utilisateur pour ce format. Le nom
 *      d'un en-tête ne garantit rien : « Référence » peut être un motif de virement
 *      répété chaque mois.
 *
 * Hors de ces deux cas, aucun verdict automatique ne fait disparaître une ligne.
 */

import { issue, labelFingerprintForm } from "@/lib/acquisition/normalization";
import type {
  ExistingIdentity,
  ExistingTransactionFact,
  ImportDedupeVerdict,
  ImportIssue,
} from "@/lib/acquisition/types";

/** Fenêtre, en jours, dans laquelle un même montant devient un doublon PROBABLE. */
export const PROBABLE_DUPLICATE_DAY_WINDOW = 3;

export interface DedupeCandidate {
  rowNumber: number;
  accountId: string;
  date: string;
  label: string;
  amount: number;
  currency: string;
  /**
   * Identifiant PRÉTENDU par la source. Il ne décide d'une identité que si la stabilité
   * est déclarée pour la session : voir `DedupeInput.stableIdentifiers`.
   */
  externalTransactionId: string | null;
}

export interface DedupeOutcome {
  rowNumber: number;
  verdict: ImportDedupeVerdict;
  /** Clé de rapprochement lisible. Jamais une identité, jamais une contrainte d'unicité. */
  matchKey: string;
  /** Identité démontrée, ou `null`. */
  externalKey: string | null;
  matchedTransactionId: string | null;
  issues: ImportIssue[];
}

const AMOUNT_SCALE = 6;

function amountForm(amount: number): string {
  return amount.toFixed(AMOUNT_SCALE);
}

/**
 * Clé de RESSEMBLANCE stricte d'une opération. Le libellé y entre sous sa forme
 * comparable : une différence d'accent ou d'espace ne doit pas créer un faux « nouveau »
 * flux, mais un libellé réellement différent reste une opération différente.
 */
function exactKeyOf(candidate: {
  accountId: string;
  date: string;
  amount: number;
  currency: string;
  label: string;
}): string {
  return [
    candidate.accountId,
    candidate.date,
    amountForm(candidate.amount),
    candidate.currency.toUpperCase(),
    labelFingerprintForm(candidate.label),
  ].join("|");
}

function looseKeyOf(candidate: {
  accountId: string;
  amount: number;
  currency: string;
  label: string;
}): string {
  return [
    candidate.accountId,
    amountForm(candidate.amount),
    candidate.currency.toUpperCase(),
    labelFingerprintForm(candidate.label),
  ].join("|");
}

function amountDateKeyOf(candidate: {
  accountId: string;
  date: string;
  amount: number;
  currency: string;
}): string {
  return [
    candidate.accountId,
    candidate.date,
    amountForm(candidate.amount),
    candidate.currency.toUpperCase(),
  ].join("|");
}

/**
 * Clé de rapprochement persistée. Volontairement LISIBLE plutôt que hachée : elle sert à
 * expliquer un rapprochement, pas à le décider.
 *
 * Le rang d'occurrence qu'elle porte est LOCAL À L'ANALYSE : il numérote les lignes
 * identiques du fichier courant. Il ne prétend pas numéroter les opérations du compte, et
 * aucune contrainte d'unicité ne s'appuie sur lui — c'était précisément l'erreur qui
 * transformait une ressemblance en identité.
 */
export function matchKeyOf(
  candidate: Parameters<typeof exactKeyOf>[0],
  occurrenceInFile: number,
): string {
  return `v2|${exactKeyOf(candidate)}|~${occurrenceInFile}`;
}

/** Clé d'identité qualifiée par sa source : deux banques peuvent utiliser la même référence. */
export function externalKeyOf(sourceKey: string, reference: string): string {
  return `${sourceKey}#${reference.trim()}`;
}

function dayDistance(left: string, right: string): number {
  const a = Date.parse(`${left}T00:00:00.000Z`);
  const b = Date.parse(`${right}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

export interface DedupeInput {
  candidates: readonly DedupeCandidate[];
  /**
   * Faits canoniques servant à la RESSEMBLANCE. Bornés dans le temps par l'appelant : une
   * ressemblance de date, de montant et de libellé ne se cherche que près du fichier.
   */
  existing: readonly ExistingTransactionFact[];
  /**
   * Identités déjà écrites, cherchées dans TOUT l'historique et sans filtre de date.
   *
   * Une identité stable ne se périme pas : une opération réimportée dont la banque a corrigé
   * la date de deux mois reste la même opération, et son identifiant doit la retrouver.
   */
  identities: readonly ExistingIdentity[];
  /** Préfixe des clés d'identité : identifiant de la source, jamais celui de la session. */
  sourceKey: string;
  /**
   * La source garantit-elle que `externalTransactionId` est un identifiant STABLE et
   * unique ? `false` par défaut, et `false` pour un CSV bancaire générique : aucun nom
   * d'en-tête ne prouve la stabilité. Seule une déclaration explicite l'établit.
   */
  stableIdentifiers: boolean;
  dayWindow?: number;
}

/**
 * Classe chaque candidat par rapport aux faits déjà canoniques ET aux candidats qui le
 * précèdent dans le même fichier.
 */
export function classifyCandidates(input: DedupeInput): DedupeOutcome[] {
  const window = input.dayWindow ?? PROBABLE_DUPLICATE_DAY_WINDOW;

  // Index d'IDENTITÉ : global, sans date. Index de RESSEMBLANCE : borné par l'appelant.
  const byExternalKey = new Map<string, string>(
    input.identities.map((identity) => [identity.externalKey, identity.transactionId]),
  );
  const exactBuckets = new Map<string, string[]>();
  const looseBuckets = new Map<string, Array<{ id: string; date: string }>>();
  const amountDateBuckets = new Map<string, Array<{ id: string; label: string }>>();

  for (const fact of input.existing) {
    const exact = exactKeyOf(fact);
    const bucket = exactBuckets.get(exact) ?? [];
    bucket.push(fact.id);
    exactBuckets.set(exact, bucket);

    const loose = looseKeyOf(fact);
    const looseBucket = looseBuckets.get(loose) ?? [];
    looseBucket.push({ id: fact.id, date: fact.date });
    looseBuckets.set(loose, looseBucket);

    const amountDate = amountDateKeyOf(fact);
    const amountDateBucket = amountDateBuckets.get(amountDate) ?? [];
    amountDateBucket.push({ id: fact.id, label: fact.label });
    amountDateBuckets.set(amountDate, amountDateBucket);
  }

  const occurrencesInFile = new Map<string, number>();
  const claimedIds = new Set<string>();
  const claimedExternalKeys = new Set<string>();
  const outcomes: DedupeOutcome[] = [];

  for (const candidate of input.candidates) {
    const exact = exactKeyOf(candidate);
    const occurrence = (occurrencesInFile.get(exact) ?? 0) + 1;
    occurrencesInFile.set(exact, occurrence);
    const matchKey = matchKeyOf(candidate, occurrence);

    // ── Identité DÉMONTRÉE : le seul chemin vers un rejet automatique ────────────────
    if (input.stableIdentifiers && candidate.externalTransactionId) {
      const externalKey = externalKeyOf(input.sourceKey, candidate.externalTransactionId);
      const matched = byExternalKey.get(externalKey);
      if (matched) {
        outcomes.push({
          rowNumber: candidate.rowNumber,
          verdict: "EXACT_DUPLICATE",
          matchKey,
          externalKey,
          matchedTransactionId: matched,
          issues: [
            issue(
              "DUPLICATE_EXACT",
              "INFO",
              "Opération déjà importée : même identifiant stable de source.",
              "externalTransactionId",
              candidate.externalTransactionId,
            ),
          ],
        });
        continue;
      }
      // La source se contredit : le même identifiant stable deux fois dans un fichier ne
      // peut pas désigner deux opérations. La seconde ligne n'est pas écrite.
      if (claimedExternalKeys.has(externalKey)) {
        outcomes.push({
          rowNumber: candidate.rowNumber,
          verdict: "EXACT_DUPLICATE",
          matchKey,
          externalKey,
          matchedTransactionId: null,
          issues: [
            issue(
              "DUPLICATE_EXACT",
              "WARNING",
              "Cet identifiant stable apparaît déjà plus haut dans le fichier : il ne peut pas désigner deux opérations.",
              "externalTransactionId",
              candidate.externalTransactionId,
            ),
          ],
        });
        continue;
      }
      claimedExternalKeys.add(externalKey);
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "NEW",
        matchKey,
        externalKey,
        matchedTransactionId: null,
        issues: [],
      });
      continue;
    }

    // ── Aucune identité démontrée : au mieux une ressemblance ────────────────────────
    //
    // Une opération déjà connue portant exactement le même tuple est un candidat de
    // rapprochement fort, jamais une preuve. Chaque opération existante n'est revendiquée
    // qu'une fois : trois lignes identiques face à deux opérations connues rapprochent les
    // deux premières et laissent la troisième NOUVELLE, parce qu'aucune opération connue
    // ne peut plus l'expliquer.
    const bucket = exactBuckets.get(exact) ?? [];
    const available = bucket.find((id) => !claimedIds.has(id));
    if (available) {
      claimedIds.add(available);
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "PROBABLE_DUPLICATE",
        matchKey,
        externalKey: null,
        matchedTransactionId: available,
        issues: [
          issue(
            "MATCH_WITHOUT_STABLE_ID",
            "WARNING",
            "Une opération identique existe déjà (compte, date, montant, devise, libellé). Sans identifiant stable, il est impossible de prouver qu'il s'agit de la même : confirmer pour l'écrire quand même.",
          ),
        ],
      });
      continue;
    }

    const looseBucket = looseBuckets.get(looseKeyOf(candidate)) ?? [];
    const near = looseBucket.find(
      (entry) =>
        !claimedIds.has(entry.id) &&
        entry.date !== candidate.date &&
        dayDistance(entry.date, candidate.date) <= window,
    );
    if (near) {
      claimedIds.add(near.id);
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "PROBABLE_DUPLICATE",
        matchKey,
        externalKey: null,
        matchedTransactionId: near.id,
        issues: [
          issue(
            "DUPLICATE_PROBABLE",
            "WARNING",
            `Même montant et même libellé qu'une opération du ${near.date} : date d'opération ou date de valeur ? À confirmer avant écriture.`,
          ),
        ],
      });
      continue;
    }

    const sameAmountDate = (amountDateBuckets.get(amountDateKeyOf(candidate)) ?? []).find(
      (entry) =>
        !claimedIds.has(entry.id) &&
        labelFingerprintForm(entry.label) !== labelFingerprintForm(candidate.label),
    );
    if (sameAmountDate) {
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "POSSIBLE_MATCH",
        matchKey,
        externalKey: null,
        matchedTransactionId: sameAmountDate.id,
        issues: [
          issue(
            "POSSIBLE_MATCH",
            "WARNING",
            `Une opération du même jour et du même montant existe sous le libellé « ${sameAmountDate.label} ». Deux opérations réelles ou une seule ?`,
          ),
        ],
      });
      continue;
    }

    outcomes.push({
      rowNumber: candidate.rowNumber,
      verdict: "NEW",
      matchKey,
      externalKey: null,
      matchedTransactionId: null,
      issues: [],
    });
  }

  return outcomes;
}
