"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { Callout, EmptyState, SectionHeader } from "@/components/ui";
import { type SectionProps, formatDate, formatNative } from "@/components/pages/shared";
import { buildTodayCockpit } from "@/lib/presentation/today-cockpit";
import {
  buildTimelineView,
  groupTimelineItems,
  timelineWindow,
  type TimelineZone,
} from "@/lib/presentation/timeline-view";

const ZONES: Array<{ id: TimelineZone; title: string; detail: string }> = [
  { id: "PAST", title: "Passé", detail: "Faits et anciennes attentes, nature d’origine conservée" },
  { id: "TODAY", title: "Aujourd’hui", detail: "Date zéro et snapshot canonique" },
  { id: "FUTURE", title: "Futur", detail: "Contrats, projections et hypothèses identifiées" },
];

export default function TimelinePage({ state, mutate, busy }: SectionProps) {
  const cockpit = useMemo(() => buildTodayCockpit(state), [state]);
  const items = useMemo(() => buildTimelineView(state, cockpit), [state, cockpit]);
  const [domain, setDomain] = useState("ALL");
  const [nature, setNature] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [visibleGroups, setVisibleGroups] = useState<Record<TimelineZone, number>>({
    PAST: 12,
    TODAY: 12,
    FUTURE: 12,
  });
  const [groupOffset, setGroupOffset] = useState<Record<TimelineZone, number>>({
    PAST: 0,
    TODAY: 0,
    FUTURE: 0,
  });
  const filtered = items.filter(
    (item) =>
      (domain === "ALL" || item.domain === domain) &&
      (nature === "ALL" || item.nature === nature) &&
      (status === "ALL" || item.status === status),
  );
  function resetWindows() {
    setGroupOffset({ PAST: 0, TODAY: 0, FUTURE: 0 });
    setVisibleGroups({ PAST: 12, TODAY: 12, FUTURE: 12 });
  }
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
            <select
              value={domain}
              onChange={(event) => {
                setDomain(event.target.value);
                resetWindows();
              }}
            >
              <option value="ALL">Tous</option>
              {[...new Set(items.map((item) => item.domain))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Nature
            <select
              value={nature}
              onChange={(event) => {
                setNature(event.target.value);
                resetWindows();
              }}
            >
              <option value="ALL">Toutes</option>
              {[...new Set(items.map((item) => item.nature))].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Statut
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                resetWindows();
              }}
            >
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
        const groups = groupTimelineItems(rows);
        const window = timelineWindow(groups, groupOffset[zone.id], visibleGroups[zone.id]);
        const shown = window.groups;
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
              <>
                <p className="muted-copy">
                  {shown.reduce((sum, group) => sum + group.items.length, 0)} élément(s) visible(s)
                  sur {rows.length} · {shown.length} date(s) sur {groups.length}
                </p>
                <div className="full-timeline">
                  {shown.map((group) => (
                    <div key={group.effectiveDate} className="timeline-date-group">
                      <div className="timeline-date">{formatDate(group.effectiveDate)}</div>
                      <i />
                      <div>
                        <h3>{group.items.length} événement(s)</h3>
                        {group.items.map((item) => (
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
                            <div>
                              <span>
                                {item.nature} · {item.domain} · {item.status}
                              </span>
                              <h3>{item.title}</h3>
                              <p>
                                Événement {formatDate(item.eventDate)} · effet{" "}
                                {formatDate(item.effectiveDate)} ·{" "}
                                {item.amountKnown && item.amount !== null && item.currency
                                  ? formatNative(item.amount, item.currency)
                                  : "montant non calculable"}{" "}
                                · source {item.provenance}
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
                    </div>
                  ))}
                </div>
                {window.offset > 0 || window.offset + shown.length < groups.length ? (
                  <div className="quick-actions">
                    {window.offset > 0 ? (
                      <button
                        className="button secondary"
                        onClick={() => {
                          setGroupOffset((current) => ({ ...current, [zone.id]: 0 }));
                          setVisibleGroups((current) => ({ ...current, [zone.id]: 12 }));
                        }}
                      >
                        Revenir aux événements les plus proches
                      </button>
                    ) : null}
                    {window.offset + shown.length < groups.length ? (
                      <>
                        <button
                          className="button secondary"
                          onClick={() =>
                            setVisibleGroups((current) => ({
                              ...current,
                              [zone.id]: current[zone.id] + 12,
                            }))
                          }
                        >
                          Afficher 12 dates de plus
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => {
                            const last = timelineWindow(groups, groups.length, 12);
                            setGroupOffset((current) => ({
                              ...current,
                              [zone.id]: last.offset,
                            }));
                            setVisibleGroups((current) => ({ ...current, [zone.id]: 12 }));
                          }}
                        >
                          Aller aux événements les plus lointains
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
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
