import type { CareerDataKind, CareerMonthlyConsequence } from "@/lib/engine/career";
import type { Confidence } from "@/lib/types";

export interface TaxBracket {
  threshold: number;
  rate: number;
}
export type TaxResultStatus =
  "PRE_TAX" | "AFTER_TAX_ESTIMATED" | "AFTER_TAX_VERIFIED" | "NOT_COMPUTABLE";
export type TaxRuleType =
  "PAYROLL_CONTRIBUTION" | "TAXABLE_DEDUCTION" | "INCOME_TAX_BRACKETS" | "WITHHOLDING_RATE";
export interface TaxProfile {
  id: string;
  jurisdiction: string;
  residencyCountry: string;
  householdStatus: string | null;
  maritalStatus: string | null;
  dependants: number | null;
  taxShares: number | null;
  withholdingSettings: Record<string, unknown>;
  socialContributionRegime: string | null;
  professionalStatus: string | null;
  specialRegime: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string | null;
  confidence: Confidence;
}
export interface TaxRuleSet {
  id: string;
  jurisdiction: string;
  taxYear: number;
  name: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  sourceDate: string;
  confidence: Confidence;
  status: "DRAFT" | "DECLARED" | "VERIFIED" | "STALE";
  legalReference: string | null;
}
export interface TaxRule {
  id: string;
  ruleSetId: string;
  taxType: TaxRuleType;
  category: "EMPLOYMENT" | "PROFESSIONAL" | "OTHER";
  parameters: {
    rate?: number;
    brackets?: TaxBracket[];
    cap?: number | null;
    floor?: number | null;
    deductible?: boolean;
  };
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
  sourceDate: string;
  confidence: Confidence;
}
export type TaxObservationType = "LIABILITY" | "WITHHELD" | "PAID" | "REFUND" | "BALANCE_DUE";
export interface TaxObservation {
  id: string;
  type: TaxObservationType;
  observedDate: string;
  taxYear: number;
  amount: number;
  currency: string;
  transactionId: string | null;
  source: string | null;
  confidence: Confidence;
}
export interface TaxMonthlyConsequence {
  month: string;
  grossIncome: number | null;
  payrollContributions: number | null;
  taxableIncome: number | null;
  taxLiability: number | null;
  taxCashPaid: number | null;
  taxRefund: number;
  netCashIncome: number | null;
  status: TaxResultStatus;
  blockers: string[];
  flags: string[];
  provenance: {
    dataKind: CareerDataKind | "DECLARED_TAX_RULE" | "OBSERVED_TAX";
    source: string[];
    confidence: Confidence;
  };
  methodology: string[];
  assumptions: string[];
}
export interface TaxCalculation {
  jurisdiction: string | null;
  taxYear: number;
  monthly: TaxMonthlyConsequence[];
  grossIncome: number | null;
  payrollContributions: number | null;
  taxableIncome: number | null;
  taxLiability: number | null;
  taxWithheld: number;
  taxPaid: number;
  taxRefund: number;
  taxCashNet: number;
  taxBalanceDue: number | null;
  netCashIncome: number | null;
  status: TaxResultStatus;
  blockers: string[];
  flags: string[];
}

export function progressiveTax(taxableIncome: number, rule: { brackets: TaxBracket[] }): number {
  if (taxableIncome <= 0) return 0;
  const brackets = [...rule.brackets].sort((a, b) => a.threshold - b.threshold);
  let tax = 0;
  for (let index = 0; index < brackets.length; index += 1) {
    const current = brackets[index];
    const next = brackets[index + 1];
    tax +=
      Math.max(0, Math.min(taxableIncome, next?.threshold ?? taxableIncome) - current.threshold) *
      current.rate;
    if (taxableIncome <= (next?.threshold ?? Number.POSITIVE_INFINITY)) break;
  }
  return tax;
}
const activeRule = (rule: TaxRule, date: string) =>
  rule.effectiveFrom <= date && (rule.effectiveTo === null || rule.effectiveTo >= date);
function ratedBase(amount: number, rule: TaxRule): number {
  const floor = rule.parameters.floor ?? 0;
  const cap = rule.parameters.cap ?? null;
  return Math.max(0, Math.min(amount, cap ?? amount) - floor);
}

