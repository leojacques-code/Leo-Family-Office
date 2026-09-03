/**
 * OPEN BANKING — IDENTITÉ, CYCLE DE VIE ET RÉCONCILIATION VERS LE CASH FLOW
 *
 * Fonctions pures. C'est ici que se joue le risque le plus coûteux du domaine : un double
 * comptage fausse le patrimoine sans laisser de trace, là où une opération manquante laisse
 * un trou visible.
 *
 * ```text
 * IDENTIFIANT FOURNI ≠ IDENTITÉ DÉMONTRÉE      RESSEMBLANCE ≠ DOUBLON
 * PENDING ≠ BOOKED                             REMPLACEMENT DÉCLARÉ ≠ REMPLACEMENT DEVINÉ
 * OBSERVATION ≠ FAIT CANONIQUE                 DÉCISION PRISE ≠ DÉCISION À REPRENDRE
 * ```
 *
 * L'IDENTITÉ SE DÉMONTRE. Deux preuves seulement autorisent un rejet automatique :
 *
 *   1. l'empreinte d'une PAGE déjà persistée — traitée par la pagination ;
 *   2. un identifiant de transaction dont la STABILITÉ EST DÉCLARÉE par l'adaptateur,
 *      cherché dans TOUT l'historique, sans aucun filtre de date.
 *
 * Tout le reste est une ressemblance SIGNALÉE, exclue par défaut, écrite sur décision
 * explicite. Deux virements de 50 € le même jour au même bénéficiaire peuvent être deux
 * virements réels.
 */
import type { ImportIssueCode, ImportIssueSeverity, ImportRowStatus } from "../types";
import type { ExistingIdentity, ExistingTransactionFact, ImportDedupeVerdict } from "../types";
import { foldLabel } from "./normalize";
import type { NormalizedObservation } from "./normalize";
import type { BankSyncIssue } from "./types";

/** Fenêtre de RESSEMBLANCE, en jours. Une ressemblance ne se cherche qu'au voisinage. */
export const PROBABLE_DUPLICATE_DAY_WINDOW = 3;

/** Décision humaine durable sur une observation. Elle survit à toutes les synchronisations. */
export const BANK_RECONCILIATION_DECISIONS = ["ACCEPT_NEW", "LINK_EXISTING", "REFUSE"] as const;
export type BankReconciliationDecision = (typeof BANK_RECONCILIATION_DECISIONS)[number];

/**
 * Observation déjà connue en base, avec ce qu'elle est devenue.
 *
 * `decision` porte la décision HUMAINE déjà prise. Une décision prise ne se redemande pas à
 * la synchronisation suivante, et surtout : une observation déjà écrite au canonique ne
 * peut plus être proposée une seconde fois.
 */
export interface KnownObservation {
  id: string;
  externalKey: string | null;
  matchKey: string | null;
  providerTransactionId: string | null;
  providerAccountId: string;
  operationDate: string | null;
  amount: number | null;
  currency: string | null;
  state: string;
  decision: BankReconciliationDecision | null;
  /** Transaction canonique déjà produite par cette observation, s'il y en a une. */
  transactionId: string | null;
}

export interface ReconcileInput {
  observations: readonly NormalizedObservation[];
  /** Observations déjà persistées pour ce compte fournisseur, TOUT l'historique. */
  known: readonly KnownObservation[];
  /**
   * Identités canoniques déjà écrites, tout l'historique, aucun filtre de date. Une
   * identité stable ne se périme pas ; la borner à une fenêtre ferait échouer le commit sur
   * l'index unique après avoir annoncé « nouvelle ».
   */
  identities: readonly ExistingIdentity[];
  /** Transactions canoniques du voisinage, pour la RESSEMBLANCE seule. */
  existing: readonly ExistingTransactionFact[];
  /** L'adaptateur déclare-t-il ses identifiants de transaction stables ? */
  stableTransactionIds: boolean;
}

