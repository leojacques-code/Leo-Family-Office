"use client";

import { useMemo, useState } from "react";
import { GitCompareArrows, Play, Save } from "lucide-react";
import { createDecisionCaseVersion, createDecisionOption } from "@/lib/engine/decision-lab";
import type { DecisionEvaluation, DecisionMetricSnapshot } from "@/lib/engine/decision-contracts";
import {
  buildGlobalFinancialContext,
  evaluateGlobalDecisionCase,
} from "@/lib/engine/global-financial-model";
import { Callout, Currency, EmptyState, SectionHeader } from "@/components/ui";
import {
  NOT_COMPUTABLE,
  OptionalCurrency,
  type SectionProps,
  formatDate,
} from "@/components/pages/shared";

const METRICS: Array<[keyof Omit<DecisionMetricSnapshot, "date">, string]> = [
  ["netWorth", "Patrimoine net"],
  ["liquidNetWorth", "Patrimoine net liquide"],
  ["cash", "Cash"],
  ["debt", "Dette"],
  ["investmentAssets", "Investissements"],
  ["realEstateAndBusinessAssets", "Immobilier + business"],
  ["fundingGap", "Funding gap"],
  ["income", "Revenus du mois terminal"],
  ["expenses", "Dépenses du mois terminal"],
  ["taxes", "Taxes du mois terminal"],
];

const STATUS_LABEL: Record<string, string> = {
  READY: "Prêt",
  PARTIAL: "Partiel",
  NOT_COMPUTABLE: "Non calculable",
  DOMINANT_OPTION: "Option dominante objectivement démontrée",
  NO_UNIQUE_WINNER: "Aucun vainqueur unique",
  TRADE_OFF: "Arbitrage multi-objectifs",
  INCOMPARABLE: "Trajectoires incomparables",
};

function metricValue(value: number | null) {
  return value === null ? (
    <span className="warning-text">{NOT_COMPUTABLE}</span>
  ) : (
    <Currency value={value} />
  );
}

function GoalCell({
  result,
}: {
  result: DecisionEvaluation["options"][number]["goalImpacts"][number];
}) {
  const evaluation = result.option;
  return (
    <div>
      <strong>{evaluation.status}</strong>
      <small className="muted-copy">
        {evaluation.projectedValueAtTargetDate === null ? (
          NOT_COMPUTABLE
        ) : (
          <>
            <Currency value={evaluation.projectedValueAtTargetDate} /> · gap{" "}
            <OptionalCurrency value={evaluation.projectedGapAtTargetDate?.shortfall ?? null} />
          </>
        )}
        {evaluation.firstProjectedAttainmentDate
          ? ` · première atteinte ${formatDate(evaluation.firstProjectedAttainmentDate)}`
          : ""}
      </small>
    </div>
  );
}

