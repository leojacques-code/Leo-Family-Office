"use client";

import { useMemo, useState } from "react";
import { ArrowRight, FilePlus2 } from "lucide-react";
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
import { buildLoanTimeline, monthlyDebtServiceAt, nextDebtEvent } from "@/lib/engine/debt";
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
  type SectionProps,
  OptionalCurrency,
  chartCurrency,
  formatDate,
  formatEur,
} from "@/components/pages/shared";

function DebtPage({ state, setExplanation }: SectionProps) {
  const [selectedId, setSelectedId] = useState(state.liabilities[0]?.id ?? "");
  const [investmentReturn, setInvestmentReturn] = useState(5.5);
  const loan = state.liabilities.find((item) => item.id === selectedId) ?? state.liabilities[0];
  const timeline = useMemo(
    () => (loan ? buildLoanTimeline(loan, state.asOfDate) : null),
    [loan, state.asOfDate],
  );
  const scenario =
    state.scenarios.find((item) => item.name === "Central") ?? state.scenarios[0] ?? null;
  const comparison = loan
    ? compareDebtVsInvest({
        availableCash: state.metrics.bankCash,
        debtBalance: loan.currentBalance,
        debtRate: loan.annualRate,
        investmentReturn: investmentReturn / 100,
        volatility: scenario?.annualVolatility ?? 0,
        inflation: scenario?.annualInflation ?? 0,
        years: 5,
      })
    : null;

  const header = (
    <SectionHeader
      eyebrow="Liabilities"
      title="Debt"
      description="Échéanciers datés, coût du crédit et arbitrage remboursement vs investissement."
      actions={
        <button className="button secondary">
          <FilePlus2 size={15} />
          Importer l’échéancier <span className="soon">À connecter</span>
        </button>
      }
    />
  );

  if (!loan || !timeline) {
    return (
      <div className="page-stack">
        {header}
        <EmptyState
          title="Aucune dette enregistrée"
          detail="Le service de dette mensuel vaut 0 € et aucun échéancier n’est projeté tant qu’aucun passif n’est saisi."
        />
      </div>
    );
  }

  const { contractual, forward } = timeline;
  const currentDebtService = monthlyDebtServiceAt([loan], state.asOfDate);
  const upcoming = nextDebtEvent([loan], state.asOfDate);
  const contractualTotal = loan.monthlyPayment * loan.paymentCount;

  return (
    <div className="page-stack">
      {header}
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
          value={<Currency value={loan.currentBalance} />}
          detail={`${loan.name} · ${loan.lender}`}
        />
        <MetricCard label="Taux" value={<Percent value={loan.annualRate} />} tone="positive" />
        <MetricCard
          label="Service de dette du mois"
          value={<Currency value={currentDebtService} />}
          tone={currentDebtService > 0 ? "warning" : "neutral"}
          detail={
            currentDebtService === 0
              ? upcoming
                ? `Aucune échéance exigible ce mois · prochaine le ${formatDate(upcoming.entry.dueDate)}`
                : "Aucune échéance exigible ce mois"
              : `Mensualité annoncée ${formatEur(loan.monthlyPayment)}`
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
              note: "Avant la première échéance et après la dernière, aucune ligne n’est exigible : le service de dette vaut 0 sans cas particulier. Assurance et frais ne sont pas portés par le contrat saisi et valent 0.",
            })
          }
        />
        <MetricCard
          label="Écart contractuel"
          value={<Currency value={timeline.contractualGap} />}
          tone={Math.abs(timeline.contractualGap) > 0.01 ? "warning" : "neutral"}
          onExplain={() =>
            setExplanation({
              title: `Écart contractuel · ${loan.name}`,
              formula: "Mensualité × nombre d’échéances − capital annoncé",
              inputs: [
                {
                  label: "Mensualité",
                  value: formatEur(loan.monthlyPayment),
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
                  value: formatEur(loan.principal),
                  kind: loan.provenance.kind,
                  source: loan.provenance.source,
                },
              ],
              note: `${formatEur(contractualTotal)} − ${formatEur(loan.principal)} = ${formatEur(timeline.contractualGap)}. Aucune explication n’est supposée.`,
            })
          }
        />
      </section>
      {timeline.flags.length ? (
        <Callout tone="warning" title="Échéancier non réconcilié">
          {timeline.flags.map((flag) => flag.detail).join(" ")} Le tableau arrête le principal à
          zéro ; seul le document bancaire pourra expliquer le reliquat contractuel.
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
                      ? "Intérêt = 0 ; principal payé = min(solde, mensualité)"
                      : "Intérêt = solde × taux/12 ; principal = mensualité − intérêt",
                  inputs: [
                    {
                      label: `Encours observé au ${formatDate(state.asOfDate)}`,
                      value: formatEur(loan.currentBalance),
                      kind: loan.provenance.kind,
                      source: loan.provenance.source,
                    },
                    {
                      label: "Taux annuel",
                      value: `${(loan.annualRate * 100).toFixed(2)} %`,
                      kind: loan.provenance.kind,
                    },
                    {
                      label: "Mensualité contractuelle",
                      value: formatEur(loan.monthlyPayment),
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
                      value: formatEur(forward.totalInterest),
                      kind: "DERIVED",
                    },
                  ],
                  note: "La projection amortit l’encours observé à la date d’observation, à partir de la prochaine échéance exigible. Les mensualités déjà passées ne sont jamais rejouées contre cet encours. Provenance DERIVED : cet échéancier ne remplace pas le document bancaire.",
                })
              }
            >
              Explain calculation
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
                <YAxis tickFormatter={chartCurrency} axisLine={false} tickLine={false} />
                <Tooltip />
                <Area dataKey="balance" stroke="#ab5a4e" fill="url(#debtArea)" />
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
              <dt>Dernière échéance annoncée</dt>
              <dd>{formatDate(loan.maturityDate)}</dd>
            </div>
            <div>
              <dt>Dernière échéance dérivée</dt>
              <dd>{contractual.lastDueDate ? formatDate(contractual.lastDueDate) : "—"}</dd>
            </div>
            <div>
              <dt>Nombre annoncé</dt>
              <dd>{loan.paymentCount} mensualités</dd>
            </div>
            <div>
              <dt>Échéances payées à ce jour</dt>
              <dd>{timeline.elapsedPayments}</dd>
            </div>
            <div>
              <dt>Intérêts du contrat, durée complète</dt>
              <dd>
                <Currency value={contractual.totalInterest} />
              </dd>
            </div>
            <div>
              <dt>Intérêts restant à payer</dt>
              <dd>
                <Currency value={forward.totalInterest} />
              </dd>
            </div>
          </dl>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Échéancier forward daté · DERIVED</span>
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
          {forward.entries.slice(0, 6).map((entry) => (
            <div className="table-row" key={entry.paymentNumber}>
              <span>{formatDate(entry.dueDate)}</span>
              <strong>
                n° {entry.paymentNumber} · <Currency value={entry.totalCashOut} />
              </strong>
              <span>
                <Currency value={entry.interest} />
              </span>
              <span>
                <Currency value={entry.principal} />
              </span>
              <strong>
                <Currency value={entry.closingBalance} />
              </strong>
            </div>
          ))}
        </div>
      </section>
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
                Rembourser <Currency value={comparison.capital} />
              </span>
              <strong>
                <OptionalCurrency value={comparison.repay.interestAvoided} />
              </strong>
              <small>
                {comparison.repay.interestAvoided === null
                  ? "Intérêts évités non calculables sans convention de remboursement anticipé"
                  : `Intérêts évités sur ${comparison.horizonYears} ans, montant certain`}
              </small>
            </div>
            <div>
              <span>
                Investir <Currency value={comparison.capital} />
              </span>
              <strong>
                <Currency value={comparison.invest.expectedGain} sign />
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
            <Currency value={state.metrics.bankCash} />
            ), pas par le montant de la dette. Les deux colonnes sont des grandeurs objectives :
            aucune option n’est recommandée ici.
          </Callout>
        </section>
      ) : null}
    </div>
  );
}

export default DebtPage;
