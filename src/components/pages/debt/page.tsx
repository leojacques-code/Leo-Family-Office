"use client";

import { useState } from "react";
import { ArrowRight, FilePlus2 } from "lucide-react";
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
import { amortizeLoan } from "@/lib/engine/financial";
import { Callout, Currency, MetricCard, Percent, SectionHeader } from "@/components/ui";
import { type SectionProps, chartCurrency } from "@/components/pages/shared";

function DebtPage({ state, setExplanation }: SectionProps) {
  const loan = state.liabilities[0];
  const schedule = amortizeLoan(
    loan.principal,
    loan.annualRate,
    loan.paymentCount,
    loan.monthlyPayment,
  );
  const contractualTotal = loan.monthlyPayment * loan.paymentCount;
  const [investmentReturn, setInvestmentReturn] = useState(5.5);
  const comparison = compareDebtVsInvest({
    availableCash: 5000,
    debtBalance: loan.currentBalance,
    debtRate: loan.annualRate,
    investmentReturn: investmentReturn / 100,
    volatility: 0.15,
    inflation: 0.02,
    years: 5,
    liquidityWeight: 0.03,
  });
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Liabilities"
        title="Debt"
        description="Échéanciers, coût du crédit et arbitrage remboursement vs investissement."
        actions={
          <button className="button secondary">
            <FilePlus2 size={15} />
            Importer l’échéancier <span className="soon">À connecter</span>
          </button>
        }
      />
      <section className="metrics-grid four">
        <MetricCard label="Capital annoncé" value={<Currency value={loan.currentBalance} />} />
        <MetricCard label="Taux" value={<Percent value={loan.annualRate} />} tone="positive" />
        <MetricCard label="Mensualité annoncée" value={<Currency value={loan.monthlyPayment} />} />
        <MetricCard
          label="Écart contractuel"
          value={<Currency value={contractualTotal - loan.principal} />}
          tone="warning"
          onExplain={() =>
            setExplanation({
              title: "Écart du prêt étudiant",
              formula: "Mensualité × nombre d’échéances − capital annoncé",
              inputs: [
                { label: "Mensualité", value: "284,72 €", kind: "ACTUAL", date: state.asOfDate },
                { label: "Échéances", value: "60", kind: "ACTUAL", date: state.asOfDate },
                { label: "Capital", value: "16 745,00 €", kind: "ACTUAL", date: state.asOfDate },
              ],
              note: "17 083,20 € − 16 745,00 € = 338,20 €. Aucune explication n’est supposée.",
            })
          }
        />
      </section>
      <Callout tone="warning" title="Échéancier non réconcilié">
        284,72 € × 60 = <Currency value={contractualTotal} />, soit{" "}
        <Currency value={contractualTotal - loan.principal} /> au-dessus du capital annoncé. Le
        tableau arrête le principal à zéro ; seul le document bancaire pourra expliquer le reliquat
        contractuel.
      </Callout>
      <section className="two-column wide-left">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Amortissement dérivé</span>
              <h2>Solde restant</h2>
            </div>
            <button
              className="link-button"
              onClick={() =>
                setExplanation({
                  title: "Amortissement à 0 %",
                  formula: "Principal payé = min(solde, mensualité) ; intérêts = 0",
                  inputs: [
                    { label: "Capital", value: "16 745 €", kind: "ACTUAL" },
                    { label: "Taux", value: "0 %", kind: "ACTUAL" },
                    { label: "Mensualité", value: "284,72 €", kind: "ACTUAL" },
                  ],
                  note: "La dernière ligne dérivée est plafonnée au solde restant et ne remplace pas l’échéancier contractuel.",
                })
              }
            >
              Explain calculation
            </button>
          </div>
          <div className="medium-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={schedule
                  .filter((_, index) => index % 6 === 0)
                  .map((row) => ({ month: row.paymentNumber, balance: row.closingBalance }))}
              >
                <defs>
                  <linearGradient id="debtArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ab5a4e" stopOpacity={0.25} />
                    <stop offset="1" stopColor="#ab5a4e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} />
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
          </div>
          <dl>
            <div>
              <dt>Première échéance</dt>
              <dd>5 décembre 2026</dd>
            </div>
            <div>
              <dt>Dernière échéance prévue</dt>
              <dd>5 novembre 2031</dd>
            </div>
            <div>
              <dt>Nombre annoncé</dt>
              <dd>60 mensualités</dd>
            </div>
            <div>
              <dt>Coût d’intérêt dérivé</dt>
              <dd>0,00 €</dd>
            </div>
          </dl>
        </article>
      </section>
      <section className="panel decision-preview">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Arbitrage</span>
            <h2>Rembourser à 0 % ou investir</h2>
          </div>
          <a href="/decision-lab">
            Ouvrir le Decision Lab <ArrowRight size={14} />
          </a>
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
            <span>Rembourser 5 000 €</span>
            <strong>
              <Currency value={comparison.repay.nominalBenefit} />
            </strong>
            <small>Bénéfice certain : 0 € d’intérêt évité</small>
          </div>
          <div className="preferred">
            <span>Investir 5 000 €</span>
            <strong>
              <Currency value={comparison.invest.nominalBenefit} />
            </strong>
            <small>Valeur espérée, non garantie</small>
          </div>
        </div>
        <Callout title="Lecture">
          {comparison.conclusion} La priorité reste néanmoins la constitution d’une réserve de
          liquidité.
        </Callout>
      </section>
    </div>
  );
}

export default DebtPage;
