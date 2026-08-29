"use client";

import { useMemo, useState } from "react";
import { Archive, Edit3, Flag, Pause, Play, Plus, Save } from "lucide-react";
import { Callout, Currency, EmptyState, Modal, SectionHeader } from "@/components/ui";
import { type SectionProps, formatDate, inputNumber } from "@/components/pages/shared";
import type { DashboardState, Goal, Scenario } from "@/lib/types";
import {
  GOAL_CONSTRAINT_STRENGTHS,
  GOAL_TARGET_METRICS,
  type GoalBlocker,
  type GoalConstraintStrength,
  type GoalEvaluationStatus,
  type GoalTargetMetric,
  type GoalTargetOperator,
  type GoalVersionDefinition,
} from "@/lib/engine/goal-contracts";
import {
  createGoalVersion,
  evaluateGoalAgainstTrajectory,
  evaluateGoalCurrent,
} from "@/lib/engine/goal-engine";
import { GOAL_METRIC_REGISTRY } from "@/lib/engine/goal-metrics";
import { buildOpeningBalanceSheet } from "@/lib/engine/monthly-financial-model";
import { buildBaselineReference, runScenarioComparison } from "@/lib/engine/scenario-engine";
import type {
  ScenarioBaselineReference,
  ScenarioComparison,
} from "@/lib/engine/scenario-contracts";

type GoalForm = {
  name: string;
  description: string;
  metric: GoalTargetMetric;
  operator: GoalTargetOperator;
  targetValue: string;
  targetDate: string;
  priority: string;
  constraintStrength: GoalConstraintStrength;
  entityId: string;
};

const EMPTY_FORM: GoalForm = {
  name: "",
  description: "",
  metric: "NET_WORTH",
  operator: "AT_LEAST",
  targetValue: "",
  targetDate: "",
  priority: "1",
  constraintStrength: "SOFT",
  entityId: "",
};

const STATUS_LABELS: Record<GoalEvaluationStatus, string> = {
  ACHIEVED: "Atteint",
  ON_TRACK: "En bonne voie",
  AT_RISK: "À risque",
  OFF_TRACK: "Hors trajectoire",
  OVERDUE: "Échu",
  NOT_COMPUTABLE: "Non calculable",
};

function statusTone(status: GoalEvaluationStatus) {
  if (status === "ACHIEVED" || status === "ON_TRACK") return "complete";
  if (status === "AT_RISK") return "partial";
  return "blocked";
}

function operatorLabel(operator: GoalTargetOperator) {
  if (operator === "AT_LEAST") return "Au moins";
  if (operator === "AT_MOST") return "Au plus";
  return "Exactement";
}

function formFromGoal(goal: Goal): GoalForm {
  const definition = goal.definition;
  return {
    name: definition?.name ?? goal.name,
    description: definition?.description ?? goal.description ?? "",
    metric: definition?.target.metric ?? "NET_WORTH",
    operator: definition?.target.operator ?? "AT_LEAST",
    targetValue: String(definition?.target.value ?? goal.targetAmount),
    targetDate: definition?.targetDate ?? goal.targetDate ?? "",
    priority: String(definition?.priority ?? goal.priority),
    constraintStrength: definition?.constraintStrength ?? goal.constraintStrength ?? "SOFT",
    entityId: definition?.target.entityId ?? "",
  };
}

export type GoalsTrajectoryContext =
  | {
      status: "READY" | "PARTIAL";
      baseline: ScenarioBaselineReference;
      comparison: ScenarioComparison;
      blockers: GoalBlocker[];
    }
  | {
      status: "NOT_COMPUTABLE";
      baseline: null;
      comparison: null;
      blockers: GoalBlocker[];
    };

function unavailableTrajectory(message: string): GoalsTrajectoryContext {
  return {
    status: "NOT_COMPUTABLE",
    baseline: null,
    comparison: null,
    blockers: [
      {
        code: "TRAJECTORY_NOT_COMPUTABLE",
        message,
        blocking: true,
        source: "GOALS_V2",
      },
    ],
  };
}

