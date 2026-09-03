/**
 * DÉDUPLICATION DES ÉVÉNEMENTS DE PORTEFEUILLE
 *
 * Elle réutilise le VOCABULAIRE et la DOCTRINE de la déduplication bancaire — mêmes
 * verdicts, même fenêtre de probabilité, même refus d'ériger une ressemblance en identité —
 * avec une clé propre au domaine, parce que l'identité d'un événement de portefeuille n'a
 * pas les mêmes composantes que celle d'une opération bancaire : elle porte l'instrument,
 * la nature et la quantité.
 *
 * L'IDENTITÉ SE DÉMONTRE. Deux achats de 10 parts du même ETF le même jour au même prix
 * peuvent parfaitement être deux ordres réels, passés à dix minutes d'intervalle. Les
 * écarter d'office supprimerait des titres détenus, et le patrimoine serait sous-évalué sans
 * qu'aucune trace ne le dise. Deux preuves seulement autorisent un rejet automatique :
 *
 *   1. l'empreinte du FICHIER déjà validé, contrôlée en amont par la fondation d'import ;
 *   2. une référence d'opération dont la STABILITÉ est DÉCLARÉE pour la session — cherchée
 *      alors dans TOUT l'historique, sans fenêtre de date.
 *
 * Tout le reste est une ressemblance SIGNALÉE, exclue par défaut, écrite sur décision.
 * Aucune contrainte d'unicité ne s'appuie sur une clé de ressemblance.
 */

import { issue } from "@/lib/acquisition/normalization";
import type { ImportDedupeVerdict, ImportIssue } from "@/lib/acquisition/types";

import type { PortfolioEventType } from "./types";

/** Fenêtre, en jours, dans laquelle un même montant devient un doublon PROBABLE. */
export const PROBABLE_EVENT_DAY_WINDOW = 3;

const AMOUNT_SCALE = 6;
const QUANTITY_SCALE = 10;

function amountForm(value: number | null): string {
  return value === null ? "~" : value.toFixed(AMOUNT_SCALE);
}

function quantityForm(value: number | null): string {
  return value === null ? "~" : value.toFixed(QUANTITY_SCALE);
}

/** Candidat issu du fichier en cours d'analyse. */
export interface EventDedupeCandidate {
  rowNumber: number;
  accountId: string;
  securityId: string | null;
  eventType: PortfolioEventType;
  eventDate: string;
  quantity: number | null;
  grossAmount: number | null;
  currency: string;
  /** Référence PRÉTENDUE par la source. Elle ne décide d'une identité que sur déclaration. */
  externalReference: string | null;
}

/** Fait déjà canonique, tel que le ledger le porte. */
export interface ExistingEventFact {
  eventId: string;
  accountId: string;
  securityId: string | null;
  eventType: string;
  eventDate: string;
  quantity: number | null;
  grossAmount: number | null;
  currency: string;
}

/** Identité déjà démontrée, préfixée par la source. */
export interface ExistingEventIdentity {
  externalKey: string;
  eventId: string;
}

export interface EventDedupeOutcome {
  rowNumber: number;
  verdict: ImportDedupeVerdict;
  /** Clé de rapprochement LISIBLE : elle explique, elle ne décide pas. */
  matchKey: string;
  /** Identité démontrée, ou `null`. Seule colonne qui porte une unicité en base. */
  externalKey: string | null;
  matchedEventId: string | null;
  issues: ImportIssue[];
}

/** Clé de ressemblance STRICTE : tous les termes économiques de l'événement. */
function exactKeyOf(candidate: {
  accountId: string;
  securityId: string | null;
  eventType: string;
  eventDate: string;
  quantity: number | null;
  grossAmount: number | null;
  currency: string;
}): string {
  return [
    candidate.accountId,
    candidate.securityId ?? "CASH",
    candidate.eventType,
    candidate.eventDate,
    quantityForm(candidate.quantity),
    amountForm(candidate.grossAmount),
    candidate.currency.toUpperCase(),
  ].join("|");
}

/** Clé sans la date : elle sert la fenêtre de probabilité, jamais un rejet. */
function looseKeyOf(candidate: {
  accountId: string;
  securityId: string | null;
  eventType: string;
  quantity: number | null;
  grossAmount: number | null;
  currency: string;
}): string {
  return [
    candidate.accountId,
    candidate.securityId ?? "CASH",
    candidate.eventType,
    quantityForm(candidate.quantity),
    amountForm(candidate.grossAmount),
    candidate.currency.toUpperCase(),
  ].join("|");
}

