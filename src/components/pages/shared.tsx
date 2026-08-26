"use client";

import type { Mutation } from "@/lib/data/contracts";
import type { DashboardState, ProjectionEnvelope } from "@/lib/types";
import { nextDebtEvent } from "@/lib/engine/debt";
import type {
  CanonicalAggregate,
  CanonicalBalanceSheet,
  ConvertedBalanceSheetLine,
} from "@/lib/engine/balance-sheet";
import {
  accountGroupTotal,
  accountLine,
  canonicalBalanceSheetOf,
  canonicalMetricsOf,
  type CanonicalAllocation,
  type CanonicalAllocationSlice,
} from "@/lib/engine/balance-sheet-view";
import type {
  AnnualBalanceSheetPoint,
  OpeningBalanceSheet,
} from "@/lib/engine/monthly-financial-model";
import type { Explanation } from "@/components/ui";
import { Callout, Currency, DataBadge } from "@/components/ui";
import { ChevronRight } from "lucide-react";
import type { FinancialAccount } from "@/lib/types";

export type Mutate = (mutation: Mutation) => Promise<boolean>;

export interface SectionProps {
  section: string;
  state: DashboardState;
  mutate: Mutate;
  busy: boolean;
  setExplanation: (explanation: Explanation) => void;
  projection: ProjectionEnvelope | null;
  runProjection: (
    scenarioId: string,
    years?: number,
    simulations?: number,
    seed?: number,
  ) => Promise<ProjectionEnvelope | null>;
  refresh: () => Promise<void>;
}

export const chartCurrency = (value: number) => `${Math.round(value / 1000)} k€`;
const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const formatEur = (value: number | null) =>
  value === null ? NOT_COMPUTABLE : eurFormatter.format(value);
/** Date ISO rendue en français long, dérivée de la donnée et jamais écrite en dur. */
export function formatDate(
  iso: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" },
) {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "UTC" }).format(parsed);
}
export const inputNumber = (value: string) => Number(value.replace(",", "."));

export const NOT_COMPUTABLE = "Non calculable";

/** Montant qui peut être NOT_COMPUTABLE : jamais de zéro affiché à la place d'un inconnu. */
export function OptionalCurrency({
  value,
  sign = false,
  fallback = NOT_COMPUTABLE,
}: {
  value: number | null;
  sign?: boolean;
  fallback?: string;
}) {
  if (value === null) return <span className="warning-text">{fallback}</span>;
  return <Currency value={value} sign={sign} />;
}

const nativeFormatter = (currency: string) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 2 });

