import { describe, expect, it } from "vitest";
import {
  calculateEmploymentTax,
  type TaxObservation,
  type TaxProfile,
  type TaxRule,
  type TaxRuleSet,
} from "@/lib/engine/tax";
import type { CareerMonthlyConsequence } from "@/lib/engine/career";

const profile: TaxProfile = {
  id: "p",
  jurisdiction: "TEST",
  residencyCountry: "TT",
  householdStatus: null,
  maritalStatus: null,
  dependants: null,
  taxShares: null,
  withholdingSettings: {},
  socialContributionRegime: null,
  professionalStatus: "EMPLOYEE",
  specialRegime: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  source: "Synthetic",
  confidence: "HIGH",
};
const set = (patch: Partial<TaxRuleSet> = {}): TaxRuleSet => ({
  id: "rs",
  jurisdiction: "TEST",
  taxYear: 2026,
  name: "Synthetic rules",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  source: "Synthetic fixture — not a real tax rule",
  sourceDate: "2026-01-01",
  confidence: "HIGH",
  status: "DECLARED",
  legalReference: null,
  ...patch,
});
const rule = (patch: Partial<TaxRule> = {}): TaxRule => ({
  id: "r-tax",
  ruleSetId: "rs",
  taxType: "INCOME_TAX_BRACKETS",
  category: "EMPLOYMENT",
  parameters: {
    brackets: [
      { threshold: 0, rate: 0 },
      { threshold: 10_000, rate: 0.1 },
      { threshold: 30_000, rate: 0.3 },
    ],
  },
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  source: "Synthetic",
  sourceDate: "2026-01-01",
  confidence: "HIGH",
  ...patch,
});
const income = (month: string, grossIncome: number | null = 4_000): CareerMonthlyConsequence => ({
  month,
  roleId: "role",
  employer: "Synthetic",
  currency: "EUR",
  fixedGross: grossIncome,
  variableGrossPaid: 0,
  otherTaxableGross: null,
  grossIncome,
  targetCompensation: null,
  dataKind: "CONTRACTUAL",
  status: grossIncome === null ? "NOT_COMPUTABLE" : "CONTRACTUAL",
  blockers: grossIncome === null ? ["GROSS_INCOME_MISSING"] : [],
  flags: [],
  methodology: [],
});
const year = (gross = 4_000) =>
  Array.from({ length: 12 }, (_, index) =>
    income(`2026-${String(index + 1).padStart(2, "0")}`, gross),
  );
const payroll = rule({ id: "r-pay", taxType: "PAYROLL_CONTRIBUTION", parameters: { rate: 0.2 } });
const withholding = rule({ id: "r-wh", taxType: "WITHHOLDING_RATE", parameters: { rate: 0.1 } });
const calculate = (patch: Partial<Parameters<typeof calculateEmploymentTax>[0]> = {}) =>
  calculateEmploymentTax({
    income: year(),
    profile,
    ruleSet: set(),
    rules: [rule(), payroll, withholding],
    taxYear: 2026,
    currency: "EUR",
    ...patch,
  });
const observation = (patch: Partial<TaxObservation>): TaxObservation => ({
  id: "o",
  type: "WITHHELD",
  observedDate: "2026-03-15",
  taxYear: 2026,
  amount: 100,
  currency: "EUR",
  transactionId: null,
  source: "Synthetic tax notice",
  confidence: "HIGH",
  ...patch,
});

