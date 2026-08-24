import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildLoanSchedule,
  debtServiceForPeriod,
  monthlyDebtServiceAt,
  nextDebtEvent,
  outstandingBalanceAt,
  upcomingDebtEvents,
} from "@/lib/engine/debt";
import type { Liability, Provenance } from "@/lib/types";

const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH" };

/** Prêt étudiant du dossier : 0 %, première échéance postérieure à la date zéro. */
const studentLoan: Liability = {
  id: "lia_student",
  name: "Prêt étudiant",
  lender: "Bpifrance",
  principal: 16745,
  currentBalance: 16745,
  annualRate: 0,
  monthlyPayment: 284.72,
  paymentCount: 60,
  firstPaymentDate: "2026-12-05",
  maturityDate: "2031-11-05",
  provenance,
};

/** GOLDEN_DATASET CASE 8 : prêt à 0 % avec première échéance future. */
const case8: Liability = {
  id: "GD-LOAN-0",
  name: "Prêt Gamma",
  lender: "Gamma",
  principal: 12000,
  currentBalance: 12000,
  annualRate: 0,
  monthlyPayment: 250,
  paymentCount: 48,
  firstPaymentDate: "2027-06-01",
  maturityDate: "2031-05-01",
  provenance,
};

/** GOLDEN_DATASET CASE 9 : prêt amortissable à taux fixe, PMT théorique. */
const case9: Liability = {
  id: "GD-LOAN-F",
  name: "Prêt fixe",
  lender: "Banque",
  principal: 100000,
  currentBalance: 100000,
  annualRate: 0.03,
  monthlyPayment: 0,
  paymentCount: 240,
  firstPaymentDate: "2027-02-01",
  maturityDate: "2047-01-01",
  provenance,
};

describe("addMonths", () => {
  it("garde le jour d’échéance et se replie sur le dernier jour du mois", () => {
    expect(addMonths("2026-12-05", 1)).toBe("2027-01-05");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-12-05", 59)).toBe("2031-11-05");
  });
});

describe("buildLoanSchedule", () => {
  it("date chaque échéance à partir de la première échéance", () => {
    const schedule = buildLoanSchedule(studentLoan);
    expect(schedule.kind).toBe("DERIVED");
    expect(schedule.firstDueDate).toBe("2026-12-05");
    expect(schedule.entries[0].totalCashOut).toBeCloseTo(284.72, 2);
    expect(schedule.entries[0].interest).toBe(0);
    expect(schedule.entries.every((entry) => entry.closingBalance >= 0)).toBe(true);
  });

  it("signale le résidu contractuel d’un prêt à 0 %", () => {
    const schedule = buildLoanSchedule(studentLoan);
    expect(schedule.contractualGap).toBeCloseTo(338.2, 2);
    expect(schedule.flags.some((flag) => flag.code === "RECONCILIATION_REQUIRED")).toBe(true);
  });

  it("reproduit CASE 9, échéancier amortissable à taux fixe", () => {
    const schedule = buildLoanSchedule(case9);
    expect(schedule.entries).toHaveLength(240);
    expect(schedule.entries[0].interest).toBeCloseTo(250, 2);
    expect(schedule.entries[0].principal).toBeCloseTo(304.6, 1);
    expect(schedule.entries[0].dueDate).toBe("2027-02-01");
    expect(schedule.entries.at(-1)?.dueDate).toBe("2047-01-01");
    expect(schedule.entries.at(-1)?.closingBalance).toBeCloseTo(0, 6);
    expect(schedule.entries.reduce((sum, entry) => sum + entry.principal, 0)).toBeCloseTo(
      100000,
      4,
    );
    expect(schedule.totalInterest).toBeCloseTo(33103.42, 0);
  });

  it("ne plante pas et ne date rien sans échéance exploitable", () => {
    const empty = buildLoanSchedule({ ...studentLoan, paymentCount: 0 });
    expect(empty.entries).toHaveLength(0);
    expect(empty.kind).toBe("MISSING");
  });
});

describe("debtService", () => {
  it("vaut 0 avant la première échéance", () => {
    // CASE 8, observation au 2027-01-31 : aucune échéance exigible.
    expect(monthlyDebtServiceAt([case8], "2027-01-31")).toBe(0);
    expect(monthlyDebtServiceAt([studentLoan], "2026-08-19")).toBe(0);
  });

  it("vaut la mensualité pendant la période de remboursement", () => {
    expect(monthlyDebtServiceAt([case8], "2027-06-01")).toBeCloseTo(250, 2);
    expect(monthlyDebtServiceAt([case8], "2028-05-01")).toBeCloseTo(250, 2);
    expect(monthlyDebtServiceAt([studentLoan], "2026-12-19")).toBeCloseTo(284.72, 2);
  });

  it("vaut 0 après la maturité", () => {
    expect(monthlyDebtServiceAt([case8], "2031-06-01")).toBe(0);
    expect(monthlyDebtServiceAt([studentLoan], "2032-01-15")).toBe(0);
  });

  it("supporte l’absence de dette", () => {
    expect(monthlyDebtServiceAt([], "2026-08-19")).toBe(0);
    expect(nextDebtEvent([], "2026-08-19")).toBeNull();
  });

  it("additionne plusieurs dettes exigibles sur la même période", () => {
    const auto: Liability = {
      ...studentLoan,
      id: "lia_auto",
      name: "Prêt auto",
      annualRate: 0.03,
      principal: 10000,
      currentBalance: 10000,
      monthlyPayment: 200,
      paymentCount: 60,
      firstPaymentDate: "2026-01-05",
      maturityDate: "2030-12-05",
    };
    expect(monthlyDebtServiceAt([studentLoan, auto], "2026-12-19")).toBeCloseTo(484.72, 2);
    expect(debtServiceForPeriod([studentLoan, auto], "2026-08-01", "2026-08-31")).toBeCloseTo(
      200,
      2,
    );
  });

  it("expose le prochain événement daté et son montant", () => {
    const event = nextDebtEvent([studentLoan], "2026-08-19");
    expect(event?.entry.dueDate).toBe("2026-12-05");
    expect(event?.isFirstPayment).toBe(true);
    expect(event?.entry.totalCashOut).toBeCloseTo(284.72, 2);
    expect(event?.daysAway).toBe(108);
  });

  it("borne les événements à venir à l’horizon demandé", () => {
    expect(upcomingDebtEvents([studentLoan], "2026-08-19", 365)).toHaveLength(9);
    expect(upcomingDebtEvents([studentLoan], "2026-08-19", 30)).toHaveLength(0);
  });
});

describe("outstandingBalanceAt", () => {
  it("laisse l’encours intact avant la première échéance", () => {
    expect(outstandingBalanceAt(studentLoan, "2026-08-19")).toBeCloseTo(16745, 2);
  });

  it("déduit les échéances déjà exigibles", () => {
    expect(outstandingBalanceAt(case8, "2028-05-01")).toBeCloseTo(9000, 2);
    expect(outstandingBalanceAt(case8, "2031-06-01")).toBeCloseTo(0, 2);
  });
});
