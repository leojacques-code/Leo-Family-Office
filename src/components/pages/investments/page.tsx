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
import {
  AggregateValue,
  ConversionNotice,
  NOT_COMPUTABLE,
  OptionalCurrency,
  canonicalLineLabel,
  formatEur,
  formatNative,
  type SectionProps,
} from "@/components/pages/shared";
import {
  accountLine,
  canonicalBalanceSheetOf,
  envelopeExposureOf,
  envelopeMarketLines,
  marketPositionLines,
  unrealisedPnL,
  type EnvelopePnL,
} from "@/lib/engine/balance-sheet-view";
import type {
  CanonicalBalanceSheet,
  ConvertedBalanceSheetLine,
  EnvelopeExposure,
} from "@/lib/engine/balance-sheet";
import type { DashboardState, FinancialAccount } from "@/lib/types";

const INVESTMENT_TYPES: FinancialAccount["type"][] = ["PEA", "CTO"];

const RECONCILIATION_LABELS: Record<string, string> = {
  RECONCILED: "Réconcilié",
  UNDER_EXPLAINED: "Partiellement expliqué",
  OVER_EXPLAINED: "Composition supérieure au solde",
  MISSING: "Réconciliation impossible",
  NOT_APPLICABLE: "Sans objet",
};

interface AccountView {
  account: FinancialAccount;
  /** Ligne comptable canonique de l'enveloppe, convertie. */
  line: ConvertedBalanceSheetLine | null;
  /** Positions non-cash de l'enveloppe, converties. */
  marketLines: ConvertedBalanceSheetLine[];
  exposure: EnvelopeExposure | null;
  pnl: EnvelopePnL;
}

/**
 * Vues d'enveloppe construites SUR le bilan canonique.
 *
 * Aucune somme de `position.value` natif : deux positions libellées dans deux devises ne
 * s'additionnent pas. L'écart de réconciliation, lui, se lit dans la devise comptable de
 * l'enveloppe, seule devise où l'égalité solde = Σ positions a un sens.
 */
function buildAccountViews(state: DashboardState, sheet: CanonicalBalanceSheet): AccountView[] {
  return state.accounts
    .filter((account) => INVESTMENT_TYPES.includes(account.type))
    .map((account) => {
      const marketLines = envelopeMarketLines(sheet, account.id);
      return {
        account,
        line: accountLine(sheet, account.id),
        marketLines,
        exposure: envelopeExposureOf(sheet, account.id),
        // Un seul coût d'acquisition manquant rend la plus-value non calculable : aucune
        // performance n'est affichée sur une base incomplète.
        pnl: unrealisedPnL(marketLines),
      };
    });
}

