import { z } from "zod";

import { AS_OF_DATE } from "@/lib/data/shared";

const finite = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/**
 * `date` ne vérifie que la forme. Un 2026-02-31 la satisfait sans exister : la profondeur
 * d'historique est comparée à des bornes de mois, une date fantôme y produirait des
 * dénominateurs faux plutôt qu'une erreur visible.
 */
function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const cashFlowKind = z.enum([
  "INCOME",
  "EXPENSE",
  "INTERNAL_TRANSFER",
  "INVESTMENT",
  "SAVING",
  "DEBT_SERVICE",
  "TAX",
  "REFUND",
  "OTHER_INFLOW",
  "OTHER_OUTFLOW",
  "UNCLASSIFIED",
]);
const essentiality = z.enum(["ESSENTIAL", "NON_ESSENTIAL", "UNKNOWN"]);
const expenseBehavior = z.enum(["FIXED", "VARIABLE", "DISCRETIONARY", "UNKNOWN"]);

export const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_account"),
    accountId: z.string().min(1),
    balance: finite,
    balanceDate: date,
  }),
  z.object({
    action: z.literal("add_account"),
    institution: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    accountType: z.enum(["BANK", "PEA", "CTO", "SAVINGS", "OTHER"]),
    balance: finite,
    currency: z.string().length(3),
  }),
  z.object({
    action: z.literal("add_transaction"),
    accountId: z.string().min(1),
    categoryId: z.string().min(1),
    date,
    label: z.string().min(1).max(180),
    amount: finite,
    updateBalance: z.boolean(),
  }),
  z.object({
    action: z.literal("update_expense"),
    categoryId: z.string().min(1),
    monthlyAmount: finite.nonnegative().nullable(),
  }),
  z.object({
    action: z.literal("update_scenario"),
    scenarioId: z.string().min(1),
    patch: z
      .object({
        annualReturn: finite.min(-0.99).max(1).optional(),
        annualVolatility: finite.min(0).max(2).optional(),
        annualInflation: finite.min(-0.1).max(1).optional(),
        monthlySavings: finite.min(-100000).max(100000).optional(),
        investmentAllocationRate: finite.min(0).max(1).optional(),
        salaryGrowth: finite.min(-0.5).max(1).optional(),
        stressProbability: finite.min(0).max(1).optional(),
        shockYear: z.number().int().min(1).max(80).nullable().optional(),
        shockMagnitude: finite.min(-0.99).max(5).nullable().optional(),
      })
      .strict(),
  }),
  z.object({ action: z.literal("duplicate_scenario"), scenarioId: z.string().min(1) }),
  z.object({ action: z.literal("create_monthly_close"), closeDate: date }),
  z.object({
    action: z.literal("add_goal"),
    name: z.string().min(1).max(160),
    targetAmount: finite.positive(),
    targetDate: date.nullable(),
  }),
  z.object({
    action: z.literal("update_category"),
    categoryId: z.string().min(1),
    patch: z
      .object({
        name: z.string().min(1).max(120).optional(),
        groupName: z.string().min(1).max(120).optional(),
        cashFlowKind: cashFlowKind.optional(),
        essentiality: essentiality.optional(),
        behavior: expenseBehavior.optional(),
        archived: z.boolean().optional(),
      })
      .strict(),
  }),
  z.object({
    action: z.literal("add_category"),
    name: z.string().min(1).max(120),
    groupName: z.string().min(1).max(120),
    cashFlowKind,
    essentiality,
    behavior: expenseBehavior,
  }),
  z.object({
    action: z.literal("classify_transaction"),
    transactionId: z.string().min(1),
    categoryId: z.string().min(1).optional(),
    kindOverride: cashFlowKind.nullable().optional(),
    transferGroupId: z.string().min(1).max(64).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("add_recurring_rule"),
    name: z.string().min(1).max(160),
    cashFlowKind,
    categoryId: z.string().min(1),
    accountId: z.string().min(1).nullable(),
    amount: finite.refine((value) => value !== 0, "Le montant ne peut pas être nul"),
    frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
    startDate: date,
    endDate: date.nullable(),
    dayOfMonth: z.number().int().min(1).max(31).nullable(),
  }),
  z.object({
    action: z.literal("update_recurring_rule"),
    ruleId: z.string().min(1),
    patch: z
      .object({
        amount: finite.optional(),
        active: z.boolean().optional(),
        endDate: date.nullable().optional(),
      })
      .strict(),
  }),
  z.object({ action: z.literal("delete_recurring_rule"), ruleId: z.string().min(1) }),
  z.object({
    action: z.literal("close_cash_flow_month"),
    month: z.string().regex(/^\d{4}-\d{2}$/, "Mois attendu au format AAAA-MM"),
  }),
  z.object({
    action: z.literal("set_ledger_coverage"),
    // `null` est une valeur légitime : elle remet la profondeur à « non déclarée ».
    // Une date postérieure à la date d'observation est refusée : on ne peut pas certifier
    // exhaustif un historique qui n'a pas encore eu lieu.
    startDate: date
      .refine(isRealCalendarDate, "Date inexistante au calendrier")
      .refine(
        (value) => value <= AS_OF_DATE,
        "La couverture ne peut pas être postérieure à la date d'observation",
      )
      .nullable(),
    source: z.enum(["MANUAL", "IMPORT", "API"]),
  }),
]);
