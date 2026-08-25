"use client";

import { UploadCloud } from "lucide-react";
import {
  Callout,
  Currency,
  DataBadge,
  EmptyState,
  MetricCard,
  Percent,
  SectionHeader,
} from "@/components/ui";
import { type SectionProps, formatEur } from "@/components/pages/shared";
import type { DashboardState, FinancialAccount, Position } from "@/lib/types";

const INVESTMENT_TYPES: FinancialAccount["type"][] = ["PEA", "CTO"];

interface AccountView {
  account: FinancialAccount;
  positions: Position[];
  positionsValue: number;
  gap: number;
  /** Somme des coûts d'acquisition connus. `null` dès qu'une position n'en porte pas. */
  costBasis: number | null;
  unrealisedPnL: number | null;
}

function buildAccountViews(state: DashboardState): AccountView[] {
  return state.accounts
    .filter((account) => INVESTMENT_TYPES.includes(account.type))
    .map((account) => {
      const positions = state.positions.filter((position) => position.accountId === account.id);
      const positionsValue = positions.reduce((sum, position) => sum + position.value, 0);
      // Un seul coût manquant rend la plus-value du compte non calculable : aucune
      // performance n'est affichée sur une base incomplète.
      const complete =
        positions.length > 0 && positions.every((position) => position.costBasis !== undefined);
      const costBasis = complete
        ? positions.reduce((sum, position) => sum + (position.costBasis ?? 0), 0)
        : null;
      return {
        account,
        positions,
        positionsValue,
        gap: account.balance - positionsValue,
        costBasis,
        unrealisedPnL: costBasis === null ? null : positionsValue - costBasis,
      };
    });
}