export function calculateEmploymentTax(input: {
  income: CareerMonthlyConsequence[];
  profile: TaxProfile | null;
  ruleSet: TaxRuleSet | null;
  rules: TaxRule[];
  observations?: TaxObservation[];
  taxYear: number;
  currency: string;
}): TaxCalculation {
  const blockers: string[] = [];
  if (!input.profile) blockers.push("TAX_PROFILE_MISSING");
  if (!input.ruleSet) blockers.push("TAX_RULES_MISSING");
  if (input.ruleSet?.taxYear !== input.taxYear) blockers.push("TAX_RULE_YEAR_MISMATCH");
  if (input.ruleSet?.status === "STALE") blockers.push("TAX_RULES_STALE");
  const relevant = input.ruleSet
    ? input.rules.filter((rule) => rule.ruleSetId === input.ruleSet?.id)
    : [];
  const bracketRule = relevant.find((rule) => rule.taxType === "INCOME_TAX_BRACKETS");
  if (input.ruleSet && !bracketRule) blockers.push("INCOME_TAX_RULE_MISSING");
  const months = input.income.filter((item) => item.month.startsWith(String(input.taxYear)));
  const grossKnown = months.every((item) => item.grossIncome !== null);
  if (!grossKnown) blockers.push("GROSS_INCOME_MISSING");
  const grossIncome = grossKnown
    ? months.reduce((sum, item) => sum + (item.grossIncome ?? 0), 0)
    : null;
  const intermediate = months.map((item) => {
    const rules = relevant.filter((rule) => activeRule(rule, `${item.month}-28`));
    if (item.grossIncome === null || !input.ruleSet)
      return {
        item,
        contributions: null as number | null,
        taxable: null as number | null,
        withholding: null as number | null,
      };
    const contributions = rules
      .filter((rule) => rule.taxType === "PAYROLL_CONTRIBUTION")
      .reduce(
        (sum, rule) => sum + ratedBase(item.grossIncome ?? 0, rule) * (rule.parameters.rate ?? 0),
        0,
      );
    const deductions = rules
      .filter((rule) => rule.taxType === "TAXABLE_DEDUCTION")
      .reduce(
        (sum, rule) => sum + ratedBase(item.grossIncome ?? 0, rule) * (rule.parameters.rate ?? 0),
        0,
      );
    const taxable = Math.max(0, item.grossIncome - contributions - deductions);
    const withholdingRule = rules.find((rule) => rule.taxType === "WITHHOLDING_RATE");
    return {
      item,
      contributions,
      taxable,
      withholding: withholdingRule ? taxable * (withholdingRule.parameters.rate ?? 0) : 0,
    };
  });
  const payrollContributions = intermediate.every((item) => item.contributions !== null)
    ? intermediate.reduce((sum, item) => sum + (item.contributions ?? 0), 0)
    : null;
  const taxableIncome = intermediate.every((item) => item.taxable !== null)
    ? intermediate.reduce((sum, item) => sum + (item.taxable ?? 0), 0)
    : null;
  const brackets = bracketRule?.parameters.brackets;
  const estimatedLiability =
    taxableIncome === null || !brackets ? null : progressiveTax(taxableIncome, { brackets });
  const observations = (input.observations ?? []).filter(
    (item) => item.taxYear === input.taxYear && item.currency === input.currency,
  );
  const observed = (type: TaxObservationType) =>
    observations.filter((item) => item.type === type).reduce((sum, item) => sum + item.amount, 0);
  const observedLiability = observations
    .filter((item) => item.type === "LIABILITY")
    .sort((a, b) => b.observedDate.localeCompare(a.observedDate))[0];
  const taxLiability = observedLiability?.amount ?? estimatedLiability;
  const modeledWithholding = intermediate.reduce((sum, item) => sum + (item.withholding ?? 0), 0);
  const observedWithheld = observed("WITHHELD");
  const taxWithheld = observations.some((item) => item.type === "WITHHELD")
    ? observedWithheld
    : modeledWithholding;
  const taxPaid = observed("PAID");
  const taxRefund = observed("REFUND");
  const taxBalanceDue =
    taxLiability === null ? null : taxLiability - taxWithheld - taxPaid + taxRefund;
  const monthly = intermediate.map(
    ({ item, contributions, taxable, withholding }): TaxMonthlyConsequence => {
      const monthObs = observations.filter((observation) =>
        observation.observedDate.startsWith(item.month),
      );
      const observedCash = monthObs
        .filter((observation) => observation.type === "WITHHELD" || observation.type === "PAID")
        .reduce((sum, observation) => sum + observation.amount, 0);
      const refund = monthObs
        .filter((observation) => observation.type === "REFUND")
        .reduce((sum, observation) => sum + observation.amount, 0);
      const taxCashPaid = monthObs.length ? observedCash : withholding;
      const netCashIncome =
        item.grossIncome === null || contributions === null || taxCashPaid === null
          ? null
          : item.grossIncome - contributions - taxCashPaid + refund;
      const localBlockers = [...new Set([...item.blockers, ...blockers])];
      return {
        month: item.month,
        grossIncome: item.grossIncome,
        payrollContributions: contributions,
        taxableIncome: taxable,
        taxLiability:
          taxLiability === null || taxableIncome === null || taxable === null || taxableIncome === 0
            ? null
            : (taxLiability * taxable) / taxableIncome,
        taxCashPaid,
        taxRefund: refund,
        netCashIncome,
        status: localBlockers.length
          ? "NOT_COMPUTABLE"
          : observedLiability
            ? "AFTER_TAX_VERIFIED"
            : "AFTER_TAX_ESTIMATED",
        blockers: localBlockers,
        flags: input.ruleSet?.status === "STALE" ? ["TAX_RULES_STALE"] : [],
        provenance: {
          dataKind: monthObs.length
            ? "OBSERVED_TAX"
            : input.ruleSet
              ? "DECLARED_TAX_RULE"
              : item.dataKind,
          source: [
            input.ruleSet?.source,
            ...monthObs.map((observation) => observation.source),
          ].filter((value): value is string => Boolean(value)),
          confidence: observedLiability
            ? observedLiability.confidence
            : (input.ruleSet?.confidence ?? "UNKNOWN"),
        },
        methodology: [
          "Cotisations salariales séparées du revenu imposable.",
          "Liability annuelle distincte des retenues, paiements et remboursements datés.",
        ],
        assumptions: input.ruleSet
          ? [`Rule set ${input.ruleSet.name} (${input.ruleSet.taxYear})`]
          : [],
      };
    },
  );
  const netCashIncome = monthly.every((item) => item.netCashIncome !== null)
    ? monthly.reduce((sum, item) => sum + (item.netCashIncome ?? 0), 0)
    : null;
  const allBlockers = [...new Set([...blockers, ...months.flatMap((item) => item.blockers)])];
  return {
    jurisdiction: input.profile?.jurisdiction ?? input.ruleSet?.jurisdiction ?? null,
    taxYear: input.taxYear,
    monthly,
    grossIncome,
    payrollContributions,
    taxableIncome,
    taxLiability,
    taxWithheld,
    taxPaid,
    taxRefund,
    taxCashNet: taxWithheld + taxPaid - taxRefund,
    taxBalanceDue,
    netCashIncome,
    status: allBlockers.length
      ? "NOT_COMPUTABLE"
      : observedLiability
        ? "AFTER_TAX_VERIFIED"
        : "AFTER_TAX_ESTIMATED",
    blockers: allBlockers,
    flags: input.ruleSet?.status === "STALE" ? ["TAX_RULES_STALE"] : [],
  };
}

/** @deprecated V1 compatibility only. Career V2 uses calculateEmploymentTax. */
export interface DatedTaxRule {
  jurisdiction: string;
  taxYear: number;
  brackets: TaxBracket[];
  socialContributionsRate: number;
  source: string;
  verifiedAt: string;
}
export function employmentCompensation(input: {
  grossFixed: number;
  grossVariable: number;
  employeeContributionRate: number;
  deductibleAllowanceRate: number;
  taxRule: DatedTaxRule;
}) {
  const gross = input.grossFixed + input.grossVariable;
  const contributions = gross * input.employeeContributionRate;
  const netBeforeTax = gross - contributions;
  const taxableIncome = netBeforeTax * (1 - input.deductibleAllowanceRate);
  const incomeTax = progressiveTax(taxableIncome, input.taxRule);
  return {
    gross,
    contributions,
    netBeforeTax,
    taxableIncome,
    incomeTax,
    netAfterTax: netBeforeTax - incomeTax,
  };
}
