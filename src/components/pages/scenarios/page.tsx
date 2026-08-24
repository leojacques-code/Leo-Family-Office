"use client";

import { useState } from "react";
import { Copy, Save, Sparkles } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Scenario } from "@/lib/types";
import {
  Callout,
  Currency,
  DataBadge,
  EmptyState,
  Modal,
  Percent,
  SectionHeader,
} from "@/components/ui";
import {
  type SectionProps,
  chartCurrency,
  formatEur,
  inputNumber,
  projectionExplanation,
} from "@/components/pages/shared";
import {
  buildOpeningBalanceSheet,
  runDeterministicModel,
  scenarioAssumptions,
  toAnnualPoints,
} from "@/lib/engine/monthly-financial-model";

function ScenariosPage({
  state,
  mutate,
  busy,
  projection,
  runProjection,
  setExplanation,
}: SectionProps) {
  const [selectedId, setSelectedId] = useState(
    state.scenarios.find((scenario) => scenario.name === "Central")?.id ?? state.scenarios[0].id,
  );
  const [editing, setEditing] = useState<Scenario | null>(null);
  const [form, setForm] = useState({
    annualReturn: "",
    annualVolatility: "",
    annualInflation: "",
    monthlySavings: "",
    investmentAllocationRate: "",
    salaryGrowth: "",
    stressProbability: "",
    shockYear: "",
    shockMagnitude: "",
  });
  const [seed, setSeed] = useState(19082026);
  function editScenario(scenario: Scenario) {
    setEditing(scenario);
    setForm({
      annualReturn: String(scenario.annualReturn * 100),
      annualVolatility: String(scenario.annualVolatility * 100),
      annualInflation: String(scenario.annualInflation * 100),
      monthlySavings: String(scenario.monthlySavings),
      investmentAllocationRate: String(scenario.investmentAllocationRate * 100),
      salaryGrowth: String(scenario.salaryGrowth * 100),
      stressProbability: String(scenario.stressProbability * 100),
      shockYear: scenario.shockYear === null ? "" : String(scenario.shockYear),
      shockMagnitude: scenario.shockMagnitude === null ? "" : String(scenario.shockMagnitude * 100),
    });
  }
  async function saveScenario(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const ok = await mutate({
      action: "update_scenario",
      scenarioId: editing.id,
      patch: {
        annualReturn: inputNumber(form.annualReturn) / 100,
        annualVolatility: inputNumber(form.annualVolatility) / 100,
        annualInflation: inputNumber(form.annualInflation) / 100,
        monthlySavings: inputNumber(form.monthlySavings),
        investmentAllocationRate: inputNumber(form.investmentAllocationRate) / 100,
        salaryGrowth: inputNumber(form.salaryGrowth) / 100,
        stressProbability: inputNumber(form.stressProbability) / 100,
        shockYear: form.shockYear ? inputNumber(form.shockYear) : null,
        shockMagnitude: form.shockMagnitude ? inputNumber(form.shockMagnitude) / 100 : null,
      },
    });
    if (ok) setEditing(null);
  }
  const finalPoint = projection?.points.at(-1);
  // Trajectoire déterministe recalculée côté client : déplacer la part investie ou le
  // surplus modifie immédiatement le bilan projeté, sans relancer le Monte-Carlo.
  const selected =
    state.scenarios.find((scenario) => scenario.id === selectedId) ?? state.scenarios[0];
  const opening = buildOpeningBalanceSheet(state);
  const monthly = runDeterministicModel(
    opening,
    state.liabilities,
    scenarioAssumptions(selected),
    30 * 12,
  );
  const deterministic = toAnnualPoints(monthly);
  const horizon = deterministic.at(-1);
  // Le pic se lit sur le déroulé mensuel : les points annuels le sous-échantillonnent.
  const peakFundingGap = Math.max(...monthly.states.map((month) => month.fundingGap), 0);
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Scenario engine"
        title="Scenarios"
        description="Les scénarios remplacent uniquement les hypothèses futures. Ils ne modifient jamais l’historique ACTUAL."
        actions={
          <button
            className="button secondary"
            onClick={() => mutate({ action: "duplicate_scenario", scenarioId: selectedId })}
          >
            <Copy size={15} />
            Dupliquer
          </button>
        }
      />
      <div className="scenario-grid">
        {state.scenarios.map((scenario) => (
          <article
            key={scenario.id}
            className={`scenario-card ${selectedId === scenario.id ? "selected" : ""}`}
            onClick={() => setSelectedId(scenario.id)}
          >
            <div className="scenario-top">
              <span className="scenario-color" style={{ background: scenario.color }} />
              <span>
                <strong>{scenario.name}</strong>
                <small>Version {scenario.version}</small>
              </span>
              <DataBadge kind={scenario.provenance.kind} />
            </div>
            <p>{scenario.description}</p>
            <div className="scenario-stats">
              <div>
                <span>Rendement</span>
                <strong>
                  <Percent value={scenario.annualReturn} />
                </strong>
              </div>
              <div>
                <span>Volatilité</span>
                <strong>
                  <Percent value={scenario.annualVolatility} />
                </strong>
              </div>
              <div>
                <span>Surplus avant dette</span>
                <strong>
                  <Currency value={scenario.monthlySavings} />
                </strong>
              </div>
              <div>
                <span>Part investie</span>
                <strong>
                  <Percent value={scenario.investmentAllocationRate} />
                </strong>
              </div>
            </div>
            <button
              className="link-button"
              onClick={(event) => {
                event.stopPropagation();
                editScenario(scenario);
              }}
            >
              Modifier les hypothèses
            </button>
          </article>
        ))}
      </div>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Bilan projeté déterministe · {selected.name}</span>
            <h2>Trajectoire mensuelle sur 30 ans</h2>
          </div>
          <button
            className="link-button"
            onClick={() =>
              setExplanation(
                projectionExplanation(
                  state,
                  selected,
                  opening,
                  deterministic[1] ?? deterministic[0],
                  deterministic[0],
                ),
              )
            }
          >
            Explain calculation
          </button>
        </div>
        <div className="medium-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={deterministic}>
              <defs>
                <linearGradient id="netWorthArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#39747a" stopOpacity={0.24} />
                  <stop offset="1" stopColor="#39747a" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border-soft)" />
              <XAxis dataKey="year" axisLine={false} tickLine={false} />
              <YAxis tickFormatter={chartCurrency} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(value) => formatEur(Number(value))}
                labelFormatter={(label) => `Année ${label}`}
              />
              <Area
                type="monotone"
                dataKey="netWorth"
                name="Patrimoine net"
                stroke="#39747a"
                strokeWidth={2.2}
                fill="url(#netWorthArea)"
              />
              <Line
                type="monotone"
                dataKey="marketInvestedAssets"
                name="Actifs de marché"
                stroke="#c0a66a"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="bankCash"
                name="Cash bancaire"
                stroke="#89a7a2"
                strokeDasharray="4 3"
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="percentile-cards">
          <div>
            <span>Patrimoine net</span>
            <strong>
              <Currency value={horizon?.netWorth ?? 0} compact />
            </strong>
            <small>À l’horizon, périmètre financier</small>
          </div>
          <div>
            <span>Actifs financiers</span>
            <strong>
              <Currency value={horizon?.grossFinancialAssets ?? 0} compact />
            </strong>
            <small>
              dont marché <Currency value={horizon?.marketInvestedAssets ?? 0} compact /> · dont
              cash <Currency value={horizon?.bankCash ?? 0} compact />
            </small>
          </div>
          <div>
            <span>Dette restante</span>
            <strong>
              <Currency value={horizon?.debt ?? 0} compact />
            </strong>
            <small>
              Intérêts cumulés <Currency value={horizon?.cumulativeInterestPaid ?? 0} compact />
            </small>
          </div>
        </div>
        {horizon?.financingCostMissing ? (
          <Callout tone="warning" title="Projection partielle : coût de financement manquant">
            Le surplus mensuel ne couvre pas toujours le service de dette : un besoin de financement
            atteint <Currency value={peakFundingGap} /> avant d’être résorbé par les surplus
            suivants. Aucun taux ne lui est appliqué, faute de conditions de financement connues,
            donc la trajectoire est optimiste de ce coût. Tant qu’il subsiste, aucun euro n’est
            investi.
          </Callout>
        ) : null}
        <p className="muted-copy">
          Surplus mensuel <Currency value={selected.monthlySavings} /> avant service de dette, dont{" "}
          <Percent value={selected.investmentAllocationRate} /> du solde après dette dirigé vers les
          actifs de marché. Le service de dette est retranché explicitement chaque mois.
        </p>
      </section>
      <section className="panel simulation-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Monte-Carlo · patrimoine net financier simulé</span>
            <h2>Distribution projetée</h2>
          </div>
          <div className="simulation-actions">
            <label>
              Seed
              <input
                type="number"
                value={seed}
                onChange={(event) => setSeed(Number(event.target.value))}
              />
            </label>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => runProjection(selectedId, 30, 3000, seed)}
            >
              <Sparkles size={15} />
              Lancer 3 000 simulations
            </button>
          </div>
        </div>
        {projection ? (
          <>
            <div className="simulation-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={projection.points}>
                  <defs>
                    <linearGradient id="band90" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#39747a" stopOpacity={0.2} />
                      <stop offset="1" stopColor="#39747a" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border-soft)" />
                  <XAxis dataKey="year" axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={chartCurrency} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value) =>
                      new Intl.NumberFormat("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                        maximumFractionDigits: 0,
                      }).format(Number(value))
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="p90"
                    stackId="band"
                    stroke="none"
                    fill="url(#band90)"
                    name="P90"
                  />
                  <Area
                    type="monotone"
                    dataKey="p10"
                    stroke="#9b8555"
                    fill="transparent"
                    strokeDasharray="3 3"
                    name="P10"
                  />
                  <Line
                    type="monotone"
                    dataKey="p50"
                    stroke="#2f6c72"
                    strokeWidth={2.4}
                    dot={false}
                    name="P50"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="percentile-cards">
              <div>
                <span>P10</span>
                <strong>
                  <Currency value={finalPoint?.p10 ?? 0} compact />
                </strong>
                <small>Patrimoine net dépassé dans ~90 % des simulations</small>
              </div>
              <div>
                <span>P50</span>
                <strong>
                  <Currency value={finalPoint?.p50 ?? 0} compact />
                </strong>
                <small>Patrimoine net médian des simulations</small>
              </div>
              <div>
                <span>P90</span>
                <strong>
                  <Currency value={finalPoint?.p90 ?? 0} compact />
                </strong>
                <small>Patrimoine net atteint ou dépassé dans ~10 % des simulations</small>
              </div>
            </div>
            <button
              className="link-button explain-link"
              onClick={() =>
                setExplanation({
                  title: "Monte-Carlo",
                  formula:
                    "Transition mensuelle du bilan : surplus − service de dette → allocation cash/marché → performance sur le capital d’ouverture",
                  inputs: [
                    {
                      label: "Simulations",
                      value: String(projection.simulations),
                      kind: "MODEL_ASSUMPTION",
                    },
                    { label: "Seed", value: String(projection.seed), kind: "MODEL_ASSUMPTION" },
                    {
                      label: "Capital initial simulé",
                      value: new Intl.NumberFormat("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                      }).format(state.metrics.grossAssets),
                      kind: "DERIVED",
                      date: state.asOfDate,
                    },
                    {
                      label: "Scénario",
                      value:
                        state.scenarios.find((scenario) => scenario.id === projection.scenarioId)
                          ?.name ?? projection.scenarioId,
                      kind: "USER_ASSUMPTION",
                    },
                  ],
                  note: projection.methodology,
                })
              }
            >
              Explain calculation
            </button>
          </>
        ) : (
          <EmptyState
            title="Projection non lancée"
            detail="Le Monte-Carlo rejoue la transition mensuelle de la projection déterministe : seul le rendement de marché est tiré au sort, avec des queues épaisses, des stress rares et un seed reproductible. Immobilier, business equity, carrière et fiscalité future n’y sont pas intégrés."
            action={
              <button
                className="button primary"
                onClick={() => runProjection(selectedId, 30, 3000, seed)}
              >
                Lancer la projection
              </button>
            }
          />
        )}
      </section>
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Modifier ${editing?.name ?? "le scénario"}`}
        subtitle="Une nouvelle version est créée à chaque sauvegarde"
      >
        <form className="form-grid" onSubmit={saveScenario}>
          <label>
            Rendement annuel
            <input
              className="text-input"
              type="number"
              step="0.1"
              value={form.annualReturn}
              onChange={(event) => setForm({ ...form, annualReturn: event.target.value })}
            />
          </label>
          <label>
            Volatilité annuelle
            <input
              className="text-input"
              type="number"
              step="0.1"
              value={form.annualVolatility}
              onChange={(event) => setForm({ ...form, annualVolatility: event.target.value })}
            />
          </label>
          <label>
            Inflation
            <input
              className="text-input"
              type="number"
              step="0.1"
              value={form.annualInflation}
              onChange={(event) => setForm({ ...form, annualInflation: event.target.value })}
            />
          </label>
          <label>
            Surplus mensuel avant service de dette
            <input
              className="text-input"
              type="number"
              value={form.monthlySavings}
              onChange={(event) => setForm({ ...form, monthlySavings: event.target.value })}
            />
          </label>
          <label>
            Part du surplus investie (%)
            <input
              className="text-input"
              type="number"
              min="0"
              max="100"
              step="1"
              value={form.investmentAllocationRate}
              onChange={(event) =>
                setForm({ ...form, investmentAllocationRate: event.target.value })
              }
            />
          </label>
          <label>
            Croissance salaire
            <input
              className="text-input"
              type="number"
              step="0.1"
              value={form.salaryGrowth}
              onChange={(event) => setForm({ ...form, salaryGrowth: event.target.value })}
            />
          </label>
          <label>
            Probabilité stress annuelle
            <input
              className="text-input"
              type="number"
              step="0.1"
              value={form.stressProbability}
              onChange={(event) => setForm({ ...form, stressProbability: event.target.value })}
            />
          </label>
          <label>
            Année du choc
            <input
              className="text-input"
              type="number"
              placeholder="Aucun"
              value={form.shockYear}
              onChange={(event) => setForm({ ...form, shockYear: event.target.value })}
            />
          </label>
          <label>
            Magnitude du choc (%)
            <input
              className="text-input"
              type="number"
              placeholder="Aucune"
              value={form.shockMagnitude}
              onChange={(event) => setForm({ ...form, shockMagnitude: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setEditing(null)}>
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={15} />
              Créer la version {editing ? editing.version + 1 : ""}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default ScenariosPage;
