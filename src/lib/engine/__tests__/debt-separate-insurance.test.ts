import { describe, expect, it } from "vitest";
import {
  buildContractualSchedule,
  debtImpactFromEntries,
  debtServiceBreakdownForPeriod,
  insurancePeriodsOverlap,
  summariseContract,
  UNDECLARED_LOAN_TERMS,
} from "@/lib/engine/debt";
import type { Liability } from "@/lib/types";

/** Oracle O03 du document 08 (recette). */
const o03: Liability = {
  ...UNDECLARED_LOAN_TERMS,
  id: "o03",
  name: "Prêt O03",
  lender: "Banque",
  principal: 1200,
  currentBalance: 1200,
  annualRate: 0,
  monthlyPayment: 100,
  paymentCount: 12,
  firstPaymentDate: "2026-01-05",
  maturityDate: "2026-12-05",
  recurringFees: 0,
  paymentIncludesInsurance: false,
  insuranceMode: "SEPARATE",
  insurancePolicies: [
    {
      id: "pol",
      insurer: "Assureur",
      contractReference: "C-1",
      insured: [{ name: "Emprunteur", coverageShare: 1 }],
      periods: [
        {
          firstDebitDate: "2026-01-05",
          lastDebitDate: null,
          frequency: "MONTHLY",
          premiumAmount: 5,
        },
      ],
    },
  ],
  oneOffCharges: [
    {
      id: "fee",
      liabilityId: "o03",
      date: "2026-01-02",
      amount: 20,
      label: "Dossier",
      financed: false,
    },
  ],
  provenance: { kind: "USER_ASSUMPTION", confidence: "HIGH" },
};

describe("B17 : assurance séparée sur son propre calendrier (oracle O03)", () => {
  it("principal 1 200, assurance 60, coût économique 80, débits mensuels 105, sorties 1 280", () => {
    // Le frais comptant est un ÉVÉNEMENT : il vit dans la trajectoire lue par les
    // consommateurs (service de dette de la période), pas dans le contrat pur.
    const impact = debtServiceBreakdownForPeriod([o03], "2025-12-31", "2026-01-01", "2026-12-31");
    const schedule = buildContractualSchedule(o03);
    expect(impact.principal).toBeCloseTo(1200, 6);
    expect(impact.insurance).toBeCloseTo(60, 6);
    expect(impact.economicCost).toBeCloseTo(80, 6);
    expect(impact.totalCashOut).toBeCloseTo(1280, 6);
    const january = schedule.entries.filter((row) => row.dueDate === "2026-01-05");
    expect(january.reduce((sum, row) => sum + row.totalCashOut, 0)).toBeCloseTo(105, 6);
    // Une ligne d'assurance ne rembourse rien et ne change pas l'encours.
    for (const row of schedule.entries.filter((item) => item.entryKind === "INSURANCE")) {
      expect(row.principal).toBe(0);
      expect(row.closingBalance).toBe(row.openingBalance);
    }
  });

  it("garde des dates de débit différentes de celles du prêt", () => {
    const shifted: Liability = {
      ...o03,
      insurancePolicies: [
        {
          ...o03.insurancePolicies![0]!,
          periods: [
            {
              firstDebitDate: "2026-01-15",
              lastDebitDate: null,
              frequency: "MONTHLY",
              premiumAmount: 5,
            },
          ],
        },
      ],
    };
    const dates = buildContractualSchedule(shifted)
      .entries.filter((row) => row.entryKind === "INSURANCE")
      .map((row) => row.dueDate);
    expect(dates[0]).toBe("2026-01-15");
    // Fin de période : la dernière échéance du prêt (5 décembre), jamais au-delà.
    expect(dates.at(-1)).toBe("2026-11-15");
    expect(dates).toHaveLength(11);
  });

  it("ne compte pas deux fois une prime par échéance quand l'assurance est séparée", () => {
    const doubled = { ...o03, monthlyInsurance: 5 };
    const impact = debtImpactFromEntries(buildContractualSchedule(doubled).entries);
    expect(impact.insurance).toBeCloseTo(60, 6);
  });

  it("gère plusieurs périodes (variation de prime) sans chevauchement inventé", () => {
    const varying: Liability = {
      ...o03,
      insurancePolicies: [
        {
          ...o03.insurancePolicies![0]!,
          periods: [
            {
              firstDebitDate: "2026-01-05",
              lastDebitDate: "2026-06-05",
              frequency: "MONTHLY",
              premiumAmount: 5,
            },
            {
              firstDebitDate: "2026-07-05",
              lastDebitDate: null,
              frequency: "MONTHLY",
              premiumAmount: 3,
            },
          ],
        },
      ],
    };
    const impact = debtImpactFromEntries(buildContractualSchedule(varying).entries);
    expect(impact.insurance).toBeCloseTo(6 * 5 + 6 * 3, 6);
  });

  it("synthèse : assurance connue si séparée ou absente confirmée, inconnue sinon", () => {
    expect(summariseContract(o03, "2025-12-31").futureInsurance).toBeCloseTo(60, 6);
    expect(
      summariseContract({ ...o03, insuranceMode: "NONE", insurancePolicies: [] }, "2025-12-31")
        .futureInsurance,
    ).toBe(0);
    const unknown = summariseContract(
      { ...o03, insuranceMode: "UNKNOWN", insurancePolicies: [] },
      "2025-12-31",
    );
    expect(unknown.futureInsurance).toBeNull();
    expect(unknown.futureCashOut.complete).toBe(false);
    expect(unknown.unknowns).toContain("assurance");
  });

  it("ne projette pas une période « jusqu'à la fin » quand la fin du prêt n'est pas calculable", () => {
    const unresolved = buildContractualSchedule({ ...o03, paymentCount: 0 });
    expect(unresolved.kind).toBe("MISSING");
    expect(unresolved.entries).toHaveLength(0);
  });
});

describe("Relecture B17 : bornes et chevauchements", () => {
  it("garde la dernière échéance du prêt quand l'assurance est débitée à une autre date", () => {
    const shifted: Liability = {
      ...o03,
      insurancePolicies: [
        {
          ...o03.insurancePolicies![0]!,
          periods: [
            {
              firstDebitDate: "2026-01-20",
              lastDebitDate: "2026-12-20",
              frequency: "MONTHLY",
              premiumAmount: 5,
            },
          ],
        },
      ],
    };
    const schedule = buildContractualSchedule(shifted);
    expect(schedule.lastDueDate).toBe("2026-12-05");
    expect(schedule.entries.at(-1)!.entryKind).toBe("INSURANCE");
  });

  it("détecte deux périodes de prime qui se chevauchent, ouvertes ou non", () => {
    const open = { firstDebitDate: "2026-01-05", lastDebitDate: null };
    const closed = { firstDebitDate: "2026-01-05", lastDebitDate: "2026-12-05" };
    const next = { firstDebitDate: "2027-01-05", lastDebitDate: null };
    expect(insurancePeriodsOverlap([open, next])).toBe(true);
    expect(insurancePeriodsOverlap([closed, next])).toBe(false);
    expect(insurancePeriodsOverlap([next, closed])).toBe(false);
    expect(insurancePeriodsOverlap([closed, { ...next, firstDebitDate: "2026-12-05" }])).toBe(
      true,
    );
  });
});
