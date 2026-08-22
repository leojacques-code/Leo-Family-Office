"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarCheck, ChevronRight, Flag } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { deterministicProjection } from "@/lib/engine/financial";
import {
  Currency,
  DataBadge,
  MetricCard,
  Percent,
  ProgressBar,
  SectionHeader,
} from "@/components/ui";
import {
  type SectionProps,
  assetsExplanation,
  cashFlowExplanation,
  chartCurrency,
  liquidityExplanation,
  netWorthExplanation,
} from "@/components/pages/shared";

function TodayPage({ state, setExplanation, mutate, busy }: SectionProps) {
  const central =
    state.scenarios.find((scenario) => scenario.name === "Central") ?? state.scenarios[0];
  const projection = deterministicProjection(state.metrics.grossAssets, 12, central).map(
    (point) => ({ year: 2026 + point.year, value: point.nominal, real: point.real }),
  );
  const allocation = [
    {
      name: "Actions monde",
      value: state.positions
        .filter((position) => position.assetClass === "Actions monde")
        .reduce((sum, position) => sum + position.value, 0),
      color: "#356b72",
    },
    {
      name: "Cash PEA",
      value: state.positions
        .filter((position) => position.isCash)
        .reduce((sum, position) => sum + position.value, 0),
      color: "#89a7a2",
    },
    {
      name: "CTO non ventilé",
      value: state.positions
        .filter((position) => position.accountId === "acc_cto")
        .reduce((sum, position) => sum + position.value, 0),
      color: "#c0a66a",
    },
    { name: "Cash bancaire", value: state.metrics.bankCash, color: "#dce5e2" },
  ].filter((item) => item.value > 0);
  const primaryGoal = state.goals[0];

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Mercredi 19 août 2026"
        title="Bonjour Léo."
        description="Voici votre situation financière identifiée et ce qui mérite votre attention."
        actions={
          <button
            className="button primary"
            onClick={() => mutate({ action: "create_monthly_close", closeDate: state.asOfDate })}
            disabled={busy}
          >
            <CalendarCheck size={16} />
            Clôturer le mois
          </button>
        }
      />
      <div className="uncertainty-strip">
        <DataBadge kind="ACTUAL" />
        <span>Valeurs observées</span>
        <DataBadge kind="DERIVED" />
        <span>Calculs</span>
        <DataBadge kind="MODEL_ASSUMPTION" />
        <span>Projections</span>
        <span className="completeness">
          <strong>{Math.round(state.metrics.dataCompleteness * 100)} %</strong> des catégories de
          dépenses renseignées
        </span>
      </div>
      <section className="metrics-grid four">
        <MetricCard
          label="Patrimoine net identifié"
          value={<Currency value={state.metrics.netWorth} />}
          tone="negative"
          detail={
            <>
              <span className="negative-text">Sous zéro</span> · périmètre non exhaustif
            </>
          }
          onExplain={() => setExplanation(netWorthExplanation(state))}
        />
        <MetricCard
          label="Actifs bruts"
          value={<Currency value={state.metrics.grossAssets} />}
          detail={`${state.accounts.length} comptes consolidés`}
          onExplain={() => setExplanation(assetsExplanation(state))}
        />
        <MetricCard
          label="Cash disponible"
          value={<Currency value={state.metrics.bankCash} />}
          tone="warning"
          detail={
            <>
              <span className="warning-text">
                <Currency value={state.metrics.emergencyCoverageMonths} /> mois
              </span>{" "}
              de loyer couvert
            </>
          }
          onExplain={() => setExplanation(liquidityExplanation(state))}
        />
        <MetricCard
          label="Cash flow mensuel connu"
          value={<Currency value={state.metrics.freeCashFlow} sign />}
          tone={state.metrics.freeCashFlow >= 0 ? "positive" : "negative"}
          detail="Avant échéance du prêt · dépenses incomplètes"
          onExplain={() => setExplanation(cashFlowExplanation(state))}
        />
      </section>
      <section className="dashboard-grid">
        <article className="panel chart-panel span-2">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Trajectoire centrale déterministe</span>
              <h2>Patrimoine brut projeté</h2>
            </div>
            <div className="legend">
              <span>
                <i className="legend-line nominal" />
                Nominal
              </span>
              <span>
                <i className="legend-line real" />
                Réel
              </span>
            </div>
          </div>
          <div className="hero-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projection} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="areaNominal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#39747a" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#39747a" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                <XAxis
                  dataKey="year"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                />
                <YAxis
                  tickFormatter={chartCurrency}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value) => [
                    new Intl.NumberFormat("fr-FR", {
                      style: "currency",
                      currency: "EUR",
                      maximumFractionDigits: 0,
                    }).format(Number(value)),
                    "",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#39747a"
                  strokeWidth={2.4}
                  fill="url(#areaNominal)"
                />
                <Line
                  type="monotone"
                  dataKey="real"
                  stroke="#9b8555"
                  strokeDasharray="5 4"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-foot">
            <span>
              Hypothèse :{" "}
              <strong>
                <Percent value={central.annualReturn} />
              </strong>{" "}
              de rendement,{" "}
              <strong>
                <Currency value={central.monthlySavings} />
              </strong>
              /mois
            </span>
            <Link href="/scenarios">
              Tester les scénarios <ArrowRight size={14} />
            </Link>
          </div>
        </article>
        <article className="panel allocation-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Allocation identifiée</span>
              <h2>Où sont les actifs</h2>
            </div>
          </div>
          <div className="allocation-content">
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={76}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {allocation.map((item) => (
                      <Cell key={item.name} fill={item.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <strong>
                  <Currency value={state.metrics.grossAssets} compact />
                </strong>
                <span>actifs</span>
              </div>
            </div>
            <div className="allocation-legend">
              {allocation.map((item) => (
                <div key={item.name}>
                  <span>
                    <i style={{ background: item.color }} />
                    {item.name}
                  </span>
                  <strong>
                    <Percent value={item.value / state.metrics.grossAssets} />
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </article>
        <article className="panel cashflow-card">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Cash flow connu</span>
              <h2>Ce mois-ci</h2>
            </div>
            <Link href="/cash-flow">
              Détails <ChevronRight size={14} />
            </Link>
          </div>
          <div className="flow-rows">
            <div>
              <span>
                <i className="flow-dot income" />
                Revenus actifs
              </span>
              <strong>
                <Currency value={state.metrics.monthlyIncome} />
              </strong>
            </div>
            <div>
              <span>
                <i className="flow-dot expense" />
                Dépenses renseignées
              </span>
              <strong>
                −<Currency value={state.metrics.monthlyExpenses} />
              </strong>
            </div>
            <div>
              <span>
                <i className="flow-dot debt" />
                Dette dès déc. 2026
              </span>
              <strong>
                −
                <Currency
                  value={state.liabilities.reduce((sum, item) => sum + item.monthlyPayment, 0)}
                />
              </strong>
            </div>
          </div>
          <div className="flow-total">
            <span>Disponible avant prêt</span>
            <strong>
              <Currency value={state.metrics.freeCashFlow} sign />
            </strong>
          </div>
        </article>
        <article className="panel goals-card">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Objectif prioritaire</span>
              <h2>{primaryGoal?.name ?? "Aucun objectif"}</h2>
            </div>
            <Link href="/goals">
              Gérer <ChevronRight size={14} />
            </Link>
          </div>
          {primaryGoal ? (
            <>
              <div className="goal-number">
                <Currency value={Math.max(0, state.metrics.netWorth)} />
                <span>
                  sur <Currency value={primaryGoal.targetAmount} />
                </span>
              </div>
              <ProgressBar value={Math.max(0, state.metrics.netWorth) / primaryGoal.targetAmount} />
              <p className="muted-copy">
                Le patrimoine net est négatif ; le premier jalon est le retour à zéro.
              </p>
            </>
          ) : null}
        </article>
        <article className="panel alerts-panel span-2">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Risques & attention</span>
              <h2>{state.alerts.length} points ouverts</h2>
            </div>
            <span className="alert-count">
              {state.alerts.filter((alert) => alert.severity === "HIGH").length} critiques
            </span>
          </div>
          <div className="alert-list">
            {state.alerts.map((alert) => (
              <div className="alert-row" key={alert.id}>
                <span className={`severity-icon ${alert.severity.toLowerCase()}`}>
                  <AlertTriangle size={15} />
                </span>
                <div>
                  <strong>{alert.title}</strong>
                  <p>{alert.detail}</p>
                </div>
                <span className={`severity-label ${alert.severity.toLowerCase()}`}>
                  {alert.severity === "HIGH" ? "Prioritaire" : "À vérifier"}
                </span>
              </div>
            ))}
          </div>
        </article>
        <article className="panel event-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Prochain événement majeur</span>
              <h2>Prêt étudiant</h2>
            </div>
            <Flag size={18} />
          </div>
          <div className="event-date">
            <strong>05</strong>
            <span>
              DÉC
              <br />
              2026
            </span>
          </div>
          <p>
            Première échéance annoncée de{" "}
            <strong>
              <Currency value={284.72} />
            </strong>
            .
          </p>
          <div className="event-foot">
            <span>Dans 108 jours à la date zéro</span>
            <Link href="/debt">Voir l’échéancier</Link>
          </div>
        </article>
      </section>
    </div>
  );
}

export default TodayPage;
