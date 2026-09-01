"use client";

import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { Callout, Currency, MetricCard, ProgressBar, SectionHeader } from "@/components/ui";
import { type SectionProps, formatDate } from "@/components/pages/shared";
import { buildTodayCockpit } from "@/lib/presentation/today-cockpit";

export default function TodayPage({ state, mutate, busy }: SectionProps) {
  const view = buildTodayCockpit(state);
  const goal = view.primaryGoal;
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow={`${formatDate(view.context.asOfDate)} · ${view.context.reportingCurrency}`}
        title="Today"
        description="Votre situation, le changement observé et la prochaine décision — issus du contexte financier partagé."
        actions={
          <button
            className="button primary"
            disabled={busy}
            onClick={() => mutate({ action: "create_monthly_close", closeDate: state.asOfDate })}
          >
            <CalendarCheck size={16} />
            Clôturer le mois
          </button>
        }
      />
      <div className="uncertainty-strip" aria-label="Provenance des données">
        {(
          [
            "ACTUAL",
            "OBSERVED",
            "CONTRACTUAL",
            "PROJECTED",
            "USER_ASSUMPTION",
            "MODEL_ASSUMPTION",
          ] as const
        ).map((kind) => (
          <span key={kind} className={`data-badge ${kind.toLowerCase()}`}>
            {kind.replaceAll("_", " ")}
          </span>
        ))}
        <span className="completeness">
          <strong>{view.context.completeness}</strong> · fingerprint{" "}
          {view.context.baseline.eventSetVersion.slice(0, 10)}
        </span>
      </div>
      <section className="metrics-grid four" aria-label="Situation actuelle">
        <MetricCard
          label="Patrimoine net"
          value={<Currency value={view.netWorth} />}
          detail="Bilan canonique · observation"
        />
        <MetricCard
          label="Liquidité"
          value={<Currency value={view.liquidity} />}
          detail="Actifs liquides identifiés · observation"
        />
        <MetricCard
          label="Cash flow mensuel"
          value={<Currency value={view.cashFlow} sign />}
          detail="Flux déclarés · inconnu ≠ zéro"
        />
        <MetricCard
          label="Dette"
          value={<Currency value={view.debt} />}
          detail="Passifs du bilan canonique"
        />
      </section>
      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Changement fiable</span>
              <h2>Depuis la clôture précédente</h2>
            </div>
          </div>
          {view.closeChange ? (
            <>
              <div className="metric-value">
                <Currency value={view.closeChange.amount} sign />
              </div>
              <p>
                {formatDate(view.closeChange.from.closeDate)} →{" "}
                {formatDate(view.closeChange.to.closeDate)} · deux observations clôturées
              </p>
            </>
          ) : (
            <Callout title="Variation non calculable">
              Deux clôtures fiables sont nécessaires ; aucune valeur zéro n’est substituée.
            </Callout>
          )}
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Goal prioritaire</span>
              <h2>{goal?.goal.name ?? "Aucun Goal actif"}</h2>
            </div>
          </div>
          {goal ? (
            <>
              <p>
                Priorité {goal.goal.definition?.priority ?? goal.goal.priority} · statut{" "}
                {goal.evaluation?.status ?? "NOT_COMPUTABLE"}
              </p>
              <ProgressBar
                value={
                  goal.evaluation?.gap?.relativeGap === null ||
                  goal.evaluation?.gap?.relativeGap === undefined
                    ? 0
                    : Math.max(0, 1 - Math.abs(goal.evaluation.gap.relativeGap))
                }
              />
              <Link className="button secondary" href="/goals">
                Ouvrir Goals
              </Link>
            </>
          ) : (
            <Link className="button secondary" href="/goals">
              Définir un Goal
            </Link>
          )}
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Prochaine échéance tous domaines</span>
              <h2>{view.nextEvent?.type.replaceAll("_", " ") ?? "Aucun événement"}</h2>
            </div>
          </div>
          <p>
            {view.nextEvent
              ? `${formatDate(view.nextEvent.effectiveDate)} · ${view.nextEvent.domain} · ${view.nextEvent.dataKind}`
              : "Aucune échéance canonique dans l’horizon explicite de 80 ans."}
          </p>
          <Link className="button secondary" href="/timeline">
            Voir la Timeline
          </Link>
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Risque principal</span>
              <h2>{view.context.blockers[0]?.code ?? "Aucun blocker"}</h2>
            </div>
          </div>
          <p>
            {view.context.blockers[0]?.message ?? "Le contexte partagé ne signale pas de blocker."}
          </p>
        </article>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Attention maintenant</span>
            <h2>Actions déterministes</h2>
          </div>
        </div>
        <div className="quick-actions">
          {view.actions.map((action) => (
            <Link key={action.id} className="button secondary" href={action.href}>
              {action.label}
            </Link>
          ))}
        </div>
        <p>
          {view.decisions.length
            ? `${view.decisions.length} décision(s) ouverte(s) ou récemment évaluée(s).`
            : "Aucun Decision Case ouvert."}{" "}
          <Link href="/decision-lab">Ouvrir Decision Lab</Link>
        </p>
      </section>
    </div>
  );
}
