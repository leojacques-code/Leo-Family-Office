"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import type {
  BusinessAmount,
  BusinessEquityPosition,
  BusinessEquityPortfolio,
} from "@/lib/engine/business-equity";
import { computeDcf, multipleSensitivity } from "@/lib/engine/business-valuation";
import {
  projectBusinessHold,
  projectBusinessRaise,
  projectBusinessSale,
  BUSINESS_SALE_TAX_BASE_CONVENTION,
} from "@/lib/engine/business-equity-scenarios";
import { blocker, known, sumAll, unknown } from "@/lib/engine/business-equity-facts";
import {
  BUSINESS_ADJUSTMENT_CATEGORY_LABELS,
  BUSINESS_AMOUNT_SCOPE_LABELS,
  BUSINESS_BRIDGE_CATEGORY_LABELS,
  BUSINESS_CAPITAL_EVENT_LABELS,
  BUSINESS_COVERAGE_LABELS,
  BUSINESS_METHOD_LABELS,
  BUSINESS_METHOD_NATURE,
  BUSINESS_METRIC_BASIS_LABELS,
  BUSINESS_PERIOD_KIND_LABELS,
  formatBusinessDate,
  type ExplainContext,
} from "@/lib/engine/business-equity-explain";
import type { DashboardState } from "@/lib/types";
import { Callout, MetricCard } from "@/components/ui";
import { NOT_COMPUTABLE } from "@/components/pages/shared";
import {
  Amount,
  BridgeTable,
  FactRow,
  QualityPanel,
  RangeBar,
  RangeValue,
  RateValue,
  RatioValue,
  SensitivityTable,
  flagList,
} from "@/components/pages/business-equity/display";
import {
  DeleteButton,
  optionalNumber,
  optionalRate,
  type Mutate,
} from "@/components/pages/business-equity/forms";

/**
 * ONGLETS D'UNE PARTICIPATION.
 *
 * Chaque onglet répond à UNE question : combien ça vaut et pourquoi (Aperçu), comment la
 * société se porte (Financiers), sur quelles hypothèses (Valorisation), qui détient quoi
 * (Détention), ce que ça a coûté et rapporté (Capital), ce qui arriverait si (Scénarios),
 * d'où vient chaque chiffre (Audit).
 *
 * Aucun calcul financier n'a lieu ici. Les scénarios eux-mêmes appellent le moteur : ces
 * composants collectent des hypothèses et affichent des résultats.
 */

export interface TabProps {
  position: BusinessEquityPosition;
  portfolio: BusinessEquityPortfolio;
  state: DashboardState;
  context: ExplainContext;
  currency: string;
  busy: boolean;
  mutate: Mutate;
  open: (editor: EditorKind) => void;
}

export type EditorKind =
  | "identity"
  | "ownership"
  | "period"
  | "valuation"
  | "adjustment"
  | "bridge-item"
  | "dcf"
  | "capital-event"
  | "holding"
  | "funding-round";

export const BUSINESS_TABS = [
  { id: "overview", label: "Aperçu" },
  { id: "financials", label: "Financiers" },
  { id: "valuation", label: "Valorisation" },
  { id: "ownership", label: "Détention & cap table" },
  { id: "capital", label: "Capital & distributions" },
  { id: "scenarios", label: "Scénarios" },
  { id: "audit", label: "Audit & sources" },
] as const;

export type BusinessTabId = (typeof BUSINESS_TABS)[number]["id"];

/**
 * Absence de période financière. Un ratio sans période n'est PAS nul : il n'existe pas.
 * Cette constante existe pour qu'aucune carte ne puisse afficher « 0 % » faute de données.
 */
const NO_PERIOD = unknown([blocker("VALUATION_FINANCIAL_PERIOD_MISSING")]);

// ─── Aperçu ─────────────────────────────────────────────────────────────────────────────

export function OverviewTab({ position, context, currency }: TabProps) {
  const valuation = position.valuation;
  const computed = position.attributableValue.central.value !== null;
  return (
    <div className="tab-stack">
      <section className="metrics-grid four">
        <MetricCard
          label="Valeur personnelle"
          tone={computed ? "positive" : "warning"}
          value={
            <Amount
              amount={position.attributableValue.central}
              currency={currency}
              context={context}
            />
          }
          detail={
            <>
              <RangeValue range={position.attributableValue} currency={currency} />
              <RangeBar range={position.attributableValue} />
            </>
          }
        />
        <MetricCard
          label="Equity Value (société entière)"
          value={
            <Amount amount={position.equityValue.central} currency={currency} context={context} />
          }
          detail={
            valuation.method ? BUSINESS_METHOD_LABELS[valuation.method] : "Aucune méthode déclarée"
          }
        />
        <MetricCard
          label="Enterprise Value"
          value={
            <Amount
              amount={position.enterpriseValue.central}
              currency={currency}
              context={context}
            />
          }
          detail={
            valuation.multiple?.central
              ? `${BUSINESS_METRIC_BASIS_LABELS[valuation.metricBasis ?? "EBITDA"]} × ${valuation.multiple.central.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}`
              : "Non applicable à cette méthode"
          }
        />
        <MetricCard
          label="Dette nette corporate"
          value={<Amount amount={position.netDebt} currency={currency} context={context} />}
          detail="Réduit l’Equity Value. N’entre jamais au passif personnel."
        />
      </section>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Dérivation</span>
            <h2>Du résultat de la société à votre valeur personnelle</h2>
          </div>
          {valuation.valuationDate ? (
            <strong>Au {formatBusinessDate(valuation.valuationDate)}</strong>
          ) : null}
        </div>
        <BridgeTable bridge={valuation.bridge} currency={currency} context={context} />
        {valuation.method ? (
          <p className="muted-copy">{BUSINESS_METHOD_NATURE[valuation.method]}</p>
        ) : null}
      </article>

      <QualityPanel quality={position.quality} computed={computed} context={context} />
    </div>
  );
}

