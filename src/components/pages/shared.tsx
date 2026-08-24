"use client";

import type { Mutation } from "@/lib/data/contracts";
import type { DashboardState, ProjectionResult } from "@/lib/types";
import { nextDebtEvent } from "@/lib/engine/debt";
import type { Explanation } from "@/components/ui";
import { Currency, DataBadge } from "@/components/ui";
import type { FinancialAccount } from "@/lib/types";

export type Mutate = (mutation: Mutation) => Promise<boolean>;

export interface SectionProps {
  section: string;
  state: DashboardState;
  mutate: Mutate;
  busy: boolean;
  setExplanation: (explanation: Explanation) => void;
  projection: ProjectionResult | null;
  runProjection: (
    scenarioId: string,
    years?: number,
    simulations?: number,
    seed?: number,
  ) => Promise<ProjectionResult | null>;
  refresh: () => Promise<void>;
}

export const chartCurrency = (value: number) => `${Math.round(value / 1000)} k€`;
const eurFormatter = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
export const formatEur = (value: number) => eurFormatter.format(value);
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

export function AccountTable({
  title,
  accounts,
  onEdit,
}: {
  title: string;
  accounts: FinancialAccount[];
  onEdit: (account: FinancialAccount) => void;
}) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Actifs</span>
          <h2>{title}</h2>
        </div>
        <strong>
          <Currency value={accounts.reduce((sum, item) => sum + item.balance, 0)} />
        </strong>
      </div>
      <div className="account-list">
        {accounts.map((account) => (
          <button
            className="account-row account-button"
            key={account.id}
            onClick={() => onEdit(account)}
          >
            <span className="account-logo">{account.institution.slice(0, 2).toUpperCase()}</span>
            <div className="account-main">
              <strong>{account.name}</strong>
              <span>
                {account.institution} · {account.currency}
              </span>
            </div>
            <DataBadge kind={account.provenance.kind} />
            <strong className={`account-balance ${account.balance < 0 ? "negative-text" : ""}`}>
              <Currency value={account.balance} />
            </strong>
          </button>
        ))}
      </div>
    </article>
  );
}

export function assetsExplanation(state: DashboardState): Explanation {
  return {
    title: "Actifs bruts identifiés",
    formula: "Σ dernier solde de chaque compte actif",
    inputs: state.accounts.map((account) => ({
      label: account.name,
      value: formatEur(account.balance),
      kind: account.provenance.kind,
      date: account.balanceDate,
      source: account.provenance.source,
    })),
    note: "Les positions PEA et CTO ne sont pas ajoutées : elles expliquent le solde du compte et évitent le double comptage.",
  };
}
export function netWorthExplanation(state: DashboardState): Explanation {
  return {
    title: "Patrimoine net identifié",
    formula: "Actifs bruts identifiés − dettes identifiées",
    inputs: [
      {
        label: "Actifs bruts",
        value: formatEur(state.metrics.grossAssets),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      ...(state.liabilities.length
        ? state.liabilities.map((liability) => ({
            label: liability.name,
            value: formatEur(liability.currentBalance),
            kind: liability.provenance.kind,
            date: liability.provenance.effectiveDate ?? state.asOfDate,
            source: liability.provenance.source,
          }))
        : [
            {
              label: "Dettes identifiées",
              value: formatEur(0),
              kind: "DERIVED" as const,
              date: state.asOfDate,
            },
          ]),
    ],
    note: `Ce chiffre vaut ${formatEur(state.metrics.netWorth)} au ${formatDate(state.asOfDate)} et reste un patrimoine net identifié, non exhaustif.`,
  };
}
export function liquidityExplanation(state: DashboardState): Explanation {
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
  return {
    title: "Couverture de liquidité",
    formula: "Cash bancaire immédiat ÷ dépenses essentielles mensuelles connues",
    inputs: [
      {
        label: "Cash bancaire",
        value: formatEur(state.metrics.bankCash),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: `Dépenses essentielles connues (${essential.length} catégories)`,
        value: formatEur(essentialTotal),
        kind: "ACTUAL",
        date: state.asOfDate,
      },
      {
        label: "Résultat",
        value: `${state.metrics.emergencyCoverageMonths.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} mois`,
        kind: "DERIVED",
        date: state.asOfDate,
      },
    ],
    note: `${missingEssential} catégories essentielles n’ont pas de montant : la couverture réelle est probablement inférieure. Le cash logé dans un PEA ou un CTO est exclu du cash bancaire disponible.`,
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
        label: "Revenus actifs",
        value: formatEur(state.metrics.monthlyIncome),
        kind: "ACTUAL",
        date: state.asOfDate,
      },
      {
        label: "Dépenses connues",
        value: formatEur(state.metrics.monthlyExpenses),
        kind: "ACTUAL",
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
