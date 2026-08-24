"use client";

import { CalendarCheck } from "lucide-react";
import { Callout, Currency, EmptyState, SectionHeader } from "@/components/ui";
import { type SectionProps, formatDate, formatEur } from "@/components/pages/shared";
import { buildLoanSchedules } from "@/lib/engine/debt";

function TimelinePage({ state, mutate, busy }: SectionProps) {
  // Les jalons de dette viennent de l'échéancier dérivé : un passif modifié déplace
  // immédiatement ces événements.
  const debtMilestones = buildLoanSchedules(state.liabilities).flatMap((schedule) => {
    const liability = state.liabilities.find((item) => item.id === schedule.liabilityId);
    const first = schedule.entries[0];
    const last = schedule.entries.at(-1);
    if (!liability || !first || !last) return [];
    return [
      {
        date: formatDate(first.dueDate),
        kind: "Contractuel",
        title: `Première échéance · ${liability.name}`,
        detail: `${formatEur(first.totalCashOut)} exigibles`,
        tone: "warning",
      },
      {
        date: formatDate(last.dueDate),
        kind: "Prévision",
        title: `Dernière échéance · ${liability.name}`,
        detail: "Échéancier dérivé, sous réserve du document bancaire",
        tone: "warning",
      },
    ];
  });
  const events = [
    {
      date: formatDate(state.asOfDate),
      kind: "Actual",
      title: "Date zéro",
      detail: `Patrimoine net identifié ${formatEur(state.metrics.netWorth)}`,
      tone: "actual",
    },
    ...debtMilestones,
    {
      date: String(Number(state.asOfDate.slice(0, 4)) + 1),
      kind: "Hypothèse",
      title: "Premier CDI principal",
      detail: "40–45 k€ fixe brut + variable",
      tone: "model",
    },
    {
      date: `~ ${Number(state.asOfDate.slice(0, 4)) + 3}`,
      kind: "Scénario",
      title: "Tentative de passage M&A → PE",
      detail: "Après environ deux ans, sans certitude",
      tone: "model",
    },
  ];
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="History & future"
        title="Timeline"
        description="Clôtures mensuelles observées et événements futurs clairement distingués."
        actions={
          <button
            className="button primary"
            disabled={busy}
            onClick={() => mutate({ action: "create_monthly_close", closeDate: state.asOfDate })}
          >
            <CalendarCheck size={15} />
            Clôturer {formatDate(state.asOfDate, { month: "long", year: "numeric" })}
          </button>
        }
      />
      <section className="timeline-layout">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Événements</span>
              <h2>Trajectoire patrimoniale</h2>
            </div>
          </div>
          <div className="full-timeline">
            {events.map((event) => (
              <div key={event.title} className={event.tone}>
                <div className="timeline-date">{event.date}</div>
                <i />
                <div>
                  <span>{event.kind}</span>
                  <h3>{event.title}</h3>
                  <p>{event.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
        <aside className="results-stack">
          <article className="panel">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Monthly close</span>
                <h2>Clôtures figées</h2>
              </div>
            </div>
            {state.monthlyCloses.length ? (
              <div className="close-list">
                {state.monthlyCloses.map((close) => (
                  <div key={close.id}>
                    <span>
                      <strong>
                        {new Date(close.closeDate).toLocaleDateString("fr-FR", {
                          month: "long",
                          year: "numeric",
                        })}
                      </strong>
                      <small>Snapshot actual</small>
                    </span>
                    <strong>
                      <Currency value={close.netWorth} />
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Aucune clôture"
                detail="Clôturer août figera soldes, positions, dette et patrimoine net."
              />
            )}
          </article>
          <Callout title="Écart réel vs prévu">
            À partir de la deuxième clôture, le cockpit conservera l’écart avec la prévision
            précédente.
          </Callout>
        </aside>
      </section>
    </div>
  );
}

export default TimelinePage;
