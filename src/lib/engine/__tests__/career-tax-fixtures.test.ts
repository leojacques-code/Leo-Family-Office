import { describe, expect, it } from "vitest";

import { buildCareerMonthlyConsequences } from "@/lib/engine/career";
import { SYNTHETIC_CAREER_TAX_PROFILES } from "@/lib/engine/__tests__/fixtures/career-tax";
import { calculateEmploymentTax, type TaxRule, type TaxRuleSet } from "@/lib/engine/tax";

const ruleSet: TaxRuleSet = {
  id: "synthetic-rules",
  jurisdiction: "SYNTHETIC",
  taxYear: 2026,
  name: "Parametric test only",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  source: "Synthetic test rule",
  sourceDate: "2026-01-01",
  confidence: "HIGH",
  status: "VERIFIED",
  legalReference: null,
};
const rules: TaxRule[] = [
  {
    id: "payroll",
    ruleSetId: ruleSet.id,
    taxType: "PAYROLL_CONTRIBUTION",
    category: "EMPLOYMENT",
    parameters: { rate: 0.2 },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: ruleSet.source,
    sourceDate: ruleSet.sourceDate,
    confidence: "HIGH",
  },
  {
    id: "withholding",
    ruleSetId: ruleSet.id,
    taxType: "WITHHOLDING_RATE",
    category: "EMPLOYMENT",
    parameters: { rate: 0.08 },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: ruleSet.source,
    sourceDate: ruleSet.sourceDate,
    confidence: "HIGH",
  },
  {
    id: "brackets",
    ruleSetId: ruleSet.id,
    taxType: "INCOME_TAX_BRACKETS",
    category: "EMPLOYMENT",
    parameters: {
      brackets: [
        { threshold: 0, rate: 0 },
        { threshold: 20_000, rate: 0.1 },
      ],
    },
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    source: ruleSet.source,
    sourceDate: ruleSet.sourceDate,
    confidence: "HIGH",
  },
];

describe("six profils Career + Tax réalistes et strictement synthétiques", () => {
  for (const fixture of SYNTHETIC_CAREER_TAX_PROFILES) {
    it(fixture.name, () => {
      const career = buildCareerMonthlyConsequences({
        roles: fixture.roles,
        terms: fixture.terms,
        events: fixture.events,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        reportingCurrency: "EUR",
        currencyRates: fixture.currencyRates,
      });
      const tax = calculateEmploymentTax({
        income: career,
        profile: {
          id: "profile",
          jurisdiction: "SYNTHETIC",
          residencyCountry: "XX",
          householdStatus: null,
          maritalStatus: null,
          dependants: null,
          taxShares: null,
          withholdingSettings: {},
          socialContributionRegime: null,
          professionalStatus: null,
          specialRegime: null,
          effectiveFrom: "2026-01-01",
          effectiveTo: null,
          source: "Synthetic",
          confidence: "HIGH",
        },
        ruleSet,
        rules,
        taxYear: 2026,
        currency: "EUR",
      });
      expect(tax.grossIncome).toBeCloseTo(fixture.expected.gross, 6);
      expect(tax.payrollContributions).toBeCloseTo(fixture.expected.contributions, 6);
      expect(tax.taxableIncome).toBeCloseTo(fixture.expected.taxable, 6);
      expect(tax.taxLiability).toBeCloseTo(fixture.expected.liability, 6);
      expect(tax.taxWithheld).toBeCloseTo(fixture.expected.withholding, 6);
      expect(tax.netCashIncome).toBeCloseTo(fixture.expected.netCash, 6);
    });
  }
});