export interface ReconcileOutcome {
  observation: NormalizedObservation;
  verdict: ImportDedupeVerdict | null;
  status: ImportRowStatus;
  /** Transaction canonique désignée comme jumelle, sans preuve d'identité. */
  matchedTransactionId: string | null;
  /** Observation antérieure que celle-ci REMPLACE, quand le remplacement est prouvé. */
  replacesObservationId: string | null;
  /** Décision humaine déjà prise qui s'applique à cette observation. */
  appliedDecision: BankReconciliationDecision | null;
  issues: BankSyncIssue[];
}

function issue(
  code: ImportIssueCode,
  severity: ImportIssueSeverity,
  message: string,
  field: string | null = null,
  sourceValue: string | null = null,
): BankSyncIssue {
  return { code, severity, field, sourceValue, message };
}

function dayDistance(left: string, right: string): number {
  const a = Date.parse(`${left}T00:00:00Z`);
  const b = Date.parse(`${right}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

/**
 * Classe chaque observation d'une synchronisation.
 *
 * L'ordre des contrôles n'est pas arbitraire : il va de la preuve la plus forte à la plus
 * faible, et s'arrête à la première. Inverser cet ordre ferait qualifier de « ressemblance »
 * une identité démontrée, donc laisserait écrire deux fois la même opération.
 */
export function reconcileObservations(input: ReconcileInput): ReconcileOutcome[] {
  const identityIndex = new Map(input.identities.map((entry) => [entry.externalKey, entry]));
  const knownByExternalKey = new Map<string, KnownObservation>();
  const knownByProviderId = new Map<string, KnownObservation>();
  for (const entry of input.known) {
    if (entry.externalKey !== null) knownByExternalKey.set(entry.externalKey, entry);
    if (entry.providerTransactionId !== null) {
      knownByProviderId.set(entry.providerTransactionId, entry);
    }
  }

  // Chaque transaction canonique connue n'est revendiquée qu'UNE fois : trois observations
  // identiques face à deux transactions connues en rapprochent deux et laissent la
  // troisième NOUVELLE. Sans cela, la troisième dépense réelle disparaîtrait.
  const claimed = new Set<string>();
  // Même règle à l'intérieur de la synchronisation : deux observations identiques dans la
  // même lecture sont deux opérations, sauf identité démontrée.
  const seenExternalKeys = new Set<string>();

  return input.observations.map((observation) => {
    const issues: BankSyncIssue[] = [];
    let verdict: ImportDedupeVerdict | null = null;
    let status: ImportRowStatus = observation.status;
    let matchedTransactionId: string | null = null;
    let replacesObservationId: string | null = null;
    let appliedDecision: BankReconciliationDecision | null = null;

    // Une observation illisible n'a pas d'identité : la déduplication n'est PAS évaluée.
    // `null` ne veut pas dire « nouvelle ».
    if (observation.status === "BLOCKED") {
      return {
        observation,
        verdict: null,
        status,
        matchedTransactionId,
        replacesObservationId,
        appliedDecision,
        issues,
      };
    }

    // ── 1. Décision humaine déjà prise sur CETTE observation ──────────────────────────
    const previous =
      observation.externalKey !== null
        ? knownByExternalKey.get(observation.externalKey)
        : observation.providerTransactionId !== null
          ? knownByProviderId.get(observation.providerTransactionId)
          : undefined;

    if (previous !== undefined && previous.decision !== null) {
      appliedDecision = previous.decision;
      if (previous.transactionId !== null || previous.decision === "REFUSE") {
        verdict = "EXACT_DUPLICATE";
        status = previous.decision === "REFUSE" ? "IGNORED" : "DUPLICATE";
        issues.push(
          issue(
            "BANK_RECONCILIATION_DECIDED",
            "INFO",
            previous.decision === "REFUSE"
              ? "Observation déjà REFUSÉE par une décision humaine. Elle n'est pas reproposée : une décision prise ne se redemande pas à chaque synchronisation."
              : "Observation déjà écrite au canonique sur décision humaine. Elle n'est jamais reproposée : ce serait le double comptage.",
            "decision",
            previous.decision,
          ),
        );
        matchedTransactionId = previous.transactionId;
        return {
          observation,
          verdict,
          status,
          matchedTransactionId,
          replacesObservationId,
          appliedDecision,
          issues,
        };
      }
    }

    // ── 2. Identité DÉMONTRÉE, cherchée dans TOUT l'historique canonique ──────────────
    if (observation.externalKey !== null) {
      if (seenExternalKeys.has(observation.externalKey)) {
        verdict = "EXACT_DUPLICATE";
        status = "DUPLICATE";
        issues.push(
          issue(
            "DUPLICATE_EXACT",
            "WARNING",
            "Identifiant stable RÉPÉTÉ dans la même synchronisation. Le fournisseur a rendu deux fois la même opération.",
            "providerTransactionId",
            observation.providerTransactionId,
          ),
        );
        return {
          observation,
          verdict,
          status,
          matchedTransactionId,
          replacesObservationId,
          appliedDecision,
          issues,
        };
      }
      seenExternalKeys.add(observation.externalKey);

      const identity = identityIndex.get(observation.externalKey);
      if (identity !== undefined) {
        verdict = "EXACT_DUPLICATE";
        status = "DUPLICATE";
        matchedTransactionId = identity.transactionId;
        issues.push(
          issue(
            "DUPLICATE_EXACT",
            "INFO",
            "Identité DÉMONTRÉE déjà écrite au canonique. Recherche menée sur tout l'historique, sans filtre de date : une identité stable ne se périme pas.",
            "providerTransactionId",
            observation.providerTransactionId,
          ),
        );
        return {
          observation,
          verdict,
          status,
          matchedTransactionId,
          replacesObservationId,
          appliedDecision,
          issues,
        };
      }
    }

    // ── 3. Remplacement PENDING → BOOKED ──────────────────────────────────────────────
    //
    // Le seul remplacement automatique accepté est celui que le FOURNISSEUR déclare, par
    // l'identifiant de l'opération remplacée, et seulement s'il déclare ses identifiants
    // stables. Deviner un remplacement à la ressemblance ferait disparaître une opération
    // réelle le jour où deux montants identiques coexistent.
    if (observation.replacesProviderTransactionId !== null) {
      const replaced = knownByProviderId.get(observation.replacesProviderTransactionId);
      if (replaced === undefined) {
        issues.push(
          issue(
            "BANK_PENDING_REPLACEMENT_UNPROVEN",
            "WARNING",
            "Le fournisseur déclare remplacer une opération inconnue de l'historique. Aucune observation n'est retirée : rien ne prouve laquelle.",
            "replacesProviderTransactionId",
            observation.replacesProviderTransactionId,
          ),
        );
      } else if (!input.stableTransactionIds) {
        issues.push(
          issue(
            "BANK_PENDING_REPLACEMENT_UNPROVEN",
            "WARNING",
            "Remplacement déclaré par un fournisseur qui ne garantit PAS ses identifiants stables. Il est signalé et non appliqué : un identifiant réattribué ferait disparaître la mauvaise opération.",
            "replacesProviderTransactionId",
            observation.replacesProviderTransactionId,
          ),
        );
      } else {
        replacesObservationId = replaced.id;
        if (replaced.transactionId !== null) {
          // L'opération en attente avait déjà été écrite : c'est une CORRECTION du fait
          // canonique, pas une nouvelle dépense. Elle est signalée et laissée à décision.
          verdict = "POSSIBLE_MATCH";
          status = "WARNING";
          matchedTransactionId = replaced.transactionId;
          issues.push(
            issue(
              "BANK_TRANSACTION_CORRECTED",
              "WARNING",
              "Cette opération comptabilisée remplace une opération en attente DÉJÀ écrite au canonique. L'écrire à nouveau doublerait la dépense : la décision porte sur la correction du fait existant.",
              "replacesProviderTransactionId",
              observation.replacesProviderTransactionId,
            ),
          );
          return {
            observation,
            verdict,
            status,
            matchedTransactionId,
            replacesObservationId,
            appliedDecision,
            issues,
          };
        }
      }
    }

    // ── 4. RESSEMBLANCE, dans une fenêtre, jamais une preuve ──────────────────────────
    if (
      observation.operationDate !== null &&
      observation.amount !== null &&
      observation.currency !== null
    ) {
      const label = foldLabel(observation.label);
      const sameDayIdentical = input.existing.find(
        (candidate) =>
          !claimed.has(candidate.id) &&
          candidate.date === observation.operationDate &&
          candidate.amount === observation.amount &&
          candidate.currency === observation.currency &&
          foldLabel(candidate.label) === label,
      );
      if (sameDayIdentical !== undefined) {
        claimed.add(sameDayIdentical.id);
        verdict = "PROBABLE_DUPLICATE";
        status = "WARNING";
        matchedTransactionId = sameDayIdentical.id;
        issues.push(
          issue(
            "DUPLICATE_PROBABLE",
            "WARNING",
            "Opération identique à une transaction déjà connue, mais AUCUNE identité ne le démontre. Exclue par défaut, écrivable sur décision : deux dépenses identiques le même jour peuvent être réelles.",
            "matchKey",
            observation.matchKey,
          ),
        );
      } else {
        const nearby = input.existing.find(
          (candidate) =>
            !claimed.has(candidate.id) &&
            candidate.amount === observation.amount &&
            candidate.currency === observation.currency &&
            foldLabel(candidate.label) === label &&
            dayDistance(candidate.date, observation.operationDate as string) <=
              PROBABLE_DUPLICATE_DAY_WINDOW,
        );
        if (nearby !== undefined) {
          claimed.add(nearby.id);
          verdict = "PROBABLE_DUPLICATE";
          status = "WARNING";
          matchedTransactionId = nearby.id;
          issues.push(
            issue(
              "DUPLICATE_PROBABLE",
              "WARNING",
              `Même montant et même libellé à moins de ${PROBABLE_DUPLICATE_DAY_WINDOW} jours d'une transaction connue. Une banque peut décaler une date de deux jours : c'est signalé, jamais tranché d'office.`,
              "matchKey",
              observation.matchKey,
            ),
          );
        } else {
          const sameAmountOtherLabel = input.existing.find(
            (candidate) =>
              !claimed.has(candidate.id) &&
              candidate.date === observation.operationDate &&
              candidate.amount === observation.amount &&
              candidate.currency === observation.currency,
          );
          if (sameAmountOtherLabel !== undefined) {
            claimed.add(sameAmountOtherLabel.id);
            verdict = "POSSIBLE_MATCH";
            status = "WARNING";
            matchedTransactionId = sameAmountOtherLabel.id;
            issues.push(
              issue(
                "POSSIBLE_MATCH",
                "WARNING",
                "Même date et même montant sous un libellé différent. Rapprochement POSSIBLE, jamais présumé.",
                "matchKey",
                observation.matchKey,
              ),
            );
          } else {
            verdict = "NEW";
          }
        }
      }
    }

    // Une opération en attente reste `WARNING` même déclarée nouvelle : elle est
    // committable sur décision, jamais d'office.
    if (observation.state === "PENDING" && status === "READY") status = "WARNING";

    if (verdict === null && status !== "BLOCKED") {
      issues.push(
        issue(
          "MATCH_WITHOUT_STABLE_ID",
          "INFO",
          "Déduplication NON ÉVALUÉE : il manque une date, un montant ou une devise pour construire la moindre clé. Ce n'est pas « nouvelle ».",
          "matchKey",
          null,
        ),
      );
    }

    return {
      observation,
      verdict,
      status,
      matchedTransactionId,
      replacesObservationId,
      appliedDecision,
      issues,
    };
  });
}
