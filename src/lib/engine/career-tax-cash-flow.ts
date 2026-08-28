import type { TaxMonthlyConsequence } from "@/lib/engine/tax";
import { categoryIndex, effectiveCashFlowKind } from "@/lib/engine/cash-flow";
import type { ExpenseCategory, Transaction } from "@/lib/types";

export interface CareerTaxMonthlyConsequence extends TaxMonthlyConsequence {
  cashFlowAmount: number | null;
  cashFlowStatus: "ACTUAL" | "FORECAST" | "NOT_COMPUTABLE";
  observedTransactionIds: string[];
}

/**
 * Adaptateur unique Career → Tax → Cash Flow.
 *
 * Il ne crée aucune transaction. Dès qu'un revenu bancaire ACTUAL existe pour le mois,
 * l'observé remplace le forecast en cash, sans modifier le pont brut-fiscal explicatif.
 */
export function toCareerTaxCashFlow(input: {
  tax: TaxMonthlyConsequence[];
  transactions: Transaction[];
  categories: ExpenseCategory[];
}): CareerTaxMonthlyConsequence[] {
  const categories = categoryIndex(input.categories);
  return input.tax.map((month) => {
    const observed = input.transactions.filter(
      (transaction) =>
        transaction.date.startsWith(month.month) &&
        transaction.provenance.kind === "ACTUAL" &&
        effectiveCashFlowKind(transaction, categories) === "INCOME",
    );
    if (observed.length > 0) {
      return {
        ...month,
        cashFlowAmount: observed.reduce((sum, transaction) => sum + transaction.amount, 0),
        cashFlowStatus: "ACTUAL",
        observedTransactionIds: observed.map((transaction) => transaction.id),
        flags: [...new Set([...month.flags, "ACTUAL_TRANSACTION_OVERRIDES_FORECAST"])],
      };
    }
    return {
      ...month,
      cashFlowAmount: month.netCashIncome,
      cashFlowStatus: month.netCashIncome === null ? "NOT_COMPUTABLE" : "FORECAST",
      observedTransactionIds: [],
    };
  });
}

/**
 * Contrat optionnel pour le Monthly Model. Le moteur mensuel historique n'est pas réécrit :
 * ce surplus n'est fourni que si revenus nets ET dépenses de vie sont canoniquement connus.
 */
export function careerTaxOperatingSurplus(
  consequence: CareerTaxMonthlyConsequence,
  monthlyConsumerExpenses: number | null,
): number | null {
  if (consequence.cashFlowAmount === null || monthlyConsumerExpenses === null) return null;
  return consequence.cashFlowAmount - monthlyConsumerExpenses;
}

export interface CareerTrajectoryComparison {
  baseline: {
    grossIncome: number | null;
    payrollContributions: number | null;
    taxCashPaid: number | null;
    netCashIncome: number | null;
    annualSavingsCapacity: number | null;
  };
  alternative: CareerTrajectoryComparison["baseline"];
  cumulativeCashImpact: number | null;
  blockers: string[];
}

/** Compare deux trajectoires sans jamais recalculer une trajectoire de patrimoine locale. */
export function compareCareerTrajectories(input: {
  baseline: CareerTaxMonthlyConsequence[];
  alternative: CareerTaxMonthlyConsequence[];
  monthlyConsumerExpenses?: number | null;
}): CareerTrajectoryComparison {
  const aggregate = (months: CareerTaxMonthlyConsequence[]) => {
    const all = <
      K extends "grossIncome" | "payrollContributions" | "taxCashPaid" | "netCashIncome",
    >(
      key: K,
    ) =>
      months.every((month) => month[key] !== null)
        ? months.reduce((sum, month) => sum + (month[key] ?? 0), 0)
        : null;
    const netCashIncome = all("netCashIncome");
    const annualSavingsCapacity =
      netCashIncome === null || input.monthlyConsumerExpenses == null
        ? null
        : netCashIncome - input.monthlyConsumerExpenses * months.length;
    return {
      grossIncome: all("grossIncome"),
      payrollContributions: all("payrollContributions"),
      taxCashPaid: all("taxCashPaid"),
      netCashIncome,
      annualSavingsCapacity,
    };
  };
  const baseline = aggregate(input.baseline);
  const alternative = aggregate(input.alternative);
  return {
    baseline,
    alternative,
    cumulativeCashImpact:
      baseline.netCashIncome === null || alternative.netCashIncome === null
        ? null
        : alternative.netCashIncome - baseline.netCashIncome,
    blockers: [
      ...new Set([...input.baseline, ...input.alternative].flatMap((month) => month.blockers)),
    ],
  };
}