export default function DecisionLabPage({ state, mutate, busy }: SectionProps) {
  const availableScenarios = useMemo(
    () => state.scenarios.filter((scenario) => scenario.definition),
    [state.scenarios],
  );
  const availableGoals = useMemo(
    () => state.goals.filter((goal) => goal.definition && goal.status === "ACTIVE"),
    [state.goals],
  );
  const [name, setName] = useState("Comparaison de scénarios");
  const [scenarioIds, setScenarioIds] = useState<string[]>(() =>
    availableScenarios.slice(0, 2).map((scenario) => scenario.id),
  );
  const [goalIds, setGoalIds] = useState<string[]>(() =>
    availableGoals.slice(0, 3).map((goal) => goal.id),
  );
  const [result, setResult] = useState<DecisionEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggleScenario = (id: string) => {
    setSaved(false);
    setScenarioIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < 3
          ? [...current, id]
          : current,
    );
  };

  const toggleGoal = (id: string) => {
    setSaved(false);
    setGoalIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const buildEvaluation = () => {
    const chosenScenarios = scenarioIds
      .map((id) => availableScenarios.find((scenario) => scenario.id === id))
      .filter((scenario) => scenario?.definition);
    if (chosenScenarios.length < 2 || chosenScenarios.length > 3)
      throw new Error("Sélectionnez deux ou trois scénarios V2.");

    const caseId = crypto.randomUUID();
    const options = chosenScenarios.map((scenario, index) =>
      createDecisionOption({
        id: `OPTION_${String.fromCharCode(65 + index)}`,
        name: scenario!.name,
        description: scenario!.description,
        definition: scenario!.definition!,
        source: `${scenario!.name} · Scenarios V2`,
      }),
    );
    const selectedGoals = goalIds
      .map((id) => availableGoals.find((goal) => goal.id === id))
      .filter((goal) => goal?.definition)
      .map((goal) => ({
        goalId: goal!.id,
        goalVersion: goal!.definition!.version,
        constraintStrength: goal!.definition!.constraintStrength,
        definition: goal!.definition!,
      }));
    const firstDefinition = chosenScenarios[0]!.definition!;
    const context = buildGlobalFinancialContext(state, firstDefinition.horizonMonths);
    const caseVersion = createDecisionCaseVersion({
      caseId,
      name,
      description: "Comparaison canonique de trajectoires Scenarios V2 contre les mêmes Goals V2.",
      status: "DRAFT",
      opening: context.opening,
      baselineEvents: context.timeline.events,
      options,
      selectedGoals,
    });
    return evaluateGlobalDecisionCase(state, caseVersion).evaluation;
  };

  const run = () => {
    try {
      setError(null);
      setSaved(false);
      setResult(buildEvaluation());
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const save = async () => {
    try {
      setError(null);
      const evaluation = result ?? buildEvaluation();
      setResult(evaluation);
      const created = await mutate({
        action: "create_decision_case_v2",
        definition: evaluation.caseVersion,
      });
      if (!created) return;
      const runSaved = await mutate({
        action: "save_decision_run_v2",
        caseId: evaluation.caseVersion.caseId,
        caseVersion: evaluation.caseVersion.version,
        run: evaluation.run,
        result: evaluation,
      });
      setSaved(runSaved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (availableScenarios.length < 2) {
    return (
      <div className="page-stack">
        <SectionHeader
          eyebrow="Decision comparison"
          title="Decision Lab"
          description="Comparer des trajectoires Scenarios V2 contre les mêmes Goals V2."
        />
        <EmptyState
          title="Deux scénarios V2 sont nécessaires"
          detail="Créez ou activez un second scénario avant de lancer une comparaison canonique."
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Decision comparison"
        title="Decision Lab"
        description="Comparer les conséquences et arbitrages de deux ou trois trajectoires Scenarios V2. Aucun score opaque, aucune recommandation automatique."
        actions={
          <>
            <button
              className="button secondary"
              onClick={run}
              disabled={busy || scenarioIds.length < 2}
            >
              <Play size={15} /> Lancer
            </button>
            <button className="button" onClick={save} disabled={busy || scenarioIds.length < 2}>
              <Save size={15} /> Lancer et enregistrer
            </button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Decision case</span>
            <h2>Question et périmètre commun</h2>
          </div>
          <GitCompareArrows size={22} />
        </div>
        <label>
          <span>Nom du cas</span>
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="muted-copy">
          Baseline canonique au {formatDate(state.asOfDate)} · devise {state.reportingCurrency} ·
          horizon et méthodologie imposés par les versions sélectionnées.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Options</span>
            <h2>Deux ou trois scénarios exacts</h2>
          </div>
          <strong>{scenarioIds.length}/3</strong>
        </div>
        <div className="decision-case-strip">
          {availableScenarios.map((scenario) => (
            <button
              key={scenario.id}
              className={scenarioIds.includes(scenario.id) ? "active" : ""}
              onClick={() => toggleScenario(scenario.id)}
            >
              {scenario.name}
              <span>
                v{scenario.definition!.version} · {scenario.definition!.overrides.length}{" "}
                événement(s) différent(s)
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Goals V2</span>
            <h2>Objectifs communs à toutes les options</h2>
          </div>
        </div>
        {availableGoals.length ? (
          <div className="decision-case-strip">
            {availableGoals.map((goal) => (
              <button
                key={goal.id}
                className={goalIds.includes(goal.id) ? "active" : ""}
                onClick={() => toggleGoal(goal.id)}
              >
                {goal.name}
                <span>
                  {goal.definition!.constraintStrength} · v{goal.definition!.version}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted-copy">
            Aucun Goal actif. Les trajectoires restent comparables, sans dominance multi-objectifs.
          </p>
        )}
      </section>

      {error ? (
        <Callout tone="warning" title="Comparaison impossible">
          {error}
        </Callout>
      ) : null}
      {saved ? (
        <Callout title="Run enregistré">
          Le Decision Case, sa version et son run immuable ont été enregistrés.
        </Callout>
      ) : null}

      {result ? (
        <>
          <Callout
            tone={result.completeness === "READY" ? "info" : "warning"}
            title={`${STATUS_LABEL[result.completeness] ?? result.completeness} · ${STATUS_LABEL[result.conclusion] ?? result.conclusion}`}
          >
            {result.dominantOptionId
              ? `${result.options.find((item) => item.option.id === result.dominantOptionId)?.option.name} ne dégrade aucun Goal sélectionné, en améliore au moins un et ne crée ni blocker ni funding gap supplémentaire.`
              : "Les arbitrages sont présentés sans choisir à votre place."}
          </Callout>

          <section className="panel table-wrap">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Comparison</span>
                <h2>Métriques à l’horizon</h2>
              </div>
              <span className="muted-copy">{formatDate(result.baseline.date)}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Métrique</th>
                  <th>Baseline</th>
                  {result.options.map((item) => (
                    <th key={item.option.id}>
                      {item.option.name}
                      <small>{item.completeness}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([key, label]) => (
                  <tr key={key}>
                    <td>{label}</td>
                    <td>{metricValue(result.baseline[key])}</td>
                    {result.options.map((item) => (
                      <td key={item.option.id}>
                        {metricValue(item.terminal[key])}
                        <small>
                          Δ <OptionalCurrency value={item.deltaVsBaseline[key]} sign />
                        </small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {result.caseVersion.selectedGoals.length ? (
            <section className="panel table-wrap">
              <div className="panel-header">
                <div>
                  <span className="eyebrow">Goal impact</span>
                  <h2>Conflits HARD / SOFT visibles</h2>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Goal</th>
                    <th>Force</th>
                    {result.options.map((item) => (
                      <th key={item.option.id}>{item.option.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.caseVersion.selectedGoals.map((goal) => (
                    <tr key={goal.goalId}>
                      <td>
                        {goal.definition.name}
                        <small>v{goal.goalVersion}</small>
                      </td>
                      <td>{goal.constraintStrength}</td>
                      {result.options.map((item) => {
                        const impact = item.goalImpacts.find(
                          (candidate) => candidate.goalId === goal.goalId,
                        )!;
                        return (
                          <td key={item.option.id}>
                            <GoalCell result={impact} />
                            <small>
                              {impact.impact}
                              {impact.hardConstraintViolated ? " · HARD VIOLÉ" : ""} · probabilité{" "}
                              {impact.probabilityOfAttainment.status === "COMPUTABLE"
                                ? `${Math.round((impact.probabilityOfAttainment.probability ?? 0) * 100)} %`
                                : NOT_COMPUTABLE}
                            </small>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Trade-offs</span>
                <h2>Avantages, coûts et blockers observables</h2>
              </div>
            </div>
            <div className="decision-results">
              {result.options.map((item) => {
                const tradeOff = result.tradeOffs.find(
                  (candidate) => candidate.optionId === item.option.id,
                )!;
                return (
                  <article className="option-card" key={item.option.id}>
                    <span className="eyebrow">{item.option.id}</span>
                    <h2>{item.option.name}</h2>
                    <dl>
                      <div>
                        <dt>Goals améliorés</dt>
                        <dd>{tradeOff.improvedGoalIds.length || "—"}</dd>
                      </div>
                      <div>
                        <dt>Goals dégradés</dt>
                        <dd>{tradeOff.degradedGoalIds.length || "—"}</dd>
                      </div>
                      <div>
                        <dt>Contraintes HARD violées</dt>
                        <dd>{tradeOff.violatedHardGoalIds.length || "—"}</dd>
                      </div>
                      <div>
                        <dt>Périodes de funding gap</dt>
                        <dd>{item.fundingGapPeriods.length || "—"}</dd>
                      </div>
                      <div>
                        <dt>Blockers</dt>
                        <dd>{tradeOff.newBlockerCodes.join(", ") || "Aucun"}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Provenance</span>
                <h2>Run reproductible</h2>
              </div>
            </div>
            <dl className="loan-facts">
              <div>
                <dt>Baseline fingerprint</dt>
                <dd>{result.run.baselineFingerprint}</dd>
              </div>
              <div>
                <dt>Méthodologie</dt>
                <dd>{result.run.methodologyVersion}</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{result.run.runMode}</dd>
              </div>
              <div>
                <dt>Case version</dt>
                <dd>v{result.run.caseVersion}</dd>
              </div>
              <div>
                <dt>État stale</dt>
                <dd>{result.run.staleStatus}</dd>
              </div>
              <div>
                <dt>Moteurs</dt>
                <dd>{result.options[0]?.provenance.engines.join(" · ")}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : null}
    </div>
  );
}
