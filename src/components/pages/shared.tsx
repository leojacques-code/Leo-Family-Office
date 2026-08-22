"use client";

import type { Mutation } from "@/lib/data/contracts";
import type { DashboardState, ProjectionResult } from "@/lib/types";
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
      value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
        account.balance,
      ),
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
        value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
          state.metrics.grossAssets,
        ),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: "Dette étudiante",
        value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
          state.metrics.debt,
        ),
        kind: "ACTUAL",
        date: state.asOfDate,
        source: "Donnée communiquée par Léo",
      },
    ],
    note: "Ce chiffre vaut −1 173,51 € à la date zéro et reste un patrimoine net identifié, non exhaustif.",
  };
}
export function liquidityExplanation(state: DashboardState): Explanation {
  return {
    title: "Couverture de liquidité",
    formula: "Cash bancaire immédiat ÷ dépenses essentielles mensuelles connues",
    inputs: [
      {
        label: "Cash bancaire",
        value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
          state.metrics.bankCash,
        ),
        kind: "DERIVED",
        date: state.asOfDate,
      },
      {
        label: "Dépenses essentielles connues",
        value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
          state.metrics.monthlyExpenses,
        ),
        kind: "ACTUAL",
        date: state.asOfDate,
      },
    ],
    note: "Seul le loyer est renseigné : la couverture réelle est probablement inférieure. Le cash PEA est exclu du cash bancaire disponible.",
  };
}
export function cashFlowExplanation(state: DashboardState): Explanation {
  return {
    title: "Cash flow mensuel connu",
    formula: "Revenus actifs − dépenses renseignées − service de dette exigible à la date zéro",
    inputs: [
      {
        label: "Revenu net actuel",
        value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
          state.metrics.monthlyIncome,
        ),
        kind: "ACTUAL",
        date: state.asOfDate,
      },
      {
        label: "Dépenses connues",
        value: new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
          state.metrics.monthlyExpenses,
        ),
        kind: "ACTUAL",
        date: state.asOfDate,
      },
      {
        label: "Service de dette actuel",
        value: "0,00 € avant le 5 décembre 2026",
        kind: "DERIVED",
        date: state.asOfDate,
      },
    ],
    note: "La majorité des dépenses n’est pas encore renseignée. Ce cash flow ne doit pas être lu comme une capacité d’épargne définitive.",
  };
}