/** Boundary Goals : une projection impossible devient un résultat explicite, jamais un crash. */
export function buildGoalsTrajectoryContext(
  state: DashboardState,
  selectedScenario: Scenario | undefined,
): GoalsTrajectoryContext {
  if (!selectedScenario?.definition || !state.eventTimeline) {
    return unavailableTrajectory(
      "Un scénario V2 actif et sa timeline canonique sont nécessaires pour l’évaluation future.",
    );
  }
  try {
    const opening = buildOpeningBalanceSheet(state);
    const baseline = buildBaselineReference({ opening, timeline: state.eventTimeline });
    const comparison = runScenarioComparison({
      baselineEvents: state.eventTimeline.events,
      opening,
      definition: selectedScenario.definition,
      reportingCurrency: state.reportingCurrency,
    });
    if (comparison.completeness === "NOT_COMPUTABLE") {
      return unavailableTrajectory(
        comparison.blockers.map((item) => item.message).join(" · ") ||
          "La trajectoire Scenarios V2 n’est pas calculable.",
      );
    }
    return {
      status: comparison.completeness,
      baseline,
      comparison,
      blockers: comparison.blockers.map((item) => ({
        code: item.code,
        message: item.message,
        blocking: item.blocking,
        source: "SCENARIOS_V2",
      })),
    };
  } catch {
    return unavailableTrajectory(
      "Le bilan canonique ne permet pas de construire la trajectoire. Les évaluations projetées restent non calculables.",
    );
  }
}

