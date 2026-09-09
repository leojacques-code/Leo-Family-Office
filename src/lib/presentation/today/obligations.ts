import type { CanonicalEvent } from "@/lib/engine/event-contracts";
import {
  canonicalDataKindLabel,
  eventDomainLabel,
  eventTypeLabel,
} from "@/lib/presentation/language/events";
import type { ObligationView } from "./contracts";

/**
 * Les échéances à trente jours (§20 item 6 : « prochaines échéances contractuelles à
 * 30 jours »).
 *
 * LA FENÊTRE EST EXACTEMENT TRENTE JOURS, et elle est calculée en jours calendaires depuis la
 * date d'arrêté, bornes incluses. Ce n'est pas « le mois prochain » : un arrêté au 20 du mois
 * verrait sinon disparaître une échéance du 25 du mois suivant, qui tombe pourtant dans les
 * trente jours.
 *
 * CONTRACTUEL ≠ PROJETÉ, et le §20 dit « contractuelles ». Une conséquence dérivée d'une
 * récurrence non confirmée n'est PAS une échéance : le registre des KPI l'écrit sous
 * `upcoming_obligations_30d`, « une échéance est CONTRACTUELLE ou déclarée : elle n'est jamais
 * déduite d'une récurrence non confirmée ». Les événements `PROJECTED`, `USER_ASSUMPTION` et
 * `MODEL_ASSUMPTION` sont donc exclus, et leur exclusion est le contenu du filtre ci-dessous.
 */

export const OBLIGATION_WINDOW_DAYS = 30;

/**
 * Natures de preuve admises.
 *
 * `PROJECTED`, `USER_ASSUMPTION` et `MODEL_ASSUMPTION` sont exclus : une hypothèse n'est pas
 * une échéance, et le registre des KPI l'écrit sous `upcoming_obligations_30d`. `OBSERVED` est
 * admis parce que le moteur d'événements qualifie ainsi une échéance issue d'un échéancier
 * FOURNI — la pièce existe, elle est datée, et c'est un fait.
 */
const ADMITTED_DATA_KINDS = new Set<CanonicalEvent["dataKind"]>(["OBSERVED", "CONTRACTUAL"]);

/**
 * Types d'événement qui CONSTITUENT une échéance datée.
 *
 * LA LISTE EST CLOSE ET ÉCRITE, pas déduite. Le §16 interdit à un agent de décider « si une
 * anomalie est assez importante pour alerter », et décider ce qui « tombe dans les trente
 * jours » est la même sorte de décision. Le registre canonique porte soixante-et-un types ;
 * ceux-ci sont les engagements datés, les autres sont des mouvements, des changements d'état
 * ou des projections.
 *
 * `OBSERVED_TRANSACTION` EN EST EXCLU, et c'est le défaut que le jeu de démonstration a fait
 * apparaître. Un filtre par seule nature de preuve laissait passer les opérations bancaires
 * déjà comptabilisées : la page annonçait « Opération observée · Flux · 34 € » comme une
 * échéance à venir, trois fois de suite. Une opération bookée n'est pas un engagement — elle
 * a déjà eu lieu, et la faire figurer dans les échéances double la lecture du mois que le
 * ruban du canvas donne déjà.
 *
 * NATURE DE PREUVE ≠ NATURE D'ÉVÉNEMENT : la première dit si l'on peut se fier à la date, la
 * seconde si l'objet est une échéance. Les deux filtres sont nécessaires et aucun ne remplace
 * l'autre.
 */
