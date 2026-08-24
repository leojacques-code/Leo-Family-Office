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
import { nextDebtEvent } from "@/lib/engine/debt";
import {
  cashRunwayDays,
  computeObservedCashFlow,
  forecastCashFlow,
  trailingPeriod,
} from "@/lib/engine/cash-flow";
import {
  buildOpeningBalanceSheet,
  runDeterministicModel,
  scenarioAssumptions,
  toAnnualPoints,
} from "@/lib/engine/monthly-financial-model";
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
  formatDate,
  liquidityExplanation,
  netWorthExplanation,
  projectionExplanation,
} from "@/components/pages/shared";

function TodayPage({ state, setExplanation, mutate, busy }: SectionProps) {
  const central =
    state.scenarios.find((scenario) => scenario.name === "Central") ?? state.scenarios[0];
  // Le graphique consomme le Personal Monthly Financial Model : bilan mois par mois,
  // point de départ égal au patrimoine net observé, dette et cash inclus.
  const opening = buildOpeningBalanceSheet(state);
  const assumptions = scenarioAssumptions(central);
  const annual = toAnnualPoints(
    runDeterministicModel(opening, state.liabilities, assumptions, 144),
  );
  const projection = annual.map((point) => ({
    year: point.year,
    value: point.netWorth,
    assets: point.grossFinancialAssets,
    debt: point.debt,
  }));
  const ALLOCATION_COLORS = ["#356b72", "#89a7a2", "#c0a66a", "#7d8fa8", "#b58a7a"];
  const investmentAccountIds = new Set(
    state.accounts
      .filter((account) => account.type === "PEA" || account.type === "CTO")
      .map((account) => account.id),
  );
  const positionsByClass = new Map<string, number>();
  state.positions.forEach((position) => {
    const key = position.isCash ? "Cash d’enveloppe" : position.assetClass;
    positionsByClass.set(key, (positionsByClass.get(key) ?? 0) + position.value);
  });
  // Un compte d'investissement dont les positions n'expliquent pas le solde garde son
  // reliquat visible plutôt que d'être aligné en silence sur la somme des positions.
  const unallocated = state.accounts
    .filter((account) => investmentAccountIds.has(account.id))
    .reduce((sum, account) => {
      const covered = state.positions
        .filter((position) => position.accountId === account.id)
        .reduce((total, position) => total + position.value, 0);
      return sum + Math.max(0, account.balance - covered);
    }, 0);
  const allocation = [
    ...[...positionsByClass.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([name, value], index) => ({
        name,
        value,
        color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
      })),
    { name: "Solde non ventilé", value: unallocated, color: "#b1bcbd" },
    { name: "Cash bancaire", value: state.metrics.bankCash, color: "#dce5e2" },
  ].filter((item) => item.value > 0);
  const allocationTotal = allocation.reduce((sum, item) => sum + item.value, 0);
  const upcomingDebt = nextDebtEvent(state.liabilities, state.asOfDate);
  // Surplus réellement constaté au ledger, à confronter à l'hypothèse du scénario.
  const t3 = trailingPeriod(state.asOfDate, 3);
  const observedT3M =
    computeObservedCashFlow(state.transactions, state.expenseCategories, t3.start, t3.end)
      .operatingCashFlowBeforeDebt / 3;
  const runway = cashRunwayDays(
    forecastCashFlow({
      asOfDate: state.asOfDate,
      horizonDays: 365,
      openingCash: state.metrics.bankCash,
      rules: state.recurringRules,
      liabilities: state.liabilities,
    }),
  );
  const primaryGoal = state.goals[0];

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow={formatDate(state.asOfDate, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
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
          tone={state.metrics.netWorth < 0 ? "negative" : "positive"}
          detail={
            <>
              {state.metrics.netWorth < 0 ? (
                <span className="negative-text">Sous zéro</span>
              ) : (
                <span className="positive-text">Au-dessus de zéro</span>
              )}{" "}
              · périmètre non exhaustif
            </>
          }
          onExplain={() => setExplanation(netWorthExplanation(state))}
        />
        <MetricCard
          label="Actifs financiers identifiés"
          value={<Currency value={state.metrics.grossAssets} />}
          detail={`${state.accounts.length} comptes consolidés · hors immobilier et business equity`}
          onExplain={() => setExplanation(assetsExplanation(state))}
        />
        <MetricCard
          label="Cash disponible"
          value={<Currency value={state.metrics.bankCash} />}
          tone="warning"
          detail={
            <>
              <span className="warning-text">
                {state.metrics.emergencyCoverageMonths.toLocaleString("fr-FR", {
                  maximumFractionDigits: 1,
                })}{" "}
                mois
              </span>{" "}
              de dépenses essentielles connues
            </>
          }
          onExplain={() => setExplanation(liquidityExplanation(state))}
        />
        <MetricCard
          label="Cash flow mensuel connu"
          value={<Currency value={state.metrics.freeCashFlow} sign />}
          tone={state.metrics.freeCashFlow >= 0 ? "positive" : "negative"}
          detail={
            state.metrics.monthlyDebtService > 0
              ? "Service de dette du mois déduit · dépenses incomplètes"
              : "Aucune échéance de dette exigible ce mois · dépenses incomplètes"
          }
          onExplain={() => setExplanation(cashFlowExplanation(state))}
        />
      </section>
      <section className="dashboard-grid">
        <article className="panel chart-panel span-2">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Trajectoire centrale déterministe</span>
              <h2>Patrimoine net financier projeté</h2>
            </div>
            <div className="legend">
              <span>
                <i className="legend-line nominal" />
                Patrimoine net
              </span>
              <span>
                <i className="legend-line real" />
                Actifs financiers
              </span>
              <button
                className="link-button"
                onClick={() =>
                  setExplanation(
                    projectionExplanation(
                      state,
                      central,
                      opening,
                      annual[1] ?? annual[0],
                      annual[0],
                    ),
                  )
                }
              >
                Explain calculation
              </button>
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
                  dataKey="assets"
                  stroke="#9b8555"
                  strokeDasharray="5 4"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-foot">
            <span>
              Scénario <strong>{central.name}</strong> ·{" "}
              <strong>
                <Percent value={central.annualReturn} />
              </strong>{" "}
              de rendement ·{" "}
              <strong>
                <Currency value={central.monthlySavings} />
              </strong>
              /mois de surplus avant service de dette ·{" "}
              <strong>
                <Percent value={central.investmentAllocationRate} />
              </strong>{" "}
              de ce surplus investi · périmètre financier uniquement
              {annual.at(-1)?.financingCostMissing
                ? " · besoin de financement non chiffré sur une partie de la trajectoire"
                : ""}
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
                  <Currency value={allocationTotal} compact />
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
                    <Percent value={item.value / allocationTotal} />
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
                {state.metrics.monthlyDebtService > 0
                  ? "Service de dette exigible"
                  : upcomingDebt
                    ? `Dette à partir du ${formatDate(upcomingDebt.entry.dueDate, { day: "numeric", month: "short", year: "numeric" })}`
                    : "Aucune dette exigible"}
              </span>
              <strong>
                {state.metrics.monthlyDebtService > 0 ? "−" : ""}
                <Currency value={state.metrics.monthlyDebtService} />
              </strong>
            </div>
          </div>
          <div className="flow-total">
            <span>Disponible ce mois</span>
            <strong>
              <Currency value={state.metrics.freeCashFlow} sign />
            </strong>
          </div>
          <p className="muted-copy">
            Surplus constaté au ledger sur 3 mois : <Currency value={observedT3M} sign />
            /mois
            {runway !== null ? ` · trésorerie négative projetée dans ${runway} jours` : ""}
          </p>
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
              <h2>{upcomingDebt ? upcomingDebt.liability.name : "Aucun événement daté"}</h2>
            </div>
            <Flag size={18} />
          </div>
          {upcomingDebt ? (
            <>
              <div className="event-date">
                <strong>{upcomingDebt.entry.dueDate.slice(8, 10)}</strong>
                <span>
                  {formatDate(upcomingDebt.entry.dueDate, { month: "short" }).toUpperCase()}
                  <br />
                  {upcomingDebt.entry.dueDate.slice(0, 4)}
                </span>
              </div>
              <p>
                {upcomingDebt.isFirstPayment
                  ? "Première échéance"
                  : `Échéance n° ${upcomingDebt.entry.paymentNumber}`}{" "}
                de{" "}
                <strong>
                  <Currency value={upcomingDebt.entry.totalCashOut} />
                </strong>
                .
              </p>
              <div className="event-foot">
                <span>
                  {upcomingDebt.daysAway === null
                    ? "Date non calculable"
                    : `Dans ${upcomingDebt.daysAway} jours à la date d’observation`}
                </span>
                <Link href="/debt">Voir l’échéancier</Link>
              </div>
            </>
          ) : (
            <p>
              Aucune échéance de dette n’est exigible dans l’échéancier dérivé. Un événement
              apparaîtra dès qu’un passif daté sera enregistré.
            </p>
          )}
        </article>
      </section>
    </div>
  );
}

export default TodayPage;
