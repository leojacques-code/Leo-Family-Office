import { describe, expect, it } from "vitest";
import { buildCanonicalBalanceSheet, OUTSTANDING_DEBT_CATEGORY } from "@/lib/engine/balance-sheet";
import { deriveCanonicalBalanceSheetMetrics } from "@/lib/engine/balance-sheet-metrics";
import { buildOpeningBalanceSheet } from "@/lib/engine/monthly-financial-model";
import { resolveCurrentGoalMetric } from "@/lib/engine/goal-metrics";
import { translateCode } from "@/lib/presentation/language/codes";
import { UNDECLARED_LOAN_TERMS } from "@/lib/engine/debt";
import type {
  DashboardState,
  FinancialAccount,
  Liability,
  OutstandingDebt,
  Provenance,
} from "@/lib/types";

// Oracles recomputés à la main, indépendamment du code testé.
const actual: Provenance = { kind: "ACTUAL", confidence: "HIGH", effectiveDate: "2026-09-20" };
const cash: FinancialAccount = {
  id: "cash",
  institutionId: "i",
  institution: "Banque",
  name: "Compte courant",
  type: "BANK",
  currency: "EUR",
  balance: 10_000,
  balanceDate: "2026-09-20",
  liquidity: "IMMEDIATE",
  provenance: actual,
};
const outstanding = (balance: number, currency = "EUR"): OutstandingDebt => ({
  id: "family-loan",
  name: "Prêt familial",
  lender: null,
  currentBalance: balance,
  currency,
  balanceDate: "2026-09-20",
  notes: null,
  provenance: actual,
});
const contract: Liability = {
  id: "loan",
  name: "Crédit auto",
  lender: "Banque",
  principal: 1200,
  currentBalance: 1200,
  annualRate: 0,
  monthlyPayment: 100,
  paymentCount: 12,
  firstPaymentDate: "2026-10-05",
  maturityDate: "2027-09-05",
  ...UNDECLARED_LOAN_TERMS,
  provenance: actual,
};
const build = (input: Partial<Parameters<typeof buildCanonicalBalanceSheet>[0]>) =>
  buildCanonicalBalanceSheet({ asOfDate: "2026-09-24", reportingCurrency: "EUR", ...input });

