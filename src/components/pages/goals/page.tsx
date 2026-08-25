"use client";

import { useState } from "react";
import { Plus, Target } from "lucide-react";
import {
  Currency,
  DataBadge,
  MetricCard,
  Modal,
  ProgressBar,
  SectionHeader,
} from "@/components/ui";
import { type SectionProps, inputNumber } from "@/components/pages/shared";

function GoalsPage({ state, mutate, busy }: SectionProps) {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: "", target: "100000", date: "" });
  async function add(event: React.FormEvent) {
    event.preventDefault();
    const ok = await mutate({
      action: "add_goal",
      name: form.name,
      targetAmount: inputNumber(form.target),
      targetDate: form.date || null,
    });
    if (ok) {
      setModal(false);
      setForm({ name: "", target: "100000", date: "" });
    }
  }
  const milestones = [100000, 250000, 500000, 1000000, 2000000, 5000000, 10000000, 20000000];
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Milestones"
        title="Goals"
        description="Les seuils sont des repères, pas la fonction objectif du moteur de décision."
        actions={
          <button className="button primary" onClick={() => setModal(true)}>
            <Plus size={16} />
            Nouvel objectif
          </button>
        }
      />
      <section className="goals-grid">
        {state.goals.map((goal) => {
          const progress =
            state.metrics.netWorth === null
              ? null
              : Math.max(0, state.metrics.netWorth) / goal.targetAmount;
          return (
            <article className="panel goal-card-large" key={goal.id}>
              <div className="goal-icon">
                <Target size={19} />
              </div>
              <DataBadge kind="USER_ASSUMPTION" />
              <h2>{goal.name}</h2>
              <div className="goal-big">
                <Currency
                  value={
                    state.metrics.netWorth === null ? null : Math.max(0, state.metrics.netWorth)
                  }
                />
                <span>
                  / <Currency value={goal.targetAmount} />
                </span>
              </div>
              {progress === null ? (
                <span className="warning-text">Progression non calculable</span>
              ) : (
                <ProgressBar value={progress} tone={goal.priority === 1 ? "teal" : "gold"} />
              )}
              <div className="goal-foot">
                <span>
                  {progress === null
                    ? "Historique incomplet"
                    : `${Math.round(progress * 100)} % atteint`}
                </span>
                <span>
                  {goal.targetDate
                    ? `Cible ${new Date(goal.targetDate).getFullYear()}`
                    : "Sans date"}
                </span>
              </div>
            </article>
          );
        })}
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Repères configurables</span>
            <h2>Milestones patrimoniaux</h2>
          </div>
        </div>
        <div className="milestone-line">
          {milestones.map((milestone) => (
            <div
              key={milestone}
              className={
                state.metrics.netWorth !== null && state.metrics.netWorth >= milestone
                  ? "achieved"
                  : ""
              }
            >
              <i />
              <strong>
                <Currency value={milestone} compact />
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="metrics-grid four">
        <MetricCard
          label="FI ratio"
          value="Non calculable"
          detail="Dépenses souhaitées manquantes"
          tone="warning"
        />
        <MetricCard label="Freedom Coverage" value="Non calculable" detail="Revenus passifs = 0" />
        <MetricCard label="Coast FIRE" value="Secondaire" detail="Objectif non prioritaire" />
        <MetricCard
          label="Premier objectif"
          value="Retour à 0 €"
          detail="Patrimoine net identifié"
        />
      </section>
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Nouvel objectif"
        subtitle="Un objectif peut être financier, de liquidité ou de liberté"
      >
        <form className="form-grid" onSubmit={add}>
          <label className="full">
            Nom
            <input
              className="text-input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </label>
          <label>
            Montant cible
            <input
              className="text-input"
              type="number"
              min="1"
              value={form.target}
              onChange={(event) => setForm({ ...form, target: event.target.value })}
              required
            />
          </label>
          <label>
            Date cible (optionnelle)
            <input
              className="text-input"
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setModal(false)}>
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              Créer
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default GoalsPage;
