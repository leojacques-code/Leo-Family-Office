import { z } from "zod";

const finite = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_account"), accountId: z.string().min(1), balance: finite, balanceDate: date }),
  z.object({ action: z.literal("add_account"), institution: z.string().min(1).max(120), name: z.string().min(1).max(120), accountType: z.enum(["BANK", "PEA", "CTO", "SAVINGS", "OTHER"]), balance: finite, currency: z.string().length(3) }),
  z.object({ action: z.literal("add_transaction"), accountId: z.string().min(1), categoryId: z.string().min(1), date, label: z.string().min(1).max(180), amount: finite, updateBalance: z.boolean() }),
  z.object({ action: z.literal("update_expense"), categoryId: z.string().min(1), monthlyAmount: finite.nonnegative().nullable() }),
  z.object({ action: z.literal("update_scenario"), scenarioId: z.string().min(1), patch: z.object({ annualReturn: finite.min(-0.99).max(1).optional(), annualVolatility: finite.min(0).max(2).optional(), annualInflation: finite.min(-0.1).max(1).optional(), monthlySavings: finite.min(-100000).max(100000).optional(), investmentAllocationRate: finite.min(0).max(1).optional(), salaryGrowth: finite.min(-0.5).max(1).optional(), stressProbability: finite.min(0).max(1).optional(), shockYear: z.number().int().min(1).max(80).nullable().optional(), shockMagnitude: finite.min(-0.99).max(5).nullable().optional() }).strict() }),
  z.object({ action: z.literal("duplicate_scenario"), scenarioId: z.string().min(1) }),
  z.object({ action: z.literal("create_monthly_close"), closeDate: date }),
  z.object({ action: z.literal("add_goal"), name: z.string().min(1).max(160), targetAmount: finite.positive(), targetDate: date.nullable() }),
]);
