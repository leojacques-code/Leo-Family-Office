import { dueDateOf } from "@/lib/engine/debt";
import type { DebtEvent, Liability } from "@/lib/types";

/**
 * B18 : traduit les événements ACTIFS du journal d'une dette en termes datés que le Debt
 * Engine sait déjà amortir. Fonction pure : aucun montant n'est calculé ici, chaque valeur
 * est celle que l'événement déclare.
 *
 *   * révision de taux, palier, avenant → révisions et paliers datés, marqués de leur
 *     événement : le contrat ne les réabsorbe jamais à l'enregistrement suivant ;
 *   * remboursement anticipé effectué, prévu, solde total → remboursements datés (un prévu
 *     reste une intention) ;
 *   * report d'échéances → période de report ; « durée allongée » ajoute ses échéances au
 *     contrat, la maturité suit ;
 *   * un événement ANNULÉ ne produit plus rien, mais reste dans l'historique.
 *
 * Ordre : à une même date, un événement s'applique après une clause du contrat.
 */
export function withDebtEvents(liability: Liability, events: readonly DebtEvent[]): Liability {
  const own = events.filter((event) => event.liabilityId === liability.id);
  const active = own
    .filter((event) => event.cancellation === null)
    .sort(
      (a, b) =>
        a.effectiveDate.localeCompare(b.effectiveDate) || a.recordedAt.localeCompare(b.recordedAt),
    );
  const rateSchedule = [...(liability.rateSchedule ?? [])];
  const paymentSchedule = [...(liability.paymentSchedule ?? [])];
  const earlyRepayments = [...(liability.earlyRepayments ?? [])];
  const deferralPeriods = [...(liability.deferralPeriods ?? [])];
  const paymentRecalculations = [...(liability.paymentRecalculations ?? [])];
  const unresolvedAmendments = [...(liability.unresolvedAmendments ?? [])];
  let extension = 0;
  // Dernière nouvelle durée déclarée par un avenant, appliquée après les reports.
  let amendedMaturity: {
    eventId: string;
    date: string;
    maturityDate: string;
    payment: boolean;
  } | null = null;

  for (const event of active) {
    const content = event.content;
    const date = event.effectiveDate;
    switch (content.kind) {
      case "RATE_CHANGE":
        rateSchedule.push({
          effectiveFrom: date,
          annualRate: content.annualRate,
          kind: "CONTRACTUAL",
          eventId: event.id,
        });
        break;
      case "PAYMENT_CHANGE":
        paymentSchedule.push({
          effectiveFrom: date,
          amount: content.paymentAmount,
          kind: "CONTRACTUAL",
          eventId: event.id,
        });
        break;
      case "AMENDMENT":
        if (content.annualRate !== null)
          rateSchedule.push({
            effectiveFrom: date,
            annualRate: content.annualRate,
            kind: "CONTRACTUAL",
            eventId: event.id,
          });
        if (content.paymentAmount !== null)
          paymentSchedule.push({
            effectiveFrom: date,
            amount: content.paymentAmount,
            kind: "CONTRACTUAL",
            eventId: event.id,
          });
        if (content.maturityDate !== null)
          amendedMaturity = {
            eventId: event.id,
            date,
            maturityDate: content.maturityDate,
            payment: content.paymentAmount !== null,
          };
        break;
      case "EARLY_REPAYMENT":
        earlyRepayments.push({
          id: event.id,
          liabilityId: liability.id,
          date,
          amount: content.amount,
          penalty: content.penalty,
          outcome: content.outcome,
          eventId: event.id,
          ...(event.nature === "PLANNED" ? { planned: true } : {}),
        });
        break;
      case "FULL_REPAYMENT":
        earlyRepayments.push({
          id: event.id,
          liabilityId: liability.id,
          date,
          amount: content.amount,
          penalty: content.penalty,
          // Le solde total éteint la dette : la convention de réduction n'a plus d'objet.
          outcome: "SHORTEN_TERM",
          eventId: event.id,
        });
        break;
      case "DEFERRAL":
        deferralPeriods.push({
          eventId: event.id,
          startDate: date,
          months: content.months,
          kind: content.deferralKind,
          interestTreatment: content.interestTreatment,
          termEffect: content.termEffect,
        });
        if (content.termEffect === "EXTEND_TERM") extension += content.months;
        break;
    }
  }

  let result: Liability = {
    ...liability,
    rateSchedule,
    paymentSchedule,
    earlyRepayments,
    deferralPeriods,
    paymentRecalculations,
    unresolvedAmendments,
    events: [...own].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)),
  };
  if (Math.trunc(liability.paymentCount) <= 0) return result;
  if (extension > 0) {
    // « Durée allongée » : les échéances reportées s'ajoutent en fin de prêt, déclaré par
    // l'événement. La maturité est celle de la nouvelle dernière échéance.
    const paymentCount = Math.trunc(liability.paymentCount) + extension;
    result = {
      ...result,
      paymentCount,
      maturityDate: dueDateOf({ ...result, paymentCount }, paymentCount),
    };
  }
  if (amendedMaturity) {
    // Nouvelle durée d'un avenant : la dernière échéance DÉCLARÉE doit tomber sur le
    // calendrier des échéances. Hors calendrier, rien n'est arrondi : c'est signalé.
    let rank = 0;
    for (let candidate = 1; candidate <= 1200; candidate += 1) {
      const due = dueDateOf(result, candidate);
      if (due === amendedMaturity.maturityDate) {
        rank = candidate;
        break;
      }
      if (due > amendedMaturity.maturityDate) break;
    }
    if (rank === 0) {
      unresolvedAmendments.push({
        eventId: amendedMaturity.eventId,
        date: amendedMaturity.date,
        maturityDate: amendedMaturity.maturityDate,
      });
    } else {
      result = { ...result, paymentCount: rank, maturityDate: amendedMaturity.maturityDate };
      // Sans nouvelle mensualité déclarée, la mensualité se recalcule à la date d'effet sur
      // la durée restante : c'est ce que « nouvelle durée » signifie pour un amortissable.
      if (!amendedMaturity.payment)
        paymentRecalculations.push({
          eventId: amendedMaturity.eventId,
          date: amendedMaturity.date,
        });
    }
  }
  return result;
}
