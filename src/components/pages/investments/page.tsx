"use client";

import { Plus, UploadCloud } from "lucide-react";
import { Callout, Currency, DataBadge, MetricCard, Percent, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function InvestmentsPage({ state, setExplanation }: SectionProps) {
  const pea = state.accounts.find((account) => account.id === "acc_pea");
  const cto = state.accounts.find((account) => account.id === "acc_cto");
  const peaPositions = state.positions.filter((position) => position.accountId === "acc_pea");
  const peaComponents = peaPositions.reduce((sum, position) => sum + position.value, 0);
  const peaGap = (pea?.balance ?? 0) - peaComponents;
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
        />
        <MetricCard
          label="Cash PEA"
          value={
            <Currency
              value={state.positions
                .filter((position) => position.isCash)
                .reduce((sum, position) => sum + position.value, 0)}
            />
          }
        />
        <MetricCard
          label="Plus-value PEA annoncée"
          value={<Currency value={703.12} sign />}
          tone="positive"
          detail="Réconciliation à 0,01 € près"
        />
        <MetricCard
          label="Concentration MSCI World"
          value={<Percent value={8698 / state.metrics.grossAssets} />}
          detail="Part des actifs bruts identifiés"
        />
      </section>
      <section className="two-column">
        <article className="panel account-summary">
          <div className="account-hero">
            <span className="account-logo large">BB</span>
            <div>
              <span className="eyebrow">Boursobank</span>
              <h2>PEA</h2>
            </div>
            <strong>
              <Currency value={pea?.balance ?? 0} />
            </strong>
          </div>
          <div className="account-stats">
            <div>
              <span>Versements annoncés</span>
              <strong>
                <Currency value={14300} />
              </strong>
            </div>
            <div>
              <span>Gain annoncé</span>
              <strong className="positive-text">
                <Currency value={703.12} sign />
              </strong>
            </div>
            <div>
              <span>Composantes</span>
              <strong>
                <Currency value={peaComponents} />
              </strong>
            </div>
          </div>
        </article>
        <article className="panel account-summary">
          <div className="account-hero">
            <span className="account-logo large">TR</span>
            <div>
              <span className="eyebrow">Trade Republic</span>
              <h2>CTO</h2>
            </div>
            <strong>
              <Currency value={cto?.balance ?? 0} />
            </strong>
          </div>
          <div className="account-stats">
            <div>
              <span>Performance affichée</span>
              <strong className="positive-text">+77,71 %</strong>
            </div>
            <div>
              <span>Ventilation</span>
              <strong className="warning-text">Manquante</strong>
            </div>
            <div>
              <span>Devise reporting</span>
              <strong>EUR</strong>
            </div>
          </div>
        </article>
      </section>
      {Math.abs(peaGap) > 0.01 ? (
        <Callout tone="warning" title="Réconciliation PEA ouverte">
          Le total du compte dépasse les positions de <Currency value={peaGap} />. Le total déclaré
          reste la valeur comptable, sans créer de position fictive.
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
                inputs: [
                  {
                    label: "Total PEA",
                    value: "15 003,13 €",
                    kind: "ACTUAL",
                    date: state.asOfDate,
                  },
                  { label: "ETF", value: "8 698,00 €", kind: "ACTUAL", date: state.asOfDate },
                  { label: "Cash PEA", value: "6 304,57 €", kind: "ACTUAL", date: state.asOfDate },
                ],
                note: "Le cash PEA est une position interne au PEA et n’est jamais ajouté au cash bancaire.",
              })
            }
          >
            Explain calculation
          </button>
        </div>
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
      </section>
      <Callout title="Limite des métriques de risque">
        Volatilité, drawdown, Sharpe et corrélations ne sont pas affichés sans historique de prix
        fiable. Ils ne préjugeront jamais des performances futures.
      </Callout>
    </div>
  );
}

export default InvestmentsPage;
