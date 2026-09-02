import { buildTodayCockpit, rankGoals } from "@/lib/presentation/today-cockpit";
import { buildTimelineView } from "@/lib/presentation/timeline-view";
import { scenarioCutOffStatus } from "@/lib/presentation/scenario-view";
import {
  evidence,
  insight,
  readableBlockerTitle,
  stableInsightOrder,
} from "@/lib/advisor/advisor-rules";
import type {
  AdvisorAnswer,
  AdvisorInput,
  AdvisorInsight,
  AdvisorIntent,
  AdvisorPacket,
} from "@/lib/advisor/advisor-types";

const fingerprintOf = (opening: string, events: string) => `${opening}:${events}`;
const daysBetween = (from: string, to: string) =>
  Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function buildAdvisorPacket(input: AdvisorInput): AdvisorPacket {
  const cockpit = input.cockpit ?? buildTodayCockpit(input.state);
  const context = input.context ?? cockpit.context;
  const timeline = input.timeline ?? buildTimelineView(input.state, cockpit);
  const fingerprint = fingerprintOf(
    context.baseline.openingFingerprint,
    context.baseline.eventSetVersion,
  );
  const inconsistent =
    cockpit.context.asOfDate !== context.asOfDate ||
    cockpit.context.baseline.openingFingerprint !== context.baseline.openingFingerprint ||
    cockpit.context.baseline.eventSetVersion !== context.baseline.eventSetVersion ||
    (input.expected?.asOfDate !== undefined && input.expected.asOfDate !== context.asOfDate) ||
    (input.expected?.openingFingerprint !== undefined &&
      input.expected.openingFingerprint !== context.baseline.openingFingerprint) ||
    (input.expected?.eventSetVersion !== undefined &&
      input.expected.eventSetVersion !== context.baseline.eventSetVersion);
  let candidates: AdvisorInsight[] = [];
  if (inconsistent) {
    candidates = [
      insight({
        id: "advisor:context-conflict",
        dedupeKey: "context-conflict",
        observedAt: context.asOfDate,
        type: "CONTEXT_CONFLICT",
        domain: "GLOBAL",
        priority: 1,
        status: "BLOCKED",
        title: "Contexte financier incohérent",
        summary:
          "Les dates d’observation ou fingerprints fournis ne correspondent pas au contexte canonique.",
        priorityReason: "Un conflit de fidélité interdit toute conclusion.",
        evidence: [
          evidence({
            id: "context:baseline",
            date: context.asOfDate,
            nature: "CANONICAL_BASELINE",
            provenance: context.methodologyVersion,
            calculability: "NOT_COMPUTABLE",
            amount: null,
            currency: null,
            href: "/net-worth",
          }),
        ],
        calculability: "NOT_COMPUTABLE",
        amount: null,
        currency: null,
        baselineFingerprint: fingerprint,
        blockers: ["CONTEXT_FINGERPRINT_OR_DATE_MISMATCH"],
      }),
    ];
    return packet(context.asOfDate, context.completeness, fingerprint, candidates);
  }

  for (const blocker of [...context.blockers].sort(
    (a, b) => a.code.localeCompare(b.code) || a.source.localeCompare(b.source),
  )) {
    candidates.push(
      insight({
        id: `advisor:blocker:${blocker.source}:${blocker.code}`,
        dedupeKey: `blocker:${blocker.source}:${blocker.code}`,
        observedAt: context.asOfDate,
        type: "DATA_BLOCKER",
        domain: blocker.source === "EVENT_ENGINE" ? "TIMELINE" : "GLOBAL",
        priority: 1,
        status: blocker.blocking ? "BLOCKED" : "NOT_COMPUTABLE",
        title: readableBlockerTitle(blocker.code),
        summary: blocker.message,
        priorityReason: "La fidélité des données précède toute recommandation.",
        evidence: [
          evidence({
            id: `blocker:${blocker.source}:${blocker.code}`,
            date: context.asOfDate,
            nature: blocker.source,
            provenance: context.methodologyVersion,
            calculability: blocker.blocking ? "NOT_COMPUTABLE" : "PARTIAL",
            amount: null,
            currency: null,
            href: blocker.source === "EVENT_ENGINE" ? "/timeline" : "/net-worth",
          }),
        ],
        calculability: blocker.blocking ? "NOT_COMPUTABLE" : "PARTIAL",
        amount: null,
        currency: null,
        baselineFingerprint: fingerprint,
        blockers: [blocker.code],
      }),
    );
  }

  for (const item of timeline.filter(
    (item) => item.nature === "CONTRACTUAL" && item.status !== "COMPLETED",
  )) {
    const days = daysBetween(context.asOfDate, item.effectiveDate);
    if (days > 30) continue;
    candidates.push(
      insight({
        id: `advisor:deadline:${item.id}`,
        dedupeKey: `event:${item.id}`,
        observedAt: context.asOfDate,
        type: days < 0 ? "OVERDUE_DEADLINE" : "IMMINENT_DEADLINE",
        domain: "TIMELINE",
        priority: 2,
        status: "ACTIONABLE",
        title: item.title,
        summary:
          days < 0
            ? `Échéance contractuelle dépassée depuis ${Math.abs(days)} jour(s).`
            : `Échéance contractuelle dans ${days} jour(s).`,
        priorityReason:
          days < 0 ? "Échéance contractuelle dépassée." : "Échéance contractuelle imminente.",
        evidence: [
          evidence({
            id: item.id,
            date: item.effectiveDate,
            nature: item.nature,
            provenance: item.provenance,
            calculability: item.amountKnown ? "KNOWN" : "NOT_COMPUTABLE",
            amount: item.amount,
            currency: item.currency,
            href: item.href,
          }),
        ],
        calculability: item.amountKnown ? "COMPUTABLE" : "NOT_COMPUTABLE",
        amount: item.amountKnown ? item.amount : null,
        currency: item.amountKnown ? item.currency : null,
        baselineFingerprint: fingerprint,
        blockers: item.blockers,
      }),
    );
  }

  // Rang 3 : signaux déjà calculés uniquement. Aucun seuil, ratio ou nouveau calcul métier.
  if (cockpit.cashFlow !== null && cockpit.cashFlow < 0) {
    candidates.push(
      insight({
        id: "advisor:cash-flow:negative",
        dedupeKey: "cash-flow:negative",
        observedAt: context.asOfDate,
        type: "NEGATIVE_CASH_FLOW",
        domain: "CASH_FLOW",
        priority: 3,
        status: "ACTIONABLE",
        title: "Cash-flow mensuel négatif",
        summary: "Le cash-flow mensuel calculé est explicitement négatif.",
        priorityReason: "Un flux net négatif connu mérite une revue des entrées et sorties.",
        evidence: [
          evidence({
            id: "today:cash-flow",
            date: context.asOfDate,
            nature: "CALCULATED_CASH_FLOW",
            provenance: "Today Cockpit",
            calculability: "KNOWN",
            amount: cockpit.cashFlow,
            currency: context.reportingCurrency,
            href: "/cash-flow",
          }),
        ],
        calculability: "COMPUTABLE",
        amount: cockpit.cashFlow,
        currency: context.reportingCurrency,
        baselineFingerprint: fingerprint,
        blockers: [],
      }),
    );
  }
  if (cockpit.liquidity !== null && cockpit.liquidity < 0) {
    candidates.push(
      insight({
        id: "advisor:liquidity:negative",
        dedupeKey: "liquidity:negative",
        observedAt: context.asOfDate,
        type: "NEGATIVE_LIQUIDITY",
        domain: "NET_WORTH",
        priority: 3,
        status: "ACTIONABLE",
        title: "Liquidité négative",
        summary: "La liquidité calculée est explicitement négative.",
        priorityReason: "Une liquidité négative connue nécessite une revue du bilan.",
        evidence: [
          evidence({
            id: "today:liquidity",
            date: context.asOfDate,
            nature: "CALCULATED_LIQUIDITY",
            provenance: "Today Cockpit",
            calculability: "KNOWN",
            amount: cockpit.liquidity,
            currency: context.reportingCurrency,
            href: "/net-worth",
          }),
        ],
        calculability: "COMPUTABLE",
        amount: cockpit.liquidity,
        currency: context.reportingCurrency,
        baselineFingerprint: fingerprint,
        blockers: [],
      }),
    );
  }

  const contractualWindow = timeline.filter((item) => {
    const days = daysBetween(context.asOfDate, item.effectiveDate);
    return item.nature === "CONTRACTUAL" && item.status !== "COMPLETED" && days >= 0 && days <= 30;
  });
  const unknownContractual = contractualWindow.filter(
    (item) =>
      !item.amountKnown ||
      item.amount === null ||
      (item.amount < 0 && (item.currency === null || item.currency !== context.reportingCurrency)),
  );
  const knownOutflows = contractualWindow.filter(
    (item) =>
      item.amountKnown &&
      item.amount !== null &&
      item.amount < 0 &&
      item.currency === context.reportingCurrency,
  );
  if (contractualWindow.length && unknownContractual.length) {
    candidates.push(
      insight({
        id: "advisor:liquidity-coverage:not-computable",
        dedupeKey: "liquidity-coverage:30d",
        observedAt: context.asOfDate,
        type: "LIQUIDITY_COVERAGE_NOT_COMPUTABLE",
        domain: "TIMELINE",
        priority: 3,
        status: "NOT_COMPUTABLE",
        title: "Couverture des échéances non calculable",
        summary:
          "Au moins une échéance contractuelle des 30 prochains jours ne possède pas un montant convertible connu.",
        priorityReason: "La couverture ne peut pas être conclue sans toutes les sorties utiles.",
        evidence: unknownContractual.map((item) =>
          evidence({
            id: item.id,
            date: item.effectiveDate,
            nature: item.nature,
            provenance: item.provenance,
            calculability: "NOT_COMPUTABLE",
            amount: item.amountKnown ? item.amount : null,
            currency: item.currency,
            href: item.href,
          }),
        ),
        calculability: "NOT_COMPUTABLE",
        amount: null,
        currency: null,
        baselineFingerprint: fingerprint,
        blockers: ["CONTRACTUAL_OUTFLOW_AMOUNT_OR_FX_MISSING"],
      }),
    );
  } else if (knownOutflows.length && cockpit.liquidity === null) {
    candidates.push(
      insight({
        id: "advisor:liquidity-coverage:not-computable",
        dedupeKey: "liquidity-coverage:30d",
        observedAt: context.asOfDate,
        type: "LIQUIDITY_COVERAGE_NOT_COMPUTABLE",
        domain: "NET_WORTH",
        priority: 3,
        status: "NOT_COMPUTABLE",
        title: "Couverture des échéances non calculable",
        summary: "La liquidité nécessaire à la comparaison est inconnue.",
        priorityReason: "Une liquidité inconnue ne peut pas être remplacée par zéro.",
        evidence: [
          evidence({
            id: "today:liquidity",
            date: context.asOfDate,
            nature: "CALCULATED_LIQUIDITY",
            provenance: "Today Cockpit",
            calculability: "NOT_COMPUTABLE",
            amount: null,
            currency: context.reportingCurrency,
            href: "/net-worth",
          }),
          ...knownOutflows.map((item) =>
            evidence({
              id: item.id,
              date: item.effectiveDate,
              nature: item.nature,
              provenance: item.provenance,
              calculability: "KNOWN",
              amount: item.amount,
              currency: item.currency,
              href: item.href,
            }),
          ),
        ],
        calculability: "NOT_COMPUTABLE",
        amount: null,
        currency: null,
        baselineFingerprint: fingerprint,
        blockers: ["LIQUIDITY_UNKNOWN"],
      }),
    );
  } else if (knownOutflows.length && cockpit.liquidity !== null) {
    const totalOutflows = knownOutflows.reduce((sum, item) => sum - item.amount!, 0);
    if (cockpit.liquidity < totalOutflows) {
      candidates.push(
        insight({
          id: "advisor:liquidity-coverage:insufficient",
          dedupeKey: "liquidity-coverage:30d",
          observedAt: context.asOfDate,
          type: "INSUFFICIENT_LIQUIDITY_COVERAGE",
          domain: "TIMELINE",
          priority: 3,
          status: "ACTIONABLE",
          title: "Liquidité insuffisante pour les échéances proches",
          summary:
            "La liquidité connue est inférieure aux sorties contractuelles connues des 30 prochains jours.",
          priorityReason: "Toutes les sorties comparées sont connues dans la devise de reporting.",
          evidence: [
            evidence({
              id: "today:liquidity",
              date: context.asOfDate,
              nature: "CALCULATED_LIQUIDITY",
              provenance: "Today Cockpit",
              calculability: "KNOWN",
              amount: cockpit.liquidity,
              currency: context.reportingCurrency,
              href: "/net-worth",
            }),
            ...knownOutflows.map((item) =>
              evidence({
                id: item.id,
                date: item.effectiveDate,
                nature: item.nature,
                provenance: item.provenance,
                calculability: "KNOWN",
                amount: item.amount,
                currency: item.currency,
                href: item.href,
              }),
            ),
          ],
          calculability: "COMPUTABLE",
          amount: cockpit.liquidity,
          currency: context.reportingCurrency,
          baselineFingerprint: fingerprint,
          blockers: [],
        }),
      );
    }
  }

  for (const ranked of rankGoals(input.state.goals, context).filter(
    (item) => item.goal.status === "ACTIVE",
  )) {
    const evaluation = ranked.evaluation;
    if (
      evaluation &&
      !["AT_RISK", "OFF_TRACK", "OVERDUE", "NOT_COMPUTABLE"].includes(evaluation.status)
    )
      continue;
    const date = evaluation?.asOfDate ?? context.asOfDate;
    candidates.push(
      insight({
        id: `advisor:goal:${ranked.goal.id}`,
        dedupeKey: `goal:${ranked.goal.id}`,
        observedAt: context.asOfDate,
        type: "GOAL_RISK",
        domain: "GOALS",
        priority: 4,
        status:
          evaluation?.status === "NOT_COMPUTABLE" || !evaluation ? "NOT_COMPUTABLE" : "ACTIONABLE",
        title: ranked.goal.name,
        summary: `Goal actif · ${evaluation?.status ?? "NOT_COMPUTABLE"}.`,
        priorityReason: evaluation
          ? `Évaluation Goals V2 : ${evaluation.status}.`
          : "Le Goal ne possède pas de définition V2 calculable.",
        evidence: [
          evidence({
            id: `goal:${ranked.goal.id}:v${ranked.goal.definition?.version ?? ranked.goal.version ?? 1}`,
            date,
            nature: "GOAL_EVALUATION",
            provenance: evaluation?.methodologyVersion ?? "Goals V2",
            calculability:
              evaluation?.status === "NOT_COMPUTABLE" || !evaluation ? "NOT_COMPUTABLE" : "KNOWN",
            amount: evaluation?.observation.value ?? null,
            currency: evaluation?.observation.currency ?? null,
            href: "/goals",
          }),
        ],
        calculability:
          evaluation?.status === "NOT_COMPUTABLE" || !evaluation ? "NOT_COMPUTABLE" : "COMPUTABLE",
        amount: evaluation?.observation.value ?? null,
        currency: evaluation?.observation.currency ?? null,
        baselineFingerprint: fingerprint,
        blockers: evaluation?.blockers.map((item) => item.code) ?? ["MISSING_GOAL_V2_DEFINITION"],
      }),
    );
  }

  for (const decision of (input.state.decisionCases ?? [])
    .filter((item) => item.status === "ACTIVE" || item.status === "DRAFT")
    .sort((a, b) => a.id.localeCompare(b.id))) {
    candidates.push(
      insight({
        id: `advisor:decision:${decision.id}`,
        dedupeKey: `decision:${decision.id}`,
        observedAt: context.asOfDate,
        type: "OPEN_DECISION",
        domain: "DECISION_LAB",
        priority: 5,
        status: "ACTIONABLE",
        title: decision.name,
        summary: `Decision Case ${decision.status.toLowerCase()} à revoir.`,
        priorityReason: "Une décision ouverte mérite une revue explicite.",
        evidence: [
          evidence({
            id: `decision:${decision.id}:v${decision.currentVersion}`,
            date: decision.updatedAt.slice(0, 10),
            nature: "DECISION_CASE",
            provenance: "Decision Lab V2",
            calculability:
              decision.latestResult?.completeness === "NOT_COMPUTABLE" ? "NOT_COMPUTABLE" : "KNOWN",
            amount: null,
            currency: null,
            href: "/decision-lab",
          }),
        ],
        calculability:
          decision.latestResult?.completeness === "NOT_COMPUTABLE"
            ? "NOT_COMPUTABLE"
            : "COMPUTABLE",
        amount: null,
        currency: null,
        baselineFingerprint: fingerprint,
        blockers: decision.latestResult?.blockers.map((item) => item.code) ?? [],
      }),
    );
  }

  for (const scenario of input.state.scenarios
    .filter((item) => !scenarioCutOffStatus(item, context.asOfDate).computable)
    .sort((a, b) => a.id.localeCompare(b.id))) {
    candidates.push(
      insight({
        id: `advisor:scenario:${scenario.id}:stale`,
        dedupeKey: `scenario:${scenario.id}:stale`,
        observedAt: context.asOfDate,
        type: "STALE_SCENARIO",
        domain: "SCENARIOS",
        priority: 6,
        status: "BLOCKED",
        title: scenario.name,
        summary:
          "La version du scénario utilise une autre date zéro et doit être rebasée explicitement.",
        priorityReason: "Une projection périmée ne peut étayer aucun conseil.",
        evidence: [
          evidence({
            id: `scenario:${scenario.id}:v${scenario.version}`,
            date: scenario.definition?.asOfDate ?? context.asOfDate,
            nature: "SCENARIO_VERSION",
            provenance: scenario.definition?.methodologyVersion ?? "Scenarios V2",
            calculability: "NOT_COMPUTABLE",
            amount: null,
            currency: null,
            href: "/scenarios",
          }),
        ],
        calculability: "NOT_COMPUTABLE",
        amount: null,
        currency: null,
        baselineFingerprint: fingerprint,
        blockers: ["STALE_SCENARIO_VERSION"],
      }),
    );
  }

  if (cockpit.closeChange)
    candidates.push(
      insight({
        id: `advisor:close-change:${cockpit.closeChange.from.id}:${cockpit.closeChange.to.id}`,
        dedupeKey: `close-change:${cockpit.closeChange.from.id}:${cockpit.closeChange.to.id}`,
        observedAt: context.asOfDate,
        type: "NET_WORTH_CHANGE",
        domain: "NET_WORTH",
        priority: 7,
        status: "INFORMATIONAL",
        title: "Variation patrimoniale observée",
        summary: `Variation entre les clôtures ${cockpit.closeChange.from.closeDate} et ${cockpit.closeChange.to.closeDate}.`,
        priorityReason: "Deux clôtures permettent une comparaison observée.",
        evidence: [cockpit.closeChange.from, cockpit.closeChange.to].map((close) =>
          evidence({
            id: `close:${close.id}`,
            date: close.closeDate,
            nature: "ACTUAL_CLOSE",
            provenance: "Monthly close",
            calculability: "KNOWN",
            amount: close.netWorth,
            currency: context.reportingCurrency,
            href: "/net-worth",
          }),
        ),
        calculability: "COMPUTABLE",
        amount: cockpit.closeChange.amount,
        currency: context.reportingCurrency,
        baselineFingerprint: fingerprint,
        blockers: [],
      }),
    );

  if (!candidates.length)
    candidates.push(
      insight({
        id: "advisor:monitoring",
        dedupeKey: "monitoring",
        observedAt: context.asOfDate,
        type: "MONITORING",
        domain: "GLOBAL",
        priority: 8,
        status: "INFORMATIONAL",
        title: "Aucune priorité détectée",
        summary:
          "Le contexte canonique ne signale actuellement aucun blocker, échéance imminente, Goal à risque, décision ouverte ou scénario périmé.",
        priorityReason: "Information de surveillance.",
        evidence: [
          evidence({
            id: "context:monitoring",
            date: context.asOfDate,
            nature: "CANONICAL_CONTEXT",
            provenance: context.methodologyVersion,
            calculability: "KNOWN",
            amount: context.balanceSheet.netWorth.value,
            currency: context.reportingCurrency,
            href: "/net-worth",
          }),
        ],
        calculability:
          context.balanceSheet.netWorth.value === null ? "NOT_COMPUTABLE" : "COMPUTABLE",
        amount: context.balanceSheet.netWorth.value,
        currency: context.balanceSheet.netWorth.value === null ? null : context.reportingCurrency,
        baselineFingerprint: fingerprint,
        blockers: [],
      }),
    );
  const deduped = [
    ...new Map(candidates.sort(stableInsightOrder).map((item) => [item.dedupeKey, item])).values(),
  ].sort(stableInsightOrder);
  return packet(context.asOfDate, context.completeness, fingerprint, deduped);
}

