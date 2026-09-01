import type { CanonicalDataKind, CanonicalEvent, EventDomain } from "@/lib/engine/event-contracts";
import type { GlobalFinancialContext } from "@/lib/engine/global-financial-model";
import type { DashboardState } from "@/lib/types";
import type { TodayCockpit } from "@/lib/presentation/today-cockpit";

export type TimelineZone = "PAST" | "TODAY" | "FUTURE";
export interface TimelineItem {
  id: string;
  zone: TimelineZone;
  eventDate: string;
  effectiveDate: string;
  domain: EventDomain | "GOALS" | "SYSTEM";
  nature: CanonicalDataKind | "ACTUAL";
  status: string;
  title: string;
  amount: number | null;
  amountKnown: boolean;
  blockers: string[];
  conflict: boolean;
  href: string;
  provenance: string;
}

const OWNER_LINK: Record<EventDomain, string> = {
  CAREER: "/career",
  TAX: "/tax",
  DEBT: "/debt",
  CASH_FLOW: "/cash-flow",
  PORTFOLIO: "/investments",
  REAL_ESTATE: "/real-estate",
  BUSINESS: "/business-equity",
  PERSONAL: "/timeline",
};

function eventAmount(event: CanonicalEvent): { value: number | null; known: boolean } {
  if (!event.consequences.length) return { value: null, known: false };
  const values = event.consequences
    .flatMap((item) => [item.cashIn, item.cashOut === null ? null : -item.cashOut])
    .filter((value): value is number => value !== null);
  return values.length
    ? { value: values.reduce((sum, value) => sum + value, 0), known: true }
    : { value: null, known: false };
}

export function buildTimelineView(state: DashboardState, cockpit: TodayCockpit): TimelineItem[] {
  const context: GlobalFinancialContext = cockpit.context;
  const conflicted = new Set(context.timeline.conflicts.flatMap((item) => item.eventIds));
  const events: TimelineItem[] = context.timeline.events
    .filter(
      (event) =>
        event.status !== "CANCELLED" && event.status !== "SUPERSEDED" && event.scenarioId === null,
    )
    .map((event) => {
      const amount = eventAmount(event);
      return {
        id: event.id,
        zone:
          event.dataKind === "OBSERVED" && event.effectiveDate < context.asOfDate
            ? "PAST"
            : event.effectiveDate <= context.asOfDate
              ? "TODAY"
              : "FUTURE",
        eventDate: event.eventDate,
        effectiveDate: event.effectiveDate,
        domain: event.domain,
        nature: event.dataKind,
        status: event.status,
        title: event.type.replaceAll("_", " "),
        amount: amount.value,
        amountKnown: amount.known,
        blockers: [
          ...new Set([...event.blockers, ...event.consequences.flatMap((item) => item.blockers)]),
        ].sort(),
        conflict: conflicted.has(event.id),
        href: OWNER_LINK[event.domain],
        provenance: event.provenance.source ?? event.provenance.engine,
      };
    });
  const closes: TimelineItem[] = state.monthlyCloses.map((close) => ({
    id: `close:${close.id}`,
    zone: close.closeDate < context.asOfDate ? "PAST" : "TODAY",
    eventDate: close.closeDate,
    effectiveDate: close.closeDate,
    domain: "SYSTEM",
    nature: "ACTUAL",
    status: "COMPLETED",
    title: "Clôture patrimoniale",
    amount: close.netWorth,
    amountKnown: true,
    blockers: [],
    conflict: false,
    href: "/net-worth",
    provenance: "Monthly close",
  }));
  const goals: TimelineItem[] = state.goals
    .filter((goal) => goal.status === "ACTIVE")
    .flatMap((goal) => {
      const date = goal.definition?.targetDate ?? goal.targetDate;
      return date
        ? [
            {
              id: `goal:${goal.id}`,
              zone: date < context.asOfDate ? ("PAST" as const) : ("FUTURE" as const),
              eventDate: date,
              effectiveDate: date,
              domain: "GOALS" as const,
              nature: "USER_ASSUMPTION" as const,
              status: goal.status,
              title: `Échéance Goal · ${goal.name}`,
              amount: goal.definition?.target.value ?? goal.targetAmount,
              amountKnown: true,
              blockers: [],
              conflict: false,
              href: "/goals",
              provenance: "Goals V2",
            },
          ]
        : [];
    });
  return [...events, ...closes, ...goals].sort(
    (a, b) =>
      a.effectiveDate.localeCompare(b.effectiveDate) ||
      a.eventDate.localeCompare(b.eventDate) ||
      a.domain.localeCompare(b.domain) ||
      a.id.localeCompare(b.id),
  );
}
