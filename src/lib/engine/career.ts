import { convertWithFx, resolveFxRate, type CurrencyRate } from "@/lib/engine/fx";
import type { Confidence, DataKind } from "@/lib/types";

export type CareerDataKind = DataKind | "CONTRACTUAL" | "PROJECTED";
export type EmploymentType =
  | "EMPLOYEE"
  | "INTERN"
  | "FREELANCE"
  | "CONTRACTOR"
  | "ENTREPRENEUR"
  | "CORPORATE_OFFICER"
  | "UNEMPLOYED"
  | "OTHER";
export type CareerRoleStatus = "ACTIVE" | "ENDED" | "FUTURE";
export type CompensationFrequency = "MONTHLY" | "ANNUAL" | "DAILY" | "HOURLY";
export type VariableState = "TARGET" | "CONTRACTUAL" | "EARNED" | "PAID" | "PROJECTED";
export type CareerEventType =
  | "JOB_START"
  | "JOB_END"
  | "PROMOTION"
  | "SALARY_CHANGE"
  | "BONUS_TARGET_CHANGE"
  | "BONUS_EARNED"
  | "BONUS_PAID"
  | "COMMISSION"
  | "UNEMPLOYMENT"
  | "SABBATICAL"
  | "FREELANCE_START"
  | "FREELANCE_END"
  | "EQUITY_GRANT"
  | "EQUITY_VEST"
  | "OTHER";
export type CareerScenarioType =
  "STAY" | "PROMOTION" | "NEW_JOB" | "UNEMPLOYMENT" | "FREELANCE" | "CUSTOM";

export interface CareerProvenance {
  dataKind: CareerDataKind;
  source: string | null;
  confidence: Confidence;
}
export interface CareerRole extends CareerProvenance {
  id: string;
  employer: string | null;
  jobTitle: string | null;
  employmentType: EmploymentType;
  industry: string | null;
  country: string | null;
  currency: string;
  startDate: string;
  endDate: string | null;
  status: CareerRoleStatus;
  notes: string | null;
}
export interface CareerCompensationTerm extends CareerProvenance {
  id: string;
  roleId: string;
  baseSalary: number | null;
  frequency: CompensationFrequency;
  guaranteedBonus: number | null;
  targetBonus: number | null;
  targetBonusRate: number | null;
  discretionaryBonus: number | null;
  commissions: number | null;
  profitSharing: number | null;
  participation: number | null;
  employerBenefits: number | null;
  allowances: number | null;
  otherTaxableCompensation: number | null;
  otherNonTaxableCompensation: number | null;
  workingTime: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface CareerEvent extends CareerProvenance {
  id: string;
  roleId: string | null;
  type: CareerEventType;
  eventDate: string;
  amount: number | null;
  currency: string | null;
  variableState: VariableState | null;
  paidDate: string | null;
  label: string | null;
  notes: string | null;
}
export interface CareerEquityGrant extends CareerProvenance {
  id: string;
  roleId: string | null;
  company: string;
  instrumentType:
    | "STOCK_OPTION"
    | "RSU"
    | "BSPCE"
    | "FREE_SHARE"
    | "CARRIED_INTEREST"
    | "MANAGEMENT_PACKAGE"
    | "EMPLOYEE_SHARE"
    | "OTHER";
  grantDate: string;
  quantity: number | null;
  strikePrice: number | null;
  currency: string | null;
  vestingSchedule: unknown;
  expiryDate: string | null;
  liquidityStatus: "ILLIQUID" | "LIQUID" | "UNKNOWN";
}
export interface CareerScenario extends CareerProvenance {
  id: string;
  name: string;
  type: CareerScenarioType;
  effectiveFrom: string;
  roleId: string | null;
  assumptions: Record<string, unknown>;
}
export interface CareerMonthlyConsequence {
  month: string;
  roleId: string | null;
  employer: string | null;
  currency: string;
  fixedGross: number | null;
  variableGrossPaid: number;
  otherTaxableGross: number | null;
  grossIncome: number | null;
  targetCompensation: number | null;
  dataKind: CareerDataKind;
  status: "ACTUAL" | "CONTRACTUAL" | "PROJECTED" | "NOT_COMPUTABLE";
  blockers: string[];
  flags: string[];
  methodology: string[];
}
export interface CareerAnalytics {
  annualisedFixedCompensation: number | null;
  annualisedTargetCompensation: number | null;
  realisedYtd: number | null;
  realisedT12m: number | null;
  fixedVariableSplit: { fixed: number; variable: number } | null;
  monthsOfEmployment: number;
  incomeConcentration: Array<{ source: string; share: number }> | null;
  blockers: string[];
}

const monthKey = (date: string) => date.slice(0, 7);
const monthStart = (month: string) => `${month}-01`;
function monthEnd(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}
function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.slice(0, 7).split("-").map(Number);
  const [ey, em] = end.slice(0, 7).split("-").map(Number);
  const result: string[] = [];
  for (let index = sy * 12 + sm - 1; index <= ey * 12 + em - 1; index += 1)
    result.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  return result;
}
const activeOn = (role: CareerRole, month: string) =>
  role.startDate <= monthEnd(month) && (role.endDate === null || role.endDate >= monthStart(month));