function packet(
  observedAt: string,
  completeness: AdvisorPacket["completeness"],
  contextFingerprint: string,
  insights: AdvisorInsight[],
): AdvisorPacket {
  return {
    version: "BEYONDER_ADVISOR_V1",
    observedAt,
    completeness,
    contextFingerprint,
    insights,
    counts: {
      actionable: insights.filter((item) => item.status === "ACTIONABLE").length,
      blocked: insights.filter((item) => item.status === "BLOCKED").length,
      notComputable: insights.filter((item) => item.calculability === "NOT_COMPUTABLE").length,
    },
  };
}

export function answerAdvisorIntent(packet: AdvisorPacket, intent: AdvisorIntent): AdvisorAnswer {
  const filters: Record<AdvisorIntent, (item: AdvisorInsight) => boolean> = {
    NOW: () => true,
    CHANGED: (item) => item.type === "NET_WORTH_CHANGE",
    GOALS: (item) => item.domain === "GOALS",
    DECISIONS: (item) => item.domain === "DECISION_LAB",
    WHY_NOT_COMPUTABLE: (item) =>
      item.calculability === "NOT_COMPUTABLE" || item.status === "BLOCKED",
  };
  const selected = packet.insights.filter(filters[intent]);
  const titles: Record<AdvisorIntent, string> = {
    NOW: "À regarder maintenant",
    CHANGED: "Ce qui a changé",
    GOALS: "Goals à risque",
    DECISIONS: "Décisions à revoir",
    WHY_NOT_COMPUTABLE: "Pourquoi ce n’est pas calculable",
  };
  return {
    intent,
    title: titles[intent],
    insightIds: selected.map((item) => item.id),
    message: selected.length
      ? `Priorité principale : ${selected[0]!.title}. Prochaine action : ${selected[0]!.cta.label}. ${selected.length} conclusion(s) vérifiable(s).`
      : "Aucun élément vérifiable pour cette question.",
  };
}
