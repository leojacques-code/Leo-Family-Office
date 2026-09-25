import { describe, expect, it } from "vitest";
import {
  buildContractualSchedule,
  buildLoanTimeline,
  debtServiceNextTwelveMonths,
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

describe("Relecture B16/B17 : assurance incluse inconnue et faux écarts", () => {
  const loan100k: Liability = {
    ...base,
    principal: 100_000,
    currentBalance: 100_000,
    annualRate: 0.03,
    recurringFees: 0,
  };

  it("ne déduit aucune durée d'une mensualité qui contient une assurance de montant inconnu", () => {
    const loan = resolveContractTerms(
      {
        ...loan100k,
        insuranceMode: "INCLUDED",
        paymentIncludesInsurance: true,
        monthlyInsurance: null,
      },
      { ...none, monthlyPayment: 600 },
    );
    expect(loan.termsResolution?.blocker).toBe("INCLUDED_INSURANCE_UNKNOWN");
    expect(loan.paymentCount).toBe(0);
    expect(buildContractualSchedule(loan).kind).toBe("MISSING");
  });

  it("amortit selon le contrat quand la durée est déclarée, et garde la mensualité comme sortie", () => {
    const loan = resolveContractTerms(
      {
        ...base,
        principal: 1200,
        currentBalance: 1200,
        recurringFees: 0,
        paymentIncludesInsurance: true,
        insuranceMode: "INCLUDED",
        monthlyInsurance: null,
      },
      { ...none, monthlyPayment: 105, paymentCount: 12 },
    );
    const schedule = buildContractualSchedule(loan);
    const first = schedule.entries[0]!;
    // Taux nul, 1 200 € sur 12 : 100 € de capital ; 5 € lus comme assurance incluse.
    expect(first.principal).toBeCloseTo(100, 6);
    expect(first.insurance).toBeCloseTo(5, 6);
    expect(first.totalCashOut).toBeCloseTo(105, 6);
    expect(schedule.entries.filter((row) => row.entryKind === "PAYMENT")).toHaveLength(12);
    expect(buildLoanTimeline(loan, "2026-01-01").flags.map((flag) => flag.code)).toContain(
      "INCLUDED_INSURANCE_UNKNOWN",
    );
  });

  it("ne signale pas d'assurance ou de frais cachés sur une durée déduite de la mensualité", () => {
    const loan = resolveContractTerms(
      { ...loan100k, insuranceMode: "NONE", paymentIncludesInsurance: false },
      { ...none, monthlyPayment: 600 },
    );
    const codes = buildLoanTimeline(loan, "2026-01-01").flags.map((flag) => flag.code);
    expect(codes).not.toContain("PAYMENT_EXCEEDS_AMORTISATION");
    expect(buildLoanTimeline(loan, "2026-01-01").contractualGap).toBe(0);
  });
});

describe("Relecture B17 : douze mois font douze échéances", () => {
  it("ne compte pas deux fois l'échéance anniversaire quand la lecture tombe un jour d'échéance", () => {
    const loan = resolveContractTerms(
      {
        ...base,
        principal: 2400,
        currentBalance: 2100,
        balanceDate: "2026-03-05",
        recurringFees: 0,
        insuranceMode: "NONE",
        paymentIncludesInsurance: false,
      },
      { ...none, monthlyPayment: 100 },
    );
    // Lecture le 5 mars 2026, jour d'échéance : du 5 mars 2026 au 4 mars 2027, 12 échéances.
    expect(debtServiceNextTwelveMonths([loan], "2026-03-05").principal).toBeCloseTo(1200, 6);
  });
});
