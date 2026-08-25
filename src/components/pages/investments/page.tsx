"use client";

import { useState } from "react";
import { BookOpen, Plus, Settings2, Trash2, UploadCloud } from "lucide-react";
import {
  Callout,
  Currency,
  DataBadge,
  EmptyState,
  MetricCard,
  Modal,
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
import {
  buildPortfolioLedger,
  envelopeLedgerOf,
  type PortfolioEnvelopeLedger,
} from "@/lib/engine/portfolio";
import {
  EVENT_TYPE_LABELS,
  MATCHING_LABELS,
  PortfolioEventForm,
  PortfolioPolicyForm,
} from "@/components/pages/investments/portfolio-ledger-form";
import type { DashboardState, FinancialAccount } from "@/lib/types";

const INVESTMENT_TYPES: FinancialAccount["type"][] = ["PEA", "CTO"];

const COVERAGE_LABELS: Record<PortfolioEnvelopeLedger["coverageStatus"], string> = {
  UNDECLARED: "Historique non déclaré",
  DECLARED: "Historique déclaré exhaustif",
  DECLARED_WITHOUT_CASH_ANCHOR: "Déclaré, sans ancrage de cash",
  PARTIAL: "Événements antérieurs à la couverture",
};

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

function InvestmentsPage({ state, mutate, busy, setExplanation }: SectionProps) {
  const [eventEditor, setEventEditor] = useState<string | null>(null);
  const [policyEditor, setPolicyEditor] = useState<string | null>(null);
  const sheet = canonicalBalanceSheetOf(state);
  // Le ledger vient du repository ; il n'est redérivé que si l'état n'en porte pas encore.
  const ledger =
    state.portfolioLedger ??
    buildPortfolioLedger({
      asOfDate: state.asOfDate,
      accounts: state.accounts,
      positions: state.positions,
      events: state.portfolioEvents,
      policies: state.portfolioPolicies,
      transactions: state.transactions,
      expenseCategories: state.expenseCategories,
    });
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
                  {(() => {
                    // Apports EXTERNES seulement : un dividende encaissé dans l'enveloppe
                    // n'est pas un versement, et un ancrage d'ouverture non plus.
                    const contributions = envelopeLedgerOf(ledger, view.account.id)?.flows
                      .externalIn;
                    return contributions === null || contributions === undefined ? (
                      <strong className="warning-text">Données insuffisantes</strong>
                    ) : (
                      <strong>
                        <Currency value={contributions} />
                      </strong>
                    );
                  })()}
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
            <span className="eyebrow">Portfolio ledger</span>
            <h2>Comment les positions se sont constituées</h2>
          </div>
          <button
            className="link-button"
            onClick={() =>
              setExplanation({
                title: "Ledger portefeuille",
                formula:
                  "Cash dérivé = ancrage d’ouverture + Σ mouvements de cash de l’enveloppe ; quantité dérivée = Σ entrées − Σ sorties",
                inputs: ledger.envelopes.map((envelope) => ({
                  label: `${envelope.accountName} · ${COVERAGE_LABELS[envelope.coverageStatus]}`,
                  value:
                    envelope.ledgerCash === null
                      ? `${NOT_COMPUTABLE} · ${envelope.eventCount} événement(s)`
                      : `${formatNative(envelope.ledgerCash, envelope.currency)} dérivé · ${envelope.eventCount} événement(s)`,
                  kind: envelope.eventCount === 0 ? ("MISSING" as const) : ("ACTUAL" as const),
                  date: envelope.lastEventDate ?? state.asOfDate,
                })),
                note: "Le ledger n’entre dans aucun total patrimonial : le Canonical Balance Sheet reste la vérité des montants. Une enveloppe sans historique déclaré conserve son état observé et n’en dérive rien : aucun achat n’est reconstitué pour faire boucler une position.",
              })
            }
          >
            Explain calculation
          </button>
        </div>
        {ledger.envelopes.length ? (
          <div className="two-column">
            {ledger.envelopes.map((envelope) => {
              const account = state.accounts.find((item) => item.id === envelope.accountId);
              return (
                <article className="panel account-summary" key={envelope.accountId}>
                  <div className="account-hero">
                    <span className="account-logo large">
                      <BookOpen size={15} />
                    </span>
                    <div>
                      <span className="eyebrow">{COVERAGE_LABELS[envelope.coverageStatus]}</span>
                      <h2>{envelope.accountName}</h2>
                    </div>
                    <strong>{envelope.eventCount} évt</strong>
                  </div>
                  <div className="account-stats">
                    <div>
                      <span>Cash dérivé du ledger</span>
                      <strong className={envelope.ledgerCash === null ? "warning-text" : undefined}>
                        {envelope.ledgerCash === null
                          ? NOT_COMPUTABLE
                          : formatNative(envelope.ledgerCash, envelope.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Cash observé</span>
                      <strong
                        className={envelope.observedCash === null ? "warning-text" : undefined}
                      >
                        {envelope.observedCash === null
                          ? NOT_COMPUTABLE
                          : formatNative(envelope.observedCash, envelope.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Écart de cash</span>
                      <strong
                        className={
                          envelope.cashState === "RECONCILED" ? "positive-text" : "warning-text"
                        }
                      >
                        {envelope.cashGap === null
                          ? RECONCILIATION_LABELS[envelope.cashState]
                          : formatNative(envelope.cashGap, envelope.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Coût de revient du stock</span>
                      <strong
                        className={envelope.openCostBasis === null ? "warning-text" : undefined}
                      >
                        {envelope.openCostBasis === null
                          ? NOT_COMPUTABLE
                          : formatNative(envelope.openCostBasis, envelope.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>PnL réalisé</span>
                      <strong
                        className={envelope.realisedPnL === null ? "warning-text" : undefined}
                      >
                        {envelope.realisedPnL === null
                          ? NOT_COMPUTABLE
                          : formatNative(envelope.realisedPnL, envelope.currency)}
                      </strong>
                    </div>
                    <div>
                      <span>Convention de lots</span>
                      <strong
                        className={envelope.lotMatchingMethod === null ? "warning-text" : undefined}
                      >
                        {envelope.lotMatchingMethod === null
                          ? "Non déclarée"
                          : MATCHING_LABELS[envelope.lotMatchingMethod]}
                      </strong>
                    </div>
                  </div>
                  {envelope.holdings.length ? (
                    <div className="ledger-holdings">
                      {envelope.holdings.map((holding) => (
                        <div key={holding.securityId}>
                          <span>
                            <strong>{holding.securityName || holding.securityId}</strong>
                            <small>
                              {holding.lots.length} lot(s) ·{" "}
                              {RECONCILIATION_LABELS[holding.quantityState]}
                            </small>
                          </span>
                          <span>
                            {holding.ledgerQuantity === null
                              ? NOT_COMPUTABLE
                              : `${holding.ledgerQuantity} au ledger`}
                            {holding.observedQuantity === null
                              ? " · quantité observée inconnue"
                              : ` · ${holding.observedQuantity} observé(s)`}
                          </span>
                          <span
                            className={
                              holding.ledgerCostBasis === null ? "warning-text" : undefined
                            }
                          >
                            {holding.ledgerCostBasis === null
                              ? "Coût de revient non calculable"
                              : formatNative(holding.ledgerCostBasis, envelope.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="form-actions">
                    <button
                      className="button secondary compact"
                      onClick={() => setPolicyEditor(envelope.accountId)}
                    >
                      <Settings2 size={13} /> Conventions
                    </button>
                    <button
                      className="button primary compact"
                      disabled={!account}
                      onClick={() => setEventEditor(envelope.accountId)}
                    >
                      <Plus size={13} /> Événement
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="Aucune enveloppe d’investissement"
            detail="Le ledger portefeuille ne se loge que dans une enveloppe : aucun compte éligible n’est enregistré."
          />
        )}
        {ledger.envelopes.some((envelope) => envelope.coverageStatus === "UNDECLARED") ? (
          <Callout tone="warning" title="Historique incomplet">
            {ledger.envelopes
              .filter((envelope) => envelope.coverageStatus === "UNDECLARED")
              .map((envelope) => envelope.accountName)
              .join(", ")}{" "}
            n’a aucune profondeur d’historique déclarée. L’état observé reste la vérité de ces
            enveloppes, et aucun achat n’est reconstitué pour l’expliquer : coût de revient
            détaillé, lots et PnL réalisé restent non calculables tant que l’historique n’est pas
            saisi et déclaré.
          </Callout>
        ) : null}
        {ledger.quality.flags.length ? (
          <p className="panel-note">
            Contrôles ouverts : {ledger.quality.flags.slice(0, 8).join(", ")}
            {ledger.quality.flags.length > 8
              ? ` et ${ledger.quality.flags.length - 8} autre(s)`
              : ""}
            .
          </p>
        ) : null}
      </section>
      {state.portfolioEvents.length ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Ledger</span>
              <h2>Événements enregistrés</h2>
            </div>
          </div>
          <div className="ledger-table">
            <div className="table-head">
              <span>Date</span>
              <span>Nature</span>
              <span>Enveloppe</span>
              <span>Instrument</span>
              <span>Quantité</span>
              <span>Cash d’enveloppe</span>
              <span />
            </div>
            {[...state.portfolioEvents]
              .sort((left, right) => right.eventDate.localeCompare(left.eventDate))
              .map((event) => (
                <div className="table-row" key={event.id}>
                  <span>
                    <strong>{event.eventDate}</strong>
                    <small>
                      <DataBadge kind={event.provenance.kind} />
                    </small>
                  </span>
                  <span>{EVENT_TYPE_LABELS[event.type]}</span>
                  <span>
                    {state.accounts.find((account) => account.id === event.accountId)?.name ??
                      "Enveloppe inconnue"}
                  </span>
                  <span>{event.securityName ?? "—"}</span>
                  <span>{event.quantity ?? "—"}</span>
                  <strong>
                    {event.envelopeCashAmount === null
                      ? NOT_COMPUTABLE
                      : formatNative(event.envelopeCashAmount, event.currency)}
                  </strong>
                  <span>
                    <button
                      className="icon-button"
                      aria-label="Supprimer l’événement"
                      disabled={busy}
                      onClick={() =>
                        mutate({ action: "delete_portfolio_event", eventId: event.id })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>
              ))}
          </div>
        </section>
      ) : null}
      {eventEditor ? (
        <Modal
          open
          wide
          title="Nouvel événement de portefeuille"
          subtitle="Un fait daté, jamais une hypothèse. Un champ vide reste inconnu."
          onClose={() => setEventEditor(null)}
        >
          <PortfolioEventForm
            envelope={state.accounts.find((account) => account.id === eventEditor)!}
            accounts={state.accounts}
            events={state.portfolioEvents.filter((event) => event.accountId === eventEditor)}
            transactions={state.transactions}
            asOfDate={state.asOfDate}
            busy={busy}
            onSave={(event) => mutate({ action: "record_portfolio_event", event })}
            onCancel={() => setEventEditor(null)}
          />
        </Modal>
      ) : null}
      {policyEditor ? (
        <Modal
          open
          title="Conventions de l’enveloppe"
          subtitle="Ce qui n’est pas déclaré n’est pas supposé."
          onClose={() => setPolicyEditor(null)}
        >
          <PortfolioPolicyForm
            envelope={state.accounts.find((account) => account.id === policyEditor)!}
            policy={
              state.portfolioPolicies.find((policy) => policy.accountId === policyEditor) ?? null
            }
            busy={busy}
            onSave={(policy) => mutate({ action: "set_portfolio_envelope_policy", policy })}
            onCancel={() => setPolicyEditor(null)}
          />
        </Modal>
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