function InvestmentsPage({ state, setExplanation }: SectionProps) {
  const views = buildAccountViews(state);
  const cashInEnvelopes = state.positions
    .filter((position) => position.isCash)
    .reduce((sum, position) => sum + position.value, 0);
  const largestPosition = state.positions
    .filter((position) => !position.isCash)
    .sort((a, b) => b.value - a.value)[0];
  const totalPnL = views.reduce<number | null>(
    (sum, view) => (sum === null || view.unrealisedPnL === null ? null : sum + view.unrealisedPnL),
    0,
  );

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Portfolio"
        title="Investments"
        description="Positions, allocation, performance connue et contrôles de réconciliation."
        actions={
          <button className="button secondary">
            <UploadCloud size={15} />
            Import CSV <span className="soon">V1.1</span>
          </button>
        }
      />
      <section className="metrics-grid four">
        <MetricCard
          label="Actifs investis"
          value={<Currency value={state.metrics.investedAssets} />}
          detail={`${views.length} comptes d’investissement`}
        />
        <MetricCard label="Cash d’enveloppe" value={<Currency value={cashInEnvelopes} />} />
        <MetricCard
          label="Plus-value latente"
          value={totalPnL === null ? "Non calculable" : <Currency value={totalPnL} sign />}
          tone={totalPnL !== null && totalPnL >= 0 ? "positive" : "neutral"}
          detail={
            totalPnL === null
              ? "Au moins une position sans coût d’acquisition"
              : "Valeur de marché − coût d’acquisition connu"
          }
          onExplain={() =>
            setExplanation({
              title: "Plus-value latente",
              formula: "Σ valeur des positions − Σ coût d’acquisition connu",
              inputs: state.positions.map((position) => ({
                label: position.securityName,
                value:
                  position.costBasis === undefined
                    ? `${formatEur(position.value)} · coût inconnu`
                    : `${formatEur(position.value)} − ${formatEur(position.costBasis)}`,
                kind: position.costBasis === undefined ? "MISSING" : position.provenance.kind,
                date: state.asOfDate,
                source: position.provenance.source,
              })),
              note: "Une plus-value latente n’est pas une performance : elle ignore les versements et les retraits. Sans historique de flux, ni TWR ni XIRR ne sont calculables.",
            })
          }
        />
        <MetricCard
          label={
            largestPosition ? `Concentration ${largestPosition.securityName}` : "Concentration"
          }
          value={
            largestPosition &&
            state.metrics.grossAssets !== null &&
            state.metrics.grossAssets > 0 ? (
              <Percent value={largestPosition.value / state.metrics.grossAssets} />
            ) : (
              "Non calculable"
            )
          }
          detail="Part des actifs bruts identifiés portée par la première position"
        />
      </section>
      {views.length ? (
        <section className="two-column">
          {views.map((view) => (
            <article className="panel account-summary" key={view.account.id}>
              <div className="account-hero">
                <span className="account-logo large">
                  {view.account.institution.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <span className="eyebrow">{view.account.institution}</span>
                  <h2>{view.account.name}</h2>
                </div>
                <strong>
                  <Currency value={view.account.balance} />
                </strong>
              </div>
              <div className="account-stats">
                <div>
                  <span>Versements cumulés</span>
                  <strong className="warning-text">Données insuffisantes</strong>
                </div>
                <div>
                  <span>Plus-value latente</span>
                  {view.unrealisedPnL === null ? (
                    <strong className="warning-text">Non calculable</strong>
                  ) : (
                    <strong className={view.unrealisedPnL >= 0 ? "positive-text" : "negative-text"}>
                      <Currency value={view.unrealisedPnL} sign />
                    </strong>
                  )}
                </div>
                <div>
                  <span>Composantes</span>
                  <strong>
                    {view.positions.length ? (
                      <Currency value={view.positionsValue} />
                    ) : (
                      "Ventilation manquante"
                    )}
                  </strong>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <EmptyState
          title="Aucun compte d’investissement"
          detail="Aucun compte de type PEA ou CTO n’est enregistré : aucune performance ni concentration n’est calculée."
        />
      )}
      {views
        .filter((view) => view.positions.length > 0 && Math.abs(view.gap) > 0.01)
        .map((view) => (
          <Callout
            key={view.account.id}
            tone="warning"
            title={`Réconciliation ouverte · ${view.account.name}`}
          >
            Le total du compte dépasse les positions de <Currency value={view.gap} />. Le total
            déclaré reste la valeur comptable, sans créer de position fictive.
          </Callout>
        ))}
      {views.some((view) => view.unrealisedPnL === null) ? (
        <Callout tone="warning" title="Performance non calculable">
          {views
            .filter((view) => view.unrealisedPnL === null)
            .map((view) => view.account.name)
            .join(", ")}{" "}
          ne porte aucun coût d’acquisition exploitable. Aucun pourcentage de performance n’est
          affiché : un taux sans base de calcul serait une donnée inventée. L’historique des
          versements est également absent du modèle, donc les versements cumulés ne sont pas
          dérivables.
        </Callout>
      ) : null}
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Positions observées</span>
            <h2>Portefeuille consolidé</h2>
          </div>
          <button
            className="link-button"
            onClick={() =>
              setExplanation({
                title: "Réconciliation des investissements",
                formula: "Total du compte − Σ valeur des positions",
                inputs: views.flatMap((view) => [
                  {
                    label: `Total ${view.account.name}`,
                    value: formatEur(view.account.balance),
                    kind: view.account.provenance.kind,
                    date: view.account.balanceDate,
                    source: view.account.provenance.source,
                  },
                  ...view.positions.map((position) => ({
                    label: position.securityName,
                    value: formatEur(position.value),
                    kind: position.provenance.kind,
                    date: state.asOfDate,
                    source: position.provenance.source,
                  })),
                  {
                    label: `Écart ${view.account.name}`,
                    value: formatEur(view.gap),
                    kind: "DERIVED" as const,
                    date: state.asOfDate,
                  },
                ]),
                note: "Le cash d’enveloppe est une position interne au compte et n’est jamais ajouté au cash bancaire.",
              })
            }
          >
            Explain calculation
          </button>
        </div>
        {state.positions.length ? (
          <div className="holdings-table">
            <div className="table-head">
              <span>Position</span>
              <span>Compte</span>
              <span>Classe</span>
              <span>Coût connu</span>
              <span>Valeur</span>
              <span>Statut</span>
            </div>
            {state.positions.map((position) => (
              <div className="table-row" key={position.id}>
                <span className="holding-name">
                  <i>{position.securityName.slice(0, 2).toUpperCase()}</i>
                  <span>
                    <strong>{position.securityName}</strong>
                    <small>{position.ticker ?? position.currency}</small>
                  </span>
                </span>
                <span>
                  {state.accounts.find((account) => account.id === position.accountId)?.name}
                </span>
                <span>{position.assetClass}</span>
                <span>
                  {position.costBasis === undefined ? "—" : <Currency value={position.costBasis} />}
                </span>
                <strong>
                  <Currency value={position.value} />
                </strong>
                <DataBadge kind={position.provenance.kind} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Aucune position"
            detail="Les soldes de compte restent la valeur comptable tant qu’aucune position n’est saisie."
          />
        )}
      </section>
      <Callout title="Limite des métriques de risque">
        Volatilité, drawdown, Sharpe et corrélations ne sont pas affichés sans historique de prix
        fiable. Ils ne préjugeront jamais des performances futures.
      </Callout>
    </div>
  );
}

export default InvestmentsPage;