export function eventExternalKeyOf(sourceKey: string, reference: string): string {
  return `${sourceKey}#${reference.trim()}`;
}

function daysBetween(left: string, right: string): number {
  const a = Date.parse(`${left}T00:00:00.000Z`);
  const b = Date.parse(`${right}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

export interface EventDedupeInput {
  candidates: readonly EventDedupeCandidate[];
  existingFacts: readonly ExistingEventFact[];
  existingIdentities: readonly ExistingEventIdentity[];
  /** Clé de la source, pour préfixer une identité déclarée. */
  sourceKey: string;
  /**
   * L'utilisateur DÉCLARE-T-IL la référence d'opération comme stable ? Faux par défaut, et
   * ce défaut est le bon : prendre une référence répétée chaque mois pour une identité
   * ferait disparaître des opérations réelles.
   */
  stableReferences: boolean;
}

/**
 * Classe chaque ligne. Ne supprime rien : elle rend un verdict et des anomalies.
 */
export function classifyEventCandidates(input: EventDedupeInput): EventDedupeOutcome[] {
  const identityIndex = new Map(
    input.existingIdentities.map((identity) => [identity.externalKey, identity.eventId]),
  );
  const exactIndex = new Map<string, ExistingEventFact[]>();
  const looseIndex = new Map<string, ExistingEventFact[]>();
  for (const fact of input.existingFacts) {
    const exact = exactKeyOf(fact);
    exactIndex.set(exact, [...(exactIndex.get(exact) ?? []), fact]);
    const loose = looseKeyOf(fact);
    looseIndex.set(loose, [...(looseIndex.get(loose) ?? []), fact]);
  }

  /** Occurrences vues DANS CE FICHIER, pour numéroter les lignes identiques. */
  const seenInFile = new Map<string, number>();
  const outcomes: EventDedupeOutcome[] = [];

  for (const candidate of input.candidates) {
    const issues: ImportIssue[] = [];
    const exact = exactKeyOf(candidate);
    const occurrence = (seenInFile.get(exact) ?? 0) + 1;
    seenInFile.set(exact, occurrence);
    // Le rang est LOCAL au fichier : il numérote les lignes identiques de CE fichier, et ne
    // prétend pas numéroter les événements de l'enveloppe.
    const matchKey = `${exact}#${occurrence}`;

    // 1. Identité DÉMONTRÉE : cherchée dans tout l'historique, sans fenêtre de date.
    if (input.stableReferences && candidate.externalReference !== null) {
      const externalKey = eventExternalKeyOf(input.sourceKey, candidate.externalReference);
      const matched = identityIndex.get(externalKey);
      if (matched !== undefined) {
        outcomes.push({
          rowNumber: candidate.rowNumber,
          verdict: "EXACT_DUPLICATE",
          matchKey,
          externalKey,
          matchedEventId: matched,
          issues: [
            issue(
              "DUPLICATE_EXACT",
              "INFO",
              `Référence « ${candidate.externalReference} » déjà connue : l'opération est déjà écrite. Rejouer le même fichier ne crée donc aucun doublon`,
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
        matchKey,
        externalKey,
        matchedEventId: null,
        issues,
      });
      continue;
    }

    if (candidate.externalReference !== null && !input.stableReferences) {
      issues.push(
        issue(
          "MATCH_WITHOUT_STABLE_ID",
          "INFO",
          `La source fournit la référence « ${candidate.externalReference} », mais sa stabilité n'est pas déclarée : elle ne décide d'aucune identité. Déclarez-la si votre courtier garantit qu'elle ne se répète pas`,
          "externalReference",
          candidate.externalReference,
        ),
      );
    }

    // 2. Doublon dans le FICHIER : deux lignes strictement identiques. C'est un CONFLIT
    // explicite, pas un rejet : deux ordres identiques le même jour existent.
    if (occurrence > 1) {
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "PROBABLE_DUPLICATE",
        matchKey,
        externalKey: null,
        matchedEventId: null,
        issues: [
          ...issues,
          issue(
            "DUPLICATE_PROBABLE",
            "WARNING",
            `Ligne ${occurrence}e occurrence strictement identique dans ce fichier. Deux ordres identiques le même jour peuvent être réels : elle est exclue par défaut, cochez-la pour l'écrire`,
          ),
        ],
      });
      continue;
    }

    // 3. Ressemblance avec un fait DÉJÀ canonique.
    const exactMatches = exactIndex.get(exact) ?? [];
    if (exactMatches.length > 0) {
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "PROBABLE_DUPLICATE",
        matchKey,
        externalKey: null,
        matchedEventId: exactMatches[0].eventId,
        issues: [
          ...issues,
          issue(
            "DUPLICATE_PROBABLE",
            "WARNING",
            "Un événement identique existe déjà dans cette enveloppe. Une égalité de tuple entre deux fichiers ne PROUVE pas qu'il s'agit du même ordre : la ligne est exclue par défaut",
          ),
        ],
      });
      continue;
    }

    const looseMatches = (looseIndex.get(looseKeyOf(candidate)) ?? []).filter(
      (fact) => daysBetween(fact.eventDate, candidate.eventDate) <= PROBABLE_EVENT_DAY_WINDOW,
    );
    if (looseMatches.length > 0) {
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "POSSIBLE_MATCH",
        matchKey,
        externalKey: null,
        matchedEventId: looseMatches[0].eventId,
        issues: [
          ...issues,
          issue(
            "POSSIBLE_MATCH",
            "WARNING",
            `Un événement très proche existe à ${daysBetween(looseMatches[0].eventDate, candidate.eventDate)} jour(s) d'écart. Ce n'est pas une preuve : décidez`,
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
      matchedEventId: null,
      issues,
    });
  }

  return outcomes;
}

