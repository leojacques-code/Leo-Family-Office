import { describe, expect, it } from "vitest";
import {
  buildContractualSchedule,
  buildForwardSchedule,
  buildLoanTimeline,
  resolveContractTerms,
  UNDECLARED_LOAN_TERMS,
} from "@/lib/engine/debt";
import { withDebtEvents } from "@/lib/engine/debt-events";
import type { DebtEvent, DebtEventContent, Liability } from "@/lib/types";

// Oracles recomputés à la main : 1 200 € à taux nul, 12 × 100 € à partir du 5 janvier 2027.
const loan: Liability = resolveContractTerms(
  {
    ...UNDECLARED_LOAN_TERMS,
    id: "loan",
    name: "Prêt",
    lender: "Banque",
    principal: 1200,
    currentBalance: 1200,
    balanceDate: "2026-12-01",
    annualRate: 0,
    monthlyPayment: 0,
    paymentCount: 0,
    firstPaymentDate: "2027-01-05",
    maturityDate: "",
    recurringFees: 0,
    insuranceMode: "NONE",
    paymentIncludesInsurance: false,
    provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH" },
  },
  { monthlyPayment: 100, paymentCount: 12, maturityDate: null },
);

let sequence = 0;
function event(
  content: DebtEventContent,
  effectiveDate: string,
  overrides: Partial<DebtEvent> = {},
): DebtEvent {
  sequence += 1;
  return {
    id: `event-${sequence}`,
    liabilityId: "loan",
    nature:
      content.kind === "EARLY_REPAYMENT" || content.kind === "FULL_REPAYMENT"
        ? "OBSERVED"
        : "CONTRACTUAL",
    effectiveDate,
    source: "Test",
    content,
    observationId: null,
    recordedAt: `2026-12-01T00:00:0${sequence % 10}Z`,
    cancellation: null,
    ...overrides,
  };
}
const payments = (liability: Liability) =>
  buildContractualSchedule(liability).entries.filter((row) => row.entryKind === "PAYMENT");

