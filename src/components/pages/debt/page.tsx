"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Archive, ArrowRight, Edit3, Plus, Save, WalletCards } from "lucide-react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compareDebtVsInvest } from "@/lib/engine/decision";
import {
  buildLoanTimeline,
  debtServiceBreakdownForPeriod,
  monthBounds,
  monthlyDebtServiceAt,
  nextDebtEvent,
} from "@/lib/engine/debt";
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
import { type SectionProps, OptionalCurrency, formatDate } from "@/components/pages/shared";
import { formatCurrency } from "@/lib/presentation/currency";
import type { DebtContractInput } from "@/lib/data/contracts";
import type { DebtReadModel } from "@/lib/presentation/debt/contracts";
import type { Liability } from "@/lib/types";
import { useRegisterPrimaryAction } from "@/components/workstation/primary-action";
import { DebtContractForm } from "@/components/pages/debt/debt-contract-form";
import { OutstandingDebtDrawer } from "@/components/pages/debt/outstanding-debt-drawer";
import type { OutstandingDebt } from "@/lib/types";

const PROFILE_LABELS: Record<Liability["amortisationProfile"], string> = {
  AMORTIZING: "Amortissable",
  INTEREST_ONLY: "Intérêts seuls",
  BULLET: "In fine",
  BALLOON: "Balloon",
};

const FREQUENCY_LABELS: Record<Liability["paymentFrequency"], string> = {
  MONTHLY: "mensuelle",
  QUARTERLY: "trimestrielle",
  SEMIANNUAL: "semestrielle",
  ANNUAL: "annuelle",
};

function interestFormula(loan: Liability): string {
  if (loan.interestConvention === "ACTUAL_365") {
    return "Intérêt = solde × taux annuel × nombre de jours réels / 365";
  }
  const period = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 }[loan.paymentFrequency];
  return `Intérêt = solde × taux annuel × ${period}/12`;
}

type DebtPageProps = Pick<SectionProps, "mutate" | "busy" | "setExplanation"> & {
  state: { cashObservationPresent?: boolean } & Pick<
    DebtReadModel,
    "asOfDate" | "liabilities" | "scenarios" | "metrics" | "reportingCurrency"
  > &
    Partial<Pick<DebtReadModel, "outstandingDebts" | "dates">>;
};

