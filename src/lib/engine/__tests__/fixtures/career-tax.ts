import type { CareerCompensationTerm, CareerEvent, CareerRole } from "@/lib/engine/career";
import type { CurrencyRate } from "@/lib/engine/fx";

export interface SyntheticCareerTaxProfile {
  name: string;
  roles: CareerRole[];
  terms: CareerCompensationTerm[];
  events: CareerEvent[];
  currencyRates: CurrencyRate[];
  expected: {
    gross: number;
    contributions: number;
    taxable: number;
    liability: number;
    withholding: number;
    netCash: number;
  };
}

const source = "Profil synthétique — aucune personne réelle";
const role = (id: string, patch: Partial<CareerRole> = {}): CareerRole => ({
  id,
  employer: "Synthetic Employer",
  jobTitle: "Synthetic role",
  employmentType: "EMPLOYEE",
  industry: null,
  country: "FR",
  currency: "EUR",
  startDate: "2026-01-01",
  endDate: null,
  status: "ACTIVE",
  dataKind: "CONTRACTUAL",
  source,
  confidence: "HIGH",
  notes: null,
  ...patch,
});
const term = (
  id: string,
  roleId: string,
  baseSalary: number,
  patch: Partial<CareerCompensationTerm> = {},
): CareerCompensationTerm => ({
  id,
  roleId,
  baseSalary,
  frequency: "ANNUAL",
  guaranteedBonus: null,
  targetBonus: null,
  targetBonusRate: null,
  discretionaryBonus: null,
  commissions: null,
  profitSharing: null,
  participation: null,
  employerBenefits: null,
  allowances: null,
  otherTaxableCompensation: null,
  otherNonTaxableCompensation: null,
  workingTime: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  dataKind: "CONTRACTUAL",
  source,
  confidence: "HIGH",
  ...patch,
});
const paid = (id: string, roleId: string, date: string, amount: number): CareerEvent => ({
  id,
  roleId,
  type: "BONUS_PAID",
  eventDate: date,
  amount,
  currency: "EUR",
  variableState: "PAID",
  paidDate: date,
  label: "Variable synthétique",
  notes: null,
  dataKind: "ACTUAL",
  source,
  confidence: "HIGH",
});
const expected = (gross: number): SyntheticCareerTaxProfile["expected"] => {
  const contributions = gross * 0.2;
  const taxable = gross - contributions;
  const liability = Math.max(0, taxable - 20_000) * 0.1;
  const withholding = taxable * 0.08;
  return {
    gross,
    contributions,
    taxable,
    liability,
    withholding,
    netCash: gross - contributions - withholding,
  };
};

export const SYNTHETIC_CAREER_TAX_PROFILES: SyntheticCareerTaxProfile[] = [
  {
    name: "Analyste finance junior synthétique",
    roles: [role("junior")],
    terms: [term("junior-term", "junior", 42_000)],
    events: [],
    currencyRates: [],
    expected: expected(42_000),
  },
  {
    name: "Cadre à bonus important synthétique",
    roles: [role("executive", { jobTitle: "Director" })],
    terms: [term("executive-term", "executive", 80_000, { targetBonusRate: 0.25 })],
    events: [paid("executive-bonus", "executive", "2026-03-15", 20_000)],
    currencyRates: [],
    expected: expected(100_000),
  },
  {
    name: "Commercial commissionné synthétique",
    roles: [role("sales", { jobTitle: "Sales" })],
    terms: [term("sales-term", "sales", 36_000)],
    events: ["03", "06", "09", "12"].map((month) =>
      paid(`commission-${month}`, "sales", `2026-${month}-28`, 3_000),
    ),
    currencyRates: [],
    expected: expected(48_000),
  },
  {
    name: "Salarié et freelance synthétique",
    roles: [
      role("employee"),
      role("freelance", { employer: "Synthetic clients", employmentType: "FREELANCE" }),
    ],
    terms: [
      term("employee-term", "employee", 48_000),
      term("freelance-term", "freelance", 1_000, { frequency: "MONTHLY" }),
    ],
    events: [],
    currencyRates: [],
    expected: expected(60_000),
  },
  {
    name: "Entrepreneur rémunéré synthétique",
    roles: [
      role("founder", { employer: "Synthetic Venture", employmentType: "CORPORATE_OFFICER" }),
    ],
    terms: [term("founder-term", "founder", 60_000)],
    events: [],
    currencyRates: [],
    expected: expected(60_000),
  },
  {
    name: "Expatrié avec changement de pays synthétique",
    roles: [
      role("fr", { endDate: "2026-06-30" }),
      role("us", { country: "US", currency: "USD", startDate: "2026-07-01" }),
    ],
    terms: [
      term("fr-term", "fr", 60_000, { effectiveTo: "2026-06-30" }),
      term("us-term", "us", 70_000, { effectiveFrom: "2026-07-01" }),
    ],
    events: [],
    currencyRates: [
      {
        id: "usd-eur",
        baseCurrency: "USD",
        quoteCurrency: "EUR",
        rate: 0.9,
        rateDate: "2026-07-01",
        provenance: { kind: "EXTERNAL_DATA", confidence: "HIGH", source },
      },
    ],
    expected: expected(61_500),
  },
];