describe("B18 : événements de dette traduits pour le Debt Engine", () => {
  it("applique une révision de taux à sa date, garde la mensualité et le dit", () => {
    const revised = withDebtEvents({ ...loan, principal: 12000, currentBalance: 12000 }, [
      event({ kind: "RATE_CHANGE", annualRate: 0.12 }, "2027-04-05"),
    ]);
    const rows = payments(revised);
    // Avant la révision : taux nul. À partir du 5 avril 2027 : 1 % par mois.
    expect(rows[2]!.interest).toBe(0);
    expect(rows[3]!.interest).toBeGreaterThan(0);
    expect(rows[3]!.totalCashOut).toBeCloseTo(100, 6);
    const codes = buildLoanTimeline(revised, "2026-12-01").flags.map((flag) => flag.code);
    expect(codes).toContain("RATE_REVISION_PAYMENT_KEPT");
  });

  it("un avenant qui déclare taux ET mensualité ne suppose rien", () => {
    const amended = withDebtEvents(loan, [
      event(
        { kind: "AMENDMENT", annualRate: 0, paymentAmount: 50, maturityDate: null, note: null },
        "2027-07-05",
      ),
    ]);
    const rows = payments(amended);
    expect(rows[5]!.principal).toBeCloseTo(100, 6);
    expect(rows[6]!.principal).toBeCloseTo(50, 6);
    const codes = buildLoanTimeline(amended, "2026-12-01").flags.map((flag) => flag.code);
    expect(codes).not.toContain("RATE_REVISION_PAYMENT_KEPT");
  });

  it("un événement annulé ne produit plus rien mais reste dans l'historique", () => {
    const cancelled = event({ kind: "PAYMENT_CHANGE", paymentAmount: 50 }, "2027-03-05", {
      cancellation: { reason: "Erreur de dette", cancelledAt: "2026-12-02T00:00:00Z" },
    });
    const result = withDebtEvents(loan, [cancelled]);
    expect(result.paymentSchedule).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(payments(result).every((row) => Math.abs(row.principal - 100) < 1e-9)).toBe(true);
  });

  it("report de principal, durée allongée : deux échéances d'intérêts, puis deux de plus en fin", () => {
    const deferred = withDebtEvents(loan, [
      event(
        {
          kind: "DEFERRAL",
          months: 2,
          deferralKind: "PRINCIPAL_ONLY",
          interestTreatment: "PAID",
          termEffect: "EXTEND_TERM",
        },
        "2027-04-01",
      ),
    ]);
    expect(deferred.paymentCount).toBe(14);
    expect(deferred.maturityDate).toBe("2028-02-05");
    const rows = payments(deferred);
    expect(rows[3]!.principal).toBe(0);
    expect(rows[4]!.principal).toBe(0);
    expect(rows).toHaveLength(14);
    expect(rows.reduce((sum, row) => sum + row.principal, 0)).toBeCloseTo(1200, 6);
    expect(rows.at(-1)!.closingBalance).toBeCloseTo(0, 6);
  });

  it("report total capitalisé, mensualité recalculée : le capital s'éteint à la date prévue", () => {
    const base = { ...loan, principal: 12000, currentBalance: 12000, annualRate: 0.12 };
    const resolved = resolveContractTerms(base, {
      monthlyPayment: null,
      paymentCount: 12,
      maturityDate: null,
    });
    const deferred = withDebtEvents(resolved, [
      event(
        {
          kind: "DEFERRAL",
          months: 3,
          deferralKind: "TOTAL",
          interestTreatment: "CAPITALISED",
          termEffect: "RECALCULATE_PAYMENT",
        },
        "2027-03-01",
      ),
    ]);
    const rows = payments(deferred);
    expect(rows).toHaveLength(12);
    expect(rows[2]!.capitalisedInterest).toBeGreaterThan(0);
    expect(rows[2]!.totalCashOut).toBe(0);
    expect(rows[5]!.totalCashOut).toBeGreaterThan(rows[1]!.totalCashOut);
    expect(rows.at(-1)!.closingBalance).toBeCloseTo(0, 2);
  });

  it("effet inconnu sur la durée : hypothèse dite, solde restant signalé", () => {
    const deferred = withDebtEvents(loan, [
      event(
        {
          kind: "DEFERRAL",
          months: 2,
          deferralKind: "PRINCIPAL_ONLY",
          interestTreatment: "PAID",
          termEffect: "UNKNOWN",
        },
        "2027-04-01",
      ),
    ]);
    const schedule = buildContractualSchedule(deferred);
    expect(schedule.kind).toBe("MODEL_ASSUMPTION");
    expect(payments(deferred).at(-1)!.closingBalance).toBeCloseTo(200, 6);
    expect(buildLoanTimeline(deferred, "2026-12-01").flags.map((flag) => flag.code)).toContain(
      "DEFERRAL_TERM_EFFECT_UNKNOWN",
    );
  });

  it("un remboursement prévu est une intention dans la projection, jamais un fait", () => {
    const planned = withDebtEvents(loan, [
      event(
        {
          kind: "EARLY_REPAYMENT",
          amount: 300,
          penalty: 0,
          outcome: "SHORTEN_TERM",
          balanceAfter: null,
        },
        "2027-06-20",
        { nature: "PLANNED" },
      ),
    ]);
    const forward = buildForwardSchedule(planned, "2026-12-01");
    const row = forward.entries.find((entry) => entry.entryKind === "EARLY_REPAYMENT")!;
    expect(row.kind).toBe("USER_ASSUMPTION");
    expect(forward.kind).toBe("MODEL_ASSUMPTION");
    expect(forward.entries.filter((entry) => entry.entryKind === "PAYMENT")).toHaveLength(9);
  });

  it("signale un remboursement effectué postérieur au dernier encours observé", () => {
    const repaid = withDebtEvents(loan, [
      event(
        {
          kind: "EARLY_REPAYMENT",
          amount: 300,
          penalty: null,
          outcome: "UNKNOWN",
          balanceAfter: null,
        },
        "2027-02-10",
      ),
    ]);
    const codes = buildLoanTimeline(repaid, "2027-03-01").flags.map((flag) => flag.code);
    expect(codes).toContain("BALANCE_PREDATES_REPAYMENT");
    const observedAfter = withDebtEvents(
      { ...loan, currentBalance: 800, balanceDate: "2027-02-10" },
      repaid.events!,
    );
    expect(
      buildLoanTimeline(observedAfter, "2027-03-01").flags.map((flag) => flag.code),
    ).not.toContain("BALANCE_PREDATES_REPAYMENT");
  });

  it("avenant de durée seule : mensualité recalculée à la date d'effet, capital éteint à la nouvelle fin", () => {
    const amended = withDebtEvents(loan, [
      event(
        {
          kind: "AMENDMENT",
          annualRate: null,
          paymentAmount: null,
          maturityDate: "2028-06-05",
          note: null,
        },
        "2027-01-01",
      ),
    ]);
    expect(amended.paymentCount).toBe(18);
    const rows = payments(amended);
    // Le prêt commence le 5 janvier 2027, après l'effet : 1 200 € sur 18 échéances.
    expect(rows).toHaveLength(18);
    expect(rows[0]!.principal).toBeCloseTo(1200 / 18, 6);
    expect(rows.at(-1)!.closingBalance).toBeCloseTo(0, 6);
  });

  it("nouvelle fin hors calendrier : durée inchangée, rien n'est arrondi, c'est signalé", () => {
    const amended = withDebtEvents(loan, [
      event(
        {
          kind: "AMENDMENT",
          annualRate: null,
          paymentAmount: null,
          maturityDate: "2028-06-10",
          note: null,
        },
        "2027-01-01",
      ),
    ]);
    expect(amended.paymentCount).toBe(12);
    expect(buildLoanTimeline(amended, "2026-12-01").flags.map((flag) => flag.code)).toContain(
      "AMENDMENT_MATURITY_NOT_ON_SCHEDULE",
    );
  });

  it("relecture 1 : un remboursement déjà dans l'encours observé n'est pas rejoué par la projection", () => {
    const repaid = withDebtEvents({ ...loan, currentBalance: 500, balanceDate: "2027-02-20" }, [
      event(
        {
          kind: "EARLY_REPAYMENT",
          amount: 500,
          penalty: 0,
          outcome: "SHORTEN_TERM",
          balanceAfter: 500,
        },
        "2027-02-20",
      ),
    ]);
    const forward = buildForwardSchedule(repaid, "2027-01-31");
    expect(forward.entries.some((row) => row.entryKind === "EARLY_REPAYMENT")).toBe(false);
    // Le capital projeté est exactement l'encours observé : 500 €, pas 500 € de moins.
    expect(forward.entries.reduce((sum, row) => sum + row.principal, 0)).toBeCloseTo(500, 6);
  });

  it("relecture 2 : un report postérieur à un avenant de durée allonge la nouvelle durée", () => {
    const changed = withDebtEvents(loan, [
      event(
        {
          kind: "AMENDMENT",
          annualRate: null,
          paymentAmount: null,
          maturityDate: "2028-06-05",
          note: null,
        },
        "2027-03-05",
      ),
      event(
        {
          kind: "DEFERRAL",
          months: 3,
          deferralKind: "PRINCIPAL_ONLY",
          interestTreatment: "PAID",
          termEffect: "EXTEND_TERM",
        },
        "2027-09-05",
      ),
    ]);
    expect(changed.paymentCount).toBe(21);
    expect(changed.maturityDate).toBe("2028-09-05");
  });

  it("relecture 3 : une projection postérieure à un recalcul garde la mensualité recalculée", () => {
    const amended = withDebtEvents(loan, [
      event(
        {
          kind: "AMENDMENT",
          annualRate: null,
          paymentAmount: null,
          maturityDate: "2028-06-05",
          note: null,
        },
        "2027-01-01",
      ),
    ]);
    const perMonth = 1200 / 18;
    const projected = withDebtEvents(
      { ...loan, currentBalance: 1200 - 5 * perMonth, balanceDate: "2027-05-10" },
      amended.events!,
    );
    const forward = buildForwardSchedule(projected, "2027-05-10");
    const first = forward.entries.find((row) => row.entryKind === "PAYMENT")!;
    expect(first.principal).toBeCloseTo(perMonth, 6);
    expect(forward.entries.filter((row) => row.entryKind === "PAYMENT")).toHaveLength(13);
    expect(forward.entries.at(-1)!.closingBalance).toBeCloseTo(0, 6);
  });

  it("relecture 3 bis : un palier antérieur ne réécrase pas un recalcul postérieur", () => {
    const changed = withDebtEvents(loan, [
      event({ kind: "PAYMENT_CHANGE", paymentAmount: 100 }, "2027-01-05"),
      event(
        {
          kind: "AMENDMENT",
          annualRate: null,
          paymentAmount: null,
          maturityDate: "2028-06-05",
          note: null,
        },
        "2027-03-01",
      ),
    ]);
    const rows = payments(changed);
    expect(rows).toHaveLength(18);
    // 2 × 100 € puis 1 000 € sur 16 échéances : 62,50 €, jusqu'au bout.
    expect(rows[2]!.principal).toBeCloseTo(62.5, 6);
    expect(rows[10]!.principal).toBeCloseTo(62.5, 6);
    expect(rows.at(-1)!.closingBalance).toBeCloseTo(0, 6);
  });

  it("relecture 4 : un échéancier bancaire fourni signale les événements qu'il n'applique pas", () => {
    const withProvided: Liability = {
      ...loan,
      providedSchedule: payments(loan).map((row) => ({
        paymentNumber: row.paymentNumber,
        dueDate: row.dueDate,
        openingBalance: row.openingBalance,
        interest: row.interest,
        principal: row.principal,
        insurance: row.insurance,
        fees: row.fees,
        closingBalance: row.closingBalance,
      })),
    };
    const deferred = withDebtEvents(withProvided, [
      event(
        {
          kind: "DEFERRAL",
          months: 3,
          deferralKind: "TOTAL",
          interestTreatment: "CAPITALISED",
          termEffect: "EXTEND_TERM",
        },
        "2027-04-01",
      ),
    ]);
    expect(buildLoanTimeline(deferred, "2026-12-01").flags.map((flag) => flag.code)).toContain(
      "EVENTS_NOT_APPLIED_TO_PROVIDED_SCHEDULE",
    );
  });

  it("relecture 6 : un remboursement prévu dont la date est passée est signalé", () => {
    const planned = withDebtEvents(loan, [
      event(
        {
          kind: "EARLY_REPAYMENT",
          amount: 100,
          penalty: null,
          outcome: "UNKNOWN",
          balanceAfter: null,
        },
        "2027-02-10",
        { nature: "PLANNED" },
      ),
    ]);
    expect(buildLoanTimeline(planned, "2027-03-01").flags.map((flag) => flag.code)).toContain(
      "PLANNED_REPAYMENT_OVERDUE",
    );
  });
});
