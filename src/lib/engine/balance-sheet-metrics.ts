import {
  debtServiceBreakdownForPeriod,
  debtServiceNextTwelveMonths,
  insuranceKnown,
  nextDebtEvent,
} from "@/lib/engine/debt";
import {
  OUTSTANDING_DEBT_CATEGORY,
  type CanonicalAggregate,
  type CanonicalBalanceSheet,
} from "@/lib/engine/balance-sheet";
import type { ExpenseCategory, Liability, NetWorthSnapshot, Position } from "@/lib/types";

export interface MetricValue {
  value: number | null;
  status: "COMPLETE" | "PARTIAL" | "NOT_COMPUTABLE";
  blockers: string[];
  scope?: string;
}

export interface HistoricalChange {
  amount: MetricValue;
  percent: MetricValue;
  referenceDate: string | null;
}

export interface CanonicalBalanceSheetMetrics {
  structure: {
    grossAssets: CanonicalAggregate;
    totalLiabilities: CanonicalAggregate;
    netWorth: CanonicalAggregate;
    financialAssets: CanonicalAggregate;
    immediateCash: CanonicalAggregate;
    liquidAssets: CanonicalAggregate;
    illiquidAssets: CanonicalAggregate;
    investedAssets: CanonicalAggregate;
    marketInvestedAssets: CanonicalAggregate;
    investmentCash: CanonicalAggregate;
    accountOverdrafts: CanonicalAggregate;
    contractualDebt: CanonicalAggregate;
    netFinancialDebt: CanonicalAggregate;
    productiveAssets: CanonicalAggregate;
    productiveNetWorth: CanonicalAggregate;
  };
  ratios: {
    debtToAssets: MetricValue;
    netWorthRatio: MetricValue;
    contractualDebtToAssets: MetricValue;
    liabilitiesToNetWorth: MetricValue;
    cashShareOfGrossAssets: MetricValue;
    investedShareOfGrossAssets: MetricValue;
    liquidShareOfGrossAssets: MetricValue;
    largestAccountConcentration: MetricValue;
    largestMarketPositionConcentration: MetricValue;
  };
  liquidity: {
    monthlyIncompressibleOutflows: MetricValue;
    cashCoverageMonths: MetricValue;
    liquidCoverageMonths: MetricValue;
    netLiquidityPosition30d: MetricValue;
    liquidityCoverage30d: MetricValue;
  };
  debt: {
    service30d: MetricValue;
    service90d: MetricValue;
    service12m: MetricValue;
    principal12m: MetricValue;
    interest12m: MetricValue;
    insurance12m: MetricValue;
    fees12m: MetricValue;
    economicCost12m: MetricValue;
    nextCashOut: MetricValue;
    nextCashOutDate: string | null;
  };
  history: Record<"mtd" | "m1" | "m3" | "m12", HistoricalChange>;
}

const complete = (value: number, scope?: string): MetricValue => ({
  value,
  status: "COMPLETE",
  blockers: [],
  scope,
});
const unavailable = (blocker: string, scope?: string): MetricValue => ({
  value: null,
  status: "NOT_COMPUTABLE",
  blockers: [blocker],
  scope,
});

function ratio(
  numerator: CanonicalAggregate | MetricValue,
  denominator: CanonicalAggregate | MetricValue,
  zeroIsZero = false,
): MetricValue {
  if (numerator.value === null || denominator.value === null)
    return unavailable("INCOMPLETE_INPUT");
  if (denominator.value === 0)
    return zeroIsZero && numerator.value === 0 ? complete(0) : unavailable("ZERO_DENOMINATOR");
  return complete(numerator.value / denominator.value);
}

function addDays(iso: string, days: number): string {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

function historyChange(
  current: number | null,
  target: string,
  snapshots: NetWorthSnapshot[],
): HistoricalChange {
  const reference = snapshots
    .filter(
      (snapshot) => snapshot.snapshotDate <= target && snapshot.completenessStatus === "COMPLETE",
    )
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate) || b.version - a.version)[0];
  if (current === null || !reference)
    return {
      amount: unavailable("INSUFFICIENT_HISTORY"),
      percent: unavailable("INSUFFICIENT_HISTORY"),
      referenceDate: null,
    };
  const amount = current - reference.netWorth;
  return {
    amount: complete(amount),
    percent:
      reference.netWorth === 0
        ? unavailable("ZERO_REFERENCE_NET_WORTH")
        : complete(amount / reference.netWorth),
    referenceDate: reference.snapshotDate,
  };
}

