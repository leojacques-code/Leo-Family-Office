"use client";

import { CalendarCheck } from "lucide-react";
import { Callout, Currency, EmptyState, SectionHeader } from "@/components/ui";
import type { SectionProps } from "@/components/pages/shared";

function TimelinePage({ state, mutate, busy }: SectionProps) {
  const events = [
    {
      date: "19 août 2026",
      kind: "Actual",
      title: "Date zéro",
      detail: `Patrimoine net identifié ${new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(state.metrics.netWorth)}`,
      tone: "actual",
    },
    {
      date: "5 décembre 2026",
      kind: "Contractuel",
      title: "Première échéance étudiant",
      detail: "284,72 € annoncés",
      tone: "warning",
    },
    {
      date: "2027",
      kind: "Hypothèse",
      title: "Premier CDI principal",
      detail: "40–45 k€ fixe brut + variable",
      tone: "model",
    },
    {
      date: "~ 2029",
      kind: "Scénario",
      title: "Tentative de passage M&A → PE",
      detail: "Après environ deux ans, sans certitude",
      tone: "model",
    },
    {
      date: "5 novembre 2031",
      kind: "Prévision",
      title: "Dernière échéance étudiant",
      detail: "Sous réserve de l’échéancier réel",
      tone: "warning",
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
            Clôturer août 2026
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