describe("Tax Engine — 20 golden cases paramétriques", () => {
  it("1. gross 50k + contributions paramétrées", () =>
    expect(calculate({ income: year(50_000 / 12) }).payrollContributions).toBeCloseTo(10_000, 6));
  it("2. taux marginal progressif simple", () => expect(calculate().taxLiability).toBe(4_520));
  it("3. plusieurs tranches", () => expect(calculate().taxableIncome).toBeCloseTo(38_400, 6));
  it("4. zéro revenu produit zéro explicite", () => {
    const result = calculate({ income: year(0) });
    expect(result.taxLiability).toBe(0);
    expect(result.netCashIncome).toBe(0);
  });
  it("5. revenu inconnu reste non calculable", () =>
    expect(calculate({ income: [income("2026-01", null)] }).grossIncome).toBeNull());
  it("6. withholding n'est pas liability", () => {
    const result = calculate();
    expect(result.taxWithheld).not.toBe(result.taxLiability);
  });
  it("7. refund augmente le cash et le solde dû", () => {
    const result = calculate({ observations: [observation({ type: "REFUND", amount: 300 })] });
    expect(result.taxRefund).toBe(300);
    expect(result.monthly[2].taxRefund).toBe(300);
  });
  it("8. balance due est liability moins cash tax", () => {
    const result = calculate();
    expect(result.taxBalanceDue).toBeCloseTo(result.taxLiability! - result.taxWithheld, 6);
  });
  it("9. bonus taxable reste dans le gross fourni par Career", () => {
    const items = year();
    items[2] = income("2026-03", 9_000);
    expect(calculate({ income: items }).grossIncome).toBe(53_000);
  });
  it("10. bonus payé année suivante est exclu de 2026", () =>
    expect(calculate({ income: [...year(), income("2027-03", 9_000)] }).grossIncome).toBe(48_000));
  it("11. changement de juridiction sans profil adapté bloque", () =>
    expect(calculate({ profile: null }).blockers).toContain("TAX_PROFILE_MISSING"));
  it("12. deux revenus simultanés s'agrègent", () =>
    expect(calculate({ income: [...year(), income("2026-01", 1_000)] }).grossIncome).toBe(49_000));
  it("13. freelance est accepté par le contrat générique de revenu", () =>
    expect(calculate({ income: [income("2026-01", 2_000)] }).grossIncome).toBe(2_000));
  it("14. tax rule missing ne fabrique aucun net", () => {
    const result = calculate({ ruleSet: null, rules: [] });
    expect(result.blockers).toContain("TAX_RULES_MISSING");
    expect(result.netCashIncome).toBeNull();
  });
  it("15. stale tax rules sont signalées", () =>
    expect(calculate({ ruleSet: set({ status: "STALE" }) }).flags).toContain("TAX_RULES_STALE"));
  it("16. taux 0 explicite est calculable", () =>
    expect(
      calculate({
        rules: [
          rule(),
          rule({ id: "zero", taxType: "PAYROLL_CONTRIBUTION", parameters: { rate: 0 } }),
        ],
      }).payrollContributions,
    ).toBe(0));
  it("17. null ne devient pas zéro", () =>
    expect(calculate({ income: [income("2026-01", null)] }).netCashIncome).toBeNull());
  it("18. revenu étranger attend une conversion en amont", () => {
    const item = income("2026-01", null);
    item.blockers = ["FX_MISSING:USD/EUR"];
    expect(calculate({ income: [item] }).blockers).toContain("FX_MISSING:USD/EUR");
  });
  it("19. changement de règle au 1er janvier sélectionne l'année", () =>
    expect(calculate({ ruleSet: set({ taxYear: 2027 }) }).blockers).toContain(
      "TAX_RULE_YEAR_MISMATCH",
    ));
  it("20. changement de règle en cours d'année applique les dates", () => {
    const first = rule({
      id: "p1",
      taxType: "PAYROLL_CONTRIBUTION",
      parameters: { rate: 0.1 },
      effectiveTo: "2026-06-30",
    });
    const second = rule({
      id: "p2",
      taxType: "PAYROLL_CONTRIBUTION",
      parameters: { rate: 0.2 },
      effectiveFrom: "2026-07-01",
    });
    expect(calculate({ rules: [rule(), first, second] }).payrollContributions).toBeCloseTo(
      7_200,
      6,
    );
  });
  it("observed liability produit AFTER_TAX_VERIFIED sans confondre cash tax", () => {
    const result = calculate({ observations: [observation({ type: "LIABILITY", amount: 8_000 })] });
    expect(result.status).toBe("AFTER_TAX_VERIFIED");
    expect(result.taxLiability).toBe(8_000);
    expect(result.taxPaid).toBe(0);
  });
});
