"use client";

import { useMemo, useState } from "react";
import { Building2, Plus } from "lucide-react";

import type { BusinessEquityPosition } from "@/lib/engine/business-equity";
import {
  BUSINESS_METHOD_LABELS,
  BUSINESS_TYPE_LABELS,
  explainNotComputable,
  formatBusinessDate,
  summariseQuality,
  type ExplainContext,
} from "@/lib/engine/business-equity-explain";
import { Callout, EmptyState, MetricCard, Modal, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";
import {
  Amount,
  QualityPanel,
  RangeBar,
  RangeValue,
  RateValue,
  RatioValue,
} from "@/components/pages/business-equity/display";
import {
  BridgeItemForm,
  CapitalEventForm,
  DcfForm,
  EbitdaAdjustmentForm,
  FinancialPeriodForm,
  FundingRoundForm,
  HoldingLinkForm,
  IdentityForm,
  OwnershipForm,
  QuickStartForm,
  ValuationBasisForm,
} from "@/components/pages/business-equity/forms";
import {
  AuditTab,
  BUSINESS_TABS,
  CapitalTab,
  FinancialsTab,
  OverviewTab,
  OwnershipTab,
  ScenariosTab,
  ValuationTab,
  type BusinessTabId,
  type EditorKind,
  type TabProps,
} from "@/components/pages/business-equity/views";

/**
 * BUSINESS EQUITY — écran principal.
 *
 * L'ancienne page empilait cinq grands formulaires sous une poignée de chiffres, et
 * demandait à l'utilisateur de fournir lui-même l'Enterprise Value. Celle-ci fait
 * l'inverse : elle montre d'abord ce que le moteur a DÉRIVÉ, société par société, et
 * n'ouvre un formulaire que sur demande, dans une fenêtre, pour un fait précis.
 *
 * Aucun calcul financier ne vit dans ce fichier : tout vient de `state.businessEquity`.
 */

const TAB_COMPONENTS: Record<BusinessTabId, (props: TabProps) => React.ReactElement> = {
  overview: OverviewTab,
  financials: FinancialsTab,
  valuation: ValuationTab,
  ownership: OwnershipTab,
  capital: CapitalTab,
  scenarios: ScenariosTab,
  audit: AuditTab,
};

export default function BusinessPage({ state, mutate, busy }: SectionProps) {
  const portfolio = state.businessEquity;
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<BusinessTabId>("overview");
  const [editor, setEditor] = useState<EditorKind | null>(null);
  const [quickStart, setQuickStart] = useState(false);

  const context: ExplainContext = useMemo(
    () => ({
      nameOf: (businessId: string) =>
        (state.businesses ?? []).find((item) => item.id === businessId)?.name ?? "Cette société",
      asOfDate: state.asOfDate,
    }),
    [state.businesses, state.asOfDate],
  );

  const currency = portfolio?.reportingCurrency ?? state.reportingCurrency;
  const selected: BusinessEquityPosition | null =
    portfolio?.positions.find((position) => position.business.id === selectedId) ??
    portfolio?.positions[0] ??
    null;

  const header = (
    <SectionHeader
      eyebrow="Private assets"
      title="Business Equity"
      description="Participations privées : le moteur dérive la valorisation, le pont EV → Equity, la fourchette et la performance à partir de vos faits. Aucune Enterprise Value ne vous est demandée."
      actions={
        <button className="button primary" onClick={() => setQuickStart(true)}>
          <Plus size={15} /> Nouvelle société
        </button>
      }
    />
  );

  const quickStartModal = quickStart ? (
    <Modal
      open
      wide
      title="Nouvelle société"
      subtitle="Mode simple : déclarez les faits, le moteur produit la valorisation complète."
      onClose={() => setQuickStart(false)}
    >
      <QuickStartForm
        asOfDate={state.asOfDate}
        busy={busy}
        mutate={mutate}
        onDone={() => setQuickStart(false)}
      />
    </Modal>
  ) : null;

  if (!portfolio || portfolio.positions.length === 0) {
    return (
      <div className="page-stack">
        {header}
        <EmptyState
          title="Aucune participation déclarée"
          detail="Une société entre au patrimoine quand elle est enregistrée avec sa détention, une période financière et une méthode de valorisation. Tant qu’elle n’existe pas, elle ne pèse rien : ce n’est pas une valeur nulle, c’est une absence."
          action={
            <button className="button primary" onClick={() => setQuickStart(true)}>
              <Plus size={15} /> Créer une société
            </button>
          }
        />
        {quickStartModal}
      </div>
    );
  }

  const totalComputed = portfolio.totalAttributableValue.central.value !== null;
  const portfolioSummary = summariseQuality(portfolio.quality, totalComputed, context);
  const TabComponent = TAB_COMPONENTS[tab];

  return (
    <div className="page-stack">
      {header}

      <Callout title="Ce que ce périmètre dit, et ce qu’il ne dit pas">
        La valeur personnelle de chaque participation entre au bilan canonique comme actif
        illiquide. La dette des sociétés détenues est CORPORATE : elle réduit leur Equity Value dans
        le pont et n’entre jamais au passif personnel. Une société suivie dont un fait manque reste
        comptée, avec un montant inconnu — jamais avec un zéro.
      </Callout>

      <section className="metrics-grid four">
        <MetricCard
          label="Valeur personnelle"
          tone={totalComputed ? "positive" : "warning"}
          value={
            <Amount
              amount={portfolio.totalAttributableValue.central}
              currency={currency}
              context={context}
            />
          }
          detail={
            <>
              <RangeValue range={portfolio.totalAttributableValue} currency={currency} />
              <RangeBar range={portfolio.totalAttributableValue} />
            </>
          }
        />
        <MetricCard
          label="Sociétés"
          value={`${portfolio.valuedCount} / ${portfolio.trackedCount}`}
          detail={`${portfolio.directPositions.length} détenue(s) en direct · ${portfolio.trackedCount - portfolio.directPositions.length} détenue(s) via une holding`}
        />
        <MetricCard
          label="Enterprise Value cumulée"
          value={
            <Amount amount={portfolio.totalEnterpriseValue} currency={currency} context={context} />
          }
          detail={`${portfolio.enterpriseValueCoverage} société(s) valorisée(s) par une méthode qui en définit une`}
        />
        <MetricCard
          label="Dette nette corporate"
          value={<Amount amount={portfolio.totalNetDebt} currency={currency} context={context} />}
          detail="Portée par les sociétés, jamais par vous"
        />
        <MetricCard
          label="Capital investi déclaré"
          value={
            <Amount amount={portfolio.totalInvestedCapital} currency={currency} context={context} />
          }
        />
        <MetricCard
          label="Cash retourné"
          value={
            <Amount amount={portfolio.totalCashReturned} currency={currency} context={context} />
          }
        />
        <MetricCard
          label="MOIC"
          value={<RatioValue amount={portfolio.portfolioMoic} context={context} />}
        />
        <MetricCard
          label="XIRR"
          value={<RateValue amount={portfolio.portfolioXirr} context={context} />}
        />
      </section>

      {portfolioSummary.level !== "COMPLETE" ? (
        <QualityPanel
          quality={portfolio.quality}
          computed={totalComputed}
          context={context}
          title="Qualité du total"
        />
      ) : null}

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Portefeuille</span>
            <h2>Sociétés</h2>
          </div>
        </div>
        <div className="business-table">
          <div className="table-head">
            <span>Société</span>
            <span>Valeur personnelle</span>
            <span>Fourchette</span>
            <span>Détention</span>
            <span>Méthode</span>
            <span>État</span>
          </div>
          {portfolio.positions.map((position) => {
            const computed = position.attributableValue.central.value !== null;
            const summary = summariseQuality(position.quality, computed, context);
            return (
              <button
                type="button"
                className={`table-row business-row ${selected?.business.id === position.business.id ? "active" : ""}`}
                key={position.business.id}
                onClick={() => {
                  setSelectedId(position.business.id);
                  setTab("overview");
                }}
              >
                <span className="holding-name">
                  <i>
                    <Building2 size={13} />
                  </i>
                  <span>
                    <strong>{position.business.name}</strong>
                    <small>
                      {position.business.type
                        ? BUSINESS_TYPE_LABELS[position.business.type]
                        : "Nature non déclarée"}
                      {position.isDirectHolding ? "" : " · détenue via une holding"}
                    </small>
                  </span>
                </span>
                <span>
                  <Amount
                    amount={position.attributableValue.central}
                    currency={currency}
                    context={context}
                  />
                </span>
                <span>
                  <RangeValue range={position.attributableValue} currency={currency} />
                </span>
                <span>
                  <RateValue amount={position.ownership.economicRate} context={context} />
                </span>
                <span>
                  {position.valuation.method
                    ? BUSINESS_METHOD_LABELS[position.valuation.method]
                    : "Aucune"}
                  {position.valuation.multiple?.central
                    ? ` ${position.valuation.multiple.central.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ×`
                    : ""}
                </span>
                <span className={`state-pill ${summary.level.toLowerCase()}`}>
                  {summary.headline}
                </span>
              </button>
            );
          })}
        </div>
      </article>

      {selected ? (
        <article className="panel business-detail">
          <div className="panel-header">
            <div>
              <span className="eyebrow">
                {selected.business.legalForm ?? "Société"}
                {selected.business.sector ? ` · ${selected.business.sector}` : ""}
              </span>
              <h2>{selected.business.name}</h2>
            </div>
            <strong>
              <Amount
                amount={selected.attributableValue.central}
                currency={currency}
                context={context}
              />
            </strong>
          </div>

          {selected.attributableValue.central.value === null ? (
            <Callout tone="warning" title="Valeur personnelle non calculable">
              {explainNotComputable(
                selected.attributableValue.central.blockers,
                context,
                "la valeur personnelle",
              )}
            </Callout>
          ) : null}

          <div className="decision-case-strip business-tabs">
            {BUSINESS_TABS.map((item) => (
              <button
                key={item.id}
                className={tab === item.id ? "active" : ""}
                onClick={() => setTab(item.id)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>

          <TabComponent
            position={selected}
            portfolio={portfolio}
            state={state}
            context={context}
            currency={currency}
            busy={busy}
            mutate={mutate}
            open={setEditor}
          />
        </article>
      ) : null}

      {quickStartModal}

      {selected && editor ? (
        <Modal
          open
          wide={editor === "dcf" || editor === "period" || editor === "identity"}
          title={EDITOR_TITLES[editor]}
          subtitle={`${selected.business.name} · arrêté au ${formatBusinessDate(state.asOfDate)}`}
          onClose={() => setEditor(null)}
        >
          {editor === "identity" ? (
            <IdentityForm
              business={selected.business}
              asOfDate={state.asOfDate}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "ownership" ? (
            <OwnershipForm
              businessId={selected.business.id}
              asOfDate={state.asOfDate}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "period" ? (
            <FinancialPeriodForm
              businessId={selected.business.id}
              currency={selected.business.functionalCurrency ?? currency}
              asOfDate={state.asOfDate}
              existing={null}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "valuation" ? (
            <ValuationBasisForm
              businessId={selected.business.id}
              currency={selected.business.functionalCurrency ?? currency}
              asOfDate={state.asOfDate}
              periods={selected.financials.periods.map((period) => period.snapshot)}
              hasDcf={(state.businessDcfAssumptions ?? []).some(
                (item) => item.businessId === selected.business.id,
              )}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "adjustment" ? (
            <EbitdaAdjustmentForm
              businessId={selected.business.id}
              currency={selected.business.functionalCurrency ?? currency}
              asOfDate={state.asOfDate}
              periods={selected.financials.periods.map((period) => period.snapshot)}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "bridge-item" ? (
            <BridgeItemForm
              businessId={selected.business.id}
              currency={selected.business.functionalCurrency ?? currency}
              asOfDate={state.asOfDate}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "dcf" ? (
            <DcfForm
              businessId={selected.business.id}
              currency={selected.business.functionalCurrency ?? currency}
              asOfDate={state.asOfDate}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "capital-event" ? (
            <CapitalEventForm
              businessId={selected.business.id}
              currency={selected.business.functionalCurrency ?? currency}
              asOfDate={state.asOfDate}
              currentOwnership={selected.ownership.economicRate.value}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "holding" ? (
            <HoldingLinkForm
              parentBusinessId={selected.business.id}
              candidates={(state.businesses ?? []).filter(
                (item) => item.id !== selected.business.id,
              )}
              asOfDate={state.asOfDate}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
          {editor === "funding-round" ? (
            <FundingRoundForm
              position={selected}
              currency={selected.business.functionalCurrency ?? currency}
              asOfDate={state.asOfDate}
              busy={busy}
              mutate={mutate}
              onDone={() => setEditor(null)}
            />
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

const EDITOR_TITLES: Record<EditorKind, string> = {
  identity: "Identité et couverture d’historique",
  ownership: "Enregistrer une détention",
  period: "Ajouter une période financière",
  valuation: "Choisir une base de valorisation",
  adjustment: "Ajouter un retraitement d’EBITDA",
  "bridge-item": "Ajouter un élément au pont EV → Equity",
  dcf: "Hypothèses de flux actualisés",
  "capital-event": "Enregistrer une opération de capital",
  holding: "Rattacher une filiale",
  "funding-round": "Appliquer un tour de table",
};