function DebtPage({ state, mutate, busy, setExplanation }: DebtPageProps) {
  const [selectedId, setSelectedId] = useState(state.liabilities[0]?.id ?? "");
  const [investmentReturn, setInvestmentReturn] = useState(5.5);
  const [contractEditor, setContractEditor] = useState<"new" | "edit" | null>(null);
  // B16 : dette encours seul dont on décrit le contrat (même ligne, décision tracée).
  const [promoting, setPromoting] = useState<OutstandingDebt | null>(null);
  useRegisterPrimaryAction(busy ? null : () => setContractEditor(loan ? "edit" : "new"));
  const [balanceEditor, setBalanceEditor] = useState(false);
  const [balance, setBalance] = useState({ value: "", date: state.asOfDate, notes: "" });
  // Tiroir « encours seul » : création (`debt: null`) ou correction d'une dette existante.
  const [outstandingEditor, setOutstandingEditor] = useState<{
    debt: OutstandingDebt | null;
  } | null>(null);
  const outstandingDebts = state.outstandingDebts ?? [];
  const loan = state.liabilities.find((item) => item.id === selectedId) ?? state.liabilities[0];
  const timeline = useMemo(
    () => (loan ? buildLoanTimeline(loan, state.asOfDate) : null),
    [loan, state.asOfDate],
  );
  const scenario =
    state.scenarios.find((item) => item.name === "Central") ?? state.scenarios[0] ?? null;
  const comparison =
    loan &&
    state.cashObservationPresent !== false &&
    state.metrics.bankCash !== null &&
    scenario &&
    loan.currency === state.reportingCurrency
      ? compareDebtVsInvest({
          availableCash: state.metrics.bankCash,
          debtBalance: loan.currentBalance,
          debtRate: loan.annualRate,
          investmentReturn: investmentReturn / 100,
          volatility: scenario.annualVolatility,
          inflation: scenario.annualInflation,
          years: 5,
        })
      : null;

  const header = (
    <SectionHeader
      eyebrow="Passif"
      title="Dettes"
      description="Échéanciers datés, coût du crédit et arbitrage remboursement vs investissement."
      actions={
        <>
          {loan ? (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setContractEditor("edit")}
              >
                <Edit3 size={15} /> Modifier le contrat
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setBalance({
                    value: String(loan.currentBalance),
                    date: state.asOfDate,
                    notes: "",
                  });
                  setBalanceEditor(true);
                }}
              >
                <WalletCards size={15} /> Nouvel encours
              </button>
            </>
          ) : null}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => setOutstandingEditor({ debt: null })}
          >
            <WalletCards size={15} /> Encours seul
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => setContractEditor("new")}
          >
            <Plus size={15} /> Nouvelle dette
          </button>
        </>
      }
    />
  );

  const outstandingDrawer = outstandingEditor ? (
    <OutstandingDebtDrawer
      key={outstandingEditor.debt?.id ?? "new"}
      open
      debt={outstandingEditor.debt}
      defaultCurrency={state.reportingCurrency}
      maxDate={state.dates?.today}
      busy={busy}
      onClose={() => setOutstandingEditor(null)}
      onSubmit={(draft) =>
        outstandingEditor.debt
          ? mutate({
              action: "record_debt_balance",
              liabilityId: outstandingEditor.debt.id,
              observedAt: draft.observedAt,
              balance: draft.balance,
              notes: draft.notes,
            })
          : mutate({ action: "record_outstanding_debt", ...draft })
      }
    />
  ) : null;

  const outstandingPanel =
    outstandingDebts.length > 0 ? (
      <section className="panel outstanding-debts" aria-label="Encours déclarés sans contrat">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Encours déclarés</span>
            <h2>Sans contrat détaillé</h2>
          </div>
        </div>
        <p className="outstanding-debt-note">
          Aucun échéancier, coût ni prochaine échéance n’est calculé tant que les termes sont
          inconnus.
        </p>
        <ul className="outstanding-debt-list">
          {outstandingDebts.map((debt) => (
            <li key={debt.id}>
              <div>
                <strong>{debt.name}</strong>
                <span>{debt.lender ?? "Créancier non renseigné"}</span>
              </div>
              <div className="outstanding-debt-value">
                <Currency currency={debt.currency} value={debt.currentBalance} />
                <span>
                  {debt.balanceDate ? `Au ${formatDate(debt.balanceDate)}` : "Date non renseignée"}
                </span>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setOutstandingEditor({ debt })}
              >
                <Edit3 size={15} /> Corriger l’encours
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setPromoting(debt)}
              >
                <Plus size={15} /> Décrire le contrat
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  const promotionModal = (
    <Modal
      open={promoting !== null}
      onClose={() => setPromoting(null)}
      title={promoting ? `Décrire le contrat de ${promoting.name}` : "Décrire le contrat"}
      subtitle="La même dette devient contractuelle : l’encours observé et son historique sont conservés."
      wide
    >
      {promoting ? (
        <DebtContractForm
          key={`promote-${promoting.id}`}
          loan={null}
          promoteFrom={promoting}
          asOfDate={state.asOfDate}
          reportingCurrency={state.reportingCurrency}
          busy={busy}
          onCancel={() => setPromoting(null)}
          onSave={(contract: DebtContractInput) =>
            mutate({ action: "save_debt_contract", contract })
          }
        />
      ) : null}
    </Modal>
  );

  const editorModal = (
    <Modal
      open={contractEditor !== null}
      onClose={() => setContractEditor(null)}
      title={contractEditor === "edit" && loan ? `Modifier ${loan.name}` : "Nouvelle dette"}
      subtitle="Les termes contractuels et l’encours observé restent deux vérités distinctes."
      wide
    >
      <DebtContractForm
        key={`${contractEditor}-${loan?.id ?? "new"}`}
        loan={contractEditor === "edit" ? (loan ?? null) : null}
        asOfDate={state.asOfDate}
        reportingCurrency={state.reportingCurrency}
        busy={busy}
        onCancel={() => setContractEditor(null)}
        onSave={(contract: DebtContractInput) => mutate({ action: "save_debt_contract", contract })}
      />
    </Modal>
  );

  async function recordBalance(event: FormEvent) {
    event.preventDefault();
    if (!loan) return;
    const ok = await mutate({
      action: "record_debt_balance",
      liabilityId: loan.id,
      observedAt: balance.date,
      balance: Number(balance.value.replace(",", ".")),
      notes: balance.notes || null,
    });
    if (ok) setBalanceEditor(false);
  }

  if (!loan || !timeline) {
    return (
      <div className="page-stack">
        {header}
        {outstandingPanel ?? (
          <EmptyState
            title="Aucune dette enregistrée"
            detail="Une absence de saisie ne signifie pas une absence de dette."
            action={
              <div className="empty-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => setOutstandingEditor({ debt: null })}
                >
                  <WalletCards size={15} /> Je connais l’encours
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setContractEditor("new")}
                >
                  <Plus size={15} /> Décrire le contrat
                </button>
              </div>
            }
          />
        )}
        {editorModal}
        {promotionModal}
        {outstandingDrawer}
      </div>
    );
  }

  const currency = loan.currency ?? null;
  const formatLoanAmount = (value: number | null) =>
    value === null ? "Non calculable" : formatCurrency(value, currency);
  const { contractual, forward } = timeline;
  const currentDebtService = monthlyDebtServiceAt([loan], state.asOfDate);
  const monthWindow = monthBounds(state.asOfDate);
  const monthBreakdown = debtServiceBreakdownForPeriod(
    [loan],
    state.asOfDate,
    monthWindow.start,
    monthWindow.end,
  );
  const upcoming = nextDebtEvent([loan], state.asOfDate);
  // B16 : l'écart « paiement × durée − capital » n'a de sens que si paiement ET durée sont
  // DÉCLARÉS. Un terme déduit par le moteur boucle par construction : l'écart serait un
  // artefact du calcul, présenté comme une anomalie du contrat.
  const termsDeclared =
    !loan.termsResolution ||
    (loan.termsResolution.monthlyPayment === "DECLARED" &&
      loan.termsResolution.paymentCount === "DECLARED");
  const paymentDeclared =
    !loan.termsResolution || loan.termsResolution.monthlyPayment === "DECLARED";
  // Un échéancier bancaire utilisé est une bonne nouvelle, pas une anomalie : le mélanger
  // aux écarts de réconciliation ferait passer une information pour un problème.
  const providedNotice = timeline.flags.find((flag) => flag.code === "PROVIDED_SCHEDULE_USED");
  const anomalies = timeline.flags.filter((flag) => flag.code !== "PROVIDED_SCHEDULE_USED");

  return (
    <div className="page-stack">
      {header}
      {outstandingPanel}
      {state.liabilities.length > 1 ? (
        <section className="decision-case-strip">
          {state.liabilities.map((item) => (
            <button
              key={item.id}
              className={item.id === loan.id ? "active" : ""}
              onClick={() => setSelectedId(item.id)}
            >
              {item.name}
              <span>{item.lender}</span>
            </button>
          ))}
        </section>
      ) : null}
      <section className="metrics-grid four">
        <MetricCard
          label="Capital restant dû"
          value={<Currency currency={currency} value={loan.currentBalance} />}
          detail={`${loan.name} · ${loan.lender}`}
        />
        <MetricCard label="Taux" value={<Percent value={loan.annualRate} />} tone="positive" />
        <MetricCard
          label="Service de dette du mois"
          value={<Currency currency={currency} value={currentDebtService} />}
          tone={currentDebtService > 0 ? "warning" : "neutral"}
          detail={
            currentDebtService === 0
              ? upcoming
                ? `Aucune échéance exigible ce mois · prochaine le ${formatDate(upcoming.entry.dueDate)}`
                : "Aucune échéance exigible ce mois"
              : paymentDeclared
                ? `Paiement ${FREQUENCY_LABELS[loan.paymentFrequency]} annoncé ${formatLoanAmount(loan.monthlyPayment)}`
                : `Paiement ${FREQUENCY_LABELS[loan.paymentFrequency]} non déclaré, dérivé par le moteur`
          }
          onExplain={() =>
            setExplanation({
              title: "Service de dette exigible",
              formula:
                "Σ totalCashOut des échéances dont la date d’exigibilité tombe dans le mois d’observation",
              inputs: [
                { label: "Date d’observation", value: formatDate(state.asOfDate), kind: "ACTUAL" },
                {
                  label: "Première échéance",
                  value: contractual.firstDueDate
                    ? formatDate(contractual.firstDueDate)
                    : "Non datée",
                  kind: "ACTUAL",
                  source: loan.provenance.source,
                },
                {
                  label: "Dernière échéance dérivée",
                  value: contractual.lastDueDate
                    ? formatDate(contractual.lastDueDate)
                    : "Non datée",
                  kind: "DERIVED",
                },
                {
                  label: "Échéances exigibles ce mois",
                  value: currentDebtService === 0 ? "0" : "1",
                  kind: "DERIVED",
                  date: state.asOfDate,
                },
              ],
              note: `Avant la première échéance et après la dernière, aucune ligne n’est exigible : le service de dette vaut 0 sans cas particulier. Décomposition du mois : ${formatLoanAmount(monthBreakdown.principal)} de capital, ${formatLoanAmount(monthBreakdown.interest)} d’intérêts, ${formatLoanAmount(monthBreakdown.insurance)} d’assurance, ${formatLoanAmount(monthBreakdown.fees)} de frais. Seuls ${formatLoanAmount(monthBreakdown.economicCost)} appauvrissent : le capital remboursé éteint un passif, il ne détruit pas de patrimoine.`,
            })
          }
        />
        {loan.amortisationProfile === "AMORTIZING" && termsDeclared ? (
          <MetricCard
            label="Écart du paiement contractuel"
            value={<Currency currency={currency} value={timeline.contractualGap} />}
            tone={Math.abs(timeline.contractualGap) > 0.01 ? "warning" : "neutral"}
            onExplain={() =>
              setExplanation({
                title: `Écart contractuel · ${loan.name}`,
                formula: "Paiement par échéance × nombre d’échéances − capital annoncé",
                inputs: [
                  {
                    label: "Paiement par échéance",
                    value: formatLoanAmount(loan.monthlyPayment),
                    kind: loan.provenance.kind,
                    date: loan.provenance.effectiveDate ?? state.asOfDate,
                    source: loan.provenance.source,
                  },
                  {
                    label: "Échéances annoncées",
                    value: String(loan.paymentCount),
                    kind: loan.provenance.kind,
                    source: loan.provenance.source,
                  },
                  {
                    label: "Capital",
                    value: formatLoanAmount(loan.principal),
                    kind: loan.provenance.kind,
                    source: loan.provenance.source,
                  },
                ],
                note: `Écart calculé par le moteur : ${formatLoanAmount(timeline.contractualGap)}. Aucune explication n’est supposée.`,
              })
            }
          />
        ) : (
          <MetricCard
            label="Profil contractuel"
            value={PROFILE_LABELS[loan.amortisationProfile]}
            detail={`${loan.paymentCount} échéances${
              loan.termsResolution && loan.termsResolution.paymentCount !== "DECLARED"
                ? " (durée calculée, non déclarée)"
                : ""
            } · fréquence ${FREQUENCY_LABELS[loan.paymentFrequency]}`}
          />
        )}
      </section>
      {providedNotice ? (
        <Callout tone="info" title="Échéancier bancaire">
          {providedNotice.detail}
        </Callout>
      ) : null}
      {anomalies.length ? (
        <Callout tone="warning" title="Points à réconcilier">
          {anomalies.map((flag) => flag.detail).join(" ")} L’encours observé fait foi : rien n’est
          corrigé en silence pour faire coller le modèle à la donnée.
        </Callout>
      ) : null}
      {loan.amortisationProfile === "INTEREST_ONLY" ? (
        <Callout tone="info" title="Capital à la maturité">
          Le profil « intérêts seuls » ne fait pas disparaître le capital : l’encours reste dû après
          la dernière échéance d’intérêts tant qu’un remboursement final n’est pas déclaré. Pour un
          remboursement automatique du capital à maturité, utilisez le profil « in fine ».
        </Callout>
      ) : null}
      <section className="two-column wide-left">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Projection depuis l’encours observé</span>
              <h2>Solde restant</h2>
            </div>
            <button
              className="link-button"
              onClick={() =>
                setExplanation({
                  title: `Amortissement · ${loan.name}`,
                  formula:
                    loan.annualRate === 0
                      ? "Intérêt = 0 ; mouvement de principal selon le profil contractuel"
                      : interestFormula(loan),
                  inputs: [
                    {
                      label: `Encours observé au ${formatDate(state.asOfDate)}`,
                      value: formatLoanAmount(loan.currentBalance),
                      kind: loan.provenance.kind,
                      source: loan.provenance.source,
                    },
                    {
                      label: "Taux annuel",
                      value: `${(loan.annualRate * 100).toFixed(2)} %`,
                      kind: loan.provenance.kind,
                    },
                    {
                      label: "Paiement contractuel par échéance",
                      value: formatLoanAmount(loan.monthlyPayment),
                      kind: loan.provenance.kind,
                    },
                    {
                      label: "Échéances déjà exigibles",
                      value: `${timeline.elapsedPayments} sur ${loan.paymentCount}`,
                      kind: "DERIVED",
                      date: state.asOfDate,
                    },
                    {
                      label: "Échéances restantes projetées",
                      value: `${forward.entries.length} lignes datées`,
                      kind: "DERIVED",
                    },
                    {
                      label: "Intérêts restant à payer",
                      value: formatLoanAmount(forward.totalInterest),
                      kind: "DERIVED",
                    },
                  ],
                  note: `${loan.interestConvention === "ACTUAL_365" ? "La convention ACTUAL/365 compte les jours calendaires réels entre deux échéances. " : "La convention proportionnelle applique la fraction d’année correspondant à la périodicité. "}${loan.rateType === "VARIABLE" ? "Un taux révisable n’est prolongé au-delà des révisions déclarées que comme hypothèse de modèle. " : "Le taux fixe est appliqué jusqu’à la maturité déclarée. "}La projection part de l’encours observé ; les échéances déjà passées ne sont jamais rejouées. Qualité ${forward.kind} : un échéancier bancaire ACTUAL prime sur toute dérivation.`,
                })
              }
            >
              Comprendre l’échéancier
            </button>
          </div>
          <div className="medium-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={forward.entries
                  .filter((_, index) => index % 6 === 0 || index === forward.entries.length - 1)
                  .map((entry) => ({
                    date: entry.dueDate.slice(0, 7),
                    balance: entry.closingBalance,
                  }))}
              >
                <defs>
                  <linearGradient id="debtArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ab5a4e" stopOpacity={0.25} />
                    <stop offset="1" stopColor="#ab5a4e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} />
                <YAxis
                  width={88}
                  tickFormatter={(value: number) => formatCurrency(value, currency, true)}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) =>
                    typeof value === "number" ? formatLoanAmount(value) : "Non calculable"
                  }
                />
                <Area
                  isAnimationActive={false}
                  name="Solde restant"
                  dataKey="balance"
                  stroke="#ab5a4e"
                  fill="url(#debtArea)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel loan-facts">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Contrat annoncé</span>
              <h2>Dates clés</h2>
            </div>
            <DataBadge kind={loan.provenance.kind} />
          </div>
          <dl>
            <div>
              <dt>Première échéance</dt>
              <dd>{formatDate(loan.firstPaymentDate)}</dd>
            </div>
            <div>
              <dt>
                {loan.termsResolution && loan.termsResolution.maturityDate !== "DECLARED"
                  ? "Dernière échéance calculée"
                  : "Dernière échéance annoncée"}
              </dt>
              <dd>{loan.maturityDate ? formatDate(loan.maturityDate) : "Non calculable"}</dd>
            </div>
            <div>
              <dt>Dernière échéance dérivée</dt>
              <dd>{contractual.lastDueDate ? formatDate(contractual.lastDueDate) : "—"}</dd>
            </div>
            <div>
              <dt>Nombre annoncé</dt>
              <dd>
                {loan.paymentCount} échéances · fréquence {FREQUENCY_LABELS[loan.paymentFrequency]}
              </dd>
            </div>
            <div>
              <dt>Échéances payées à ce jour</dt>
              <dd>{timeline.elapsedPayments}</dd>
            </div>
            <div>
              <dt>Intérêts du contrat, durée complète</dt>
              <dd>
                <Currency currency={currency} value={contractual.totalInterest} />
              </dd>
            </div>
            <div>
              <dt>Intérêts restant à payer</dt>
              <dd>
                <Currency currency={currency} value={forward.totalInterest} />
              </dd>
            </div>
          </dl>
          {loan.currentBalance <= 0.01 ? (
            <button
              className="button secondary debt-archive"
              disabled={busy}
              onClick={() => mutate({ action: "archive_debt", liabilityId: loan.id })}
            >
              <Archive size={14} /> Archiver cette dette éteinte
            </button>
          ) : null}
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Échéancier forward daté · {forward.kind}</span>
            <h2>Prochaines échéances</h2>
          </div>
          <span className="panel-note">
            {forward.entries.length} restantes sur {loan.paymentCount} annoncées
          </span>
        </div>
        <div className="simple-table">
          <div className="table-head">
            <span>Date</span>
            <span>Échéance</span>
            <span>Intérêt</span>
            <span>Principal</span>
            <span>Solde</span>
          </div>
          {forward.entries.slice(0, 6).map((entry, index) => (
            <div
              className="table-row"
              key={`${entry.entryKind}-${entry.paymentNumber}-${entry.dueDate}-${index}`}
            >
              <span>{formatDate(entry.dueDate)}</span>
              <strong>
                n° {entry.paymentNumber} ·{" "}
                <Currency currency={currency} value={entry.totalCashOut} />
              </strong>
              <span>
                <Currency currency={currency} value={entry.interest} />
              </span>
              <span>
                <Currency currency={currency} value={entry.principal} />
              </span>
              <strong>
                <Currency currency={currency} value={entry.closingBalance} />
              </strong>
            </div>
          ))}
        </div>
      </section>
      {!comparison ? (
        <Callout title="Comparaison à compléter">
          {state.cashObservationPresent === false || state.metrics.bankCash === null
            ? "Renseignez une observation de cash et ses éventuels taux de change avant de comparer remboursement et placement."
            : !scenario
              ? "Renseignez les hypothèses du scénario avant de comparer remboursement et placement."
              : "La comparaison attend une dette dans la devise de reporting. Les montants de devises différentes ne sont pas comparés directement."}
        </Callout>
      ) : null}
      {comparison ? (
        <section className="panel decision-preview">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Arbitrage</span>
              <h2>
                Rembourser à <Percent value={loan.annualRate} /> ou investir
              </h2>
            </div>
            <Link href="/decision-lab">
              Ouvrir le Decision Lab <ArrowRight size={14} />
            </Link>
          </div>
          <div className="decision-controls">
            <label>
              Rendement annuel hypothétique <strong>{investmentReturn.toFixed(1)} %</strong>
              <input
                type="range"
                min="0"
                max="10"
                step="0.1"
                value={investmentReturn}
                onChange={(event) => setInvestmentReturn(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="comparison-cards">
            <div>
              <span>
                Rembourser <Currency currency={currency} value={comparison.capital} />
              </span>
              <strong>
                <OptionalCurrency currency={currency} value={comparison.repay.interestAvoided} />
              </strong>
              <small>
                {comparison.repay.interestAvoided === null
                  ? "Intérêts évités non calculables sans convention de remboursement anticipé"
                  : `Intérêts évités sur ${comparison.horizonYears} ans, montant certain`}
              </small>
            </div>
            <div>
              <span>
                Investir <Currency currency={currency} value={comparison.capital} />
              </span>
              <strong>
                <Currency currency={currency} value={comparison.invest.expectedGain} sign />
              </strong>
              <small>Gain espéré non garanti, dette conservée</small>
            </div>
          </div>
          {comparison.interestAvoidedBlocker ? (
            <Callout tone="warning" title="Intérêts évités non calculables">
              {comparison.interestAvoidedBlocker} Le montant réellement économisé n’est donc pas
              chiffré ici : les autres grandeurs restent comparables.
            </Callout>
          ) : null}
          <Callout title="Lecture">
            Le capital arbitrable est borné par le cash bancaire réellement disponible (
            <Currency currency={state.reportingCurrency} value={state.metrics.bankCash} />
            ), pas par le montant de la dette. Les deux colonnes sont des grandeurs objectives :
            aucune option n’est recommandée ici.
          </Callout>
        </section>
      ) : null}
      {editorModal}
      {promotionModal}
      <Modal
        open={balanceEditor}
        onClose={() => setBalanceEditor(false)}
        title={`Nouvel encours observé · ${loan.name}`}
        subtitle={`Montant en ${currency ?? "devise non renseignée"}. Cette observation n’altère aucun terme contractuel.`}
      >
        <form className="form-grid" onSubmit={recordBalance}>
          <label>
            Encours
            <input
              className="text-input"
              type="number"
              min="0"
              step="0.01"
              value={balance.value}
              onChange={(event) => setBalance({ ...balance, value: event.target.value })}
              required
            />
          </label>
          <label>
            Date d’observation
            <input
              className="text-input"
              type="date"
              value={balance.date}
              onChange={(event) => setBalance({ ...balance, date: event.target.value })}
              required
            />
          </label>
          <label className="full">
            Note (optionnelle)
            <input
              className="text-input"
              value={balance.notes}
              onChange={(event) => setBalance({ ...balance, notes: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setBalanceEditor(false)}
            >
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={15} /> Enregistrer l’observation
            </button>
          </div>
        </form>
      </Modal>
      {outstandingDrawer}
    </div>
  );
}

export default DebtPage;