export function GoalsPage({ state, mutate, busy }: SectionProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    state.scenarios.find((scenario) => scenario.name === "Central")?.id ??
      state.scenarios[0]?.id ??
      "",
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [form, setForm] = useState<GoalForm>(EMPTY_FORM);

  const selectedScenario =
    state.scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? state.scenarios[0];
  const trajectoryContext = useMemo(
    () => buildGoalsTrajectoryContext(state, selectedScenario),
    [selectedScenario, state],
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setCreating(true);
  }

  function openEdit(goal: Goal) {
    setCreating(false);
    setEditing(goal);
    setForm(formFromGoal(goal));
  }

  function setMetric(metric: GoalTargetMetric) {
    const definition = GOAL_METRIC_REGISTRY[metric];
    setForm((current) => ({
      ...current,
      metric,
      operator: definition.allowedOperators[0],
      entityId: "",
    }));
  }

  function definitionFromForm(goalId: string): GoalVersionDefinition {
    return createGoalVersion({
      goalId,
      name: form.name,
      description: form.description,
      priority: Math.max(1, Math.min(99, Math.trunc(inputNumber(form.priority)))),
      constraintStrength: form.constraintStrength,
      target: {
        metric: form.metric,
        operator: form.operator,
        value: inputNumber(form.targetValue),
        currency: state.reportingCurrency,
        entityId: form.entityId || null,
      },
      targetDate: form.targetDate || null,
      status: editing?.definition?.status ?? editing?.status ?? "ACTIVE",
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const goalId = editing?.id ?? crypto.randomUUID();
    let definition = definitionFromForm(goalId);
    if (editing) {
      definition = {
        ...definition,
        version: editing.version ?? editing.definition?.version ?? 1,
        createdAt: editing.definition?.createdAt ?? definition.createdAt,
        legacyCompatibility: editing.definition?.legacyCompatibility ?? false,
      };
    }
    const ok = editing
      ? await mutate({
          action: "save_goal_version_v2",
          goalId: editing.id,
          expectedVersion: editing.version ?? editing.definition?.version ?? 1,
          definition,
        })
      : await mutate({ action: "create_goal_v2", definition });
    if (ok) {
      setCreating(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    }
  }

  async function setStatus(goal: Goal, status: "ACTIVE" | "PAUSED" | "ARCHIVED") {
    await mutate({
      action: "set_goal_status_v2",
      goalId: goal.id,
      expectedVersion: goal.version ?? goal.definition?.version ?? 1,
      status,
    });
  }

  const modalOpen = creating || editing !== null;
  const metricDefinition = GOAL_METRIC_REGISTRY[form.metric];
  const entityTarget =
    form.metric === "SPECIFIC_DEBT_BALANCE"
      ? {
          label: "Dette ciblée",
          placeholder: "Sélectionner une dette",
          required: true,
          options: state.liabilities.map((liability) => ({
            id: liability.id,
            name: liability.name,
          })),
        }
      : form.metric === "REAL_ESTATE_VALUE"
        ? {
            label: "Bien ciblé (optionnel)",
            placeholder: "Tous les biens",
            required: false,
            options: state.realEstateAssets.map((asset) => ({ id: asset.id, name: asset.name })),
          }
        : form.metric === "BUSINESS_EQUITY"
          ? {
              label: "Entreprise ciblée (optionnel)",
              placeholder: "Toutes les entreprises",
              required: false,
              options: (state.businesses ?? []).map((business) => ({
                id: business.id,
                name: business.name,
              })),
            }
          : null;

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Goals engine"
        title="Goals"
        description="Des intentions versionnées, évaluées sur le bilan canonique et la trajectoire Scenarios V2 sélectionnée."
        actions={
          <button className="button primary" onClick={openCreate} disabled={busy}>
            <Plus size={15} /> Nouvel objectif
          </button>
        }
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Trajectoire prospective</span>
            <h2>Scénario d’évaluation</h2>
          </div>
          <label>
            <span className="muted-copy">Scénario</span>
            <select
              value={selectedScenario?.id ?? ""}
              onChange={(event) => setSelectedScenarioId(event.target.value)}
              disabled={!state.scenarios.length}
            >
              {state.scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.name} · v{scenario.version}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted-copy">
          La projection est recalculée à la lecture. Aucun statut, gap ou résultat de scénario n’est
          persisté comme fait.
        </p>
        {trajectoryContext.status === "NOT_COMPUTABLE" ? (
          <Callout tone="warning" title="Trajectoire indisponible">
            {trajectoryContext.blockers.map((item) => item.message).join(" · ")}
          </Callout>
        ) : null}
      </section>

      {state.goals.length ? (
        <div className="goals-grid">
          {state.goals.map((goal) => {
            const definition = goal.definition;
            if (!definition) return null;
            const current = evaluateGoalCurrent({
              goal: definition,
              balanceSheet: state.balanceSheet ?? null,
              reportingCurrency: state.reportingCurrency,
              asOfDate: state.asOfDate,
            });
            const projected =
              trajectoryContext.status !== "NOT_COMPUTABLE"
                ? evaluateGoalAgainstTrajectory({
                    goal: definition,
                    trajectory: trajectoryContext.comparison.scenario,
                    reportingCurrency: state.reportingCurrency,
                    baselineFingerprint: trajectoryContext.baseline.openingFingerprint,
                    currentBaselineFingerprint: trajectoryContext.baseline.openingFingerprint,
                  })
                : null;
            const metric = GOAL_METRIC_REGISTRY[definition.target.metric];
            return (
              <article className="panel goal-card-large" key={goal.id}>
                <div className="goal-icon">
                  <Flag size={18} />
                </div>
                <span className={`state-pill ${statusTone(current.status)}`}>
                  {STATUS_LABELS[current.status]}
                </span>
                <h2>{definition.name}</h2>
                {definition.description ? (
                  <p className="muted-copy">{definition.description}</p>
                ) : null}
                <div className="goal-big">
                  <Currency value={definition.target.value} />
                  <span> · {operatorLabel(definition.target.operator)}</span>
                </div>
                <div className="scenario-stats">
                  <div>
                    <span>Métrique</span>
                    <strong>{metric.label}</strong>
                  </div>
                  <div>
                    <span>Valeur courante</span>
                    <strong>
                      <Currency value={current.observation.value} />
                    </strong>
                  </div>
                  <div>
                    <span>Écart courant</span>
                    <strong>
                      <Currency value={current.gap?.shortfall ?? null} />
                    </strong>
                  </div>
                  <div>
                    <span>Scénario {selectedScenario?.name ?? "indisponible"}</span>
                    <strong
                      className={`state-pill ${statusTone(projected?.status ?? "NOT_COMPUTABLE")}`}
                    >
                      {STATUS_LABELS[projected?.status ?? "NOT_COMPUTABLE"]}
                    </strong>
                  </div>
                  <div>
                    <span>Valeur à l’échéance</span>
                    <strong>
                      <Currency value={projected?.projectedValueAtTargetDate ?? null} />
                    </strong>
                  </div>
                  <div>
                    <span>Première atteinte projetée</span>
                    <strong>
                      {projected?.firstProjectedAttainmentDate
                        ? formatDate(projected.firstProjectedAttainmentDate)
                        : "Non calculable"}
                    </strong>
                  </div>
                  <div>
                    <span>Deadline</span>
                    <strong>
                      {definition.targetDate ? formatDate(definition.targetDate) : "Aucune"}
                    </strong>
                  </div>
                  <div>
                    <span>Contrainte · version</span>
                    <strong>
                      {definition.constraintStrength} · v{definition.version}
                    </strong>
                  </div>
                </div>
                {[...current.blockers, ...(projected?.blockers ?? [])].length ? (
                  <Callout tone="warning" title="Évaluation partielle">
                    {[...current.blockers, ...(projected?.blockers ?? [])]
                      .map((item) => item.message)
                      .filter((message, index, all) => all.indexOf(message) === index)
                      .join(" · ")}
                  </Callout>
                ) : null}
                <div className="goal-foot">
                  <span>
                    {definition.target.currency ?? "Devise non déclarée"} ·{" "}
                    {current.observation.provenance.source}
                  </span>
                  <span>{definition.status}</span>
                </div>
                <div className="form-actions">
                  <button
                    className="button secondary"
                    onClick={() => openEdit(goal)}
                    disabled={busy}
                  >
                    <Edit3 size={14} /> Versionner
                  </button>
                  {definition.status === "PAUSED" ? (
                    <button
                      className="button secondary"
                      onClick={() => setStatus(goal, "ACTIVE")}
                      disabled={busy}
                    >
                      <Play size={14} /> Reprendre
                    </button>
                  ) : (
                    <button
                      className="button secondary"
                      onClick={() => setStatus(goal, "PAUSED")}
                      disabled={busy}
                    >
                      <Pause size={14} /> Pause
                    </button>
                  )}
                  <button
                    className="button secondary"
                    onClick={() => setStatus(goal, "ARCHIVED")}
                    disabled={busy}
                  >
                    <Archive size={14} /> Archiver
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="Aucun objectif actif"
          detail="Créez une intention mesurable. Elle sera versionnée puis évaluée sans figer de résultat calculé."
          action={
            <button className="button primary" onClick={openCreate}>
              <Plus size={15} /> Nouvel objectif
            </button>
          }
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? "Nouvelle version de l’objectif" : "Créer un objectif"}
        subtitle="La définition est persistée ; les évaluations restent dérivées."
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        wide
      >
        <form className="form-grid" onSubmit={submit}>
          <label className="full">
            Nom
            <input
              required
              maxLength={160}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="full">
            Description
            <textarea
              maxLength={1000}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>
          <label>
            Métrique fermée
            <select
              value={form.metric}
              onChange={(event) => setMetric(event.target.value as GoalTargetMetric)}
            >
              {GOAL_TARGET_METRICS.map((metric) => (
                <option key={metric} value={metric}>
                  {GOAL_METRIC_REGISTRY[metric].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Opérateur
            <select
              value={form.operator}
              onChange={(event) =>
                setForm({ ...form, operator: event.target.value as GoalTargetOperator })
              }
            >
              {metricDefinition.allowedOperators.map((operator) => (
                <option key={operator} value={operator}>
                  {operatorLabel(operator)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cible ({state.reportingCurrency})
            <input
              required
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.targetValue}
              onChange={(event) => setForm({ ...form, targetValue: event.target.value })}
            />
          </label>
          <label>
            Deadline (optionnelle)
            <input
              type="date"
              value={form.targetDate}
              onChange={(event) => setForm({ ...form, targetDate: event.target.value })}
            />
          </label>
          <label>
            Priorité (1–99)
            <input
              required
              type="number"
              min="1"
              max="99"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            />
          </label>
          <label>
            Force de contrainte
            <select
              value={form.constraintStrength}
              onChange={(event) =>
                setForm({
                  ...form,
                  constraintStrength: event.target.value as GoalConstraintStrength,
                })
              }
            >
              {GOAL_CONSTRAINT_STRENGTHS.map((strength) => (
                <option key={strength}>{strength}</option>
              ))}
            </select>
          </label>
          {entityTarget ? (
            <label className="full">
              {entityTarget.label}
              <select
                required={entityTarget.required}
                value={form.entityId}
                onChange={(event) => setForm({ ...form, entityId: event.target.value })}
              >
                <option value="">{entityTarget.placeholder}</option>
                {entityTarget.options.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="form-notice full">
            Source courante : {metricDefinition.source}. Projection{" "}
            {metricDefinition.supportsProjected ? "disponible" : "non disponible"} dans Scenarios V2
            ; aucune métrique voisine ne sera substituée.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Annuler
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={15} /> {editing ? "Créer la version" : "Créer"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default GoalsPage;
