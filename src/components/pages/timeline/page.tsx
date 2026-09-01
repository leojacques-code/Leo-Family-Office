"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { Callout, Currency, EmptyState, SectionHeader } from "@/components/ui";
import { type SectionProps, formatDate } from "@/components/pages/shared";
import { buildTodayCockpit } from "@/lib/presentation/today-cockpit";
import { buildTimelineView, type TimelineZone } from "@/lib/presentation/timeline-view";

const ZONES: Array<{ id: TimelineZone; title: string; detail: string }> = [
  { id: "PAST", title: "Passé observé", detail: "Clôtures et événements observés" },
  { id: "TODAY", title: "Aujourd’hui", detail: "Date zéro et snapshot canonique" },
  { id: "FUTURE", title: "Futur", detail: "Contrats, projections et hypothèses identifiées" },
];

export default function TimelinePage({ state, mutate, busy }: SectionProps) {
  const cockpit = useMemo(() => buildTodayCockpit(state), [state]);
  const items = useMemo(() => buildTimelineView(state, cockpit), [state, cockpit]);
  const [domain, setDomain] = useState("ALL");
  const [nature, setNature] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const filtered = items.filter(
    (item) =>
      (domain === "ALL" || item.domain === domain) &&
      (nature === "ALL" || item.nature === nature) &&
      (status === "ALL" || item.status === status),
  );
  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow={`${formatDate(cockpit.context.asOfDate)} → ${formatDate(cockpit.context.endDate)}`}
        title="Timeline V2"
        description="Horizon explicite de 80 ans · Event Engine canonique · dates d’événement et d’effet conservées."
        actions={
          <button
            className="button primary"
            disabled={busy}
            onClick={() => mutate({ action: "create_monthly_close", closeDate: state.asOfDate })}
          >
            <CalendarCheck size={15} />
            Clôturer
          </button>
        }
      />
      <section className="panel">
        <div className="form-grid three" aria-label="Filtres Timeline">
          <label>
            Domaine
            <select value={domain} onChange={(event) => setDomain(event.target.value)}>
              <option value="ALL">Tous</option>
              {[...new Set(items.map((item) => item.domain))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Nature
            <select value={nature} onChange={(event) => setNature(event.target.value)}>
              <option value="ALL">Toutes</option>
              {[...new Set(items.map((item) => item.nature))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Statut
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ALL">Tous</option>
              {[...new Set(items.map((item) => item.status))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {ZONES.map((zone) => {
        const rows = filtered.filter((item) => item.zone === zone.id);
        return (
          <section className="panel" key={zone.id} aria-labelledby={`zone-${zone.id}`}>
            <div className="panel-header">
              <div>
                <span className="eyebrow">{zone.detail}</span>
                <h2 id={`zone-${zone.id}`}>{zone.title}</h2>
              </div>
            </div>
            {zone.id === "TODAY" && (
              <Callout
                title={`${cockpit.context.completeness} · ${cockpit.context.reportingCurrency}`}
              >
                Patrimoine net :{" "}
                {cockpit.netWorth === null
                  ? "non calculable"
                  : cockpit.netWorth.toLocaleString("fr-FR")}{" "}
                · Goal : {cockpit.primaryGoal?.goal.name ?? "aucun"} ·{" "}
                {cockpit.context.blockers.length} blocker(s).
              </Callout>
            )}
            {rows.length ? (
              <div className="full-timeline">
                {rows.map((item) => (
                  <div
                    key={item.id}
                    className={
                      item.conflict || item.blockers.length
                        ? "warning"
                        : item.nature === "PROJECTED" || item.nature.includes("ASSUMPTION")
                          ? "model"
                          : "actual"
                    }
                  >
                    <div className="timeline-date">{formatDate(item.effectiveDate)}</div>
                    <i />
                    <div>
                      <span>
                        {item.nature} · {item.domain} · {item.status}
                      </span>
                      <h3>{item.title}</h3>
                      <p>
                        Événement {formatDate(item.eventDate)} · effet{" "}
                        {formatDate(item.effectiveDate)} ·{" "}
                        {item.amountKnown ? <Currency value={item.amount} /> : "sans montant"} ·
                        source {item.provenance}
                      </p>
                      {(item.conflict || item.blockers.length > 0) && (
                        <p className="warning-text">
                          {item.conflict ? "Conflit Event Engine. " : ""}
                          {item.blockers.join(", ") || "À arbitrer"}
                        </p>
                      )}
                      <Link href={item.href}>Ouvrir le domaine propriétaire</Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Aucun élément"
                detail="Aucun fait canonique ne correspond à cette zone et aux filtres actifs."
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