/** Montant dans SA devise : un solde en USD n'est jamais rendu avec un symbole €. */
export function formatNative(value: number, currency: string) {
  try {
    return nativeFormatter(currency).format(value);
  } catch {
    return `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

/**
 * Montant natif qui peut être inconnu. Un actif détenu dont la valorisation manque
 * n'affiche jamais « 0 € » : il affiche que le montant n'est pas calculable.
 */
export function formatNativeOptional(value: number | null, currency: string) {
  return value === null ? NOT_COMPUTABLE : formatNative(value, currency);
}

/** Libellé lisible d'une ligne canonique, résolu depuis l'état plutôt qu'inventé. */
export function canonicalLineLabel(state: DashboardState, line: ConvertedBalanceSheetLine): string {
  const account = state.accounts.find((item) => item.id === line.entityId);
  if (account) return account.name;
  const position = state.positions.find((item) => item.id === line.entityId);
  if (position) return position.securityName;
  const liability = state.liabilities.find((item) => item.id === line.entityId);
  if (liability) return liability.name;
  return line.entityId;
}

/** Agrégat canonique rendu tel quel : `null` reste « non calculable », jamais zéro. */
export function AggregateValue({
  aggregate,
  compact = false,
}: {
  aggregate: CanonicalAggregate;
  compact?: boolean;
}) {
  if (aggregate.value === null)
    return (
      <span className="warning-text" title={aggregate.blockers.join(" · ")}>
        {NOT_COMPUTABLE}
      </span>
    );
  return <Currency value={aggregate.value} compact={compact} />;
}

/**
 * État réel de la conversion de change, lu sur le bilan canonique.
 *
 * Le FX Engine est branché : ce bloc dit ce qu'il a réellement fait, ligne par ligne, au
 * lieu d'affirmer qu'aucune conversion n'existe. Un taux manquant rend le total non
 * calculable, un taux périmé reste utilisable mais signalé.
 */
export function ConversionNotice({
  state,
  sheet,
}: {
  state: DashboardState;
  sheet: CanonicalBalanceSheet;
}) {
  const foreign = sheet.contributions.filter((line) => line.fx.status !== "IDENTITY");
  if (foreign.length === 0) return null;
  const missing = foreign.filter((line) => line.fx.status === "MISSING");
  const stale = foreign.filter((line) => line.fx.status === "STALE");
  const current = foreign.filter((line) => line.fx.status === "CURRENT");
  const describe = (line: ConvertedBalanceSheetLine) =>
    `${canonicalLineLabel(state, line)} ${formatNativeOptional(line.nativeValue, line.currency)}`;
  return (
    <>
      {current.length ? (
        <Callout title="Conversion de change appliquée">
          {current
            .map(
              (line) =>
                `${describe(line)} → ${formatEur(line.reportingValue)} au taux du ${formatDate(
                  line.fx.rateDate ?? line.valuationDate,
                )}`,
            )
            .join(" · ")}
          . Les totaux sont exprimés en {sheet.reportingCurrency} avec le taux le plus récent
          antérieur ou égal à la date de valeur.
        </Callout>
      ) : null}
      {stale.length ? (
        <Callout tone="warning" title="Taux de change périmé">
          {stale
            .map(
              (line) =>
                `${describe(line)} converti avec un taux du ${formatDate(
                  line.fx.rateDate ?? line.valuationDate,
                )}`,
            )
            .join(" · ")}
          . La conversion reste appliquée, mais elle vieillit : le montant converti n’est plus celui
          du jour.
        </Callout>
      ) : null}
      {missing.length ? (
        <Callout tone="warning" title="Conversion de change impossible">
          {missing.map(describe).join(" · ")} : aucun taux daté n’est disponible vers{" "}
          {sheet.reportingCurrency}. Ces montants ne sont ni convertis à un pour un ni comptés pour
          zéro ; les totaux qui les contiennent restent non calculables.
        </Callout>
      ) : null}
    </>
  );
}

/**
 * Table de comptes. Le total du groupe est le total CANONIQUE converti : additionner des
 * soldes natifs de devises différentes comparerait des grandeurs non comparables.
 */
export function AccountTable({
  title,
  accounts,
  sheet,
  state,
  onEdit,
}: {
  title: string;
  accounts: FinancialAccount[];
  sheet: CanonicalBalanceSheet;
  state: DashboardState;
  onEdit: (account: FinancialAccount) => void;
}) {
  const total = accountGroupTotal(
    sheet,
    accounts.map((account) => account.id),
  );
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Actifs</span>
          <h2>{title}</h2>
        </div>
        <strong>
          <AggregateValue aggregate={total} />
        </strong>
      </div>
      <div className="account-list">
        {accounts.map((account) => {
          const line = accountLine(sheet, account.id);
          const isOverdraft = line?.side === "LIABILITY";
          const isForeign = account.currency !== state.reportingCurrency;
          return (
            <button
              className="account-row account-button"
              key={account.id}
              onClick={() => onEdit(account)}
            >
              <span className="account-logo">{account.institution.slice(0, 2).toUpperCase()}</span>
              <div className="account-main">
                <strong>{account.name}</strong>
                <span>
                  {account.institution} ·{" "}
                  {isForeign
                    ? `${formatNative(account.balance, account.currency)} → ${sheet.reportingCurrency}`
                    : account.currency}
                </span>
              </div>
              <DataBadge kind={account.provenance.kind} />
              <strong className={`account-balance ${isOverdraft ? "negative-text" : ""}`}>
                {isOverdraft ? "−" : ""}
                <OptionalCurrency value={line?.reportingValue ?? null} />
              </strong>
              <ChevronRight size={15} />
            </button>
          );
        })}
      </div>
      {accounts.some((account) => account.balance < 0) ? (
        <p className="muted-copy">
          Un compte à découvert figure au passif du bilan : le total ci-dessus est un total
          d’actifs, il ne nette pas le découvert.
        </p>
      ) : null}
    </article>
  );
}

/**
 * Une ligne d'explication rendue depuis le bilan canonique : montant natif ET montant
 * converti quand la devise diffère, jamais un montant étranger affiché avec un symbole €.
 */
export function canonicalLineInput(state: DashboardState, line: ConvertedBalanceSheetLine) {
  const converted = formatEur(line.reportingValue);
  return {
    label: canonicalLineLabel(state, line),
    value:
      line.currency === state.reportingCurrency
        ? converted
        : `${formatNativeOptional(line.nativeValue, line.currency)} → ${converted}${
            line.fx.rateDate ? ` (taux du ${formatDate(line.fx.rateDate)})` : ""
          }`,
    kind: line.reportingValue === null ? ("MISSING" as const) : line.provenance.kind,
    date: line.valuationDate,
    source: line.source,
  };
}

const ALLOCATION_SLICE_LABELS: Record<string, string> = {
  BANK_CASH: "Cash bancaire",
  ENVELOPE_CASH: "Cash d’enveloppe",
  UNEXPOSED_ENVELOPE: "Solde sans exposition connue",
};

/** Libellé d'affichage d'une tranche canonique. Les clés réservées ne sont pas des classes. */
export function allocationSliceLabel(slice: CanonicalAllocationSlice): string {
  return ALLOCATION_SLICE_LABELS[slice.key] ?? slice.key;
}

/**
 * Explication de la ventilation. Elle montre le bouclage sur les actifs financiers
 * canoniques : une allocation qui ne boucle pas est une allocation inventée.
 */
export function allocationExplanation(
  state: DashboardState,
  allocation: CanonicalAllocation,
): Explanation {
  const unreliable = allocation.slices.filter((slice) => slice.unreliable);
  return {
    title: "Allocation identifiée",
    formula:
      "Σ tranches converties = actifs financiers canoniques (les positions expliquent une enveloppe, elles ne s’y ajoutent pas)",
    inputs: [
      ...allocation.slices.map((slice) => ({
        label: `${allocationSliceLabel(slice)}${slice.unreliable ? " · exposition non fiable" : ""}`,
        value: formatEur(slice.value),
        kind: "DERIVED" as const,
        date: state.asOfDate,
        source: slice.accountIds.length
          ? slice.accountIds
              .map(
                (accountId) =>
                  state.accounts.find((account) => account.id === accountId)?.name ?? accountId,
              )
              .join(", ")
          : undefined,
      })),
      {
        label: "Actifs financiers canoniques",
        value: formatEur(allocation.financialAssets.value ?? allocation.financialAssets.knownValue),
        kind: "DERIVED" as const,
        date: state.asOfDate,
      },
      {
        label: "Écart de bouclage",
        value: formatEur(allocation.residual),
        kind: "DERIVED" as const,
        date: state.asOfDate,
      },
    ],
    note: `Chaque tranche est exprimée en ${allocation.reportingCurrency} après conversion datée.${
      unreliable.length
        ? " Une enveloppe dont la composition dépasse sa valeur comptable ne reçoit aucune exposition de marché : sa valeur comptable reste entière dans la tranche sans exposition connue, et les autres enveloppes conservent la leur."
        : ""
    }${allocation.blockers.length ? ` Points ouverts : ${allocation.blockers.join(", ")}.` : ""}`,
  };
}

export function assetsExplanation(state: DashboardState): Explanation {
  const sheet = canonicalBalanceSheetOf(state);
  const lines = sheet.contributions.filter(
    (line) =>
      line.domain === "FINANCIAL_ACCOUNT" && line.side === "ASSET" && line.isAccountingPrimary,
  );
  return {
    title: "Actifs bruts identifiés",
    formula: "Σ dernier solde de chaque compte actif, converti en devise de reporting",
    inputs: [
      ...lines.map((line) => canonicalLineInput(state, line)),
      {
        label: `Total consolidé (${lines.length} comptes)`,
        value: formatEur(sheet.grossAssets.value),
        kind: "DERIVED" as const,
        date: state.asOfDate,
      },
    ],
    note: `Les positions PEA et CTO ne sont pas ajoutées : elles expliquent le solde du compte et évitent le double comptage.${
      sheet.grossAssets.value === null
        ? ` Le total reste non calculable : ${sheet.grossAssets.blockers.join(", ")}.`
        : ""
    }`,
  };
}
export function netWorthExplanation(state: DashboardState): Explanation {
  const sheet = canonicalBalanceSheetOf(state);
  const liabilityLines = sheet.contributions.filter(
    (line) => line.side === "LIABILITY" && line.isAccountingPrimary,
  );
  return {
    title: "Patrimoine net identifié",
    formula: "Actifs bruts identifiés − dettes identifiées, en devise de reporting",
    inputs: [
      {
        label: "Actifs bruts",
        value: formatEur(sheet.grossAssets.value),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      ...(liabilityLines.length
        ? liabilityLines.map((line) => canonicalLineInput(state, line))
        : [
            {
              label: "Dettes identifiées",
              value: formatEur(0),
              kind: "DERIVED" as const,
              date: state.asOfDate,
            },
          ]),
    ],
    note: `Ce chiffre vaut ${formatEur(sheet.netWorth.value)} au ${formatDate(state.asOfDate)} et reste un patrimoine net identifié, non exhaustif.`,
  };
}
/**
 * Couverture de liquidité, telle que la calcule le bilan canonique : cash immédiat CONVERTI
 * rapporté aux sorties incompressibles à 30 jours. Le dénominateur est la fenêtre exacte du
 * Debt Engine, pas le mois civil : c'est la même grandeur que celle affichée, sans second
 * calcul local.
 */
export function liquidityExplanation(state: DashboardState): Explanation {
  const sheet = canonicalBalanceSheetOf(state);
  const canonical = canonicalMetricsOf(state);
  const essential = state.expenseCategories.filter(
    (category) => category.essential && category.monthlyAmount !== null,
  );
  const essentialTotal = essential.reduce(
    (sum, category) => sum + (category.monthlyAmount ?? 0),
    0,
  );
  const missingEssential = state.expenseCategories.filter(
    (category) => category.essential && category.monthlyAmount === null,
  ).length;
  const coverage = canonical.liquidity.cashCoverageMonths;
  return {
    title: "Couverture de liquidité",
    formula:
      "Cash immédiat converti ÷ (dépenses essentielles mensuelles connues + décaissements de dette exigibles à 30 jours)",
    inputs: [
      {
        label: "Cash immédiat (bilan canonique)",
        value: formatEur(sheet.immediateCash.value),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: `Dépenses essentielles connues (${essential.length} catégories)`,
        value: formatEur(essentialTotal),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: "Décaissements de dette exigibles à 30 jours",
        value: formatEur(canonical.debt.service30d.value),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: "Résultat",
        value:
          coverage.value === null
            ? `${NOT_COMPUTABLE}${coverage.blockers.length ? ` · ${coverage.blockers.join(", ")}` : ""}`
            : `${coverage.value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} mois`,
        kind: "DERIVED",
        date: state.asOfDate,
      },
    ],
    note: `Le service de dette est incompressible et entre au dénominateur. ${missingEssential} catégories essentielles n’ont pas de montant : la couverture réelle est probablement inférieure. Le cash logé dans un PEA ou un CTO est un cash d’enveloppe : il est exclu du cash immédiat.`,
  };
}
export function cashFlowExplanation(state: DashboardState): Explanation {
  const upcoming = nextDebtEvent(state.liabilities, state.asOfDate);
  return {
    title: "Cash flow mensuel connu",
    formula:
      "Revenus actifs − dépenses renseignées − Σ échéances de dette exigibles dans le mois d’observation",
    inputs: [
      {
        label: `Revenus actifs (${state.incomes.filter((income) => income.active).length} sources)`,
        value: formatEur(state.metrics.monthlyIncome),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: `Dépenses connues (${state.expenseCategories.filter((category) => category.monthlyAmount !== null).length} catégories)`,
        value: formatEur(state.metrics.monthlyExpenses),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: "Service de dette exigible",
        value: formatEur(state.metrics.monthlyDebtService),
        kind: "DERIVED",
        date: state.asOfDate,
      },
    ],
    note: `${upcoming ? `Prochaine échéance le ${formatDate(upcoming.entry.dueDate)} pour ${formatEur(upcoming.entry.totalCashOut)}. ` : "Aucune échéance de dette à venir. "}La majorité des dépenses n’est pas encore renseignée : ce cash flow est une borne haute, avant impôt sur le revenu.`,
  };
}

/**
 * Explication d'un point annuel de la projection mensuelle. La variation de patrimoine
 * net y est réconciliée par ses composantes économiques : le principal remboursé n'y
 * apparaît pas, ses deux jambes s'annulent.
 */
export function projectionExplanation(
  state: DashboardState,
  scenario: {
    name: string;
    annualReturn: number;
    monthlySavings: number;
    investmentAllocationRate: number;
  },
  opening: OpeningBalanceSheet,
  point: AnnualBalanceSheetPoint,
  previous: AnnualBalanceSheetPoint | undefined,
): Explanation {
  const openingNetWorth = previous?.netWorth ?? opening.netWorth;
  const surplus = point.cumulativeOperatingSurplus - (previous?.cumulativeOperatingSurplus ?? 0);
  const marketPnL = point.cumulativeMarketPnL - (previous?.cumulativeMarketPnL ?? 0);
  const debtCosts =
    point.cumulativeEconomicDebtCosts - (previous?.cumulativeEconomicDebtCosts ?? 0);
  const principal = point.cumulativePrincipalPaid - (previous?.cumulativePrincipalPaid ?? 0);
  return {
    title: `Patrimoine net projeté en ${point.year}`,
    formula:
      "Patrimoine net d’ouverture + surplus d’exploitation − coûts économiques de dette + performance de marché = patrimoine net de clôture",
    inputs: [
      {
        label: "Patrimoine net d’ouverture",
        value: formatEur(openingNetWorth),
        kind: previous ? "DERIVED" : "ACTUAL",
        date: previous ? undefined : state.asOfDate,
      },
      {
        label: "Surplus d’exploitation avant service de dette",
        value: formatEur(surplus),
        kind: "MODEL_ASSUMPTION",
        source: `Scénario ${scenario.name}, ${formatEur(scenario.monthlySavings)}/mois`,
      },
      {
        label: "Coûts économiques de dette (intérêts, assurance, frais)",
        value: `− ${formatEur(debtCosts)}`,
        kind: "DERIVED",
        source: "Échéancier forward dérivé du contrat",
      },
      {
        label: "Performance de marché",
        value: formatEur(marketPnL),
        kind: "DERIVED",
        source: `Rendement annuel ${(scenario.annualReturn * 100).toFixed(1)} % composé mensuellement`,
      },
      {
        label: "Principal remboursé (mouvement de structure)",
        value: `${formatEur(principal)} · effet nul sur le patrimoine`,
        kind: "DERIVED",
        source: "Trésorerie et passif diminuent du même montant",
      },
      {
        label: "Patrimoine net de clôture",
        value: formatEur(point.netWorth),
        kind: "DERIVED",
      },
    ],
    note: `Périmètre financier uniquement : trésorerie, actifs exposés au marché, actifs financiers sans exposition connue et dette. Ni immobilier, ni business equity, ni carrière, ni fiscalité future. La part investie du surplus après service de dette vaut ${(scenario.investmentAllocationRate * 100).toFixed(0)} %.`,
  };
}