const termOn = (term: CareerCompensationTerm, month: string) =>
  term.effectiveFrom <= monthEnd(month) &&
  (term.effectiveTo === null || term.effectiveTo >= monthStart(month));
function monthlyBase(term: CareerCompensationTerm): number | null {
  if (term.baseSalary === null) return null;
  if (term.frequency === "ANNUAL") return term.baseSalary / 12;
  if (term.frequency === "MONTHLY") return term.baseSalary;
  return term.workingTime === null ? null : term.baseSalary * term.workingTime;
}
function annualTarget(term: CareerCompensationTerm): number | null {
  const monthly = monthlyBase(term);
  if (monthly === null) return null;
  const fixed = monthly * 12;
  const target =
    term.targetBonus ?? (term.targetBonusRate === null ? null : fixed * term.targetBonusRate);
  return target === null ? null : fixed + target;
}

export function buildCareerMonthlyConsequences(input: {
  roles: CareerRole[];
  terms: CareerCompensationTerm[];
  events: CareerEvent[];
  startDate: string;
  endDate: string;
  reportingCurrency: string;
  currencyRates?: CurrencyRate[];
}): CareerMonthlyConsequence[] {
  return monthsBetween(input.startDate, input.endDate).flatMap((month) =>
    input.roles
      .filter((role) => activeOn(role, month))
      .map((role) => {
        const term = input.terms
          .filter((candidate) => candidate.roleId === role.id && termOn(candidate, month))
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
        const blockers: string[] = [];
        if (!term) blockers.push(`COMPENSATION_TERMS_MISSING:${role.id}`);
        const fixedNative = term ? monthlyBase(term) : null;
        if (term && fixedNative === null) blockers.push(`BASE_COMPENSATION_MISSING:${term.id}`);
        const paidEvents = input.events.filter(
          (event) =>
            event.roleId === role.id &&
            event.variableState === "PAID" &&
            event.paidDate !== null &&
            monthKey(event.paidDate) === month,
        );
        if (paidEvents.some((event) => event.amount === null))
          blockers.push(`PAID_VARIABLE_AMOUNT_MISSING:${role.id}:${month}`);
        const variableNative = paidEvents.reduce((sum, event) => sum + (event.amount ?? 0), 0);
        const fx = resolveFxRate(
          role.currency.toUpperCase(),
          input.reportingCurrency,
          monthEnd(month),
          input.currencyRates ?? [],
        );
        if (fx.rate === null) blockers.push(...fx.flags);
        const fixedGross = fixedNative === null ? null : convertWithFx(fixedNative, fx);
        const variableGrossPaid = convertWithFx(variableNative, fx) ?? 0;
        const otherNative = term?.otherTaxableCompensation ?? null;
        const otherTaxableGross = otherNative === null ? null : convertWithFx(otherNative / 12, fx);
        const grossIncome =
          fixedGross === null ||
          fx.rate === null ||
          paidEvents.some((event) => event.amount === null)
            ? null
            : fixedGross + variableGrossPaid + (otherTaxableGross ?? 0);
        const annual = term ? annualTarget(term) : null;
        const targetCompensation = annual === null ? null : convertWithFx(annual, fx);
        const future =
          role.startDate > input.startDate ||
          role.status === "FUTURE" ||
          role.dataKind === "PROJECTED";
        const contractual = role.dataKind === "CONTRACTUAL" || term?.dataKind === "CONTRACTUAL";
        return {
          month,
          roleId: role.id,
          employer: role.employer,
          currency: input.reportingCurrency,
          fixedGross,
          variableGrossPaid,
          otherTaxableGross,
          grossIncome,
          targetCompensation,
          dataKind: future ? "PROJECTED" : (term?.dataKind ?? role.dataKind),
          status: blockers.length
            ? "NOT_COMPUTABLE"
            : future
              ? "PROJECTED"
              : contractual
                ? "CONTRACTUAL"
                : "ACTUAL",
          blockers: [...new Set(blockers)],
          flags: fx.status === "STALE" ? fx.flags : [],
          methodology: [
            "Le fixe est mensualisé selon le terme daté.",
            "Le variable entre en cash uniquement à la date PAID.",
            "TARGET, EARNED et PAID restent distincts.",
          ],
        };
      }),
  );
}

