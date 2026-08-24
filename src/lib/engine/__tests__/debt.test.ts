import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildContractualSchedule,
  buildForwardSchedule,
  buildLoanTimeline,
  debtServiceForPeriod,
  elapsedPaymentsAt,
  monthBounds,
  monthlyDebtServiceAt,
  nextDebtEvent,
  outstandingBalanceAt,
  upcomingDebtEvents,
  amortisingPayment,
  debtServiceBreakdownForPeriod,
  projectedBalanceAt,
  annualRateAt,
  dueDateOf,
  UNDECLARED_LOAN_TERMS,
} from "@/lib/engine/debt";
import type { Liability, LoanScheduleEntry, Provenance } from "@/lib/types";

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
  ...UNDECLARED_LOAN_TERMS,
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
  ...UNDECLARED_LOAN_TERMS,
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
  ...UNDECLARED_LOAN_TERMS,
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

  it("signale le résidu contractuel d’un prêt à 0 % et chiffre la charge implicite", () => {
    const timeline = buildLoanTimeline(studentLoan, "2026-08-19");
    expect(timeline.contractualGap).toBeCloseTo(338.2, 2);
    expect(timeline.flags.some((flag) => flag.code === "PAYMENT_EXCEEDS_AMORTISATION")).toBe(true);
    // 60 × 284,72 dépassent 16 745 € de 338,20 €, soit 5,64 € par échéance : le profil
    // d'une assurance non déclarée. Une piste chiffrée, jamais une correction silencieuse.
    expect(timeline.impliedChargePerPayment).toBeCloseTo(338.2 / 60, 4);
    expect(timeline.liability.monthlyInsurance).toBeNull();
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
      ...UNDECLARED_LOAN_TERMS,
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// DEBT ENGINE V2 — cas d'or
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Prêt de référence V2 : amortissable, taux positif, assurance et frais déclarés. */
function loan(overrides: Partial<Liability> = {}): Liability {
  return {
    id: "lia_v2",
    name: "Prêt de référence",
    lender: "Banque",
    principal: 120000,
    currentBalance: 120000,
    annualRate: 0.036,
    monthlyPayment: 0,
    paymentCount: 240,
    firstPaymentDate: "2026-09-05",
    maturityDate: "2046-08-05",
    ...UNDECLARED_LOAN_TERMS,
    provenance,
    ...overrides,
  };
}

/** Invariants que TOUTE ligne d'échéancier doit respecter, quel que soit le scénario. */
function expectEntryInvariants(schedule: { entries: LoanScheduleEntry[] }) {
  for (const row of schedule.entries) {
    expect(row.totalCashOut).toBeCloseTo(
      row.principal + row.interest + row.insurance + row.fees,
      6,
    );
    expect(row.closingBalance).toBeCloseTo(
      Math.max(
        0,
        row.openingBalance - row.principal + row.capitalisedInterest + row.capitalisedCharges,
      ),
      6,
    );
    expect(row.closingBalance).toBeGreaterThanOrEqual(-1e-9);
  }
}

describe("CASE D1 — prêt à 0 %", () => {
  it("amortit linéairement et ne facture aucun intérêt", () => {
    const schedule = buildContractualSchedule(
      loan({ annualRate: 0, principal: 12000, paymentCount: 24, monthlyPayment: 500 }),
    );
    expect(schedule.entries).toHaveLength(24);
    expect(schedule.totalInterest).toBeCloseTo(0, 9);
    expect(schedule.entries[0].principal).toBeCloseTo(500, 9);
    expect(schedule.entries.at(-1)?.closingBalance).toBeCloseTo(0, 6);
    expectEntryInvariants(schedule);
  });
});

describe("CASE D2 — prêt amortissable à taux positif", () => {
  it("dérive la mensualité du contrat et solde exactement le capital", () => {
    const liability = loan();
    const schedule = buildContractualSchedule(liability);
    // PMT(120 000 ; 3,6 %/12 ; 240) = 702,13 €
    expect(amortisingPayment(liability)).toBeCloseTo(702.13, 2);
    expect(schedule.entries).toHaveLength(240);
    expect(schedule.entries.at(-1)?.closingBalance).toBeCloseTo(0, 4);
    // L'intérêt décroît avec le capital restant dû.
    expect(schedule.entries[0].interest).toBeGreaterThan(schedule.entries[100].interest);
    expect(schedule.entries[100].interest).toBeGreaterThan(schedule.entries[239].interest);
    expectEntryInvariants(schedule);
  });
});

describe("CASE D3 — encours déjà amorti", () => {
  it("projette depuis l’encours observé sans réamortir le passé", () => {
    const liability = loan({ currentBalance: 96000 });
    const asOf = "2031-01-15";
    const elapsed = elapsedPaymentsAt(liability, asOf);
    const forward = buildForwardSchedule(liability, asOf);
    expect(elapsed).toBe(53);
    expect(forward.entries[0].paymentNumber).toBe(54);
    expect(forward.entries[0].openingBalance).toBeCloseTo(96000, 6);
    // 96 000 € observés contre ~103 000 € attendus au contrat : à mensualité inchangée, le
    // prêt s'éteint avant la 240e échéance. Moins de lignes, jamais plus.
    expect(forward.entries.length).toBeLessThanOrEqual(240 - 53);
    expect(forward.entries.at(-1)?.closingBalance).toBeCloseTo(0, 4);
    expectEntryInvariants(forward);
  });
});

describe("CASE D4 — avant la première échéance", () => {
  it("ne facture aucun service de dette", () => {
    const liability = loan();
    expect(monthlyDebtServiceAt([liability], "2026-08-19")).toBeCloseTo(0, 9);
    expect(debtServiceForPeriod([liability], "2026-08-19", "2026-01-01", "2026-08-31")).toBeCloseTo(
      0,
      9,
    );
  });
});

describe("CASE D5 — après la maturité", () => {
  it("ne facture aucun service de dette", () => {
    const liability = loan({ currentBalance: 0 });
    expect(monthlyDebtServiceAt([liability], "2050-03-10")).toBeCloseTo(0, 9);
  });
});

describe("CASE D6 — assurance emprunteur", () => {
  it("s’ajoute au décaissement sans toucher à l’amortissement quand elle est en sus", () => {
    const sans = loan({ monthlyPayment: 703.25 });
    const avec = loan({
      monthlyPayment: 703.25,
      monthlyInsurance: 25,
      paymentIncludesInsurance: false,
    });
    const a = buildContractualSchedule(sans).entries[0];
    const b = buildContractualSchedule(avec).entries[0];
    expect(b.principal).toBeCloseTo(a.principal, 9);
    expect(b.insurance).toBeCloseTo(25, 9);
    expect(b.totalCashOut).toBeCloseTo(a.totalCashOut + 25, 9);
    expectEntryInvariants(buildContractualSchedule(avec));
  });

  it("ralentit l’amortissement quand la mensualité la contient déjà", () => {
    const incluse = loan({
      monthlyPayment: 703.25,
      monthlyInsurance: 25,
      paymentIncludesInsurance: true,
    });
    const enSus = loan({
      monthlyPayment: 703.25,
      monthlyInsurance: 25,
      paymentIncludesInsurance: false,
    });
    // Assurance comprise : seuls 678,25 € amortissent, le prêt s'éteint donc plus lentement
    // et coûte plus cher. Confondre les deux conventions fausse le coût du crédit.
    expect(amortisingPayment(incluse)).toBeCloseTo(678.25, 9);
    expect(amortisingPayment(enSus)).toBeCloseTo(703.25, 9);
    const cher = buildContractualSchedule(incluse);
    const normal = buildContractualSchedule(enSus);
    expect(cher.totalInterest).toBeGreaterThan(normal.totalInterest);
    // Assurance comprise, le prélèvement est la mensualité déclarée. En sus, il la dépasse
    // de la prime. Traiter l'une comme l'autre fausse la trésorerie de 25 € par mois.
    expect(cher.entries[0].totalCashOut).toBeCloseTo(703.25, 9);
    expect(normal.entries[0].totalCashOut).toBeCloseTo(728.25, 9);
  });

  it("signale une convention inconnue au lieu de la trancher", () => {
    const timeline = buildLoanTimeline(
      loan({ monthlyPayment: 703.25, monthlyInsurance: 25, paymentIncludesInsurance: null }),
      "2026-08-19",
    );
    expect(timeline.flags.some((flag) => flag.code === "INSURANCE_TREATMENT_UNKNOWN")).toBe(true);
  });
});

describe("CASE D7 — frais", () => {
  it("distingue frais récurrents et frais ponctuels", () => {
    const liability = loan({
      monthlyPayment: 703.25,
      recurringFees: 3,
      oneOffCharges: [
        {
          id: "chg1",
          liabilityId: "lia_v2",
          date: "2026-09-20",
          amount: 900,
          label: "Dossier",
          financed: false,
        },
      ],
    });
    const schedule = buildContractualSchedule(liability);
    // Le frais récurrent est porté par chaque échéance.
    expect(schedule.entries[0].fees).toBeCloseTo(3, 9);
    // Le frais ponctuel n'est pas une échéance : il ne figure pas au contrat théorique.
    expect(schedule.entries.every((row) => row.entryKind === "PAYMENT")).toBe(true);
    // Mais c'est bien une sortie de trésorerie sur sa période.
    const septembre = debtServiceBreakdownForPeriod(
      [liability],
      "2026-08-19",
      "2026-09-01",
      "2026-09-30",
    );
    expect(septembre.fees).toBeCloseTo(903, 6);
    expect(septembre.principal).toBeGreaterThan(0);
  });
});

describe("CASE D8 — différé", () => {
  it("différé de principal : intérêts dus, encours inchangé", () => {
    const liability = loan({
      monthlyPayment: 703.25,
      monthlyInsurance: 20,
      paymentIncludesInsurance: false,
      deferral: { kind: "PRINCIPAL_ONLY", months: 12, interestTreatment: "PAID" },
    });
    const schedule = buildContractualSchedule(liability);
    const premiere = schedule.entries[0];
    expect(premiere.principal).toBeCloseTo(0, 9);
    expect(premiere.interest).toBeCloseTo((120000 * 0.036) / 12, 6);
    expect(premiere.insurance).toBeCloseTo(20, 9);
    expect(premiere.closingBalance).toBeCloseTo(120000, 6);
    expect(schedule.entries[11].closingBalance).toBeCloseTo(120000, 6);
    // L'amortissement démarre à la 13e échéance.
    expect(schedule.entries[12].principal).toBeGreaterThan(0);
    expectEntryInvariants(schedule);
  });

  it("différé total à intérêts capitalisés : rien ne sort, la dette grossit", () => {
    const liability = loan({
      monthlyPayment: 703.25,
      deferral: { kind: "TOTAL", months: 6, interestTreatment: "CAPITALISED" },
    });
    const schedule = buildContractualSchedule(liability);
    const premiere = schedule.entries[0];
    expect(premiere.totalCashOut).toBeCloseTo(0, 9);
    expect(premiere.interest).toBeCloseTo(0, 9);
    expect(premiere.capitalisedInterest).toBeCloseTo((120000 * 0.036) / 12, 6);
    expect(premiere.closingBalance).toBeGreaterThan(120000);
    expect(schedule.entries[5].closingBalance).toBeGreaterThan(schedule.entries[0].closingBalance);
    expectEntryInvariants(schedule);
  });

  it("différé total sans convention connue : hypothèse marquée, jamais silencieuse", () => {
    const liability = loan({
      monthlyPayment: 703.25,
      deferral: { kind: "TOTAL", months: 6, interestTreatment: "UNKNOWN" },
    });
    const timeline = buildLoanTimeline(liability, "2026-08-19");
    expect(timeline.flags.some((flag) => flag.code === "DEFERRAL_INTEREST_UNKNOWN")).toBe(true);
    expect(timeline.contractual.kind).toBe("MODEL_ASSUMPTION");
    expect(timeline.contractual.entries.every((row) => row.kind === "MODEL_ASSUMPTION")).toBe(true);
  });

  it("différé total à intérêts payés est contradictoire et retombe sur un différé de principal", () => {
    const liability = loan({
      monthlyPayment: 703.25,
      deferral: { kind: "TOTAL", months: 3, interestTreatment: "PAID" },
    });
    const timeline = buildLoanTimeline(liability, "2026-08-19");
    expect(timeline.flags.some((flag) => flag.code === "DEFERRAL_CONTRADICTORY")).toBe(true);
    expect(timeline.contractual.entries[0].interest).toBeGreaterThan(0);
    expect(timeline.contractual.entries[0].capitalisedInterest).toBeCloseTo(0, 9);
  });
});

describe("CASE D9 — remboursement anticipé", () => {
  const base = () =>
    loan({ monthlyPayment: 703.25, currentBalance: 100000, firstPaymentDate: "2026-09-05" });

  it("réduit la durée à mensualité constante", () => {
    const liability = {
      ...base(),
      earlyRepayments: [
        {
          id: "er1",
          liabilityId: "lia_v2",
          date: "2030-06-15",
          amount: 20000,
          penalty: 600,
          outcome: "SHORTEN_TERM" as const,
        },
      ],
    };
    const asOf = "2030-01-10";
    const forward = buildForwardSchedule(liability, asOf);
    const sans = buildForwardSchedule(base(), asOf);
    const ligne = forward.entries.find((row) => row.entryKind === "EARLY_REPAYMENT");
    expect(ligne?.principal).toBeCloseTo(20000, 6);
    expect(ligne?.fees).toBeCloseTo(600, 6);
    expect(ligne?.totalCashOut).toBeCloseTo(20600, 6);
    // Le prêt s'éteint plus tôt et coûte moins d'intérêts.
    expect(forward.totalInterest).toBeLessThan(sans.totalInterest);
    expect(forward.entries.at(-1)?.closingBalance).toBeCloseTo(0, 4);
    expectEntryInvariants(forward);
  });

  it("réduit la mensualité à durée constante", () => {
    const liability = {
      ...base(),
      earlyRepayments: [
        {
          id: "er2",
          liabilityId: "lia_v2",
          date: "2030-06-15",
          amount: 20000,
          penalty: 0,
          outcome: "REDUCE_PAYMENT" as const,
        },
      ],
    };
    const forward = buildForwardSchedule(liability, "2030-01-10");
    const apres = forward.entries.filter(
      (row) => row.entryKind === "PAYMENT" && row.dueDate > "2030-06-15",
    );
    const avant = forward.entries.filter(
      (row) => row.entryKind === "PAYMENT" && row.dueDate < "2030-06-15",
    );
    expect(apres[0].totalCashOut).toBeLessThan(avant[0].totalCashOut);
    // La durée est conservée : aucune échéance n'est supprimée.
    expect(forward.entries.at(-1)?.closingBalance).toBeCloseTo(0, 3);
  });

  it("ne choisit pas seul entre les deux conventions", () => {
    const liability = {
      ...base(),
      earlyRepayments: [
        {
          id: "er3",
          liabilityId: "lia_v2",
          date: "2030-06-15",
          amount: 20000,
          penalty: null,
          outcome: "UNKNOWN" as const,
        },
      ],
    };
    const forward = buildForwardSchedule(liability, "2030-01-10");
    const timeline = buildLoanTimeline(liability, "2030-01-10");
    expect(forward.kind).toBe("MODEL_ASSUMPTION");
    void timeline;
    // L'indemnité inconnue n'est jamais supposée nulle en silence.
    const ligne = forward.entries.find((row) => row.entryKind === "EARLY_REPAYMENT");
    expect(ligne?.kind).toBe("MODEL_ASSUMPTION");
    expect(ligne?.fees).toBeCloseTo(0, 9);
  });

  it("un remboursement déjà passé n’est pas rejoué contre l’encours observé", () => {
    const liability = {
      ...base(),
      currentBalance: 80000,
      earlyRepayments: [
        {
          id: "er4",
          liabilityId: "lia_v2",
          date: "2029-06-15",
          amount: 20000,
          penalty: 400,
          outcome: "SHORTEN_TERM" as const,
        },
      ],
    };
    const asOf = "2030-01-10";
    const forward = buildForwardSchedule(liability, asOf);
    expect(forward.entries.some((row) => row.entryKind === "EARLY_REPAYMENT")).toBe(false);
    expect(forward.entries[0].openingBalance).toBeCloseTo(80000, 6);
    // Mais il reste une sortie de trésorerie réelle sur sa propre période.
    const juin = debtServiceBreakdownForPeriod([liability], asOf, "2029-06-01", "2029-06-30");
    expect(juin.principal).toBeGreaterThanOrEqual(20000);
    expect(juin.fees).toBeGreaterThanOrEqual(400);
  });
});

describe("CASE D10 — encours incohérent avec l’échéancier", () => {
  it("expose les trois encours et ne corrige rien en silence", () => {
    const liability = loan({ monthlyPayment: 703.25, currentBalance: 111000 });
    const asOf = "2028-03-10";
    const timeline = buildLoanTimeline(liability, asOf);
    expect(timeline.balance.observed).toBeCloseTo(111000, 6);
    expect(timeline.balance.contractual).toBeGreaterThan(0);
    expect(timeline.balance.contractual).not.toBeCloseTo(111000, 2);
    expect(timeline.balance.difference).toBeCloseTo(
      timeline.balance.observed - timeline.balance.contractual,
      6,
    );
    expect(timeline.balance.reconciled).toBe(false);
    expect(timeline.flags.some((flag) => flag.code === "BALANCE_MISMATCH")).toBe(true);
    // La projection part bien de l'encours observé, pas du théorique.
    expect(buildForwardSchedule(liability, asOf).entries[0].openingBalance).toBeCloseTo(111000, 6);
  });
});

describe("CASE D11 — échéancier bancaire fourni", () => {
  const provided = [
    {
      paymentNumber: 1,
      dueDate: "2026-09-05",
      openingBalance: 10000,
      interest: 30,
      principal: 470,
      insurance: 12,
      fees: 2,
      closingBalance: 9530,
    },
    {
      paymentNumber: 2,
      dueDate: "2026-10-05",
      openingBalance: 9530,
      interest: 28.59,
      principal: 471.41,
      insurance: 12,
      fees: 2,
      closingBalance: 9058.59,
    },
  ];

  it("prime sur toute reconstruction théorique", () => {
    const liability = loan({
      principal: 10000,
      currentBalance: 10000,
      paymentCount: 24,
      monthlyPayment: 999,
      providedSchedule: provided,
    });
    const schedule = buildContractualSchedule(liability);
    expect(schedule.kind).toBe("ACTUAL");
    expect(schedule.entries).toHaveLength(2);
    // Les montants de la banque sont repris tels quels, jamais recalculés.
    expect(schedule.entries[0].interest).toBeCloseTo(30, 9);
    expect(schedule.entries[0].totalCashOut).toBeCloseTo(514, 9);
    expect(
      buildLoanTimeline(liability, "2026-08-19").flags.some(
        (f) => f.code === "PROVIDED_SCHEDULE_USED",
      ),
    ).toBe(true);
    expectEntryInvariants(schedule);
  });

  it("le forward n’expose que les lignes bancaires encore à venir", () => {
    const liability = loan({
      principal: 10000,
      currentBalance: 9530,
      paymentCount: 24,
      providedSchedule: provided,
    });
    const forward = buildForwardSchedule(liability, "2026-09-20");
    expect(forward.kind).toBe("ACTUAL");
    expect(forward.entries).toHaveLength(1);
    expect(forward.entries[0].dueDate).toBe("2026-10-05");
  });
});

describe("CASE D12 — neutralité patrimoniale du principal", () => {
  it("sépare le décaissement du coût économique", () => {
    const liability = loan({
      monthlyPayment: 703.25,
      monthlyInsurance: 20,
      recurringFees: 3,
      paymentIncludesInsurance: false,
      firstPaymentDate: "2026-09-05",
    });
    const asOf = "2026-08-19";
    const breakdown = debtServiceBreakdownForPeriod([liability], asOf, "2026-09-01", "2026-09-30");
    expect(breakdown.totalCashOut).toBeCloseTo(
      breakdown.principal + breakdown.interest + breakdown.insurance + breakdown.fees,
      6,
    );
    // Seuls intérêts, assurance et frais appauvrissent. Le principal éteint un passif.
    expect(breakdown.economicCost).toBeCloseTo(
      breakdown.interest + breakdown.capitalisedInterest + breakdown.insurance + breakdown.fees,
      6,
    );
    expect(breakdown.economicCost).toBeLessThan(breakdown.totalCashOut);
    expect(breakdown.principal).toBeGreaterThan(0);
    expect(breakdown.economicCost).toBeCloseTo((120000 * 0.036) / 12 + 20 + 3, 6);
  });

  it("ClosingDebt = OpeningDebt − PrincipalPaid sur tout l’échéancier", () => {
    const schedule = buildContractualSchedule(loan({ monthlyPayment: 703.25 }));
    const principalTotal = schedule.entries.reduce((sum, row) => sum + row.principal, 0);
    expect(principalTotal).toBeCloseTo(120000, 2);
    for (const row of schedule.entries) {
      expect(row.closingBalance).toBeCloseTo(row.openingBalance - row.principal, 6);
    }
  });
});

describe("CASE D13 — mensualité insuffisante", () => {
  it("signale l’amortissement négatif plutôt que de le laisser passer", () => {
    // 200 € par mois sur un encours de 120 000 € à 3,6 % : l'intérêt mensuel est de 360 €.
    const liability = loan({ monthlyPayment: 200 });
    const timeline = buildLoanTimeline(liability, "2026-08-19");
    expect(timeline.flags.some((flag) => flag.code === "NEGATIVE_AMORTISATION")).toBe(true);
    const premiere = timeline.contractual.entries[0];
    expect(premiere.principal).toBeCloseTo(0, 9);
    expect(premiere.interest).toBeCloseTo(200, 9);
    expect(premiere.capitalisedInterest).toBeCloseTo(160, 6);
    expect(premiere.closingBalance).toBeGreaterThan(premiere.openingBalance);
    expectEntryInvariants(timeline.contractual);
  });
});

describe("CASE D14 — service de dette agrégé", () => {
  it("additionne plusieurs prêts hétérogènes sur la même période", () => {
    const amortissable = loan({
      id: "l1",
      monthlyPayment: 703.25,
      monthlyInsurance: 20,
      paymentIncludesInsurance: false,
      firstPaymentDate: "2026-09-05",
    });
    const zero = loan({
      id: "l2",
      annualRate: 0,
      principal: 12000,
      currentBalance: 12000,
      paymentCount: 24,
      monthlyPayment: 500,
      firstPaymentDate: "2026-09-10",
      maturityDate: "2028-08-10",
    });
    const asOf = "2026-08-19";
    const breakdown = debtServiceBreakdownForPeriod(
      [amortissable, zero],
      asOf,
      "2026-09-01",
      "2026-09-30",
    );
    expect(breakdown.interest).toBeCloseTo((120000 * 0.036) / 12, 6);
    expect(breakdown.insurance).toBeCloseTo(20, 9);
    expect(breakdown.principal).toBeCloseTo(703.25 - (120000 * 0.036) / 12 + 500, 6);
    expect(breakdown.totalCashOut).toBeCloseTo(703.25 + 20 + 500, 6);
    expect(breakdown.cashImpact).toBeCloseTo(-(703.25 + 20 + 500), 6);
    expect(breakdown.liabilityDelta).toBeCloseTo(-breakdown.principal, 6);
    expect(breakdown.principalMovement).toBeCloseTo(-breakdown.principal, 6);
    expect(breakdown.kind).toBe("DERIVED");
    expect(breakdown.sourceLiabilityIds).toEqual(["l1", "l2"]);
  });
});

describe("CASE D15 — interconnexion Monthly Financial Model", () => {
  it("expose assurance et frais que le bilan mensuel consomme sans les recomposer", () => {
    const liability = loan({
      monthlyPayment: 702.13,
      monthlyInsurance: 20,
      recurringFees: 3,
      paymentIncludesInsurance: false,
      firstPaymentDate: "2026-09-05",
      currentBalance: 120000,
    });
    // C'est exactement ce que buildDebtCalendar agrège : les champs de la ligne, un à un.
    const forward = buildForwardSchedule(liability, "2026-08-19");
    const premiere = forward.entries[0];
    expect(premiere.insurance).toBeCloseTo(20, 9);
    expect(premiere.fees).toBeCloseTo(3, 9);
    // ΔNetWorth retranche interest + insurance + fees, jamais le principal.
    const coutEconomique = premiere.interest + premiere.insurance + premiere.fees;
    expect(coutEconomique).toBeCloseTo((120000 * 0.036) / 12 + 23, 6);
    expect(premiere.totalCashOut - premiere.principal).toBeCloseTo(coutEconomique, 6);
  });

  it("le service de dette consommé par Cash Flow est le décaissement complet", () => {
    const liability = loan({
      monthlyPayment: 702.13,
      monthlyInsurance: 20,
      recurringFees: 3,
      paymentIncludesInsurance: false,
      firstPaymentDate: "2026-09-05",
    });
    const asOf = "2026-08-19";
    const cashOut = debtServiceForPeriod([liability], asOf, "2026-09-01", "2026-09-30");
    const breakdown = debtServiceBreakdownForPeriod([liability], asOf, "2026-09-01", "2026-09-30");
    expect(cashOut).toBeCloseTo(702.13 + 20 + 3, 6);
    expect(cashOut).toBeCloseTo(breakdown.totalCashOut, 9);
  });

  it("un différé total ne décaisse rien mais appauvrit quand même", () => {
    const liability = loan({
      monthlyPayment: 702.13,
      firstPaymentDate: "2026-09-05",
      deferral: { kind: "TOTAL", months: 6, interestTreatment: "CAPITALISED" },
    });
    const asOf = "2026-08-19";
    const breakdown = debtServiceBreakdownForPeriod([liability], asOf, "2026-09-01", "2026-09-30");
    // Rien ne sort du compte : le Cash Flow ne doit voir aucune sortie.
    expect(breakdown.totalCashOut).toBeCloseTo(0, 9);
    // Mais la dette grossit : le patrimoine net baisse du montant capitalisé.
    expect(breakdown.economicCost).toBeCloseTo((120000 * 0.036) / 12, 6);
    expect(breakdown.capitalisedInterest).toBeCloseTo((120000 * 0.036) / 12, 6);
  });
});

describe("CASE D16 — la charge implicite réconcilie le prêt étudiant", () => {
  it("passe d’un écart de 338,20 € à un écart nul une fois l’assurance déclarée", () => {
    // Le contrat déclare 60 × 284,72 € pour 16 745 € empruntés à 0 %. L'écart de 338,20 €
    // n'a jamais été expliqué. Le moteur en donne le profil par échéance ; le déclarer
    // comme assurance comprise réconcilie le contrat presque au centime.
    const avant = buildLoanTimeline(studentLoan, "2026-08-19");
    expect(avant.contractualGap).toBeCloseTo(338.2, 2);
    expect(avant.impliedChargePerPayment).toBeCloseTo(5.6367, 3);

    const apres = buildLoanTimeline(
      { ...studentLoan, monthlyInsurance: 5.64, paymentIncludesInsurance: true },
      "2026-08-19",
    );
    expect(apres.contractualGap).toBeCloseTo(-0.2, 2);
    expect(apres.flags.some((flag) => flag.code === "PAYMENT_EXCEEDS_AMORTISATION")).toBe(false);
    // Le décaissement mensuel reste 284,72 € : c'est sa répartition qui change.
    const premiere = apres.contractual.entries[0];
    expect(premiere.totalCashOut).toBeCloseTo(284.72, 6);
    expect(premiere.principal).toBeCloseTo(279.08, 6);
    expect(premiere.insurance).toBeCloseTo(5.64, 6);
  });

  it("une reconstruction stockée en base ne devient jamais un échéancier bancaire", () => {
    // Le dossier contient 60 lignes DERIVED en base. Les traiter comme un échéancier
    // fourni reviendrait à figer nos propres hypothèses en faits de la banque.
    expect(studentLoan.providedSchedule).toHaveLength(0);
    expect(buildContractualSchedule(studentLoan).kind).toBe("DERIVED");
  });
});

describe("CASE D17 — échéancier bancaire contre encours observé", () => {
  const provided = [
    {
      paymentNumber: 1,
      dueDate: "2026-09-05",
      openingBalance: 10000,
      interest: 30,
      principal: 470,
      insurance: 12,
      fees: 2,
      closingBalance: 9530,
    },
    {
      paymentNumber: 2,
      dueDate: "2026-10-05",
      openingBalance: 9530,
      interest: 28.59,
      principal: 471.41,
      insurance: 12,
      fees: 2,
      closingBalance: 9058.59,
    },
    {
      paymentNumber: 3,
      dueDate: "2026-11-05",
      openingBalance: 9058.59,
      interest: 27.18,
      principal: 472.82,
      insurance: 12,
      fees: 2,
      closingBalance: 8585.77,
    },
  ];

  /** Échéancier bancaire devenu obsolète : l'encours réel est 800 € au-dessus. */
  const obsolete = loan({
    principal: 10000,
    currentBalance: 10330,
    paymentCount: 24,
    providedSchedule: provided,
  });
  const asOf = "2026-09-20";

  it("l’encours observé reste la vérité du bilan à la date d’analyse", () => {
    expect(outstandingBalanceAt(obsolete, asOf)).toBeCloseTo(10330, 6);
    expect(buildLoanTimeline(obsolete, asOf).balance.observed).toBeCloseTo(10330, 6);
  });

  it("l’échéancier bancaire reste la vérité des prélèvements futurs", () => {
    const forward = buildForwardSchedule(obsolete, asOf);
    expect(forward.kind).toBe("ACTUAL");
    expect(forward.entries.map((row) => row.dueDate)).toEqual(["2026-10-05", "2026-11-05"]);
    expect(forward.entries[0].totalCashOut).toBeCloseTo(514, 6);
  });

  it("la contradiction est signalée, jamais résorbée en silence", () => {
    const timeline = buildLoanTimeline(obsolete, asOf);
    expect(timeline.balance.reconciled).toBe(false);
    expect(timeline.balance.contractual).toBeCloseTo(9530, 6);
    expect(timeline.balance.difference).toBeCloseTo(800, 6);
    expect(timeline.flags.some((flag) => flag.code === "BALANCE_MISMATCH")).toBe(true);
  });

  it("l’échéancier bancaire n’écrase jamais l’encours observé dans la projection", () => {
    // Le document annonce 9 058,59 € au 5 octobre. L'observation dit 800 € de plus.
    // La projection part de l'observé et n'applique que les variations du document.
    expect(projectedBalanceAt(obsolete, asOf, "2026-10-05")).toBeCloseTo(10330 - 471.41, 6);
    expect(projectedBalanceAt(obsolete, asOf, "2026-11-05")).toBeCloseTo(
      10330 - 471.41 - 472.82,
      6,
    );
    // L'écart de 800 € est conservé, ni absorbé ni amplifié.
    expect(projectedBalanceAt(obsolete, asOf, "2026-11-05") - 8585.77).toBeCloseTo(800, 6);
  });

  it("un encours observé réconcilié donne la même projection que le document", () => {
    const conforme = { ...obsolete, currentBalance: 9530 };
    expect(buildLoanTimeline(conforme, asOf).balance.reconciled).toBe(true);
    expect(projectedBalanceAt(conforme, asOf, "2026-11-05")).toBeCloseTo(8585.77, 6);
  });
});

describe("CASE D18 — propagation des hypothèses", () => {
  const cas = [
    {
      nom: "assurance de convention inconnue",
      liability: loan({
        monthlyPayment: 702.13,
        monthlyInsurance: 25,
        paymentIncludesInsurance: null,
      }),
      code: "INSURANCE_TREATMENT_UNKNOWN" as const,
    },
    {
      nom: "différé total de traitement inconnu",
      liability: loan({
        monthlyPayment: 702.13,
        deferral: { kind: "TOTAL" as const, months: 6, interestTreatment: "UNKNOWN" as const },
      }),
      code: "DEFERRAL_INTEREST_UNKNOWN" as const,
    },
    {
      nom: "remboursement anticipé de convention inconnue",
      liability: loan({
        monthlyPayment: 702.13,
        earlyRepayments: [
          {
            id: "er",
            liabilityId: "lia_v2",
            date: "2030-06-15",
            amount: 10000,
            penalty: 100,
            outcome: "UNKNOWN" as const,
          },
        ],
      }),
      code: "EARLY_REPAYMENT_CONVENTION_UNKNOWN" as const,
    },
    {
      nom: "indemnité de remboursement inconnue",
      liability: loan({
        monthlyPayment: 702.13,
        earlyRepayments: [
          {
            id: "er",
            liabilityId: "lia_v2",
            date: "2030-06-15",
            amount: 10000,
            penalty: null,
            outcome: "SHORTEN_TERM" as const,
          },
        ],
      }),
      code: "EARLY_REPAYMENT_PENALTY_UNKNOWN" as const,
    },
  ];

  for (const { nom, liability, code } of cas) {
    it(`${nom} : échéancier et lignes marqués MODEL_ASSUMPTION, drapeau visible`, () => {
      const timeline = buildLoanTimeline(liability, "2026-08-19");
      const schedule = code.startsWith("EARLY_REPAYMENT") ? timeline.forward : timeline.contractual;
      expect(timeline.flags.some((flag) => flag.code === code)).toBe(true);
      // Le niveau qui compte pour un consommateur est celui de l'échéancier : c'est la
      // TRAJECTOIRE qui devient hypothétique.
      expect(schedule.kind).toBe("MODEL_ASSUMPTION");
      expect(schedule.entries.some((row) => row.kind === "MODEL_ASSUMPTION")).toBe(true);
      // Aucune échéance projetée ne peut passer pour constatée. Une ligne qui enregistre un
      // fait déclaré, comme un remboursement dont le montant et l'indemnité sont connus,
      // reste ACTUAL : la dégrader serait moins précis, pas plus prudent.
      expect(
        schedule.entries
          .filter((row) => row.entryKind === "PAYMENT")
          .every((row) => row.kind !== "ACTUAL"),
      ).toBe(true);
    });
  }

  it("un contrat complet reste DERIVED, sans hypothèse superflue", () => {
    const net = loan({
      monthlyPayment: 702.13,
      monthlyInsurance: 25,
      paymentIncludesInsurance: false,
      recurringFees: 2,
    });
    const timeline = buildLoanTimeline(net, "2026-08-19");
    expect(timeline.contractual.kind).toBe("DERIVED");
    expect(timeline.forward.kind).toBe("DERIVED");
    expect(timeline.flags.filter((flag) => flag.code.endsWith("_UNKNOWN"))).toHaveLength(0);
  });

  it("un échéancier bancaire perd son statut ACTUAL si un événement est hypothétique", () => {
    const banque = loan({
      principal: 10000,
      currentBalance: 10000,
      paymentCount: 24,
      providedSchedule: [
        {
          paymentNumber: 1,
          dueDate: "2027-01-05",
          openingBalance: 10000,
          interest: 30,
          principal: 470,
          insurance: 0,
          fees: 0,
          closingBalance: 9530,
        },
      ],
    });
    expect(buildForwardSchedule(banque, "2026-08-19").kind).toBe("ACTUAL");
    const avecEvenement = {
      ...banque,
      earlyRepayments: [
        {
          id: "er",
          liabilityId: "lia_v2",
          date: "2027-02-01",
          amount: 5000,
          penalty: null,
          outcome: "UNKNOWN" as const,
        },
      ],
    };
    // Le document bancaire ne prévoit pas ce remboursement : ses prélèvements postérieurs
    // ne sont plus ceux qu'il annonce.
    expect(buildForwardSchedule(avecEvenement, "2026-08-19").kind).toBe("MODEL_ASSUMPTION");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// DEBT V2.1 — couverture contractuelle élargie
// ═══════════════════════════════════════════════════════════════════════════════════════

describe("CASE E-A — amortissable standard inchangé", () => {
  it("produit exactement le même échéancier qu’avant l’extension", () => {
    const liability = loan({ monthlyPayment: 702.13 });
    const schedule = buildContractualSchedule(liability);
    expect(schedule.kind).toBe("DERIVED");
    expect(schedule.entries).toHaveLength(240);
    expect(schedule.entries[0].interest).toBeCloseTo((120000 * 0.036) / 12, 6);
    expect(schedule.entries[0].principal).toBeCloseTo(702.13 - 360, 6);
    // 702,13 € déclarés au lieu de 702,1337 : le résidu d'arrondi est le comportement
    // historique, inchangé par l'extension.
    expect(schedule.entries.at(-1)?.closingBalance).toBeLessThan(2);
    expectEntryInvariants(schedule);
  });
});

describe("CASE E-B — interest-only", () => {
  it("ne rembourse aucun capital et laisse l’encours stable", () => {
    const liability = loan({ amortisationProfile: "INTEREST_ONLY", paymentCount: 24 });
    const schedule = buildContractualSchedule(liability);
    expect(schedule.entries).toHaveLength(24);
    for (const row of schedule.entries) {
      expect(row.principal).toBeCloseTo(0, 9);
      expect(row.interest).toBeCloseTo((120000 * 0.036) / 12, 6);
      expect(row.closingBalance).toBeCloseTo(120000, 6);
    }
    // Aucun capital remboursé : l'encours final est le capital emprunté.
    expect(schedule.totalInterest).toBeCloseTo(24 * 360, 4);
    expectEntryInvariants(schedule);
  });

  it("conserve explicitement le capital après la dernière échéance d’intérêts", () => {
    const liability = loan({ amortisationProfile: "INTEREST_ONLY", paymentCount: 24 });
    const afterMaturity = addMonths(dueDateOf(liability, 24), 1);
    expect(outstandingBalanceAt(liability, "2026-08-19", afterMaturity)).toBeCloseTo(120000, 6);
    expect(monthlyDebtServiceAt([liability], afterMaturity)).toBeCloseTo(0, 9);
  });
});

describe("CASE E-C — in fine / bullet", () => {
  it("garde le capital intact puis le rembourse à maturité", () => {
    const liability = loan({ amortisationProfile: "BULLET", paymentCount: 24 });
    const schedule = buildContractualSchedule(liability);
    expect(schedule.entries).toHaveLength(24);
    for (const row of schedule.entries.slice(0, 23)) {
      expect(row.principal).toBeCloseTo(0, 9);
      expect(row.closingBalance).toBeCloseTo(120000, 6);
    }
    const derniere = schedule.entries[23];
    expect(derniere.principal).toBeCloseTo(120000, 6);
    expect(derniere.interest).toBeCloseTo(360, 6);
    expect(derniere.totalCashOut).toBeCloseTo(120360, 6);
    expect(derniere.closingBalance).toBeCloseTo(0, 6);
    expectEntryInvariants(schedule);
  });

  it("le remboursement final est neutre au patrimoine hors coût", () => {
    const liability = loan({ amortisationProfile: "BULLET", paymentCount: 24 });
    const asOf = "2026-08-19";
    const derniere = dueDateOf(liability, 24);
    const mois = monthBounds(derniere);
    const b = debtServiceBreakdownForPeriod([liability], asOf, mois.start, mois.end);
    expect(b.totalCashOut).toBeCloseTo(120360, 6);
    expect(b.principal).toBeCloseTo(120000, 6);
    // Seuls 360 € appauvrissent : les 120 000 € éteignent un passif.
    expect(b.economicCost).toBeCloseTo(360, 6);
  });

  it("éteint explicitement l’encours à maturité et ne le conserve pas ensuite", () => {
    const liability = loan({ amortisationProfile: "BULLET", paymentCount: 24 });
    const maturity = dueDateOf(liability, 24);
    expect(outstandingBalanceAt(liability, "2026-08-19", maturity)).toBeCloseTo(0, 6);
    expect(outstandingBalanceAt(liability, "2026-08-19", addMonths(maturity, 1))).toBeCloseTo(0, 6);
  });
});

describe("CASE E-D — balloon", () => {
  it("amortit partiellement puis solde le résiduel à la dernière échéance", () => {
    const liability = loan({
      amortisationProfile: "BALLOON",
      balloonAmount: 60000,
      paymentCount: 60,
      monthlyPayment: 0,
    });
    const schedule = buildContractualSchedule(liability);
    expect(schedule.entries).toHaveLength(60);
    // Amortissement réel pendant la vie du prêt, mais partiel.
    expect(schedule.entries[0].principal).toBeGreaterThan(0);
    // À mi-vie, une partie seulement du capital est remboursée : c'est ce qui distingue le
    // balloon de l'in fine.
    expect(schedule.entries[29].closingBalance).toBeLessThan(120000);
    expect(schedule.entries[29].closingBalance).toBeGreaterThan(60000);
    // Le paiement courant amortit vers le solde cible, atteint à la dernière échéance.
    const avantDerniere = schedule.entries[58];
    const derniere = schedule.entries[59];
    expect(avantDerniere.closingBalance - derniere.interest).toBeGreaterThan(60000);
    expect(derniere.principal).toBeCloseTo(avantDerniere.closingBalance, 4);
    expect(derniere.principal).toBeGreaterThan(60000);
    expect(derniere.closingBalance).toBeCloseTo(0, 6);
    expectEntryInvariants(schedule);
  });

  it("signale un profil balloon sans montant de solde final", () => {
    const timeline = buildLoanTimeline(
      loan({ amortisationProfile: "BALLOON", balloonAmount: null, monthlyPayment: 0 }),
      "2026-08-19",
    );
    expect(timeline.flags.some((flag) => flag.code === "BALLOON_AMOUNT_MISSING")).toBe(true);
  });
});

describe("CASE E-E — échéance trimestrielle", () => {
  const liability = loan({
    paymentFrequency: "QUARTERLY",
    paymentCount: 20,
    monthlyPayment: 0,
    firstPaymentDate: "2026-09-05",
  });

  it("date les échéances tous les trois mois", () => {
    const schedule = buildContractualSchedule(liability);
    expect(schedule.entries.slice(0, 4).map((row) => row.dueDate)).toEqual([
      "2026-09-05",
      "2026-12-05",
      "2027-03-05",
      "2027-06-05",
    ]);
    // L'intérêt d'une période trimestrielle couvre trois mois.
    expect(schedule.entries[0].interest).toBeCloseTo((120000 * 0.036 * 3) / 12, 6);
    expect(schedule.entries.at(-1)?.closingBalance).toBeCloseTo(0, 2);
    expectEntryInvariants(schedule);
  });

  it("ne facture rien dans les mois sans échéance", () => {
    const asOf = "2026-08-19";
    expect(debtServiceForPeriod([liability], asOf, "2026-10-01", "2026-10-31")).toBeCloseTo(0, 9);
    expect(debtServiceForPeriod([liability], asOf, "2026-11-01", "2026-11-30")).toBeCloseTo(0, 9);
    const decembre = debtServiceForPeriod([liability], asOf, "2026-12-01", "2026-12-31");
    expect(decembre).toBeGreaterThan(0);
    // Aucun lissage : le trimestre entier tombe sur un seul mois.
    const trimestre = debtServiceForPeriod([liability], asOf, "2026-10-01", "2026-12-31");
    expect(trimestre).toBeCloseTo(decembre, 9);
  });
});

describe("CASE E-F — changement de taux connu", () => {
  it("applique le nouveau taux à sa date, sans effet rétroactif", () => {
    const liability = loan({
      monthlyPayment: 702.13,
      rateType: "VARIABLE",
      rateSchedule: [
        { effectiveFrom: "2028-01-01", annualRate: 0.05, kind: "CONTRACTUAL" },
        { effectiveFrom: "2046-09-01", annualRate: 0.05, kind: "CONTRACTUAL" },
      ],
    });
    expect(annualRateAt(liability, "2027-12-31")).toBeCloseTo(0.036, 9);
    expect(annualRateAt(liability, "2028-01-01")).toBeCloseTo(0.05, 9);
    const schedule = buildContractualSchedule(liability);
    const avant = schedule.entries.find((row) => row.dueDate === "2027-12-05");
    const apres = schedule.entries.find((row) => row.dueDate === "2028-01-05");
    expect(avant?.interest).toBeCloseTo((avant!.openingBalance * 0.036) / 12, 6);
    expect(apres?.interest).toBeCloseTo((apres!.openingBalance * 0.05) / 12, 6);
    // La hausse de taux ralentit l'amortissement à paiement constant.
    expect(apres!.principal).toBeLessThan(avant!.principal);
    expectEntryInvariants(schedule);
  });
});

describe("CASE E-G — taux révisable non projetable", () => {
  it("n’érige jamais le taux du jour en certitude contractuelle", () => {
    const liability = loan({ monthlyPayment: 702.13, rateType: "VARIABLE", rateSchedule: [] });
    const timeline = buildLoanTimeline(liability, "2026-08-19");
    expect(timeline.flags.some((flag) => flag.code === "VARIABLE_RATE_UNPROJECTABLE")).toBe(true);
    expect(timeline.contractual.kind).toBe("MODEL_ASSUMPTION");
    expect(timeline.forward.kind).toBe("MODEL_ASSUMPTION");
    expect(
      timeline.contractual.entries
        .filter((row) => row.entryKind === "PAYMENT")
        .every((row) => row.kind === "MODEL_ASSUMPTION"),
    ).toBe(true);
  });

  it("une hypothèse de taux déclarée reste une hypothèse, pas une clause", () => {
    const liability = loan({
      monthlyPayment: 702.13,
      rateType: "VARIABLE",
      rateSchedule: [{ effectiveFrom: "2030-01-01", annualRate: 0.055, kind: "ASSUMPTION" }],
    });
    const timeline = buildLoanTimeline(liability, "2026-08-19");
    expect(timeline.flags.some((flag) => flag.code === "RATE_ASSUMPTION_APPLIED")).toBe(true);
    expect(timeline.contractual.kind).toBe("MODEL_ASSUMPTION");
  });

  it("un taux fixe sans révision ne déclenche aucune hypothèse", () => {
    const timeline = buildLoanTimeline(loan({ monthlyPayment: 702.13 }), "2026-08-19");
    expect(timeline.flags.some((flag) => flag.code === "VARIABLE_RATE_UNPROJECTABLE")).toBe(false);
    expect(timeline.contractual.kind).toBe("DERIVED");
  });
});

describe("CASE E-H — paiement évolutif", () => {
  it("change de montant exactement à la date prévue", () => {
    const liability = loan({
      monthlyPayment: 702.13,
      paymentSchedule: [{ effectiveFrom: "2029-01-01", amount: 900, kind: "CONTRACTUAL" }],
    });
    const schedule = buildContractualSchedule(liability);
    const avant = schedule.entries.find((row) => row.dueDate === "2028-12-05");
    const apres = schedule.entries.find((row) => row.dueDate === "2029-01-05");
    expect(avant!.principal + avant!.interest).toBeCloseTo(702.13, 6);
    expect(apres!.principal + apres!.interest).toBeCloseTo(900, 6);
    // Le step-up éteint le prêt avant la 240e échéance.
    expect(schedule.entries.length).toBeLessThan(240);
    expect(schedule.entries.at(-1)?.closingBalance).toBeCloseTo(0, 2);
    expectEntryInvariants(schedule);
  });
});

describe("CASE E-I / E-J — frais payés cash contre frais financés", () => {
  const charge = (financed: boolean) => ({
    id: "c1",
    liabilityId: "lia_v2",
    date: "2026-09-20",
    amount: 900,
    label: "Frais de dossier",
    financed,
  });

  it("un frais payé cash sort du compte et n’augmente pas la dette", () => {
    const liability = loan({ monthlyPayment: 702.13, oneOffCharges: [charge(false)] });
    const b = debtServiceBreakdownForPeriod([liability], "2026-08-19", "2026-09-01", "2026-09-30");
    expect(b.fees).toBeCloseTo(900, 6);
    expect(b.capitalisedCharges).toBeCloseTo(0, 9);
    expect(b.totalCashOut).toBeCloseTo(702.13 + 900, 6);
    expect(b.economicCost).toBeCloseTo(360 + 900, 6);
  });

  it("un frais financé n’est pas décaissé mais alourdit l’encours", () => {
    const liability = loan({ monthlyPayment: 702.13, oneOffCharges: [charge(true)] });
    const b = debtServiceBreakdownForPeriod([liability], "2026-08-19", "2026-09-01", "2026-09-30");
    // Aucun euro supplémentaire ne sort : seule l'échéance est décaissée.
    expect(b.totalCashOut).toBeCloseTo(702.13, 6);
    expect(b.fees).toBeCloseTo(0, 9);
    expect(b.capitalisedCharges).toBeCloseTo(900, 6);
    // Mais c'est bien un coût : il appauvrit par la dette, pas par la trésorerie.
    expect(b.economicCost).toBeCloseTo(360 + 900, 6);
    // Aucun double comptage : l'encours monte d'exactement 900 €.
    const forward = buildForwardSchedule(liability, "2026-08-19");
    const ligne = forward.entries.find((row) => row.entryKind === "CHARGE");
    expect(ligne?.closingBalance).toBeCloseTo(ligne!.openingBalance + 900, 6);
    const apres = forward.entries.find(
      (row) => row.entryKind === "PAYMENT" && row.dueDate === "2026-10-05",
    );
    const avant = forward.entries.find(
      (row) => row.entryKind === "PAYMENT" && row.dueDate === "2026-09-05",
    );
    expect(apres!.openingBalance - avant!.closingBalance).toBeCloseTo(900, 6);
    expectEntryInvariants(forward);
  });

  it("intègre un frais financé dans chaque lecture projetée de l’encours", () => {
    const liability = loan({
      currentBalance: 100000,
      firstPaymentDate: "2027-09-05",
      maturityDate: "2047-08-05",
      oneOffCharges: [charge(true)],
    });

    const breakdown = debtServiceBreakdownForPeriod(
      [liability],
      "2026-08-19",
      "2026-09-01",
      "2026-09-30",
    );
    expect(breakdown.totalCashOut).toBeCloseTo(0, 9);
    expect(breakdown.capitalisedCharges).toBeCloseTo(900, 9);
    expect(breakdown.economicCost).toBeCloseTo(900, 9);
    expect(projectedBalanceAt(liability, "2026-08-19", "2026-09-20")).toBeCloseTo(100900, 9);
    expect(outstandingBalanceAt(liability, "2026-08-19", "2026-09-20")).toBeCloseTo(100900, 9);
  });
});

describe("CASE E-L — neutralité patrimoniale sur bullet et balloon", () => {
  it("le principal final ne détruit aucun patrimoine", () => {
    for (const liability of [
      loan({ amortisationProfile: "BULLET", paymentCount: 12 }),
      loan({
        amortisationProfile: "BALLOON",
        balloonAmount: 80000,
        paymentCount: 12,
        monthlyPayment: 0,
      }),
    ]) {
      const schedule = buildContractualSchedule(liability);
      const principalTotal = schedule.entries.reduce((sum, row) => sum + row.principal, 0);
      // Tout le capital est bien remboursé, ni plus ni moins.
      expect(principalTotal).toBeCloseTo(120000, 2);
      expect(schedule.entries.at(-1)?.closingBalance).toBeCloseTo(0, 4);
      expectEntryInvariants(schedule);
    }
  });
});

describe("CASE E-P — extinction totale par remboursement anticipé", () => {
  it("solde le prêt et n’émet plus aucune échéance ensuite", () => {
    const liability = loan({
      monthlyPayment: 702.13,
      currentBalance: 100000,
      earlyRepayments: [
        {
          id: "payoff",
          liabilityId: "lia_v2",
          date: "2030-06-15",
          amount: 200000,
          penalty: 1500,
          outcome: "SHORTEN_TERM",
        },
      ],
    });
    const forward = buildForwardSchedule(liability, "2030-01-10");
    const payoff = forward.entries.find((row) => row.entryKind === "EARLY_REPAYMENT");
    // On ne rembourse jamais plus que l'encours, même si le montant déclaré le dépasse.
    expect(payoff!.principal).toBeLessThanOrEqual(100000);
    expect(payoff!.closingBalance).toBeCloseTo(0, 6);
    expect(payoff!.fees).toBeCloseTo(1500, 6);
    expect(forward.entries.filter((row) => row.dueDate > "2030-06-15")).toHaveLength(0);
    expectEntryInvariants(forward);
  });
});

describe("CASE E-Q — convention de calcul des intérêts", () => {
  it("ACTUAL_365 compte les jours réels, PROPORTIONAL les mois", () => {
    const base = { monthlyPayment: 0, paymentCount: 4, paymentFrequency: "QUARTERLY" as const };
    const proportionnel = buildContractualSchedule(loan(base));
    const jours = buildContractualSchedule(loan({ ...base, interestConvention: "ACTUAL_365" }));
    // Un trimestre de 92 jours porte plus d'intérêt qu'un quart d'année théorique.
    expect(proportionnel.entries[0].interest).toBeCloseTo((120000 * 0.036 * 3) / 12, 6);
    const premierTrimestre = 92;
    expect(jours.entries[0].interest).toBeCloseTo((120000 * 0.036 * premierTrimestre) / 365, 4);
    expect(jours.entries[0].interest).not.toBeCloseTo(proportionnel.entries[0].interest, 2);
    expectEntryInvariants(jours);
  });
});

describe("CASE E-R — regroupement multi-tranches", () => {
  it("chaque tranche reste une dette autonome, le service de dette s’additionne", () => {
    const trancheA = loan({
      id: "tA",
      facilityId: "fac_1",
      monthlyPayment: 702.13,
      firstPaymentDate: "2026-09-05",
    });
    const trancheB = loan({
      id: "tB",
      facilityId: "fac_1",
      principal: 50000,
      currentBalance: 50000,
      annualRate: 0.05,
      amortisationProfile: "BULLET",
      paymentCount: 60,
      monthlyPayment: 0,
      firstPaymentDate: "2026-09-05",
    });
    const b = debtServiceBreakdownForPeriod(
      [trancheA, trancheB],
      "2026-08-19",
      "2026-09-01",
      "2026-09-30",
    );
    // Taux, maturité et profil diffèrent : rien n'est fondu dans une moyenne.
    expect(b.interest).toBeCloseTo((120000 * 0.036) / 12 + (50000 * 0.05) / 12, 6);
    expect(b.principal).toBeCloseTo(702.13 - 360, 6);
    expect(trancheA.facilityId).toBe(trancheB.facilityId);
  });
});

describe("CASE E-O — non-régression du prêt étudiant", () => {
  it("garde exactement le comportement validé en Debt V2", () => {
    // Le prêt du dossier n'a aucun terme V2.1 déclaré : profil, périodicité et convention
    // reprennent leurs valeurs par défaut, qui reproduisent le moteur d'origine.
    expect(studentLoan.amortisationProfile).toBe("AMORTIZING");
    expect(studentLoan.paymentFrequency).toBe("MONTHLY");
    expect(studentLoan.interestConvention).toBe("PROPORTIONAL");
    expect(studentLoan.rateType).toBe("FIXED");

    const timeline = buildLoanTimeline(studentLoan, "2026-08-19");
    expect(timeline.contractual.kind).toBe("DERIVED");
    expect(timeline.contractualGap).toBeCloseTo(338.2, 2);
    expect(timeline.impliedChargePerPayment).toBeCloseTo(338.2 / 60, 4);
    expect(timeline.contractual.entries).toHaveLength(59);
    expect(timeline.contractual.entries[0].dueDate).toBe("2026-12-05");
    expect(timeline.contractual.entries[0].principal).toBeCloseTo(284.72, 6);
    expect(timeline.contractual.entries[0].interest).toBeCloseTo(0, 9);
    expect(monthlyDebtServiceAt([studentLoan], "2026-08-19")).toBeCloseTo(0, 9);
    expect(monthlyDebtServiceAt([studentLoan], "2026-12-15")).toBeCloseTo(284.72, 6);
    expectEntryInvariants(timeline.contractual);
  });

  it("se réconcilie toujours en déclarant l’assurance implicite", () => {
    const apres = buildLoanTimeline(
      { ...studentLoan, monthlyInsurance: 5.64, paymentIncludesInsurance: true },
      "2026-08-19",
    );
    expect(apres.contractualGap).toBeCloseTo(-0.2, 2);
    expect(apres.contractual.entries[0].totalCashOut).toBeCloseTo(284.72, 6);
  });
});