describe("dette connue par son seul encours au bilan canonique", () => {
  it("est un passif daté qui réduit le patrimoine net, hors encours contractuel", () => {
    const sheet = build({ accounts: [cash], outstandingDebts: [outstanding(1000)] });
    // 10 000 € d'actifs − 1 000 € de dette = 9 000 € de patrimoine net.
    expect(sheet.grossAssets.value).toBe(10_000);
    expect(sheet.totalLiabilities.value).toBe(1000);
    expect(sheet.netWorth.value).toBe(9000);
    expect(sheet.otherLiabilities.value).toBe(1000);
    expect(sheet.contractualDebt.value).toBe(0);
    const line = sheet.contributions.find((item) => item.entityId === "family-loan")!;
    expect(line).toMatchObject({
      category: OUTSTANDING_DEBT_CATEGORY,
      domain: "DEBT",
      side: "LIABILITY",
      valuationDate: "2026-09-20",
      valuationMethod: "OBSERVED_BALANCE",
    });
    expect(line.flags).toContain("DEBT_TERMS_UNDECLARED");
  });

  it("convertit dans sa devise native et devient non calculable sans taux", () => {
    const usd = outstanding(1000, "USD");
    const rate = {
      baseCurrency: "USD",
      quoteCurrency: "EUR",
      rate: 0.9,
      // Antérieur à l'observation du 20 : un taux postérieur serait refusé par le FX Engine.
      rateDate: "2026-09-19",
      provenance: { kind: "EXTERNAL_DATA", confidence: "HIGH", effectiveDate: "2026-09-19" },
    } as const;
    // 1 000 USD × 0,9 = 900 € ; 10 000 − 900 = 9 100 €.
    const converted = build({ accounts: [cash], outstandingDebts: [usd], currencyRates: [rate] });
    expect(converted.totalLiabilities.value).toBeCloseTo(900, 12);
    expect(converted.netWorth.value).toBeCloseTo(9100, 12);
    const missing = build({ accounts: [cash], outstandingDebts: [usd] });
    expect(missing.totalLiabilities.value).toBeNull();
    expect(missing.netWorth.value).toBeNull();
    expect(missing.netWorth.knownValue).toBe(10_000);
  });

  it("n'ajoute aucune ligne pour un encours éteint", () => {
    const sheet = build({ accounts: [cash], outstandingDebts: [outstanding(0)] });
    expect(sheet.totalLiabilities.value).toBe(0);
    expect(sheet.netWorth.value).toBe(10_000);
  });

  it("rend partielles les obligations de dette au lieu de les compter nulles", () => {
    const sheet = build({ accounts: [cash], outstandingDebts: [outstanding(1000)] });
    const metrics = deriveCanonicalBalanceSheetMetrics({
      balanceSheet: sheet,
      liabilities: [],
      expenses: [],
      positions: [],
    });
    for (const metric of [
      metrics.debt.service30d,
      metrics.debt.service90d,
      metrics.debt.service12m,
      metrics.debt.principal12m,
      metrics.debt.interest12m,
      metrics.debt.nextCashOut,
      metrics.liquidity.monthlyIncompressibleOutflows,
      metrics.liquidity.netLiquidityPosition30d,
    ]) {
      expect(metric.value).toBeNull();
      expect(metric.status).toBe("PARTIAL");
      expect(metric.blockers).toContain("DEBT_TERMS_UNDECLARED");
    }
    expect(metrics.debt.nextCashOutDate).toBeNull();
    expect(metrics.liquidity.cashCoverageMonths.value).toBeNull();
  });

  it("laisse inchangées les métriques d'un bilan sans dette encours seul", () => {
    const sheet = build({ accounts: [cash], liabilities: [contract] });
    const metrics = deriveCanonicalBalanceSheetMetrics({
      balanceSheet: sheet,
      liabilities: [contract],
      expenses: [],
      positions: [],
    });
    // Une échéance de 100 € le 5 octobre, dans les 30 jours suivant le 24 septembre.
    expect(metrics.debt.service30d).toMatchObject({ status: "COMPLETE", value: 100 });
    expect(metrics.debt.nextCashOutDate).toBe("2026-10-05");
  });

  it("n'est pas amortie par la projection : autre passif constant et signalé", () => {
    const sheet = build({
      accounts: [cash],
      liabilities: [contract],
      outstandingDebts: [outstanding(1000)],
    });
    const opening = buildOpeningBalanceSheet({ balanceSheet: sheet } as unknown as DashboardState);
    // Encours contractuel 1 200 € amortissable ; 1 000 € encours seul portés à part.
    expect(opening.loanBalance).toBe(1200);
    expect(opening.otherLiabilityBalance).toBe(1000);
    expect(opening.flags).toContain("LIABILITY_PROJECTION_TERMS_MISSING");
  });
  it("rend partiel un objectif « dette contractuelle » tant qu'une dette encours seul existe", () => {
    const target = {
      metric: "CONTRACTUAL_DEBT" as const,
      operator: "AT_MOST" as const,
      value: 0,
      currency: "EUR",
      entityId: null,
    };
    const context = (outstandingDebts: OutstandingDebt[]) => ({
      balanceSheet: build({ accounts: [cash], outstandingDebts }),
      reportingCurrency: "EUR",
      asOfDate: "2026-09-24",
    });
    // Sans dette encours seul : 0 € de dette contractuelle, mesure complète.
    expect(resolveCurrentGoalMetric(target, context([]))).toMatchObject({
      value: 0,
      status: "COMPLETE",
    });
    // Avec 1 000 € connus par leur seul encours : l'objectif ne peut pas paraître atteint.
    const partial = resolveCurrentGoalMetric(target, context([outstanding(1000)]));
    expect(partial.value).toBeNull();
    expect(partial.status).not.toBe("COMPLETE");
    const metrics = deriveCanonicalBalanceSheetMetrics({
      balanceSheet: build({ accounts: [cash], outstandingDebts: [outstanding(1000)] }),
      liabilities: [],
      expenses: [],
      positions: [],
    });
    expect(metrics.ratios.contractualDebtToAssets).toMatchObject({
      value: null,
      status: "PARTIAL",
    });
  });

  it("nomme sa réserve en français : aucune « erreur système » dans Aujourd'hui", () => {
    expect(translateCode("DEBT_TERMS_UNDECLARED")?.label).toBe("Termes de la dette non déclarés");
  });
});
