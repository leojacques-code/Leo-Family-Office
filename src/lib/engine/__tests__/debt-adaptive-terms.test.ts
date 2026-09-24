import { describe, expect, it } from "vitest";
import {
  buildContractualSchedule,
  buildLoanTimeline,
  resolveContractTerms,
  UNDECLARED_LOAN_TERMS,
} from "@/lib/engine/debt";
import type { Liability } from "@/lib/types";

const base: Liability = {
  id: "lia_adaptive",
  name: "Prêt",
  lender: "Banque",
  principal: 1200,
  currentBalance: 1200,
  annualRate: 0,
  monthlyPayment: 0,
  paymentCount: 0,
  firstPaymentDate: "2026-01-05",
  maturityDate: "",
  ...UNDECLARED_LOAN_TERMS,
  provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH" },
};
const none = { monthlyPayment: null, paymentCount: null, maturityDate: null };

describe("B16 : contrat adaptatif, montant OU durée selon la donnée connue", () => {
  it("déduit la durée d'une mensualité à taux nul (O03 : 1 200 € en 12 × 100 €)", () => {
    const loan = resolveContractTerms(base, { ...none, monthlyPayment: 100 });
    expect(loan.paymentCount).toBe(12);
    expect(loan.maturityDate).toBe("2026-12-05");
    expect(loan.termsResolution).toMatchObject({
      paymentCount: "DERIVED_FROM_PAYMENT",
      maturityDate: "DERIVED_FROM_COUNT",
      monthlyPayment: "DECLARED",
      blocker: null,
    });
    const schedule = buildContractualSchedule(loan);
    expect(schedule.entries.reduce((sum, row) => sum + row.principal, 0)).toBeCloseTo(1200, 6);
  });

  it("déduit la durée d'une mensualité à taux positif, dernière échéance ajustée par le moteur", () => {
    const loan = resolveContractTerms(
      { ...base, principal: 10000, currentBalance: 10000, annualRate: 0.03 },
      { ...none, monthlyPayment: 500 },
    );
    const schedule = buildContractualSchedule(loan);
    expect(loan.paymentCount).toBe(schedule.entries.length);
    expect(schedule.entries.at(-1)!.closingBalance).toBeLessThan(0.01);
    expect(schedule.entries.at(-1)!.principal + schedule.entries.at(-1)!.interest).toBeLessThan(
      500,
    );
  });

  it("déduit la durée de la maturité quand elle tombe sur une échéance", () => {
    const loan = resolveContractTerms(base, { ...none, maturityDate: "2026-12-05" });
    expect(loan.paymentCount).toBe(12);
    expect(loan.termsResolution?.paymentCount).toBe("DERIVED_FROM_MATURITY");
    expect(loan.termsResolution?.monthlyPayment).toBe("DERIVED_FROM_COUNT");
  });

  it("n'arrondit pas une maturité hors calendrier : bloque, échéancier MISSING", () => {
    const loan = resolveContractTerms(base, { ...none, maturityDate: "2026-12-20" });
    expect(loan.paymentCount).toBe(0);
    expect(loan.termsResolution?.blocker).toBe("MATURITY_NOT_ON_SCHEDULE");
    expect(buildContractualSchedule(loan).kind).toBe("MISSING");
    expect(buildLoanTimeline(loan, "2026-06-01").flags.map((flag) => flag.code)).toContain(
      "TERMS_UNRESOLVED",
    );
  });

  it("refuse de déduire une durée d'une mensualité qui ne couvre pas l'intérêt", () => {
    const loan = resolveContractTerms(
      { ...base, principal: 100000, annualRate: 0.06 },
      { ...none, monthlyPayment: 400 },
    );
    expect(loan.termsResolution?.blocker).toBe("PAYMENT_DOES_NOT_AMORTISE");
    expect(loan.paymentCount).toBe(0);
  });

  it("ne suppose rien sans durée, maturité ni mensualité, et ne lit pas une mensualité 0 comme déclarée", () => {
    const loan = resolveContractTerms(base, { ...none, monthlyPayment: 0 });
    expect(loan.termsResolution?.blocker).toBe("TERMS_INSUFFICIENT");
    expect(loan.declaredTerms?.monthlyPayment).toBeNull();
  });

  it("ne déduit pas la durée d'un in fine à partir d'une mensualité", () => {
    const loan = resolveContractTerms(
      { ...base, amortisationProfile: "BULLET", annualRate: 0.02 },
      { ...none, monthlyPayment: 2 },
    );
    expect(loan.termsResolution?.blocker).toBe("TERMS_INSUFFICIENT");
  });

  it("garde les termes déclarés tels quels et signale les termes calculés dans la timeline", () => {
    const declared = resolveContractTerms(base, {
      monthlyPayment: 100,
      paymentCount: 12,
      maturityDate: "2026-12-05",
    });
    expect(declared.termsResolution).toMatchObject({
      monthlyPayment: "DECLARED",
      paymentCount: "DECLARED",
      maturityDate: "DECLARED",
    });
    const derived = resolveContractTerms(base, { ...none, monthlyPayment: 100 });
    const flags = buildLoanTimeline(derived, "2026-06-01").flags;
    expect(flags.find((flag) => flag.code === "TERMS_DERIVED")?.detail).toContain(
      "déduite de la mensualité",
    );
  });
});