const OBLIGATION_EVENT_TYPES = new Set<CanonicalEvent["type"]>([
  // Dette : ce que le contrat impose, et les dates auxquelles il change.
  "LOAN_PAYMENT",
  "RATE_CHANGE",
  "PAYMENT_CHANGE",
  "DEFERRAL_START",
  "DEFERRAL_END",
  "LOAN_END",
  // Fiscalité : ce qu'il faut payer ou déclarer. Un changement de RÈGLE n'est pas une échéance
  // de l'utilisateur, il n'y figure donc pas.
  "TAX_PAYMENT",
  "TAX_ASSESSMENT",
  // Immobilier : les dates du bail, de la taxe, des travaux engagés et de l'assurance.
  "PROPERTY_TAX",
  "LEASE_END",
  "RENT_CHANGE",
  "WORKS_PAYMENT",
  "INSURANCE_CHANGE",
  // Placements : un appel de capital est une obligation contractuelle. Un achat, une vente, un
  // dividende ou un versement sont des mouvements, pas des engagements.
  "CAPITAL_CALL",
  // Revenus : la fin d'un contrat est une date contractuelle qui change les encaissements.
  "EMPLOYMENT_END",
]);

/** Ajoute des jours à une date ISO, sans dépendre du fuseau local. */
function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const base = Date.UTC(year!, month! - 1, day!);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Montant attendu d'une échéance, ou `null`.
 *
 * Il est LU dans les conséquences mensuelles de l'événement, jamais reconstruit : une sortie de
 * trésorerie y est déjà décomposée par le moteur. Une conséquence dont la sortie est `null`
 * laisse le montant inconnu — le §20 interdit de le remplacer par zéro, et une échéance sans
 * montant connu existe parfaitement (une fin de bail, une expiration d'assurance).
 *
 * Les montants sont additionnés SEULEMENT s'ils partagent une devise. Une échéance mêlant deux
 * devises rend `null` : FX ABSENT ≠ FX ÉGAL À 1, et Aujourd'hui n'a pas à convertir ce que le
 * moteur de change n'a pas converti.
 */
function expectedAmount(event: CanonicalEvent, reportingCurrency: string): number | null {
  const consequences = event.consequences ?? [];
  if (consequences.length === 0) return null;
  if (consequences.some((consequence) => consequence.currency !== reportingCurrency)) return null;
  if (consequences.some((item) => item.cashOut === null || item.cashIn === null)) return null;
  let total = 0;
  let known = false;
  for (const consequence of consequences) {
    if (consequence.cashOut !== null) {
      total += consequence.cashOut;
      known = true;
    }
    if (consequence.cashIn !== null) {
      total -= consequence.cashIn;
      known = true;
    }
  }
  return known ? total : null;
}

export interface BuildObligationsInput {
  readonly events: readonly CanonicalEvent[];
  readonly asOfDate: string;
  readonly reportingCurrency: string;
  /** Nombre maximum d'échéances rendues. Le reste est atteignable depuis l'Activité. */
  readonly limit?: number;
}

export function buildObligations(input: BuildObligationsInput): ObligationView[] {
  const horizon = addDays(input.asOfDate, OBLIGATION_WINDOW_DAYS);
  return input.events
    .filter(
      (event) =>
        event.effectiveDate >= input.asOfDate &&
        event.effectiveDate <= horizon &&
        // Un événement annulé ou remplacé n'est pas une échéance : il a cessé d'être vrai.
        event.status !== "CANCELLED" &&
        event.status !== "SUPERSEDED" &&
        OBLIGATION_EVENT_TYPES.has(event.type) &&
        ADMITTED_DATA_KINDS.has(event.dataKind),
    )
    .sort(
      (left, right) =>
        left.effectiveDate.localeCompare(right.effectiveDate) ||
        left.sequence - right.sequence ||
        left.id.localeCompare(right.id),
    )
    .slice(0, input.limit ?? 6)
    .map((event) => ({
      id: event.id,
      date: event.effectiveDate,
      // Le libellé vient du traducteur central. `type.replaceAll("_", " ")` rendait
      // « RENT RECEIPT » : un code anglais sans ses soulignés n'est pas du français.
      label: eventTypeLabel(event.type),
      domainLabel: eventDomainLabel(event.domain),
      amount: expectedAmount(event, input.reportingCurrency),
      evidenceLabel: canonicalDataKindLabel(event.dataKind),
    }));
}