/**
 * Déduplication des POSITIONS observées.
 *
 * Elle est plus simple, et pour une raison de fond : une position est une OBSERVATION DATÉE,
 * pas un mouvement. Deux observations du même instrument à la même date dans la même
 * enveloppe sont la même observation — la seconde CORRIGE la première plutôt que de s'y
 * ajouter. C'est l'inverse d'un événement, où deux lignes identiques peuvent être deux faits.
 *
 * C'est aussi ce qui rend l'import INCRÉMENTAL sûr : réimporter un relevé plus récent ajoute
 * une observation à une nouvelle date, sans toucher aux précédentes, et sans jamais supprimer
 * l'historique.
 */
export interface PositionDedupeCandidate {
  rowNumber: number;
  accountId: string;
  securityId: string;
  asOfDate: string;
}

export interface ExistingPositionObservation {
  snapshotId: string;
  accountId: string;
  securityId: string;
  asOfDate: string;
}

export function classifyPositionCandidates(input: {
  candidates: readonly PositionDedupeCandidate[];
  existing: readonly ExistingPositionObservation[];
}): EventDedupeOutcome[] {
  const index = new Map(
    input.existing.map((entry) => [
      `${entry.accountId}|${entry.securityId}|${entry.asOfDate}`,
      entry.snapshotId,
    ]),
  );
  const seenInFile = new Set<string>();
  const outcomes: EventDedupeOutcome[] = [];

  for (const candidate of input.candidates) {
    const key = `${candidate.accountId}|${candidate.securityId}|${candidate.asOfDate}`;
    if (seenInFile.has(key)) {
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "EXACT_DUPLICATE",
        matchKey: key,
        externalKey: null,
        matchedEventId: null,
        issues: [
          issue(
            "DUPLICATE_EXACT",
            "ERROR",
            "Deux observations du même instrument à la même date dans ce fichier : une position est une observation datée, elle ne se cumule pas. Corrigez la source",
          ),
        ],
      });
      continue;
    }
    seenInFile.add(key);

    const existing = index.get(key);
    if (existing !== undefined) {
      outcomes.push({
        rowNumber: candidate.rowNumber,
        verdict: "EXACT_DUPLICATE",
        matchKey: key,
        // L'identité d'une observation EST son triplet : c'est le seul cas du domaine où une
        // égalité de tuple prouve l'identité, parce qu'une observation n'existe qu'une fois
        // par date.
        externalKey: key,
        matchedEventId: existing,
        issues: [
          issue(
            "DUPLICATE_EXACT",
            "INFO",
            "Observation déjà enregistrée à cette date pour cet instrument : rejouer le fichier ne crée aucun doublon",
          ),
        ],
      });
      continue;
    }

    outcomes.push({
      rowNumber: candidate.rowNumber,
      verdict: "NEW",
      matchKey: key,
      externalKey: key,
      matchedEventId: null,
      issues: [],
    });
  }

  return outcomes;
}