export function buildCareerAnalytics(input: {
  consequences: CareerMonthlyConsequence[];
  asOfDate: string;
}): CareerAnalytics {
  const currentMonth = monthKey(input.asOfDate);
  const current = input.consequences.filter((item) => item.month === currentMonth);
  const currentKnown = current.every((item) => item.grossIncome !== null);
  const annualisedFixedCompensation = currentKnown
    ? current.reduce((sum, item) => sum + (item.fixedGross ?? 0), 0) * 12
    : null;
  const annualisedTargetCompensation =
    current.length > 0 && current.every((item) => item.targetCompensation !== null)
      ? current.reduce((sum, item) => sum + (item.targetCompensation ?? 0), 0)
      : null;
  const ytd = input.consequences.filter(
    (item) =>
      item.month >= `${input.asOfDate.slice(0, 4)}-01` &&
      item.month <= currentMonth &&
      item.status === "ACTUAL",
  );
  const realisedYtd =
    ytd.length > 0 && ytd.every((item) => item.grossIncome !== null)
      ? ytd.reduce((sum, item) => sum + (item.grossIncome ?? 0), 0)
      : null;
  const asOfIndex =
    Number(input.asOfDate.slice(0, 4)) * 12 + Number(input.asOfDate.slice(5, 7)) - 1;
  const start = asOfIndex - 11;
  const t12 = input.consequences.filter((item) => {
    const index = Number(item.month.slice(0, 4)) * 12 + Number(item.month.slice(5, 7)) - 1;
    return index >= start && index <= asOfIndex && item.status === "ACTUAL";
  });
  const realisedT12m =
    t12.length > 0 && t12.every((item) => item.grossIncome !== null)
      ? t12.reduce((sum, item) => sum + (item.grossIncome ?? 0), 0)
      : null;
  const known = input.consequences.filter((item) => item.grossIncome !== null);
  const fixed = known.reduce((sum, item) => sum + (item.fixedGross ?? 0), 0);
  const variable = known.reduce((sum, item) => sum + item.variableGrossPaid, 0);
  const total = fixed + variable;
  const bySource = new Map<string, number>();
  for (const item of known)
    bySource.set(
      item.employer ?? "Autre",
      (bySource.get(item.employer ?? "Autre") ?? 0) + (item.grossIncome ?? 0),
    );
  return {
    annualisedFixedCompensation,
    annualisedTargetCompensation,
    realisedYtd,
    realisedT12m,
    fixedVariableSplit: total === 0 ? null : { fixed: fixed / total, variable: variable / total },
    monthsOfEmployment: new Set(input.consequences.map((item) => item.month)).size,
    incomeConcentration:
      total === 0
        ? null
        : [...bySource]
            .map(([source, amount]) => ({ source, share: amount / total }))
            .sort((a, b) => b.share - a.share),
    blockers: [...new Set(input.consequences.flatMap((item) => item.blockers))],
  };
}