function InvestmentsPage({ state, setExplanation }: SectionProps) {
  const sheet = canonicalBalanceSheetOf(state);
  const views = buildAccountViews(state, sheet);
  const allMarketLines = marketPositionLines(sheet);
  const largestPosition = [...allMarketLines].sort(
    (left, right) => (right.reportingValue ?? 0) - (left.reportingValue ?? 0),
  )[0];
  const totalPnL = unrealisedPnL(allMarketLines);
  const unreliable = views.filter((view) => view.exposure && !view.exposure.exposureKnown);
  const positionLines = sheet.contributions.filter(
    (line) => line.category === "MARKET_POSITION" || line.category === "INVESTMENT_ENVELOPE_CASH",
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
          value={<AggregateValue aggregate={sheet.marketInvestedAssets} />}
          detail={
            unreliable.length
              ? `${views.length} comptes d’investissement · ${unreliable.length} enveloppe(s) dont l’exposition n’est pas fiable`
              : `${views.length} comptes d’investissement · positions converties en ${sheet.reportingCurrency}`
          }
        />
        <MetricCard
          label="Cash d’enveloppe"
          value={<AggregateValue aggregate={sheet.investmentEnvelopeCash} />}
          detail="Position interne à une enveloppe · jamais ajoutée au cash bancaire"
        />
        <MetricCard
          label="Plus-value latente"
          value={
            totalPnL.unrealised === null ? (
              NOT_COMPUTABLE
            ) : (
              <Currency value={totalPnL.unrealised} sign />
            )
          }
          tone={totalPnL.unrealised !== null && totalPnL.unrealised >= 0 ? "positive" : "neutral"}
          detail={
            totalPnL.unrealised === null
              ? "Au moins une position sans coût d’acquisition exploitable"
              : totalPnL.fxEffectNotIsolated
                ? "Valeur − coût, convertis au même taux : l’effet de change n’est pas isolé"
                : "Valeur de marché − coût d’acquisition connu"
          }
          onExplain={() =>
            setExplanation({
              title: "Plus-value latente",
              formula:
                "Σ valeur convertie des positions − Σ coût d’acquisition converti au même taux",
              inputs: allMarketLines.map((line) => ({
                label: canonicalLineLabel(state, line),
                value:
                  line.reportingCostBasis === null || line.reportingCostBasis === undefined
                    ? `${formatEur(line.reportingValue)} · coût inconnu`
                    : `${formatEur(line.reportingValue)} − ${formatEur(line.reportingCostBasis)}${
                        line.currency === state.reportingCurrency
                          ? ""
                          : ` (natif ${formatNative(line.nativeValue, line.currency)})`
                      }`,
                kind:
                  line.reportingCostBasis === null || line.reportingCostBasis === undefined
                    ? "MISSING"
                    : line.provenance.kind,
                date: line.valuationDate,
                source: line.source,
              })),
              note: `Une plus-value latente n’est pas une performance : elle ignore les versements et les retraits. Sans historique de flux, ni TWR ni XIRR ne sont calculables.${
                totalPnL.fxEffectNotIsolated
                  ? " Valeur et coût sont convertis au même taux daté : le résultat est une plus-value en devise locale convertie, l’effet de change sur le capital investi n’en est pas séparé."
                  : ""
              }${totalPnL.blockers.length ? ` Points ouverts : ${totalPnL.blockers.join(", ")}.` : ""}`,
            })
          }
        />
        <MetricCard
          label={
            largestPosition
              ? `Concentration ${canonicalLineLabel(state, largestPosition)}`
              : "Concentration"
          }
          value={
            largestPosition &&
            largestPosition.reportingValue !== null &&
            sheet.grossAssets.value !== null &&
            sheet.grossAssets.value > 0 ? (
              <Percent value={largestPosition.reportingValue / sheet.grossAssets.value} />
            ) : (
              NOT_COMPUTABLE
            )
          }
          detail="Part des actifs bruts identifiés portée par la première position, après conversion"
        />
      </section>
      <ConversionNotice state={state} sheet={sheet} />
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
                  <OptionalCurrency value={view.line?.reportingValue ?? null} />
                </strong>
              </div>
              <div className="account-stats">
                <div>
                  <span>Versements cumulés</span>
                  <strong className="warning-text">Données insuffisantes</strong>
                </div>
                <div>
                  <span>Plus-value latente</span>
                  {view.pnl.unrealised === null ? (
                    <strong className="warning-text">{NOT_COMPUTABLE}</strong>
                  ) : (
                    <strong
                      className={view.pnl.unrealised >= 0 ? "positive-text" : "negative-text"}
                    >
                      <Currency value={view.pnl.unrealised} sign />
                    </strong>
                  )}
                </div>
                <div>
                  <span>Exposition de marché</span>
                  <strong>
                    {view.marketLines.length ? (
                      <AggregateValue
                        aggregate={
                          view.exposure?.marketExposure ?? {
                            value: null,
                            knownValue: 0,
                            status: "NOT_COMPUTABLE",
                            coverage: 0,
                            blockers: [],
                          }
                        }
                      />
                    ) : (
                      "Ventilation manquante"
                    )}
                  </strong>
                </div>
                <div>
                  <span>Réconciliation</span>
                  <strong
                    className={
                      view.exposure?.state === "RECONCILED" ? "positive-text" : "warning-text"
                    }
                  >
                    {RECONCILIATION_LABELS[view.exposure?.state ?? "MISSING"]}
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
        .filter(
          (view) =>
            view.exposure &&
            view.exposure.state !== "RECONCILED" &&
            view.exposure.state !== "NOT_APPLICABLE",
        )
        .map((view) => {
          const exposure = view.exposure!;
          const gap = exposure.gapNativeValue;
          return (
            <Callout
              key={view.account.id}
              tone="warning"
              title={`Réconciliation ouverte · ${view.account.name} · ${RECONCILIATION_LABELS[exposure.state]}`}
            >
              {exposure.state === "MISSING"
                ? "Au moins une position de cette enveloppe n’est pas convertible dans la devise du compte : l’écart n’est pas chiffrable et n’est pas supposé nul."
                : gap === null
                  ? "Écart non chiffrable."
                  : gap > 0
                    ? `Le solde du compte dépasse ses positions de ${formatNative(gap, view.account.currency)}. Le total déclaré reste la valeur comptable, sans créer de position fictive : ce reliquat est porté sans exposition de marché connue.`
                    : `Les positions dépassent le solde du compte de ${formatNative(-gap, view.account.currency)}. Aucune exposition n’est déduite de cette enveloppe tant que l’écart n’est pas expliqué ; sa valeur comptable reste entière et les autres enveloppes conservent la leur.`}
            </Callout>
          );
        })}
      {views.some((view) => view.pnl.unrealised === null && view.marketLines.length > 0) ? (
        <Callout tone="warning" title="Performance non calculable">
          {views
            .filter((view) => view.pnl.unrealised === null && view.marketLines.length > 0)
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
                formula:
                  "Solde du compte − Σ positions, dans la devise du compte (l’écart n’est jamais mesuré entre deux devises)",
                inputs: views.flatMap((view) => [
                  {
                    label: `Total ${view.account.name}`,
                    value: formatNative(view.account.balance, view.account.currency),
                    kind: view.account.provenance.kind,
                    date: view.account.balanceDate,
                    source: view.account.provenance.source,
                  },
                  ...envelopeMarketLines(sheet, view.account.id).map((line) => ({
                    label: canonicalLineLabel(state, line),
                    value: formatNative(line.nativeValue, line.currency),
                    kind: line.provenance.kind,
                    date: line.valuationDate,
                    source: line.source,
                  })),
                  {
                    label: `Écart ${view.account.name}`,
                    value:
                      view.exposure?.gapNativeValue === null ||
                      view.exposure?.gapNativeValue === undefined
                        ? NOT_COMPUTABLE
                        : formatNative(view.exposure.gapNativeValue, view.account.currency),
                    kind: "DERIVED" as const,
                    date: state.asOfDate,
                  },
                ]),
                note: "Le cash d’enveloppe est une position interne au compte et n’est jamais ajouté au cash bancaire. Une enveloppe dont la composition dépasse le solde ne se voit attribuer aucune exposition, et n’annule pas celle des autres enveloppes.",
              })
            }
          >
            Explain calculation
          </button>
        </div>
        {positionLines.length ? (
          <div className="holdings-table">
            <div className="table-head">
              <span>Position</span>
              <span>Compte</span>
              <span>Classe</span>
              <span>Coût connu</span>
              <span>Valeur</span>
              <span>Statut</span>
            </div>
            {positionLines.map((line) => {
              const position = state.positions.find((item) => item.id === line.entityId);
              const isForeign = line.currency !== state.reportingCurrency;
              return (
                <div className="table-row" key={line.id}>
                  <span className="holding-name">
                    <i>{canonicalLineLabel(state, line).slice(0, 2).toUpperCase()}</i>
                    <span>
                      <strong>{canonicalLineLabel(state, line)}</strong>
                      <small>{position?.ticker ?? line.currency}</small>
                    </span>
                  </span>
                  <span>
                    {state.accounts.find((account) => account.id === line.envelopeAccountId)
                      ?.name ?? "Compte inconnu"}
                  </span>
                  <span>{line.subcategory ?? "—"}</span>
                  <span>
                    {line.reportingCostBasis === null || line.reportingCostBasis === undefined
                      ? "—"
                      : formatEur(line.reportingCostBasis)}
                  </span>
                  <strong>
                    <OptionalCurrency value={line.reportingValue} />
                    {isForeign ? (
                      <small> · {formatNative(line.nativeValue, line.currency)}</small>
                    ) : null}
                  </strong>
                  <DataBadge kind={line.provenance.kind} />
                </div>
              );
            })}
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
