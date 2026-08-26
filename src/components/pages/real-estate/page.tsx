"use client";

import { useMemo, useState } from "react";
import { Building2, Coins, Hammer, Link2, Plus, Ruler, Trash2 } from "lucide-react";
import Link from "next/link";

import {
  holdScenario,
  sellScenario,
  underwriteProspectiveRealEstate,
  type RealEstateScenarioAssumptions,
} from "@/lib/engine/real-estate-scenarios";
import { realEstateOf } from "@/lib/engine/balance-sheet-view";
import type { DerivedAmount, RealEstateAssetView } from "@/lib/engine/real-estate";
import type { RealEstateCapitalEvent } from "@/lib/types";
import { REAL_ESTATE_TAX_BASE_CONVENTION } from "@/lib/engine/real-estate";
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
  NOT_COMPUTABLE,
  type SectionProps,
  AggregateValue,
  formatDate,
  formatEur,
  formatNativeOptional,
} from "@/components/pages/shared";
import {
  CAPITAL_EVENT_LABELS,
  RealEstateAssetForm,
  RealEstateCapitalEventForm,
  RealEstateFinancingLinkForm,
  RealEstateOperatingTermsForm,
  RealEstateValuationForm,
  USAGE_LABELS,
  VALUATION_METHOD_LABELS,
} from "@/components/pages/real-estate/real-estate-forms";

/** Montant dérivé rendu tel quel : un `null` reste « non calculable », jamais un zéro. */
function Derived({ amount, sign = false }: { amount: DerivedAmount; sign?: boolean }) {
  if (amount.value === null)
    return (
      <span className="warning-text" title={amount.blockers.join(" · ")}>
        {NOT_COMPUTABLE}
      </span>
    );
  return <Currency value={amount.value} sign={sign} />;
}

function DerivedPercent({ amount }: { amount: DerivedAmount }) {
  if (amount.value === null)
    return (
      <span className="warning-text" title={amount.blockers.join(" · ")}>
        {NOT_COMPUTABLE}
      </span>
    );
  return <Percent value={amount.value} />;
}

function DerivedRatio({ amount, unit = "×" }: { amount: DerivedAmount; unit?: string }) {
  if (amount.value === null)
    return (
      <span className="warning-text" title={amount.blockers.join(" · ")}>
        {NOT_COMPUTABLE}
      </span>
    );
  return <>{`${amount.value.toFixed(2)} ${unit}`}</>;
}

type Editor =
  | { kind: "asset"; assetId: string | null }
  | { kind: "valuation"; assetId: string }
  | { kind: "capital"; assetId: string }
  | { kind: "terms"; assetId: string }
  | { kind: "financing"; assetId: string }
  | null;

const DEFAULT_ASSUMPTIONS: RealEstateScenarioAssumptions = {
  horizonYears: 10,
  // Aucune croissance n'est postulée : tant que l'utilisateur n'en déclare pas, les
  // grandeurs qui en dépendent restent non calculables. Un champ vide n'est pas un zéro.
  annualValueGrowth: null,
  annualRentGrowth: null,
  sellingCostsRate: null,
  discountRate: 0.06,
};

