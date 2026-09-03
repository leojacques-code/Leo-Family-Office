import { orderedCloses, historicalCurrency, historicalBlockers } from "./historical-closes";
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
  currency: string | null;
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

export interface TimelineGroup {
  effectiveDate: string;
  items: TimelineItem[];
}

function zoneOf(effectiveDate: string, asOfDate: string): TimelineZone {
  return effectiveDate < asOfDate ? "PAST" : effectiveDate === asOfDate ? "TODAY" : "FUTURE";
}

/** Un net cash n'existe que si toutes ses composantes incluses sont connues et homogènes. */
export function eventAmount(event: CanonicalEvent): {
  value: number | null;
  known: boolean;
  currency: string | null;
} {
  const consequences = event.consequences.filter((item) => item.included);
  if (!consequences.length) return { value: null, known: false, currency: null };
  const currencies = [...new Set(consequences.map((item) => item.currency))];
  if (
    currencies.length !== 1 ||
    consequences.some((item) => item.cashIn === null || item.cashOut === null)
  ) {
    return { value: null, known: false, currency: currencies.length === 1 ? currencies[0]! : null };
  }
  return {
    value: consequences.reduce((sum, item) => sum + item.cashIn! - item.cashOut!, 0),
    known: true,
    currency: currencies[0]!,
  };
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
        zone: zoneOf(event.effectiveDate, context.asOfDate),
        eventDate: event.eventDate,
        effectiveDate: event.effectiveDate,
        domain: event.domain,
        nature: event.dataKind,
        status: event.status,
        title: event.type.replaceAll("_", " "),
        amount: amount.value,
        amountKnown: amount.known,
        currency: amount.currency,
        blockers: [
          ...new Set([...event.blockers, ...event.consequences.flatMap((item) => item.blockers)]),
        ].sort(),
        conflict: conflicted.has(event.id),
        href: OWNER_LINK[event.domain],
        provenance: event.provenance.source ?? event.provenance.engine,
      };
    });
  const closes: TimelineItem[] = orderedCloses(state.monthlyCloses).map((close) => ({
    id: `close:${close.id}`,
    zone: zoneOf(close.closeDate, context.asOfDate),
    eventDate: close.closeDate,
    effectiveDate: close.closeDate,
    domain: "SYSTEM",
    nature: "ACTUAL",
    status: "COMPLETED",
    title: "Clôture patrimoniale",
    amount: close.netWorth,
    amountKnown: close.netWorth !== null,
    currency: historicalCurrency(close),
    blockers: historicalBlockers([close]).filter((x) => x !== "SINGLE_CLOSE_POINT_IN_TIME_ONLY"),
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
              zone: zoneOf(date, context.asOfDate),
              eventDate: date,
              effectiveDate: date,
              domain: "GOALS" as const,
              nature: "USER_ASSUMPTION" as const,
              status: goal.status,
              title: `Échéance Goal · ${goal.name}`,
              amount: goal.definition?.target.value ?? goal.targetAmount,
              amountKnown: true,
              currency: goal.definition?.target.currency ?? state.reportingCurrency,
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

export function groupTimelineItems(items: TimelineItem[]): TimelineGroup[] {
  const groups = new Map<string, TimelineItem[]>();
  for (const item of items)
    groups.set(item.effectiveDate, [...(groups.get(item.effectiveDate) ?? []), item]);
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([effectiveDate, grouped]) => ({ effectiveDate, items: grouped }));
}

export function timelineWindow(groups: TimelineGroup[], offset: number, size: number) {
  const safeSize = Math.max(1, Math.floor(size));
  const safeOffset = Math.min(
    Math.max(0, Math.floor(offset)),
    Math.max(0, groups.length - safeSize),
  );
  return {
    groups: groups.slice(safeOffset, safeOffset + safeSize),
    offset: safeOffset,
    totalGroups: groups.length,
  };
}
