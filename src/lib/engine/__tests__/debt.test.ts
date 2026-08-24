import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildContractualSchedule,
  buildForwardSchedule,
  buildLoanTimeline,
  debtServiceForPeriod,
  elapsedPaymentsAt,
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

describe("buildContractualSchedule", () => {
  it("date chaque échéance à partir de la première échéance", () => {
    const schedule = buildContractualSchedule(studentLoan);
    expect(schedule.kind).toBe("DERIVED");
    expect(schedule.firstDueDate).toBe("2026-12-05");
    expect(schedule.entries[0].totalCashOut).toBeCloseTo(284.72, 2);
    expect(schedule.entries[0].interest).toBe(0);
    expect(schedule.entries.every((entry) => entry.closingBalance >= 0)).toBe(true);
  });

  it("signale le résidu contractuel d’un prêt à 0 %", () => {
    const timeline = buildLoanTimeline(studentLoan, "2026-08-19");
    expect(timeline.contractualGap).toBeCloseTo(338.2, 2);
    expect(timeline.flags.some((flag) => flag.code === "RECONCILIATION_REQUIRED")).toBe(true);
  });

  it("reproduit CASE 9, échéancier amortissable à taux fixe", () => {
    const schedule = buildContractualSchedule(case9);
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
    const empty = buildContractualSchedule({ ...studentLoan, paymentCount: 0 });
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
    expect(
      debtServiceForPeriod([studentLoan, auto], "2026-08-19", "2026-08-01", "2026-08-31"),
    ).toBeCloseTo(200, 2);
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
  it("rend l’encours observé pour la date d’observation elle-même", () => {
    expect(outstandingBalanceAt(studentLoan, "2026-08-19")).toBeCloseTo(16745, 2);
  });

  it("projette l’encours futur depuis l’encours observé", () => {
    // 12 échéances de 250 € après le 2027-06-01 : 12 000 − 3 000 = 9 000.
    expect(outstandingBalanceAt(case8, "2027-05-31", "2028-05-01")).toBeCloseTo(9000, 2);
    expect(outstandingBalanceAt(case8, "2027-05-31", "2031-06-01")).toBeCloseTo(0, 2);
  });

  it("ne redéduit jamais une échéance déjà incorporée dans l’encours observé", () => {
    // Encours observé APRÈS 12 échéances : la fonction ne doit pas les retrancher encore.
    const partlyRepaid = { ...case8, currentBalance: 9000 };
    expect(outstandingBalanceAt(partlyRepaid, "2028-05-15")).toBeCloseTo(9000, 2);
    expect(outstandingBalanceAt(partlyRepaid, "2028-05-15", "2028-06-01")).toBeCloseTo(8750, 2);
  });
});

describe("ancrage temporel de l’encours observé", () => {
  /** Prêt de 100 000 € à 3 %, 240 échéances, dont 12 déjà payées à la date d'observation. */
  const contractual = buildContractualSchedule(case9);
  const balanceAfter12 = contractual.entries[11].closingBalance;
  const partlyRepaid = { ...case9, currentBalance: balanceAfter12 };
  const asOf = "2028-02-15"; // après la 12e échéance (2028-01-01), avant la 13e (2028-02-01)… voir ci-dessous

  it("compte exactement les échéances déjà exigibles", () => {
    // Première échéance 2027-02-01, donc la 12e tombe le 2028-01-01.
    expect(contractual.entries[11].dueDate).toBe("2028-01-01");
    expect(elapsedPaymentsAt(case9, "2028-01-15")).toBe(12);
    expect(elapsedPaymentsAt(case9, "2027-01-31")).toBe(0);
  });

  it("démarre la projection à la 13e échéance, depuis l’encours observé", () => {
    const forward = buildForwardSchedule(partlyRepaid, "2028-01-15");
    expect(forward.entries[0].paymentNumber).toBe(13);
    expect(forward.entries[0].dueDate).toBe("2028-02-01");
    expect(forward.entries[0].openingBalance).toBeCloseTo(balanceAfter12, 6);
    expect(forward.entries).toHaveLength(228);
  });

  it("n’amortit jamais deux fois le capital déjà remboursé", () => {
    const forward = buildForwardSchedule(partlyRepaid, "2028-01-15");
    const principalRepaidForward = forward.entries.reduce((sum, entry) => sum + entry.principal, 0);
    // L'encours observé s'amortit intégralement, ni plus ni moins.
    expect(principalRepaidForward).toBeCloseTo(balanceAfter12, 4);
    // La somme des deux jambes reste le capital emprunté : aucun euro compté deux fois.
    const principalRepaidPast = contractual.entries
      .slice(0, 12)
      .reduce((sum, entry) => sum + entry.principal, 0);
    expect(principalRepaidPast + principalRepaidForward).toBeCloseTo(case9.principal, 3);
    expect(forward.entries.at(-1)?.closingBalance).toBeCloseTo(0, 6);
  });

  it("reste aligné sur le contrat quand rien n’a encore été payé", () => {
    const forward = buildForwardSchedule(case9, "2027-01-31");
    expect(forward.entries).toHaveLength(contractual.entries.length);
    expect(forward.entries[0].paymentNumber).toBe(1);
    expect(forward.totalInterest).toBeCloseTo(contractual.totalInterest, 6);
    expect(
      buildLoanTimeline(case9, "2027-01-31").flags.some((flag) => flag.code === "BALANCE_MISMATCH"),
    ).toBe(false);
  });

  it("signale un encours qui ne correspond pas au contrat sans le corriger", () => {
    // Encours resté au capital initial alors que 12 échéances sont passées.
    const stale = buildLoanTimeline(case9, "2028-01-15");
    expect(stale.elapsedPayments).toBe(12);
    expect(stale.observedBalance).toBe(100000);
    expect(stale.contractualBalanceAtAsOf).toBeCloseTo(balanceAfter12, 2);
    expect(stale.flags.some((flag) => flag.code === "BALANCE_MISMATCH")).toBe(true);
    // L'encours observé fait foi : la projection part bien de 100 000, pas de l'attendu.
    expect(stale.forward.entries[0].openingBalance).toBeCloseTo(100000, 2);
  });

  it("garde le service de dette exact des deux côtés de la date d’observation", () => {
    // Mois d'une échéance passée : le montant vient du contrat.
    expect(monthlyDebtServiceAt([partlyRepaid], "2027-06-15")).toBeCloseTo(
      contractual.entries[4].totalCashOut,
      2,
    );
    // Mois d'une échéance future : le montant vient de la projection.
    expect(monthlyDebtServiceAt([partlyRepaid], "2028-02-15")).toBeCloseTo(
      buildForwardSchedule(partlyRepaid, "2028-02-15").entries[0].totalCashOut,
      2,
    );
    void asOf;
  });
});

describe("mensualité contractuelle stable", () => {
  it("ne recalcule pas la mensualité depuis un encours entamé", () => {
    const contractual = buildContractualSchedule(case9);
    const pmt = contractual.entries[0].totalCashOut;
    const partlyRepaid = { ...case9, currentBalance: contractual.entries[11].closingBalance };
    const forward = buildForwardSchedule(partlyRepaid, "2028-01-15");
    // La mensualité d'un prêt à taux fixe est un terme du contrat, pas une variable.
    expect(forward.entries[0].totalCashOut).toBeCloseTo(pmt, 2);
    expect(pmt).toBeCloseTo(554.6, 2);
  });

  it("signale un encours que les échéances restantes ne soldent pas", () => {
    const underfunded = buildLoanTimeline({ ...case9, currentBalance: 150000 }, "2028-01-15");
    expect(underfunded.flags.some((flag) => flag.code === "RECONCILIATION_REQUIRED")).toBe(true);
  });
});