function RealEstatePage({ state, mutate, busy, setExplanation }: SectionProps) {
  const portfolio = useMemo(() => realEstateOf(state), [state]);
  const [selectedId, setSelectedId] = useState(portfolio.assets[0]?.asset.id ?? "");
  const [editor, setEditor] = useState<Editor>(null);
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS);
  const [prepaymentPenalty, setPrepaymentPenalty] = useState<number | null>(null);

  const selected =
    portfolio.assets.find((view) => view.asset.id === selectedId) ?? portfolio.assets[0] ?? null;

  const rate = (value: number | null) => (value === null ? "" : String(value * 100));
  const readRate = (raw: string) => (raw === "" ? null : Number(raw.replace(",", ".")) / 100);

  const header = (
    <SectionHeader
      eyebrow="Real assets"
      title="Real Estate"
      description="Biens détenus, valeur, coût de revient, exploitation, financement consommé du Debt Engine et scénarios."
      actions={
        <>
          {selected ? (
            <>
              <button
                className="button secondary"
                onClick={() => setEditor({ kind: "valuation", assetId: selected.asset.id })}
              >
                <Ruler size={15} /> Nouvelle valorisation
              </button>
              <button
                className="button secondary"
                onClick={() => setEditor({ kind: "terms", assetId: selected.asset.id })}
              >
                <Coins size={15} /> Termes d’exploitation
              </button>
            </>
          ) : null}
          <button
            className="button primary"
            onClick={() => setEditor({ kind: "asset", assetId: null })}
          >
            <Plus size={15} /> Nouveau bien
          </button>
        </>
      }
    />
  );

  if (portfolio.assets.length === 0) {
    return (
      <div className="page-stack">
        {header}
        <EmptyState
          title="Aucun bien enregistré"
          detail="Un bien immobilier entre au patrimoine quand il est enregistré comme fait, avec sa quote-part détenue et au moins une valorisation datée. Tant qu’il n’existe pas, il ne pèse rien : ce n’est pas une valeur nulle, c’est une absence."
        />
        <ProspectiveStudy reportingCurrency={state.reportingCurrency} asOfDate={state.asOfDate} />
        {editor?.kind === "asset" ? (
          <Modal open title="Nouveau bien" onClose={() => setEditor(null)}>
            <RealEstateAssetForm
              asset={null}
              busy={busy}
              onCancel={() => setEditor(null)}
              onSave={(asset) => mutate({ action: "save_real_estate_asset", asset })}
            />
          </Modal>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page-stack">
      {header}

      <Callout title="Ce que ce périmètre dit, et ce qu’il ne dit pas">
        La valeur des biens entre au bilan canonique comme actif illiquide. Leur dette n’y entre PAS
        par ici : elle est déjà portée par le périmètre <Link href="/debt">Debt</Link>, et le
        rattachement ne sert qu’à savoir quelle part de ce concours finance quel bien. Aucun
        échéancier n’est reconstruit dans ce périmètre : tout le financement vient du Debt Engine.
        Les loyers et charges réellement encaissés ou payés restent des lignes de{" "}
        <Link href="/cash-flow">Cash Flow</Link>, simplement rattachées à un bien.
      </Callout>

      <section className="metrics-grid four">
        <MetricCard
          label="Valeur immobilière attribuée"
          value={<AggregateValue aggregate={portfolio.grossValue} />}
          detail="Quote-part détenue appliquée, en devise de reporting"
          onExplain={() =>
            setExplanation({
              title: "Valeur immobilière au bilan",
              formula:
                "Σ (valorisation du bien entier × quote-part détenue), convertie au taux de la date de valorisation",
              inputs: portfolio.assets
                .filter((view) => view.isOnBalanceSheet)
                .map((view) => ({
                  label: view.asset.name,
                  value:
                    view.valuation.ownerNativeValue === null
                      ? NOT_COMPUTABLE
                      : formatNativeOptional(
                          view.valuation.ownerNativeValue,
                          view.valuation.nativeCurrency ?? state.reportingCurrency,
                        ),
                  kind: view.valuation.observation?.provenance.kind ?? "MISSING",
                })),
              note: "Un bien sans valorisation, ou dont la quote-part n’est pas déclarée, rend le total partiel. Il n’est jamais compté pour zéro.",
            })
          }
        />
        <MetricCard
          label="Dette attribuée"
          value={<AggregateValue aggregate={portfolio.attributedDebt} />}
          detail="Part des concours existants affectée aux biens"
        />
        <MetricCard
          label="Equity immobilière"
          value={<AggregateValue aggregate={portfolio.equity} />}
          tone={(portfolio.equity.value ?? 0) >= 0 ? "positive" : "negative"}
          detail="Valeur attribuée − dette attribuée"
        />
        <MetricCard
          label="Plus-value latente"
          value={<AggregateValue aggregate={portfolio.unrealisedGain} />}
          tone={(portfolio.unrealisedGain.value ?? 0) >= 0 ? "positive" : "negative"}
          detail="Aucune trésorerie : elle ne se réalise qu’à la cession"
        />
      </section>

      <section className="metrics-grid four">
        <MetricCard
          label="Résultat d’exploitation annuel"
          value={<AggregateValue aggregate={portfolio.annualNetOperatingIncome} />}
          detail="Loyer effectif − charges déclarées, quote-part appliquée"
        />
        <MetricCard
          label="Cash flow annuel avant impôt"
          value={<AggregateValue aggregate={portfolio.annualPreTaxCashFlow} />}
          detail="Inclut le remboursement de capital, qui n’est pas une charge"
        />
        <MetricCard
          label="Coût économique du financement"
          value={<AggregateValue aggregate={portfolio.annualEconomicFinancingCost} />}
          detail="Intérêts, assurance et frais. Jamais le principal"
          onExplain={() =>
            setExplanation({
              title: "Coût économique du financement immobilier",
              formula:
                "Σ (intérêts + intérêts capitalisés + assurance + frais) × quote-part, sur 12 mois",
              inputs: (selected?.financing ?? []).map((line) => ({
                label: `${line.liability.name} · ${(line.allocationShare * 100).toFixed(1)} %`,
                value: formatEur(line.attributedDebtService12m.economicCost.value),
                kind: line.attributedDebtService12m.dataKind,
              })),
              note: "Le remboursement de capital est exclu : il réduit un passif et de la trésorerie du même montant, il ne coûte rien. Ces montants viennent du Debt Engine, ils ne sont pas recalculés ici.",
            })
          }
        />
        <MetricCard
          label="Biens au bilan"
          value={`${portfolio.assets.filter((view) => view.isOnBalanceSheet).length} / ${portfolio.assets.length}`}
          detail="Les biens cédés ou archivés restent lisibles hors bilan"
        />
      </section>

      {portfolio.assets.length > 1 ? (
        <section className="decision-case-strip">
          {portfolio.assets.map((view) => (
            <button
              key={view.asset.id}
              className={view.asset.id === selected?.asset.id ? "active" : ""}
              onClick={() => setSelectedId(view.asset.id)}
            >
              {view.asset.name}
              <span>
                {view.usage === null ? "usage non déclaré" : USAGE_LABELS[view.usage]}
                {view.financingState === "UNKNOWN" ? " · financement inconnu" : ""}
                {view.isOnBalanceSheet ? "" : " · hors bilan"}
              </span>
            </button>
          ))}
        </section>
      ) : null}

      <div>
        {selected ? (
          <div className="results-stack">
            <AssetEconomics
              view={selected}
              reportingCurrency={state.reportingCurrency}
              capitalEvents={state.realEstateCapitalEvents.filter(
                (event) => event.propertyId === selected.asset.id,
              )}
              busy={busy}
              onEdit={setEditor}
              onDeleteCapitalEvent={(eventId) =>
                mutate({ action: "delete_real_estate_capital_event", eventId })
              }
              onDeleteFinancingLink={(linkId) =>
                mutate({ action: "delete_real_estate_financing_link", linkId })
              }
            />
            <AssetScenarios
              view={selected}
              asOfDate={state.asOfDate}
              assumptions={assumptions}
              prepaymentPenalty={prepaymentPenalty}
              onAssumptions={setAssumptions}
              onPrepaymentPenalty={setPrepaymentPenalty}
              rate={rate}
              readRate={readRate}
            />
            {selected.flags.length ? (
              <article className="panel">
                <div className="panel-header">
                  <div>
                    <span className="eyebrow">Qualité de la donnée</span>
                    <h2>Ce que le moteur ne peut pas affirmer</h2>
                  </div>
                </div>
                <ul className="quality-flags">
                  {selected.flags.map((flag) => (
                    <li key={`${flag.code}-${flag.detail}`}>
                      <strong>{flag.code}</strong>
                      <span>{flag.detail}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ) : null}
          </div>
        ) : null}
      </div>

      <ProspectiveStudy reportingCurrency={state.reportingCurrency} asOfDate={state.asOfDate} />

      {editor?.kind === "asset" ? (
        <Modal
          open
          title={editor.assetId ? "Modifier le bien" : "Nouveau bien"}
          onClose={() => setEditor(null)}
        >
          <RealEstateAssetForm
            asset={
              editor.assetId
                ? (state.realEstateAssets.find((asset) => asset.id === editor.assetId) ?? null)
                : null
            }
            busy={busy}
            onCancel={() => setEditor(null)}
            onSave={(asset) => mutate({ action: "save_real_estate_asset", asset })}
          />
        </Modal>
      ) : null}
      {editor?.kind === "valuation" ? (
        <Modal open title="Nouvelle valorisation" onClose={() => setEditor(null)}>
          <RealEstateValuationForm
            propertyId={editor.assetId}
            asOfDate={state.asOfDate}
            reportingCurrency={state.reportingCurrency}
            busy={busy}
            onCancel={() => setEditor(null)}
            onSave={(valuation) => mutate({ action: "record_real_estate_valuation", valuation })}
          />
        </Modal>
      ) : null}
      {editor?.kind === "capital" ? (
        <Modal open title="Fait de capital" onClose={() => setEditor(null)}>
          <RealEstateCapitalEventForm
            propertyId={editor.assetId}
            asOfDate={state.asOfDate}
            reportingCurrency={state.reportingCurrency}
            busy={busy}
            onCancel={() => setEditor(null)}
            onSave={(event) => mutate({ action: "record_real_estate_capital_event", event })}
          />
        </Modal>
      ) : null}
      {editor?.kind === "terms" ? (
        <Modal open title="Termes d’exploitation" onClose={() => setEditor(null)}>
          <RealEstateOperatingTermsForm
            propertyId={editor.assetId}
            asOfDate={state.asOfDate}
            reportingCurrency={state.reportingCurrency}
            current={(() => {
              const terms = portfolio.assets.find((view) => view.asset.id === editor.assetId)
                ?.operating.terms;
              return terms === null || terms === undefined
                ? null
                : { ...terms, propertyId: terms.propertyId };
            })()}
            busy={busy}
            onCancel={() => setEditor(null)}
            onSave={(terms) => mutate({ action: "set_real_estate_operating_terms", terms })}
          />
        </Modal>
      ) : null}
      {editor?.kind === "financing" ? (
        <Modal open title="Rattacher un financement" onClose={() => setEditor(null)}>
          {state.liabilities.length === 0 ? (
            <Callout tone="warning" title="Aucune dette enregistrée">
              Un bien se rattache à une dette qui existe déjà. Enregistrer d’abord le prêt dans le
              périmètre <Link href="/debt">Debt</Link> : c’est lui qui porte le contrat,
              l’échéancier et l’encours.
            </Callout>
          ) : (
            <RealEstateFinancingLinkForm
              propertyId={editor.assetId}
              liabilities={state.liabilities}
              busy={busy}
              onCancel={() => setEditor(null)}
              onSave={(link) => mutate({ action: "set_real_estate_financing_link", link })}
            />
          )}
        </Modal>
      ) : null}
    </div>
  );
}

// ─── Économie d'un bien ───────────────────────────────────────────────────────────────

function AssetEconomics({
  view,
  reportingCurrency,
  capitalEvents,
  busy,
  onEdit,
  onDeleteCapitalEvent,
  onDeleteFinancingLink,
}: {
  view: RealEstateAssetView;
  reportingCurrency: string;
  capitalEvents: RealEstateCapitalEvent[];
  busy: boolean;
  onEdit: (editor: Editor) => void;
  onDeleteCapitalEvent: (eventId: string) => Promise<boolean>;
  onDeleteFinancingLink: (linkId: string) => Promise<boolean>;
}) {
  const observation = view.valuation.observation;
  return (
    <article className="panel result-summary">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Économie du bien</span>
          <h2>{view.asset.name}</h2>
        </div>
        <DataBadge kind={observation?.provenance.kind ?? "MISSING"} />
      </div>

      <div className="header-actions">
        <button
          className="button secondary"
          onClick={() => onEdit({ kind: "asset", assetId: view.asset.id })}
        >
          <Building2 size={15} /> Identité
        </button>
        <button
          className="button secondary"
          onClick={() => onEdit({ kind: "capital", assetId: view.asset.id })}
        >
          <Hammer size={15} /> Prix, frais, travaux
        </button>
        <button
          className="button secondary"
          onClick={() => onEdit({ kind: "financing", assetId: view.asset.id })}
        >
          <Link2 size={15} /> Rattacher une dette
        </button>
      </div>

      <h3>Valeur et coût de revient</h3>
      <dl>
        <div>
          <dt>Valorisation retenue</dt>
          <dd>
            {observation === null ? (
              <span className="warning-text">{NOT_COMPUTABLE}</span>
            ) : (
              <>
                {formatNativeOptional(observation.value, observation.currency)}
                <small>
                  {" "}
                  · {VALUATION_METHOD_LABELS[observation.method]} du{" "}
                  {formatDate(observation.valuedAt)}
                  {view.valuation.status === "STALE" ? " · périmée" : ""}
                </small>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Valeur attribuée au patrimoine</dt>
          <dd>
            <Derived amount={view.valuation.ownerValue} />
          </dd>
        </div>
        <div>
          <dt>Prix d’achat</dt>
          <dd>
            <Derived amount={view.costBasis.acquisitionPrice} />
          </dd>
        </div>
        <div>
          <dt>Frais d’acquisition déclarés</dt>
          <dd>
            <Derived amount={view.costBasis.acquisitionCosts} />
            <small> · {view.costBasis.acquisitionCostEventCount} fait(s)</small>
          </dd>
        </div>
        <div>
          <dt>Travaux capitalisés</dt>
          <dd>
            <Derived amount={view.costBasis.capex} />
            <small> · {view.costBasis.capexEventCount} fait(s)</small>
          </dd>
        </div>
        <div>
          <dt>Coût de revient total</dt>
          <dd>
            <Derived amount={view.costBasis.totalCostBasis} />
          </dd>
        </div>
        <div>
          <dt>Plus-value latente attribuée</dt>
          <dd>
            <Derived amount={view.equity.unrealisedGain} sign />
          </dd>
        </div>
      </dl>

      {capitalEvents.length > 0 ? (
        <ul className="quality-flags">
          {capitalEvents.map((event) => (
            <li key={event.id}>
              <strong>{CAPITAL_EVENT_LABELS[event.type]}</strong>
              <span>
                {formatNativeOptional(event.amount, event.currency)} · {formatDate(event.eventDate)}
                {event.label ? ` · ${event.label}` : ""}
              </span>
              <button
                className="icon-button"
                title="Supprimer ce fait"
                disabled={busy}
                onClick={() => onDeleteCapitalEvent(event.id)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <h3>Exploitation annuelle déclarée</h3>
      <dl>
        <div>
          <dt>Loyer brut</dt>
          <dd>
            <Derived amount={view.operating.grossRent} />
          </dd>
        </div>
        <div>
          <dt>Loyer effectif après vacance</dt>
          <dd>
            <Derived amount={view.operating.effectiveRent} />
          </dd>
        </div>
        {view.operating.costBreakdown.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>
              <Derived amount={item.amount} />
            </dd>
          </div>
        ))}
        <div>
          <dt>Résultat d’exploitation</dt>
          <dd>
            <Derived amount={view.operating.netOperatingIncome} />
          </dd>
        </div>
      </dl>

      <h3>Rendements, dénominateur nommé</h3>
      <dl>
        <div>
          <dt>Rendement brut sur valeur</dt>
          <dd>
            <DerivedPercent amount={view.returns.grossYieldOnValue} />
          </dd>
        </div>
        <div>
          <dt>Rendement brut sur coût de revient</dt>
          <dd>
            <DerivedPercent amount={view.returns.grossYieldOnCost} />
          </dd>
        </div>
        <div>
          <dt>Rendement net sur valeur</dt>
          <dd>
            <DerivedPercent amount={view.returns.netYieldOnValue} />
          </dd>
        </div>
        <div>
          <dt>Rendement net sur coût de revient</dt>
          <dd>
            <DerivedPercent amount={view.returns.netYieldOnCost} />
          </dd>
        </div>
        <div>
          <dt>Apport réellement engagé</dt>
          <dd>
            <Derived amount={view.returns.equityEngaged} />
          </dd>
        </div>
        <div>
          <dt>Cash-on-cash sur apport</dt>
          <dd>
            <DerivedPercent amount={view.returns.cashOnCashOnEquityEngaged} />
          </dd>
        </div>
        <div>
          <dt>Rentabilité économique des fonds propres actuels</dt>
          <dd>
            <DerivedPercent amount={view.returns.economicReturnOnCurrentEquity} />
          </dd>
        </div>
      </dl>

      <h3>Financement, consommé du Debt Engine</h3>
      {view.financingState === "DECLARED_NONE" ? (
        <Callout tone="success" title="Bien déclaré sans dette">
          Aucune dette ne finance ce bien, et c’est une information déclarée, pas une lacune.
          L’equity du bien vaut donc sa valeur attribuable, et son apport réel son coût de revient
          entier.
        </Callout>
      ) : view.financingState === "UNKNOWN" ? (
        <Callout
          tone="warning"
          title={
            view.asset.isDebtFinanced === true
              ? "Dette déclarée, mais aucun concours rattaché"
              : "Financement non déclaré"
          }
        >
          {view.asset.isDebtFinanced === true
            ? "Une dette finance ce bien sans qu’un concours lui soit rattaché : la dette attribuée est inconnue, elle n’est pas nulle."
            : "Ni concours rattaché, ni déclaration d’achat sans dette. Le moteur refuse de trancher entre les deux."}{" "}
          Tant que la situation n’est pas connue, equity, apport réel, cash flow et rendements sur
          fonds propres restent non calculables : les afficher à zéro surévaluerait le patrimoine du
          montant entier de la dette. Rattacher le concours, ou déclarer le bien sans dette dans son
          identité.
        </Callout>
      ) : (
        <>
          <dl>
            {view.financing.map((line) => (
              <div key={line.link.id}>
                <dt>
                  {line.liability.name}
                  <small> · {(line.allocationShare * 100).toFixed(1)} % du concours</small>
                </dt>
                <dd>
                  <Derived amount={line.attributedOutstanding} />
                  <button
                    className="icon-button"
                    title="Détacher ce financement"
                    disabled={busy}
                    onClick={() => onDeleteFinancingLink(line.link.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </dd>
              </div>
            ))}
            <div>
              <dt>Service de dette attribué sur 12 mois</dt>
              <dd>
                <Derived amount={view.debt.cashDebtService} />
              </dd>
            </div>
            <div>
              <dt>dont capital remboursé, neutre sur le patrimoine</dt>
              <dd>
                <Derived amount={view.debt.principalPaid} />
              </dd>
            </div>
            <div>
              <dt>dont coût économique, intérêts assurance frais</dt>
              <dd>
                <Derived amount={view.debt.economicCost} />
              </dd>
            </div>
            <div>
              <dt>Couverture du service de dette</dt>
              <dd>
                <DerivedRatio amount={view.returns.debtServiceCoverage} />
              </dd>
            </div>
            <div>
              <dt>Quotité de financement</dt>
              <dd>
                <DerivedPercent amount={view.returns.loanToValue} />
              </dd>
            </div>
          </dl>
          {view.financing.some((line) => line.debtFlags.length > 0) ? (
            <Callout tone="warning" title="Signalements du Debt Engine">
              {view.financing
                .flatMap((line) =>
                  line.debtFlags.map((flag) => `${line.liability.name} : ${flag.detail}`),
                )
                .join(" ")}
            </Callout>
          ) : null}
        </>
      )}

      <h3>Trésorerie réelle et fiscalité déclarée</h3>
      <dl>
        <div>
          <dt>Cash flow annuel avant impôt</dt>
          <dd>
            <Derived amount={view.returns.preTaxCashFlow} sign />
          </dd>
        </div>
        <div>
          <dt>Assiette conventionnelle d’imposition</dt>
          <dd>
            <Derived amount={view.returns.taxBase} />
            <small> · {REAL_ESTATE_TAX_BASE_CONVENTION}</small>
          </dd>
        </div>
        <div>
          <dt>Impôt au taux déclaré</dt>
          <dd>
            <Derived amount={view.returns.declaredTax} />
          </dd>
        </div>
        <div>
          <dt>Cash flow après impôt déclaré</dt>
          <dd>
            <Derived amount={view.returns.afterTaxCashFlow} sign />
          </dd>
        </div>
        <div>
          <dt>Flux rattachés observés</dt>
          <dd>
            {view.observed.transactionCount === 0 ? (
              <span className="warning-text">Aucun flux rattaché</span>
            ) : (
              <>
                {view.observed.transactionCount} ligne(s)
                <small>
                  {" "}
                  · du {formatDate(view.observed.periodStart)} au{" "}
                  {formatDate(view.observed.periodEnd)}
                </small>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Revenus observés rattachés</dt>
          <dd>
            <Derived amount={view.observed.observedIncome} />
          </dd>
        </div>
        <div>
          <dt>Écart loyer déclaré − revenus observés</dt>
          <dd>
            <Derived amount={view.observed.declaredRentVsObservedIncome} sign />
            <small> · deux grandeurs de nature différente</small>
          </dd>
        </div>
      </dl>
      <p className="form-notice">
        Les montants ci-dessus sont exprimés en {reportingCurrency}. Aucun impôt n’est calculé sans
        taux effectif déclaré : LFO ne porte aucune règle fiscale immobilière fiable et n’en invente
        aucune.
      </p>
    </article>
  );
}

// ─── Scénarios sur un bien détenu ─────────────────────────────────────────────────────

function AssetScenarios({
  view,
  asOfDate,
  assumptions,
  prepaymentPenalty,
  onAssumptions,
  onPrepaymentPenalty,
  rate,
  readRate,
}: {
  view: RealEstateAssetView;
  asOfDate: string;
  assumptions: RealEstateScenarioAssumptions;
  prepaymentPenalty: number | null;
  onAssumptions: (next: RealEstateScenarioAssumptions) => void;
  onPrepaymentPenalty: (next: number | null) => void;
  rate: (value: number | null) => string;
  readRate: (raw: string) => number | null;
}) {
  const hold = useMemo(
    () => holdScenario(view, assumptions, asOfDate),
    [view, assumptions, asOfDate],
  );
  const sell = useMemo(
    () =>
      sellScenario(view, {
        sellingCostsRate: assumptions.sellingCostsRate,
        prepaymentPenalty,
        salePrice: null,
      }),
    [view, assumptions.sellingCostsRate, prepaymentPenalty],
  );

  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          <span className="eyebrow">Scénarios</span>
          <h2>Conserver ou céder</h2>
        </div>
        <DataBadge kind="USER_ASSUMPTION" />
      </div>

      <div className="mini-form-grid">
        <label>
          Horizon
          <div className="suffix-input">
            <input
              type="number"
              min="1"
              max="40"
              step="1"
              value={assumptions.horizonYears}
              onChange={(event) =>
                onAssumptions({
                  ...assumptions,
                  horizonYears: Math.max(1, Number(event.target.value)),
                })
              }
            />
            <span>ans</span>
          </div>
        </label>
        <label>
          Croissance de valeur
          <div className="suffix-input">
            <input
              type="number"
              step="0.1"
              placeholder="non déclarée"
              value={rate(assumptions.annualValueGrowth)}
              onChange={(event) =>
                onAssumptions({ ...assumptions, annualValueGrowth: readRate(event.target.value) })
              }
            />
            <span>%/an</span>
          </div>
        </label>
        <label>
          Croissance de loyer
          <div className="suffix-input">
            <input
              type="number"
              step="0.1"
              placeholder="non déclarée"
              value={rate(assumptions.annualRentGrowth)}
              onChange={(event) =>
                onAssumptions({ ...assumptions, annualRentGrowth: readRate(event.target.value) })
              }
            />
            <span>%/an</span>
          </div>
        </label>
        <label>
          Frais de cession
          <div className="suffix-input">
            <input
              type="number"
              step="0.1"
              placeholder="non déclarés"
              value={rate(assumptions.sellingCostsRate)}
              onChange={(event) =>
                onAssumptions({ ...assumptions, sellingCostsRate: readRate(event.target.value) })
              }
            />
            <span>%</span>
          </div>
        </label>
        <label>
          Taux d’actualisation
          <div className="suffix-input">
            <input
              type="number"
              step="0.1"
              value={rate(assumptions.discountRate)}
              onChange={(event) =>
                onAssumptions({
                  ...assumptions,
                  discountRate: readRate(event.target.value) ?? assumptions.discountRate,
                })
              }
            />
            <span>%</span>
          </div>
        </label>
        <label>
          Indemnité de remboursement anticipé
          <div className="suffix-input">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="inconnue"
              value={prepaymentPenalty ?? ""}
              onChange={(event) =>
                onPrepaymentPenalty(
                  event.target.value === "" ? null : Number(event.target.value.replace(",", ".")),
                )
              }
            />
            <span>€</span>
          </div>
        </label>
      </div>

      <h3>Conserver sur {assumptions.horizonYears} ans</h3>
      <dl>
        <div>
          <dt>TRI patrimonial</dt>
          <dd>
            {hold.equityIrr === null ? (
              <span className="warning-text" title={hold.blockers.join(" · ")}>
                {NOT_COMPUTABLE}
              </span>
            ) : (
              <Percent value={hold.equityIrr} />
            )}
          </dd>
        </div>
        <div>
          <dt>VAN au taux déclaré</dt>
          <dd>
            <Derived amount={hold.equityNpv} sign />
          </dd>
        </div>
        <div>
          <dt>Coût économique du financement sur l’horizon</dt>
          <dd>
            <Derived amount={hold.economicFinancingCost} />
          </dd>
        </div>
        <div>
          <dt>Capital remboursé sur l’horizon</dt>
          <dd>
            <Derived amount={hold.principalRepaid} />
          </dd>
        </div>
        <div>
          <dt>Equity terminale</dt>
          <dd>
            <Derived amount={hold.terminalCashFlow} />
          </dd>
        </div>
      </dl>

      <h3>Céder maintenant</h3>
      <dl>
        <div>
          <dt>Prix retenu, part attribuée</dt>
          <dd>
            <Derived amount={sell.attributedSalePrice} />
          </dd>
        </div>
        <div>
          <dt>Frais de cession</dt>
          <dd>
            <Derived amount={sell.sellingCosts} />
          </dd>
        </div>
        <div>
          <dt>Dette à solder</dt>
          <dd>
            <Derived amount={sell.debtPayoff} />
          </dd>
        </div>
        <div>
          <dt>Indemnité de remboursement anticipé</dt>
          <dd>
            <Derived amount={sell.prepaymentPenalty} />
          </dd>
        </div>
        <div>
          <dt>Produit net encaissé, avant impôt</dt>
          <dd>
            <Derived amount={sell.netProceedsBeforeTax} />
          </dd>
        </div>
        <div>
          <dt>Plus-value réalisée, avant impôt</dt>
          <dd>
            <Derived amount={sell.realisedGainBeforeTax} sign />
          </dd>
        </div>
      </dl>

      {[...hold.notes, ...sell.notes].map((note) => (
        <p className="form-notice" key={note}>
          {note}
        </p>
      ))}
    </article>
  );
}

// ─── Étude prospective ────────────────────────────────────────────────────────────────

/**
 * Étude d'un bien NON détenu. Rien n'entre au patrimoine : c'est un cas de travail. Le
 * crédit envisagé passe par le Debt Engine comme n'importe quel prêt réel.
 */
function ProspectiveStudy({
  reportingCurrency,
  asOfDate,
}: {
  reportingCurrency: string;
  asOfDate: string;
}) {
  const [inputs, setInputs] = useState({
    purchasePrice: 0,
    acquisitionCosts: 0,
    works: 0,
    loanPrincipal: 0,
    annualRate: 0,
    termMonths: 300,
    annualGrossRent: null as number | null,
    vacancyRate: null as number | null,
    annualOperatingCosts: null as number | null,
    valueGrowth: null as number | null,
    rentGrowth: null as number | null,
    sellingCostsRate: null as number | null,
    horizonYears: 10,
    discountRate: 0.06,
  });

  const result = useMemo(
    () =>
      underwriteProspectiveRealEstate({
        startDate: asOfDate,
        currency: reportingCurrency,
        purchasePrice: inputs.purchasePrice,
        acquisitionCosts: inputs.acquisitionCosts,
        works: inputs.works,
        loan:
          inputs.loanPrincipal > 0
            ? {
                principal: inputs.loanPrincipal,
                annualRate: inputs.annualRate,
                termMonths: inputs.termMonths,
                firstPaymentDate: asOfDate,
                currency: reportingCurrency,
                monthlyInsurance: null,
                paymentIncludesInsurance: null,
              }
            : null,
        annualGrossRent: inputs.annualGrossRent,
        vacancyRate: inputs.vacancyRate,
        annualOperatingCosts: inputs.annualOperatingCosts,
        assumptions: {
          horizonYears: inputs.horizonYears,
          annualValueGrowth: inputs.valueGrowth,
          annualRentGrowth: inputs.rentGrowth,
          sellingCostsRate: inputs.sellingCostsRate,
          discountRate: inputs.discountRate,
        },
      }),
    [inputs, asOfDate, reportingCurrency],
  );

  const numberField = (key: keyof typeof inputs, label: string, suffix: string, step = "1") => (
    <label key={key}>
      {label}
      <div className="suffix-input">
        <input
          type="number"
          step={step}
          value={(inputs[key] as number | null) ?? ""}
          onChange={(event) =>
            setInputs({
              ...inputs,
              [key]:
                event.target.value === "" ? null : Number(event.target.value.replace(",", ".")),
            })
          }
        />
        <span>{suffix}</span>
      </div>
    </label>
  );
  const rateField = (key: keyof typeof inputs, label: string) => (
    <label key={key}>
      {label}
      <div className="suffix-input">
        <input
          type="number"
          step="0.1"
          placeholder="non déclarée"
          value={inputs[key] === null ? "" : String((inputs[key] as number) * 100)}
          onChange={(event) =>
            setInputs({
              ...inputs,
              [key]:
                event.target.value === ""
                  ? null
                  : Number(event.target.value.replace(",", ".")) / 100,
            })
          }
        />
        <span>%</span>
      </div>
    </label>
  );

  return (
    <section className="underwriting-layout">
      <article className="panel input-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Étude prospective</span>
            <h2>Projet non détenu</h2>
          </div>
          <DataBadge kind="USER_ASSUMPTION" />
        </div>
        <div className="input-sections">
          <h3>Acquisition</h3>
          <div className="mini-form-grid">
            {numberField("purchasePrice", "Prix d’achat", reportingCurrency)}
            {numberField("acquisitionCosts", "Frais d’acquisition", reportingCurrency)}
            {numberField("works", "Travaux", reportingCurrency)}
          </div>
          <h3>Financement envisagé</h3>
          <div className="mini-form-grid">
            {numberField("loanPrincipal", "Capital emprunté", reportingCurrency)}
            {rateField("annualRate", "Taux nominal")}
            {numberField("termMonths", "Durée", "mois")}
          </div>
          <h3>Exploitation et sortie</h3>
          <div className="mini-form-grid">
            {numberField("annualGrossRent", "Loyer brut annuel", reportingCurrency)}
            {rateField("vacancyRate", "Vacance")}
            {numberField("annualOperatingCosts", "Charges annuelles", reportingCurrency)}
            {rateField("valueGrowth", "Croissance de valeur")}
            {rateField("rentGrowth", "Croissance de loyer")}
            {rateField("sellingCostsRate", "Frais de cession")}
            {numberField("horizonYears", "Horizon", "ans")}
            {rateField("discountRate", "Taux d’actualisation")}
          </div>
        </div>
      </article>
      <div className="results-stack">
        <section className="metrics-grid two">
          <MetricCard
            label="TRI du projet"
            value={
              result.equityIrr === null ? (
                <span className="warning-text" title={result.blockers.join(" · ")}>
                  {NOT_COMPUTABLE}
                </span>
              ) : (
                <Percent value={result.equityIrr} />
              )
            }
            tone={
              result.equityIrr !== null && result.equityIrr > result.discountRate
                ? "positive"
                : "neutral"
            }
          />
          <MetricCard
            label="VAN au taux déclaré"
            value={<Derived amount={result.equityNpv} sign />}
          />
          <MetricCard
            label="Apport réellement engagé"
            value={<Currency value={result.equityEngaged} />}
            detail="Coût total − capital emprunté"
          />
          <MetricCard
            label="Mensualité, produite par le Debt Engine"
            value={<Derived amount={result.monthlyPayment} />}
          />
        </section>
        <article className="panel result-summary">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Résultat</span>
              <h2>Économie du projet</h2>
            </div>
          </div>
          <dl>
            <div>
              <dt>Coût total du projet</dt>
              <dd>
                <Currency value={result.totalProjectCost} />
              </dd>
            </div>
            <div>
              <dt>Quotité de financement sur coût</dt>
              <dd>
                <DerivedPercent amount={result.loanToCost} />
              </dd>
            </div>
            <div>
              <dt>Loyer effectif annuel</dt>
              <dd>
                <Derived amount={result.effectiveRent} />
              </dd>
            </div>
            <div>
              <dt>Résultat d’exploitation</dt>
              <dd>
                <Derived amount={result.netOperatingIncome} />
              </dd>
            </div>
            <div>
              <dt>Rendement brut sur coût</dt>
              <dd>
                <DerivedPercent amount={result.grossYieldOnCost} />
              </dd>
            </div>
            <div>
              <dt>Rendement net sur coût</dt>
              <dd>
                <DerivedPercent amount={result.netYieldOnCost} />
              </dd>
            </div>
            <div>
              <dt>Couverture du service de dette</dt>
              <dd>
                <DerivedRatio amount={result.debtServiceCoverage} />
              </dd>
            </div>
            <div>
              <dt>Coût économique du crédit sur l’horizon</dt>
              <dd>
                <Derived amount={result.economicFinancingCost} />
              </dd>
            </div>
            <div>
              <dt>Coût économique si le crédit est conservé à terme</dt>
              <dd>
                <Derived amount={result.fullTermEconomicFinancingCost} />
              </dd>
            </div>
            <div>
              <dt>Capital remboursé sur l’horizon</dt>
              <dd>
                <Derived amount={result.principalRepaid} />
              </dd>
            </div>
            <div>
              <dt>Encours restant à l’horizon</dt>
              <dd>
                <Derived amount={result.outstandingAtHorizon} />
              </dd>
            </div>
            <div>
              <dt>Valeur à l’horizon</dt>
              <dd>
                <Derived amount={result.valueAtHorizon} />
              </dd>
            </div>
            <div>
              <dt>Produit net de cession, avant impôt</dt>
              <dd>
                <Derived amount={result.exitProceedsBeforeTax} />
              </dd>
            </div>
          </dl>
          {result.notes.map((note) => (
            <p className="form-notice" key={note}>
              {note}
            </p>
          ))}
        </article>
      </div>
    </section>
  );
}

export default RealEstatePage;