export function deriveCanonicalBalanceSheetMetrics(input: {
  balanceSheet: CanonicalBalanceSheet;
  liabilities: Liability[];
  expenses: ExpenseCategory[];
  positions: Position[];
  snapshots?: NetWorthSnapshot[];
}): CanonicalBalanceSheetMetrics {
  const { balanceSheet: sheet } = input;
  const asOf = sheet.asOfDate;
  const debt30 = debtServiceBreakdownForPeriod(input.liabilities, asOf, asOf, addDays(asOf, 30));
  const debt90 = debtServiceBreakdownForPeriod(input.liabilities, asOf, asOf, addDays(asOf, 90));
  const debt12 = debtServiceNextTwelveMonths(input.liabilities, asOf);
  // Une dette connue par son SEUL encours est au bilan mais n'a aucun échéancier : les sorties
  // de dette connues ne sont alors qu'une partie des sorties réelles. Les compter comme le tout
  // sous-estimerait les obligations et surestimerait la couverture, sans rien signaler.
  // La présence se lit sur le bilan canonique, sans nouvelle entrée ni recalcul.
  const unscheduledDebt = sheet.contributions.some(
    (line) =>
      line.side === "LIABILITY" &&
      line.isAccountingPrimary &&
      line.category === OUTSTANDING_DEBT_CATEGORY &&
      (line.nativeValue ?? 0) > 0,
  );
  const partialDebt = (scope?: string): MetricValue => ({
    value: null,
    status: "PARTIAL",
    blockers: ["DEBT_TERMS_UNDECLARED"],
    ...(scope ? { scope } : {}),
  });
  const debtAmount = (breakdown: typeof debt30, value: number, scope?: string): MetricValue =>
    breakdown.kind === "MISSING"
      ? unavailable("DEBT_NOT_PROJECTABLE", scope)
      : unscheduledDebt
        ? partialDebt(scope)
        : complete(value, scope);
  // Assurance et frais récurrents INCONNUS sur une dette active : leur somme sur 12 mois
  // n'est que celle des dettes où ils sont connus. La présenter comme complète compterait
  // l'inconnu à zéro. Le montant connu reste lisible, marqué PARTIAL et nommé.
  const activeDebts = input.liabilities.filter((liability) => liability.currentBalance > 0);
  const insuranceGap = activeDebts.some((liability) => !insuranceKnown(liability));
  const feesGap = activeDebts.some((liability) => liability.recurringFees === null);
  // Seule une assurance dont même le TRAITEMENT est inconnu peut ajouter des sorties : une
  // part inconnue d'une assurance incluse est déjà dans le paiement.
  const cashOutInsuranceGap = activeDebts.some(
    (liability) => liability.insuranceMode === "UNKNOWN",
  );
  const withGaps = (metric: MetricValue, gaps: [boolean, string][]): MetricValue => {
    const blockers = gaps.filter(([gap]) => gap).map(([, code]) => code);
    return metric.status === "COMPLETE" && blockers.length
      ? { ...metric, status: "PARTIAL", blockers }
      : metric;
  };
  const debtQuality = (breakdown: typeof debt30, scope: string): MetricValue =>
    withGaps(debtAmount(breakdown, breakdown.totalCashOut, scope), [
      [cashOutInsuranceGap, "DEBT_INSURANCE_UNKNOWN"],
    ]);
  const essential = input.expenses.filter((expense) => expense.essential);
  const missingEssential = essential.some((expense) => expense.monthlyAmount === null);
  const knownEssential = essential.reduce((sum, expense) => sum + (expense.monthlyAmount ?? 0), 0);
  const monthlyDebt = debt30.totalCashOut;
  const incompressibleValue = knownEssential + monthlyDebt;
  const obligationBlockers = [
    ...(missingEssential ? ["MISSING_ESSENTIAL_EXPENSE"] : []),
    ...(unscheduledDebt ? ["DEBT_TERMS_UNDECLARED"] : []),
  ];
  const incompressible: MetricValue =
    obligationBlockers.length > 0
      ? {
          value: null,
          status: "PARTIAL" as const,
          blockers: obligationBlockers,
          scope: "essential expenses + exact debt cash-outs due in 30 days",
        }
      : complete(incompressibleValue, "essential expenses + exact debt cash-outs due in 30 days");
  const coverage = (assets: CanonicalAggregate): MetricValue => {
    if (assets.value === null || incompressible.value === null)
      return unavailable("INCOMPLETE_INPUT");
    if (incompressible.value === 0) return unavailable("NO_SHORT_TERM_OBLIGATIONS");
    return complete(assets.value / incompressible.value);
  };
  const knownObligations30 = knownEssential + debt30.totalCashOut;
  const netLiquidity =
    sheet.liquidAssets.value === null
      ? unavailable(
          "INCOMPLETE_LIQUID_ASSETS",
          "known essential expenses + exact debt cash-outs; taxes and unmodelled outflows excluded",
        )
      : obligationBlockers.length > 0
        ? {
            value: null,
            status: "PARTIAL" as const,
            blockers: obligationBlockers,
            scope:
              "known essential expenses + exact debt cash-outs; taxes and unmodelled outflows excluded",
          }
        : complete(
            sheet.liquidAssets.value - knownObligations30,
            "known essential expenses + exact debt cash-outs; taxes and unmodelled outflows excluded",
          );
  const next = nextDebtEvent(input.liabilities, asOf);
  const accounts = sheet.contributions.filter(
    (line) =>
      line.domain === "FINANCIAL_ACCOUNT" && line.side === "ASSET" && line.isAccountingPrimary,
  );
  const largestAccount = accounts.reduce(
    (largest, line) => Math.max(largest, line.reportingValue ?? 0),
    0,
  );
  const largestPosition = sheet.contributions
    .filter((line) => line.category === "MARKET_POSITION")
    .reduce((largest, line) => Math.max(largest, line.reportingValue ?? 0), 0);
  const invested = sheet.marketInvestedAssets;
  const current = sheet.netWorth.value;
  const startOfMonth = `${asOf.slice(0, 7)}-01`;
  const snapshots = input.snapshots ?? [];
  return {
    structure: {
      grossAssets: sheet.grossAssets,
      totalLiabilities: sheet.totalLiabilities,
      netWorth: sheet.netWorth,
      financialAssets: sheet.financialAssets,
      immediateCash: sheet.immediateCash,
      liquidAssets: sheet.liquidAssets,
      illiquidAssets: sheet.illiquidAssets,
      investedAssets: invested,
      marketInvestedAssets: sheet.marketInvestedAssets,
      investmentCash: sheet.investmentEnvelopeCash,
      accountOverdrafts: sheet.accountOverdraftLiabilities,
      contractualDebt: sheet.contractualDebt,
      netFinancialDebt: sheet.netFinancialDebt,
      productiveAssets: sheet.productiveAssets,
      productiveNetWorth: sheet.productiveNetWorth,
    },
    ratios: {
      debtToAssets: ratio(sheet.totalLiabilities, sheet.grossAssets, true),
      netWorthRatio: ratio(sheet.netWorth, sheet.grossAssets),
      // Même règle que pour les objectifs : le seul encours contractuel n'est pas toute la dette.
      contractualDebtToAssets: unscheduledDebt
        ? partialDebt()
        : ratio(sheet.contractualDebt, sheet.grossAssets, true),
      liabilitiesToNetWorth:
        sheet.netWorth.value !== null && sheet.netWorth.value > 0
          ? ratio(sheet.totalLiabilities, sheet.netWorth, true)
          : unavailable("NON_POSITIVE_NET_WORTH"),
      cashShareOfGrossAssets: ratio(sheet.immediateCash, sheet.grossAssets),
      investedShareOfGrossAssets: ratio(invested, sheet.grossAssets),
      liquidShareOfGrossAssets: ratio(sheet.liquidAssets, sheet.grossAssets),
      largestAccountConcentration: ratio(complete(largestAccount), sheet.financialAssets),
      largestMarketPositionConcentration: ratio(
        complete(largestPosition),
        sheet.marketInvestedAssets,
      ),
    },
    liquidity: {
      monthlyIncompressibleOutflows: incompressible,
      cashCoverageMonths: coverage(sheet.immediateCash),
      liquidCoverageMonths: coverage(sheet.liquidAssets),
      netLiquidityPosition30d: netLiquidity,
      liquidityCoverage30d:
        incompressible.value === 0
          ? unavailable("NO_SHORT_TERM_OBLIGATIONS")
          : coverage(sheet.liquidAssets),
    },
    debt: {
      service30d: debtQuality(debt30, "exact due entries in 30 days"),
      service90d: debtQuality(debt90, "exact due entries in 90 days"),
      service12m: debtQuality(debt12, "exact due entries in 12 months"),
      principal12m: debtAmount(debt12, debt12.principal),
      interest12m: debtAmount(debt12, debt12.interest + debt12.capitalisedInterest),
      insurance12m: withGaps(debtAmount(debt12, debt12.insurance), [
        [insuranceGap, "DEBT_INSURANCE_UNKNOWN"],
      ]),
      fees12m: withGaps(debtAmount(debt12, debt12.fees + debt12.capitalisedCharges), [
        [feesGap, "DEBT_RECURRING_FEES_UNKNOWN"],
      ]),
      economicCost12m: withGaps(debtAmount(debt12, debt12.economicCost), [
        [insuranceGap, "DEBT_INSURANCE_UNKNOWN"],
        [feesGap, "DEBT_RECURRING_FEES_UNKNOWN"],
      ]),
      // Zéro n'est affirmé que si AUCUNE dette n'est active : une dette sans échéancier peut
      // sortir avant la prochaine échéance connue.
      nextCashOut: unscheduledDebt
        ? partialDebt("Debt Engine next due entry")
        : next
          ? complete(next.entry.totalCashOut, "Debt Engine next due entry")
          : complete(0, "no active debt cash-out"),
      // Même règle : la date agrégée d'une « prochaine sortie » n'est pas connue si une dette
      // sans échéancier peut la précéder. Chaque contrat garde sa propre échéance au domaine Dette.
      nextCashOutDate: unscheduledDebt ? null : (next?.entry.dueDate ?? null),
    },
    history: {
      mtd: historyChange(current, startOfMonth, snapshots),
      m1: historyChange(current, addMonths(asOf, -1), snapshots),
      m3: historyChange(current, addMonths(asOf, -3), snapshots),
      m12: historyChange(current, addMonths(asOf, -12), snapshots),
    },
  };
}
