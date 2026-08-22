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
import { Currency, DataBadge, EmptyState, Modal, Percent, SectionHeader } from "@/components/ui";
import { type SectionProps, chartCurrency, inputNumber } from "@/components/pages/shared";

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
        salaryGrowth: inputNumber(form.salaryGrowth) / 100,
        stressProbability: inputNumber(form.stressProbability) / 100,
        shockYear: form.shockYear ? inputNumber(form.shockYear) : null,
        shockMagnitude: form.shockMagnitude ? inputNumber(form.shockMagnitude) / 100 : null,
      },
    });
    if (ok) setEditing(null);
  }
  const finalPoint = projection?.points.at(-1);
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
                <span>Épargne</span>
                <strong>
                  <Currency value={scenario.monthlySavings} />
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
      <section className="panel simulation-panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Monte-Carlo</span>
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
                <small>Dépassé favorablement dans ~90 % des simulations du modèle</small>
              </div>
              <div>
                <span>P50</span>
                <strong>
                  <Currency value={finalPoint?.p50 ?? 0} compact />
                </strong>
                <small>Médiane des simulations</small>
              </div>
              <div>
                <span>P90</span>
                <strong>
                  <Currency value={finalPoint?.p90 ?? 0} compact />
                </strong>
                <small>Atteint ou dépassé dans ~10 % des simulations du modèle</small>
              </div>
            </div>
            <button
              className="link-button explain-link"
              onClick={() =>
                setExplanation({
                  title: "Monte-Carlo",
                  formula: "Aₜ₊₁ = max(0, Aₜ × (1 + rₜ) + épargne mensuelle)",
                  inputs: [
                    {
                      label: "Simulations",
                      value: String(projection.simulations),
                      kind: "MODEL_ASSUMPTION",
                    },
                    { label: "Seed", value: String(projection.seed), kind: "MODEL_ASSUMPTION" },
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
            detail="Le moteur utilise des rendements mensuels à queues épaisses, des stress rares et un seed reproductible."
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
            Épargne mensuelle
            <input
              className="text-input"
              type="number"
              value={form.monthlySavings}
              onChange={(event) => setForm({ ...form, monthlySavings: event.target.value })}
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