// ─── Financiers ─────────────────────────────────────────────────────────────────────────

export function FinancialsTab({ position, context, currency, busy, mutate, open }: TabProps) {
  const history = position.financials;
  return (
    <div className="tab-stack">
      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Historique</span>
            <h2>Comptes par période</h2>
          </div>
          <button className="button secondary" onClick={() => open("period")}>
            <Plus size={14} /> Ajouter une période
          </button>
        </div>
        {history.periods.length === 0 ? (
          <p className="muted-copy">
            Aucune période saisie. Sans période financière, ni multiple ni pont EV → Equity ne
            peuvent être dérivés.
          </p>
        ) : (
          <div className="financial-table">
            <div className="table-head">
              <span>Période</span>
              <span>CA</span>
              <span>Croissance</span>
              <span>EBITDA</span>
              <span>Marge</span>
              <span>Dette nette</span>
              <span>Levier</span>
              <span>FCF</span>
              <span />
            </div>
            {[...history.periods].reverse().map((period) => (
              <div className="table-row" key={period.snapshot.id}>
                <span>
                  <strong>
                    {period.snapshot.periodLabel ?? formatBusinessDate(period.snapshot.periodEnd)}
                  </strong>
                  <small>{BUSINESS_PERIOD_KIND_LABELS[period.snapshot.periodKind]}</small>
                </span>
                <span>
                  {period.snapshot.revenue === null ? (
                    NOT_COMPUTABLE
                  ) : (
                    <Amount
                      amount={known(period.snapshot.revenue)}
                      currency={period.currency ?? currency}
                      compact
                      context={context}
                    />
                  )}
                </span>
                <span>
                  <RateValue amount={period.revenueGrowth} context={context} />
                </span>
                <span>
                  {period.snapshot.ebitda === null ? (
                    NOT_COMPUTABLE
                  ) : (
                    <Amount
                      amount={known(period.snapshot.ebitda)}
                      currency={period.currency ?? currency}
                      compact
                      context={context}
                    />
                  )}
                </span>
                <span>
                  <RateValue amount={period.ebitdaMargin} context={context} />
                </span>
                <span>
                  <Amount
                    amount={period.netDebt}
                    currency={period.currency ?? currency}
                    compact
                    context={context}
                  />
                </span>
                <span>
                  <RatioValue amount={period.leverage} context={context} />
                </span>
                <span>
                  <Amount
                    amount={period.freeCashFlow}
                    currency={period.currency ?? currency}
                    compact
                    context={context}
                  />
                </span>
                <span>
                  <DeleteButton
                    label={`Supprimer la période ${period.snapshot.periodEnd}`}
                    busy={busy}
                    onDelete={() =>
                      mutate({
                        action: "delete_business_financials",
                        financialsId: period.snapshot.id,
                      })
                    }
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </article>

      <section className="metrics-grid four">
        <MetricCard
          label="CAGR chiffre d’affaires"
          value={<RateValue amount={history.revenueCagr} context={context} />}
          detail={
            history.cagrYears
              ? `Sur ${history.cagrYears.toFixed(1)} ans d’exercices`
              : "Deux exercices comparables requis"
          }
        />
        <MetricCard
          label="CAGR EBITDA"
          value={<RateValue amount={history.ebitdaCagr} context={context} />}
        />
        <MetricCard
          label="Conversion EBITDA → FCF"
          value={
            <RateValue
              amount={history.latest?.ebitdaToFcfConversion ?? NO_PERIOD}
              context={context}
            />
          }
          detail="Dernière période connue"
        />
        <MetricCard
          label="Marge d’exploitation"
          value={<RateValue amount={history.latest?.ebitMargin ?? NO_PERIOD} context={context} />}
        />
      </section>
    </div>
  );
}

// ─── Valorisation ───────────────────────────────────────────────────────────────────────

export function ValuationTab({ position, state, context, currency, busy, mutate, open }: TabProps) {
  const valuation = position.valuation;
  const adjustments = (state.businessEbitdaAdjustments ?? []).filter(
    (item) => item.businessId === position.business.id,
  );
  const bridgeItems = (state.businessBridgeItems ?? []).filter(
    (item) => item.businessId === position.business.id,
  );
  const dcfAssumptions = (state.businessDcfAssumptions ?? []).filter(
    (item) => item.businessId === position.business.id,
  );
  const dcf = dcfAssumptions.at(-1) ?? null;
  const dcfResult = useMemo(
    () => (dcf ? computeDcf(position.business, dcf, currency, state.currencyRates ?? []) : null),
    [dcf, position.business, currency, state.currencyRates],
  );

  const toEquity = (enterprise: BusinessAmount) =>
    sumAll([
      enterprise,
      {
        value: valuation.grossDebt.value === null ? null : -valuation.grossDebt.value,
        blockers: valuation.grossDebt.blockers,
        flags: valuation.grossDebt.flags,
      },
      valuation.cash,
      valuation.bridgeItemsTotal,
    ]);

  const central = valuation.multiple?.central ?? null;
  const sensitivity =
    valuation.adjustedMetric && central !== null
      ? multipleSensitivity({
          adjustedMetric: valuation.adjustedMetric,
          multiples: [
            valuation.multiple?.low ?? central * 0.85,
            central,
            valuation.multiple?.high ?? central * 1.15,
          ],
          metricShocks: [-0.1, 0, 0.1],
          toEquity,
          economicRate: position.ownership.economicRate,
          output: "ATTRIBUTABLE_VALUE",
        })
      : null;

  return (
    <div className="tab-stack">
      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Base retenue</span>
            <h2>
              {valuation.method ? BUSINESS_METHOD_LABELS[valuation.method] : "Aucune base déclarée"}
            </h2>
          </div>
          <button className="button secondary" onClick={() => open("valuation")}>
            Changer de base
          </button>
        </div>
        {valuation.method ? (
          <>
            <div className="fact-grid">
              <FactRow
                label="Date de valorisation"
                value={
                  valuation.valuationDate
                    ? formatBusinessDate(valuation.valuationDate)
                    : NOT_COMPUTABLE
                }
              />
              <FactRow
                label="Agrégat retenu"
                value={
                  valuation.metricBasis
                    ? BUSINESS_METRIC_BASIS_LABELS[valuation.metricBasis]
                    : "Sans objet"
                }
                detail={
                  valuation.metricPeriodEnd
                    ? formatBusinessDate(valuation.metricPeriodEnd)
                    : undefined
                }
              />
              <FactRow
                label="Multiple bas / central / haut"
                value={
                  valuation.multiple
                    ? `${(valuation.multiple.low ?? 0).toFixed(2)} × / ${(valuation.multiple.central ?? 0).toFixed(2)} × / ${(valuation.multiple.high ?? 0).toFixed(2)} ×`
                    : "Sans objet"
                }
              />
              <FactRow
                label="Bilan du pont"
                value={
                  valuation.balanceSheetPeriodEnd
                    ? formatBusinessDate(valuation.balanceSheetPeriodEnd)
                    : NOT_COMPUTABLE
                }
                detail="Période dont proviennent dette brute et trésorerie"
              />
            </div>
            <p className="muted-copy">{BUSINESS_METHOD_NATURE[valuation.method]}</p>
          </>
        ) : (
          <p className="muted-copy">
            Déclarez une méthode et ses hypothèses. Le moteur en dérivera la valeur : aucune
            Enterprise Value ne vous sera demandée.
          </p>
        )}
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Fourchette</span>
            <h2>Trois multiples, trois valeurs</h2>
          </div>
        </div>
        <div className="range-grid">
          <div>
            <span>Bas</span>
            <strong>
              <Amount
                amount={position.attributableValue.low}
                currency={currency}
                context={context}
              />
            </strong>
          </div>
          <div className="central">
            <span>Central — alimente le bilan</span>
            <strong>
              <Amount
                amount={position.attributableValue.central}
                currency={currency}
                context={context}
              />
            </strong>
          </div>
          <div>
            <span>Haut</span>
            <strong>
              <Amount
                amount={position.attributableValue.high}
                currency={currency}
                context={context}
              />
            </strong>
          </div>
        </div>
        <RangeBar range={position.attributableValue} />
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">EBITDA ajusté</span>
            <h2>Retraitements déclarés</h2>
          </div>
          <button className="button secondary" onClick={() => open("adjustment")}>
            <Plus size={14} /> Ajouter
          </button>
        </div>
        {adjustments.length === 0 ? (
          <p className="muted-copy">
            Aucun retraitement déclaré. Le moteur n’en invente aucun : l’agrégat observé est utilisé
            tel quel.
          </p>
        ) : (
          <div className="fact-grid">
            {adjustments.map((item) => (
              <FactRow
                key={item.id}
                label={item.label}
                detail={`${BUSINESS_ADJUSTMENT_CATEGORY_LABELS[item.category]} · ${formatBusinessDate(item.periodEnd)}${item.recurring ? " · récurrent" : ""}`}
                value={
                  <>
                    <Amount
                      amount={known(item.amount)}
                      currency={item.currency}
                      context={context}
                      sign
                    />
                    <DeleteButton
                      label={`Supprimer ${item.label}`}
                      busy={busy}
                      onDelete={() =>
                        mutate({
                          action: "delete_business_ebitda_adjustment",
                          adjustmentId: item.id,
                        })
                      }
                    />
                  </>
                }
              />
            ))}
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Pont EV → Equity</span>
            <h2>Éléments autres que dette et trésorerie</h2>
          </div>
          <button className="button secondary" onClick={() => open("bridge-item")}>
            <Plus size={14} /> Ajouter
          </button>
        </div>
        {bridgeItems.length === 0 ? (
          <p className="muted-copy">
            Aucun élément déclaré : minoritaires, engagements de retraite, comptes courants et
            actifs hors exploitation sont l’exception, pas la règle.
          </p>
        ) : (
          <div className="fact-grid">
            {bridgeItems.map((item) => (
              <FactRow
                key={item.id}
                label={item.label}
                detail={`${BUSINESS_BRIDGE_CATEGORY_LABELS[item.category]} · ${formatBusinessDate(item.effectiveDate)}`}
                value={
                  <>
                    <Amount
                      amount={known(item.amount)}
                      currency={item.currency}
                      context={context}
                      sign
                    />
                    <DeleteButton
                      label={`Supprimer ${item.label}`}
                      busy={busy}
                      onDelete={() =>
                        mutate({ action: "delete_business_bridge_item", itemId: item.id })
                      }
                    />
                  </>
                }
              />
            ))}
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Flux actualisés</span>
            <h2>Hypothèses de DCF</h2>
          </div>
          <button className="button secondary" onClick={() => open("dcf")}>
            {dcf ? "Modifier" : "Saisir"} les hypothèses
          </button>
        </div>
        {!dcf || !dcfResult ? (
          <p className="muted-copy">
            Aucune hypothèse de DCF. La méthode n’est proposée qu’une fois ses paramètres déclarés :
            LFO ne fournit ni WACC, ni croissance, ni marge.
          </p>
        ) : (
          <>
            <div className="fact-grid">
              <FactRow label="WACC" value={`${(dcf.wacc * 100).toFixed(2)} %`} />
              <FactRow label="Taux d’impôt" value={`${(dcf.taxRate * 100).toFixed(2)} %`} />
              <FactRow
                label="Valeur terminale"
                value={
                  dcf.terminalMethod === "PERPETUAL_GROWTH"
                    ? `Croissance perpétuelle ${(100 * (dcf.terminalGrowth ?? 0)).toFixed(2)} %`
                    : `Multiple de sortie ${(dcf.terminalExitMultiple ?? 0).toFixed(2)} × ${dcf.terminalExitMetric ?? ""}`
                }
              />
              <FactRow
                label="Actualisation"
                value={dcf.discountConvention === "MID_YEAR" ? "Mi-année" : "Fin d’année"}
              />
              <FactRow
                label="Flux actualisés de l’horizon"
                value={
                  <Amount
                    amount={dcfResult.discountedExplicitValue}
                    currency={currency}
                    context={context}
                  />
                }
              />
              <FactRow
                label="Valeur terminale actualisée"
                value={
                  <Amount
                    amount={dcfResult.discountedTerminalValue}
                    currency={currency}
                    context={context}
                  />
                }
              />
              <FactRow
                label="Part portée par la valeur terminale"
                value={<RateValue amount={dcfResult.terminalValueShare} context={context} />}
                detail="Au-delà de 75 %, le DCF dit surtout ce que vaut l’hypothèse terminale"
              />
            </div>
            <div className="financial-table">
              <div className="table-head">
                <span>Année</span>
                <span>EBIT</span>
                <span>NOPAT</span>
                <span>Free cash flow</span>
                <span>Actualisé</span>
              </div>
              {dcfResult.periods.map((period) => (
                <div className="table-row" key={period.yearIndex}>
                  <span>
                    <strong>N+{period.yearIndex}</strong>
                  </span>
                  <span>
                    <Amount amount={period.ebit} currency={currency} compact context={context} />
                  </span>
                  <span>
                    <Amount amount={period.nopat} currency={currency} compact context={context} />
                  </span>
                  <span>
                    <Amount
                      amount={period.freeCashFlow}
                      currency={currency}
                      compact
                      context={context}
                    />
                  </span>
                  <span>
                    <Amount
                      amount={period.presentValue}
                      currency={currency}
                      compact
                      context={context}
                    />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </article>

      {sensitivity ? (
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Sensibilité</span>
              <h2>Valeur personnelle selon le multiple et l’agrégat</h2>
            </div>
          </div>
          <SensitivityTable
            matrix={sensitivity}
            currency={currency}
            context={context}
            rowLabel="Agrégat"
            columnLabel="Multiple"
            formatRow={(value) =>
              value === 0 ? "Central" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(0)} %`
            }
            formatColumn={(value) => `${value.toFixed(1)} ×`}
          />
        </article>
      ) : null}

      {valuation.alternatives.length > 0 ? (
        <Callout tone="warning" title="Valorisations concurrentes à la même date">
          {valuation.alternatives
            .map(
              (item) =>
                `${BUSINESS_METHOD_LABELS[item.method]} du ${formatBusinessDate(item.valuationDate)}`,
            )
            .join(" · ")}
          . La plus factuelle est retenue ; les autres restent consultables dans l’audit et ne sont
          ni moyennées ni effacées.
        </Callout>
      ) : null}
    </div>
  );
}

// ─── Détention ──────────────────────────────────────────────────────────────────────────

export function OwnershipTab({ position, context, currency, busy, mutate, open }: TabProps) {
  const ownership = position.ownership;
  return (
    <div className="tab-stack">
      <section className="metrics-grid four">
        <MetricCard
          label="Détention juridique"
          value={<RateValue amount={ownership.legalRate} context={context} />}
        />
        <MetricCard
          label="Droits économiques"
          value={<RateValue amount={ownership.economicRate} context={context} />}
          detail="Seul taux qui attribue de la valeur"
        />
        <MetricCard
          label="Droits de vote"
          value={<RateValue amount={ownership.votingRate} context={context} />}
        />
        <MetricCard
          label="Pleinement dilué"
          value={<RateValue amount={ownership.fullyDilutedRate} context={context} />}
        />
      </section>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Historique</span>
            <h2>Détention par date d’effet</h2>
          </div>
          <div className="header-actions">
            <button className="button secondary" onClick={() => open("funding-round")}>
              Appliquer un tour de table
            </button>
            <button className="button secondary" onClick={() => open("ownership")}>
              <Plus size={14} /> Enregistrer une détention
            </button>
          </div>
        </div>
        {ownership.history.length === 0 ? (
          <p className="muted-copy">
            Aucune détention déclarée. Tant qu’elle manque, la société est suivie mais sa valeur
            personnelle reste non calculable — elle ne vaut pas zéro.
          </p>
        ) : (
          <div className="ownership-table">
            <div className="table-head">
              <span>Date d’effet</span>
              <span>Juridique</span>
              <span>Économique</span>
              <span>Titres</span>
              <span>Origine</span>
              <span />
            </div>
            {[...ownership.history].reverse().map((record) => (
              <div className="table-row" key={record.id}>
                <span>
                  <strong>{formatBusinessDate(record.effectiveDate)}</strong>
                </span>
                <span>{(record.legalRate * 100).toFixed(2)} %</span>
                <span>
                  {record.economicRate === null
                    ? NOT_COMPUTABLE
                    : `${(record.economicRate * 100).toFixed(2)} %`}
                </span>
                <span>
                  {record.sharesHeld === null || record.sharesOutstanding === null
                    ? "—"
                    : `${record.sharesHeld.toLocaleString("fr-FR")} / ${record.sharesOutstanding.toLocaleString("fr-FR")}`}
                </span>
                <span>
                  {record.provenance.kind === "DERIVED" ? "Dérivée d’une opération" : "Déclarée"}
                </span>
                <span>
                  <DeleteButton
                    label={`Supprimer la détention du ${record.effectiveDate}`}
                    busy={busy}
                    onDelete={() =>
                      mutate({ action: "delete_business_ownership", ownershipId: record.id })
                    }
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Structure</span>
            <h2>Participations et sociétés mères</h2>
          </div>
          <button className="button secondary" onClick={() => open("holding")}>
            <Plus size={14} /> Rattacher une filiale
          </button>
        </div>
        {position.subsidiaries.length === 0 && position.parents.length === 0 ? (
          <p className="muted-copy">Aucun rattachement : cette société est détenue en direct.</p>
        ) : (
          <div className="fact-grid">
            {position.subsidiaries.map((subsidiary) => (
              <FactRow
                key={subsidiary.link.id}
                label={subsidiary.business?.name ?? "Filiale hors périmètre"}
                detail={`Filiale détenue à ${(subsidiary.link.ownershipRate * 100).toFixed(2)} % depuis le ${formatBusinessDate(subsidiary.link.effectiveDate)}`}
                value={
                  <>
                    <Amount amount={subsidiary.attributed} currency={currency} context={context} />
                    <DeleteButton
                      label={`Détacher ${subsidiary.business?.name ?? "la filiale"}`}
                      busy={busy}
                      onDelete={() =>
                        mutate({ action: "delete_business_holding", holdingId: subsidiary.link.id })
                      }
                    />
                  </>
                }
              />
            ))}
            {position.parents.map((parent) => (
              <FactRow
                key={parent.link.id}
                label={parent.business?.name ?? "Société mère hors périmètre"}
                detail={`Détient ${(parent.link.ownershipRate * 100).toFixed(2)} % de cette société`}
                value="Valeur remontée par la mère"
              />
            ))}
            <FactRow
              label="Détention économique effective"
              detail="Directe et indirecte. Grandeur de contrôle : elle n’attribue aucune valeur."
              value={<RateValue amount={position.lookThroughEconomicRate} context={context} />}
            />
          </div>
        )}
      </article>
    </div>
  );
}

// ─── Capital ────────────────────────────────────────────────────────────────────────────

export function CapitalTab({ position, context, currency, busy, mutate, open }: TabProps) {
  const capital = position.capital;
  return (
    <div className="tab-stack">
      {!capital.coverage.complete ? (
        <Callout tone="warning" title="Historique de capital non déclaré complet">
          {BUSINESS_COVERAGE_LABELS[capital.coverage.source]}. Les montants ci-dessous sont des
          bornes basses, et MOIC, XIRR et plus-value restent non calculables : un rendement mesuré
          sur une fraction inconnue de l’historique n’est pas un rendement.
        </Callout>
      ) : null}

      <section className="metrics-grid four">
        <MetricCard
          label="Capital investi déclaré"
          value={<Amount amount={capital.investedCapital} currency={currency} context={context} />}
        />
        <MetricCard
          label="Cash retourné"
          value={<Amount amount={capital.cashReturned} currency={currency} context={context} />}
          detail="Distributions et cessions, nettes de frais"
        />
        <MetricCard
          label="Valeur restante"
          value={
            <Amount
              amount={position.attributableValue.central}
              currency={currency}
              context={context}
            />
          }
        />
        <MetricCard
          label="Gain économique total"
          value={
            <Amount amount={capital.totalEconomicGain} currency={currency} context={context} sign />
          }
        />
        <MetricCard
          label="PnL réalisée"
          value={<Amount amount={capital.realisedPnL} currency={currency} context={context} sign />}
          detail="Sur les titres cédés, coût moyen pondéré"
        />
        <MetricCard
          label="PnL latente"
          value={
            <Amount amount={capital.unrealisedPnL} currency={currency} context={context} sign />
          }
          detail="Sur les titres encore détenus"
        />
        <MetricCard label="MOIC" value={<RatioValue amount={capital.moic} context={context} />} />
        <MetricCard label="XIRR" value={<RateValue amount={capital.xirr} context={context} />} />
      </section>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Opérations</span>
            <h2>Apports, cessions et distributions</h2>
          </div>
          <button className="button secondary" onClick={() => open("capital-event")}>
            <Plus size={14} /> Enregistrer une opération
          </button>
        </div>
        {capital.events.length === 0 ? (
          <p className="muted-copy">
            Aucune opération enregistrée. Une absence d’événement n’est pas un historique vide :
            elle empêche tout calcul de performance.
          </p>
        ) : (
          <div className="capital-table">
            <div className="table-head">
              <span>Date</span>
              <span>Nature</span>
              <span>Montant société</span>
              <span>Cash personnel</span>
              <span>Frais</span>
              <span>Détention après</span>
              <span />
            </div>
            {[...capital.events].reverse().map((view) => (
              <div className="table-row" key={view.event.id}>
                <span>
                  <strong>{formatBusinessDate(view.event.eventDate)}</strong>
                </span>
                <span>
                  {BUSINESS_CAPITAL_EVENT_LABELS[view.event.type]}
                  {view.event.label ? <small>{view.event.label}</small> : null}
                </span>
                <span>
                  {view.companyAmount ? (
                    <Amount
                      amount={view.companyAmount}
                      currency={view.event.currency}
                      compact
                      context={context}
                    />
                  ) : (
                    <span className="muted-copy">{BUSINESS_AMOUNT_SCOPE_LABELS.USER_CASH}</span>
                  )}
                </span>
                <span>
                  <Amount
                    amount={view.userCash}
                    currency={view.event.currency}
                    compact
                    context={context}
                  />
                </span>
                <span>
                  {view.event.fees === null ? (
                    "—"
                  ) : (
                    <Amount
                      amount={known(view.event.fees)}
                      currency={view.event.currency}
                      compact
                      context={context}
                    />
                  )}
                </span>
                <span>
                  {view.event.ownershipRateAfter === null
                    ? "—"
                    : `${(view.event.ownershipRateAfter * 100).toFixed(2)} %`}
                </span>
                <span>
                  <DeleteButton
                    label={`Supprimer l’opération du ${view.event.eventDate}`}
                    busy={busy}
                    onDelete={() =>
                      mutate({ action: "delete_business_capital_event", eventId: view.event.id })
                    }
                  />
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

// ─── Scénarios ──────────────────────────────────────────────────────────────────────────

/**
 * Trois décisions, aucune hypothèse par défaut. Chaque champ vide laisse la grandeur qui en
 * dépend non calculable : c'est ce qui distingue un scénario d'une illusion de scénario.
 */
export function ScenariosTab({ position, context, currency }: TabProps) {
  const [horizon, setHorizon] = useState("5");
  const [growth, setGrowth] = useState("");
  const [distribution, setDistribution] = useState("");
  const [discountRate, setDiscountRate] = useState("");
  const [exitMultiple, setExitMultiple] = useState(
    position.valuation.multiple?.central ? String(position.valuation.multiple.central) : "",
  );
  const [saleFraction, setSaleFraction] = useState("100");
  const [feeRate, setFeeRate] = useState("");
  const [taxRate, setTaxRate] = useState("");
  const [preMoney, setPreMoney] = useState("");
  const [primaryNewMoney, setPrimaryNewMoney] = useState("");
  const [contribution, setContribution] = useState("0");

  const hold = projectBusinessHold({
    currentEquityValue: position.equityValue.central,
    economicRate: position.ownership.economicRate,
    years: optionalNumber(horizon),
    annualValueGrowth: optionalRate(growth),
    annualDistributionToOwner: optionalNumber(distribution),
    discountRate: optionalRate(discountRate),
  });

  const sale = projectBusinessSale({
    exitBasis: "EXIT_MULTIPLE",
    adjustedMetric: position.valuation.adjustedMetric,
    exitMultiple: optionalNumber(exitMultiple),
    exitEquityValue: null,
    grossDebt: position.valuation.grossDebt,
    cash: position.valuation.cash,
    otherBridgeItems: position.valuation.bridgeItemsTotal,
    economicRate: position.ownership.economicRate,
    saleFraction: optionalRate(saleFraction),
    transactionFeeRate: optionalRate(feeRate),
    remainingCostBasis: position.capital.remainingCostBasis,
    effectiveTaxRate: optionalRate(taxRate),
  });

  const ownershipBefore = position.ownership.economicRate.value;
  const contributionValue = optionalNumber(contribution);
  const raise =
    ownershipBefore !== null &&
    optionalNumber(preMoney) !== null &&
    optionalNumber(primaryNewMoney) !== null &&
    contributionValue !== null
      ? projectBusinessRaisePreview({
          preMoney: optionalNumber(preMoney)!,
          primary: optionalNumber(primaryNewMoney)!,
          ownershipBefore,
          contribution: contributionValue,
          costBasisBefore: position.capital.remainingCostBasis,
        })
      : null;

  return (
    <div className="tab-stack">
      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Conserver</span>
            <h2>Garder la participation</h2>
          </div>
        </div>
        <div className="mini-form-grid">
          <label>
            Horizon (années)
            <input
              className="text-input"
              value={horizon}
              onChange={(event) => setHorizon(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label>
            Croissance annuelle de la valeur
            <div className="suffix-input">
              <input
                className="text-input"
                value={growth}
                onChange={(event) => setGrowth(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </label>
          <label>
            Distribution annuelle perçue
            <input
              className="text-input"
              value={distribution}
              onChange={(event) => setDistribution(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Taux d’actualisation
            <div className="suffix-input">
              <input
                className="text-input"
                value={discountRate}
                onChange={(event) => setDiscountRate(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </label>
        </div>
        <div className="fact-grid">
          <FactRow
            label="Equity Value à l’horizon"
            value={
              <Amount amount={hold.terminalEquityValue} currency={currency} context={context} />
            }
          />
          <FactRow
            label="Votre part à l’horizon"
            value={
              <Amount
                amount={hold.terminalAttributableValue}
                currency={currency}
                context={context}
              />
            }
          />
          <FactRow
            label="Distributions cumulées"
            value={
              <Amount amount={hold.cumulativeDistributions} currency={currency} context={context} />
            }
          />
          <FactRow
            label="Valeur actualisée du total"
            value={<Amount amount={hold.presentValue} currency={currency} context={context} />}
          />
        </div>
        <p className="muted-copy">
          Aucune croissance ni distribution n’est supposée : un champ laissé vide rend la grandeur
          correspondante non calculable plutôt que nulle.
        </p>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Céder</span>
            <h2>Vendre tout ou partie</h2>
          </div>
        </div>
        <div className="mini-form-grid">
          <label>
            Multiple de sortie
            <div className="suffix-input">
              <input
                className="text-input"
                value={exitMultiple}
                onChange={(event) => setExitMultiple(event.target.value)}
                inputMode="decimal"
              />
              <span>×</span>
            </div>
          </label>
          <label>
            Part de la détention cédée
            <div className="suffix-input">
              <input
                className="text-input"
                value={saleFraction}
                onChange={(event) => setSaleFraction(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </label>
          <label>
            Frais de transaction
            <div className="suffix-input">
              <input
                className="text-input"
                value={feeRate}
                onChange={(event) => setFeeRate(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </label>
          <label>
            Taux d’imposition effectif
            <div className="suffix-input">
              <input
                className="text-input"
                value={taxRate}
                onChange={(event) => setTaxRate(event.target.value)}
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </label>
        </div>
        <div className="fact-grid">
          <FactRow
            label="Enterprise Value de sortie"
            value={
              <Amount amount={sale.exitEnterpriseValue} currency={currency} context={context} />
            }
          />
          <FactRow
            label="Equity Value de sortie"
            value={<Amount amount={sale.exitEquityValue} currency={currency} context={context} />}
          />
          <FactRow
            label="Quote-part cédée"
            value={<RateValue amount={sale.ownershipSold} context={context} />}
          />
          <FactRow
            label="Produit brut"
            value={<Amount amount={sale.grossProceeds} currency={currency} context={context} />}
          />
          <FactRow
            label="Frais de transaction"
            value={<Amount amount={sale.transactionFees} currency={currency} context={context} />}
          />
          <FactRow
            label="Produit net avant impôt"
            value={<Amount amount={sale.preTaxNetProceeds} currency={currency} context={context} />}
          />
          <FactRow
            label="Coût de revient libéré"
            value={<Amount amount={sale.releasedCostBasis} currency={currency} context={context} />}
          />
          <FactRow
            label="Plus-value imposable"
            detail={`Assiette conventionnelle : ${BUSINESS_SALE_TAX_BASE_CONVENTION.toLowerCase().replace(/_/g, " ")}`}
            value={<Amount amount={sale.taxableGain} currency={currency} context={context} />}
          />
          <FactRow
            label="Impôt estimé"
            value={<Amount amount={sale.estimatedTax} currency={currency} context={context} />}
          />
          <FactRow
            label="Produit net après impôt"
            value={
              <Amount amount={sale.afterTaxNetProceeds} currency={currency} context={context} />
            }
          />
          <FactRow
            label="Valeur conservée"
            value={<Amount amount={sale.retainedValue} currency={currency} context={context} />}
          />
        </div>
        <p className="muted-copy">
          LFO ne porte aucune règle de plus-value de cession de titres : sans taux effectif déclaré,
          le produit après impôt reste non calculable plutôt qu’approximatif.
        </p>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Lever</span>
            <h2>Simuler un tour de table</h2>
          </div>
        </div>
        <div className="mini-form-grid">
          <label>
            Pre-money
            <input
              className="text-input"
              value={preMoney}
              onChange={(event) => setPreMoney(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Argent frais primaire
            <input
              className="text-input"
              value={primaryNewMoney}
              onChange={(event) => setPrimaryNewMoney(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Votre souscription
            <input
              className="text-input"
              value={contribution}
              onChange={(event) => setContribution(event.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        {raise ? (
          <div className="fact-grid">
            <FactRow
              label="Post-money"
              value={
                <Amount amount={raise.postMoneyEquityValue} currency={currency} context={context} />
              }
            />
            <FactRow
              label="Détention avant"
              value={<RateValue amount={raise.ownershipBefore} context={context} />}
            />
            <FactRow
              label="Détention après"
              value={<RateValue amount={raise.ownershipAfter} context={context} />}
            />
            <FactRow
              label="Dilution"
              value={<RateValue amount={raise.dilution} context={context} />}
            />
            <FactRow
              label="Valeur de votre part au post-money"
              value={
                <Amount amount={raise.positionValueAfter} currency={currency} context={context} />
              }
            />
            <FactRow
              label="Multiple implicite sur capital investi"
              value={<RatioValue amount={raise.impliedMoic} context={context} />}
            />
          </div>
        ) : (
          <p className="muted-copy">
            Renseignez le pre-money et l’argent frais primaire. La détention actuelle doit être
            déclarée pour que la dilution soit dérivable.
          </p>
        )}
      </article>
    </div>
  );
}

function projectBusinessRaisePreview(input: {
  preMoney: number;
  primary: number;
  ownershipBefore: number;
  contribution: number;
  costBasisBefore: BusinessAmount;
}) {
  return projectBusinessRaise({
    preMoneyEquityValue: input.preMoney,
    primaryNewMoney: input.primary,
    secondaryAmount: null,
    ownershipBefore: input.ownershipBefore,
    investorContribution: input.contribution,
    preferredRightsKnown: false,
    costBasisBefore: input.costBasisBefore,
  });
}

// ─── Audit ──────────────────────────────────────────────────────────────────────────────

/** Structure que le moteur sait déjà produire, et qu'un export Excel consommera tel quel. */
const EXPORT_SHEETS = [
  "01 Synthèse",
  "02 Historique financier",
  "03 Ajustements d’EBITDA",
  "04 Valorisation",
  "05 Pont EV → Equity",
  "06 Détention",
  "07 Opérations de capital",
  "08 Performance",
  "09 Scénarios",
  "10 Sensibilités",
  "11 Sources et audit",
];

export function AuditTab({ position, state, context, currency, open }: TabProps) {
  const valuation = position.valuation;
  const computed = position.attributableValue.central.value !== null;
  const reserves = flagList(position.quality, context);
  const alternatives = valuation.alternatives;

  return (
    <div className="tab-stack">
      <QualityPanel
        quality={position.quality}
        computed={computed}
        context={context}
        title="État du résultat"
      />

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Provenance</span>
            <h2>D’où vient chaque chiffre</h2>
          </div>
          <button className="button secondary" onClick={() => open("identity")}>
            Modifier l’identité
          </button>
        </div>
        <div className="fact-grid">
          <FactRow
            label="Base de valorisation retenue"
            detail={
              valuation.basis
                ? `${BUSINESS_METHOD_LABELS[valuation.basis.method]} · ${valuation.basis.provenance.kind}`
                : undefined
            }
            value={
              valuation.valuationDate ? formatBusinessDate(valuation.valuationDate) : NOT_COMPUTABLE
            }
          />
          <FactRow
            label="Source déclarée"
            value={valuation.basis?.provenance.source ?? "Non renseignée"}
          />
          <FactRow
            label="Confiance"
            value={
              valuation.basis?.provenance.confidence ?? position.business.provenance.confidence
            }
          />
          <FactRow
            label="Ancienneté de la valorisation"
            value={valuation.ageDays === null ? "Sans objet" : `${valuation.ageDays} jours`}
            detail={valuation.isStale ? "Signalée périmée, jamais corrigée ni indexée" : undefined}
          />
          <FactRow
            label="Périodes financières déclarées"
            value={`${position.financials.periods.length}`}
            detail={position.financials.periods
              .map((period) => period.snapshot.periodLabel ?? period.snapshot.periodEnd)
              .join(" · ")}
          />
          <FactRow
            label="Couverture de l’historique de capital"
            value={BUSINESS_COVERAGE_LABELS[position.capital.coverage.source]}
            detail={
              position.capital.coverage.start
                ? `Depuis le ${formatBusinessDate(position.capital.coverage.start)}`
                : undefined
            }
          />
          <FactRow
            label="Devise fonctionnelle"
            value={position.business.functionalCurrency ?? "Non déclarée"}
            detail={`Reporting en ${currency}, converti par le FX Engine à la date de chaque fait`}
          />
        </div>
      </article>

      {alternatives.length > 0 ? (
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Divergence</span>
              <h2>Autres valorisations à la même date</h2>
            </div>
          </div>
          <div className="fact-grid">
            {alternatives.map((item) => (
              <FactRow
                key={item.id}
                label={BUSINESS_METHOD_LABELS[item.method]}
                detail={item.provenance.source ?? undefined}
                value={
                  item.equityValue !== null ? (
                    <Amount
                      amount={known(item.equityValue)}
                      currency={item.currency ?? currency}
                      context={context}
                    />
                  ) : item.enterpriseValue !== null ? (
                    <Amount
                      amount={known(item.enterpriseValue)}
                      currency={item.currency ?? currency}
                      context={context}
                    />
                  ) : (
                    "Base d’hypothèses"
                  )
                }
              />
            ))}
          </div>
        </article>
      ) : null}

      {reserves.length > 0 ? (
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Réserves</span>
              <h2>Ce qu’il faut savoir en lisant ces chiffres</h2>
            </div>
          </div>
          <ul className="quality-flags">
            {reserves.map((reserve) => (
              <li key={reserve}>
                <span>{reserve}</span>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <article className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Export</span>
            <h2>Structure exportable</h2>
          </div>
        </div>
        <p className="muted-copy">
          Le moteur produit déjà, pour cette société, la totalité des tables ci-dessous : le pont
          pas à pas, les retraitements tracés, l’historique de détention, les opérations de capital
          et les sensibilités. L’export Excel n’est pas encore livré ; il ne demandera aucune donnée
          supplémentaire.
        </p>
        <ul className="quality-flags">
          {EXPORT_SHEETS.map((sheet) => (
            <li key={sheet}>
              <span>{sheet}</span>
            </li>
          ))}
        </ul>
        <p className="muted-copy">
          Documents rattachés à cette société :{" "}
          {state.documents.length > 0
            ? `${state.documents.length} pièce(s) dans le coffre`
            : "aucune pièce déposée"}
          . L’import de liasses et de comptes annuels reste un chantier ouvert ; rien dans cette
          interface ne suppose une ressaisie manuelle définitive.
        </p>
      </article>
    </div>
  );
}
