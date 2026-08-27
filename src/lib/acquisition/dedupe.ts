/**
 * DÉDUPLICATION — reconnaître ce qui existe déjà, sans effacer ce qui existe vraiment.
 *
 * Deux erreurs symétriques sont possibles, et elles ne coûtent pas la même chose. Compter
 * deux fois la même opération fausse le patrimoine et les flux sans laisser de trace
 * visible. Écarter une opération réelle laisse un trou que l'utilisateur voit et peut
 * corriger par un nouvel import. La couche d'acquisition choisit donc, à égalité de doute,
 * de ne PAS écrire, et de le dire.
 *
 * Trois rangs d'identification, du plus fort au plus faible :
 *
 *   1. identifiant stable fourni par la source, préfixé par la source
 *   2. empreinte déterministe (compte, date, montant, devise, libellé) + RANG d'occurrence
 *   3. ressemblance : même montant à quelques jours près, ou même date et même montant
 *      sous un libellé différent
 *
 * Le rang d'occurrence est ce qui distingue « deux fois la même ligne » de « deux
 * opérations réellement identiques ». Deux cafés à 3,20 € le même jour sont deux dépenses :
 * la première porte le rang 1, la seconde le rang 2. Un réimport du même fichier retrouve
 * les deux rangs déjà écrits et n'en crée aucun.
 */

import { labelFingerprintForm } from "@/lib/acquisition/normalization";
import { issue } from "@/lib/acquisition/normalization";
import type {
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
  externalReference: string | null;
}

export interface DedupeOutcome {
  rowNumber: number;
  verdict: ImportDedupeVerdict;
  fingerprint: string;
  externalKey: string | null;
  matchedTransactionId: string | null;
  issues: ImportIssue[];
}

const AMOUNT_SCALE = 6;

function amountForm(amount: number): string {
  return amount.toFixed(AMOUNT_SCALE);
}

/**
 * Clé d'égalité stricte d'une opération. Le libellé y entre sous sa forme comparable :
 * une différence d'accent ou d'espace ne doit pas créer un faux « nouveau » flux, mais un
 * libellé réellement différent reste une opération différente.
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
 * Empreinte persistée. Volontairement LISIBLE plutôt que hachée : elle sert d'unicité en
 * base et de preuve d'audit. Un utilisateur qui demande « pourquoi cette ligne est-elle un
 * doublon ? » doit pouvoir lire la réponse, pas un condensé hexadécimal.
 */
export function fingerprintOf(
  candidate: Parameters<typeof exactKeyOf>[0],
  occurrence: number,
): string {
  return `v1|${exactKeyOf(candidate)}|#${occurrence}`;
}

/** Clé externe qualifiée par sa source : deux banques peuvent utiliser la même référence. */
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
  existing: readonly ExistingTransactionFact[];
  /** Préfixe des clés externes : identifiant de la source, jamais celui de la session. */
  sourceKey: string;
  dayWindow?: number;
}

/**
 * Classe chaque candidat par rapport aux faits déjà canoniques ET aux candidats qui le
 * précèdent dans le même fichier.
 *
 * L'ordre du fichier est significatif : c'est lui qui attribue les rangs d'occurrence, et
 * il doit donc être stable d'un import à l'autre pour que l'idempotence tienne.
 */
export function classifyCandidates(input: DedupeInput): DedupeOutcome[] {
  const window = input.dayWindow ?? PROBABLE_DUPLICATE_DAY_WINDOW;

  const byExternalKey = new Map<string, string>();
  const exactBuckets = new Map<string, string[]>();
  const looseBuckets = new Map<string, Array<{ id: string; date: string }>>();
  const amountDateBuckets = new Map<string, Array<{ id: string; label: string }>>();

  for (const fact of input.existing) {
    if (fact.externalKey) byExternalKey.set(fact.externalKey, fact.id);
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

  const consumedOrdinals = new Map<string, number>();
  const claimedIds = new Set<string>();
  const outcomes: DedupeOutcome[] = [];

  for (const candidate of input.candidates) {
    const exact = exactKeyOf(candidate);
    const ordinalIndex = consumedOrdinals.get(exact) ?? 0;
    consumedOrdinals.set(exact, ordinalIndex + 1);
    const fingerprint = fingerprintOf(candidate, ordinalIndex + 1);
    const externalKey = candidate.externalReference
      ? externalKeyOf(input.sourceKey, candidate.externalReference)
      : null;

    // Rang 1 : un identifiant stable tranche seul, dans les deux sens.
    if (externalKey) {
      const matched = byExternalKey.get(externalKey);
      if (matched) {
        outcomes.push({
          rowNumber: candidate.rowNumber,
          verdict: "EXACT_DUPLICATE",
          fingerprint,
          externalKey,
          matchedTransactionId: matched,
          issues: [
            issue(
              "DUPLICATE_EXACT",
              "INFO",
              "Opération déjà importée : même identifiant de source.",
              "externalReference",
              candidate.externalReference,
            ),
          ],
        });
        continue;
      }
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "NEW",
        fingerprint,
        externalKey,
        matchedTransactionId: null,
        issues: [],
      });
      continue;
    }

    // Rang 2 : égalité stricte au rang d'occurrence près.
    const bucket = exactBuckets.get(exact) ?? [];
    if (ordinalIndex < bucket.length) {
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "EXACT_DUPLICATE",
        fingerprint,
        externalKey: null,
        matchedTransactionId: bucket[ordinalIndex],
        issues: [
          issue(
            "DUPLICATE_EXACT",
            "INFO",
            "Opération identique déjà présente (compte, date, montant, devise, libellé).",
          ),
        ],
      });
      claimedIds.add(bucket[ordinalIndex]);
      continue;
    }

    // Rang 3 : ressemblances. Signalées, jamais écartées d'office.
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
        fingerprint,
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
        fingerprint,
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
      fingerprint,
      externalKey: null,
      matchedTransactionId: null,
      issues: [],
    });
  }

  return outcomes;
}
