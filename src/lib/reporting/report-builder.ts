import { buildAdvisorPacket } from "@/lib/advisor/advisor-core";
import { buildTodayCockpit } from "@/lib/presentation/today-cockpit";
import type { DashboardState, MonthlyClose } from "@/lib/types";
import { stableFingerprint } from "./report-formatters";
import { section } from "./report-sections";
import type {
  InstitutionalReport,
  ReportAmount,
  ReportManifest,
  ReportParameters,
  ReportSection,
} from "./report-types";

const amount = (
  label: string,
  value: number | null,
  currency: string,
  date: string,
  source: string,
  nature: ReportAmount["nature"] = "DERIVED",
): ReportAmount => ({
  label,
  value,
  currency,
  date,
  source,
  nature,
  calculability: value === null ? "NOT_COMPUTABLE" : "COMPUTABLE",
});
const orderedCloses = (closes: MonthlyClose[]) =>
  [...closes].sort((a, b) => a.closeDate.localeCompare(b.closeDate) || a.id.localeCompare(b.id));

function currentSections(state: DashboardState): ReportSection[] {
  const cockpit = buildTodayCockpit(state);
  const advisor = buildAdvisorPacket({ state, cockpit });
  const balance = cockpit.context.balanceSheet;
  const missingTax = !state.taxCalculation || state.taxCalculation.status === "NOT_COMPUTABLE";
  return [
    section(
      "executive",
      "Synthèse exécutive",
      advisor.insights[0]?.summary ?? "Aucune conclusion prioritaire disponible.",
      [],
      advisor.insights.slice(0, 3).map((i) => i.title),
    ),
    section(
      "net-worth",
      "Patrimoine net",
      "Bilan canonique à la date d’observation.",
      [
        amount(
          "Patrimoine net",
          balance.netWorth.value,
          state.reportingCurrency,
          state.asOfDate,
          "Canonical Balance Sheet",
        ),
      ],
      [],
      balance.netWorth.blockers,
      "/net-worth",
    ),
    section(
      "assets-liabilities",
      "Actifs et passifs",
      "Agrégats du bilan canonique.",
      [
        amount(
          "Actifs bruts",
          balance.grossAssets.value,
          state.reportingCurrency,
          state.asOfDate,
          "Canonical Balance Sheet",
        ),
        amount(
          "Passifs",
          balance.totalLiabilities.value,
          state.reportingCurrency,
          state.asOfDate,
          "Canonical Balance Sheet",
        ),
      ],
      [],
      [...balance.grossAssets.blockers, ...balance.totalLiabilities.blockers],
      "/net-worth",
    ),
    section(
      "liquidity",
      "Liquidité",
      "Liquidité publiée par le cockpit Today.",
      [
        amount(
          "Actifs liquides",
          cockpit.liquidity,
          state.reportingCurrency,
          state.asOfDate,
          "Today V2",
        ),
      ],
      [],
      [],
      "/cash-flow",
    ),
    section(
      "cash-flow",
      "Cash-flow",
      "Flux courant calculable sans extrapolation.",
      [
        amount(
          "Cash-flow libre",
          cockpit.cashFlow,
          state.reportingCurrency,
          state.asOfDate,
          "Today V2",
        ),
      ],
      [],
      [],
      "/cash-flow",
    ),
    section(
      "debt",
      "Dette",
      "Passifs personnels canoniques.",
      [
        amount(
          "Dette totale",
          cockpit.debt,
          state.reportingCurrency,
          state.asOfDate,
          "Canonical Balance Sheet",
        ),
      ],
      state.liabilities.map((x) => x.name),
      [],
      "/debt",
    ),
    section(
      "portfolio",
      "Portefeuille",
      "Enveloppes et positions observées, sans performance inventée.",
      [],
      state.accounts.filter((x) => x.type === "PEA" || x.type === "CTO").map((x) => x.name),
      [],
      "/investments",
    ),
    section(
      "real-estate",
      "Immobilier",
      "Faits immobiliers détenus.",
      [],
      state.realEstateAssets.map((x) => x.name),
      state.realEstateAssets.length && !state.realEstateValuations.length
        ? ["REAL_ESTATE_VALUATION_MISSING"]
        : [],
      "/real-estate",
    ),
    section(
      "business",
      "Business Equity",
      "Participations et bases de valorisation déclarées.",
      [],
      (state.businesses ?? []).map((x) => x.name),
      (state.businesses ?? []).length && !(state.businessValuations ?? []).length
        ? ["BUSINESS_VALUATION_MISSING"]
        : [],
      "/business-equity",
    ),
    section(
      "career",
      "Carrière et revenus",
      "Rôles et revenus datés.",
      [],
      (state.careerRoles ?? []).map((x) => x.jobTitle ?? x.employer ?? x.id),
      [],
      "/career",
    ),
    section(
      "tax",
      "Fiscalité",
      missingTax ? "Aucune fiscalité fiable ne peut être calculée." : "Calcul fiscal disponible.",
      [],
      [],
      missingTax ? ["TAX_NOT_COMPUTABLE"] : [],
      "/tax",
    ),
    section(
      "goals",
      "Goals",
      "Objectifs enregistrés uniquement.",
      [],
      state.goals.map((x) => x.name),
      state.goals.length ? [] : ["NO_GOAL"],
      "/goals",
    ),
    section(
      "decisions",
      "Décisions ouvertes",
      "Decision Cases enregistrés uniquement.",
      [],
      (state.decisionCases ?? []).map((x) => x.name),
      (state.decisionCases ?? []).length ? [] : ["NO_DECISION_CASE"],
      "/decision-lab",
    ),
    section(
      "events",
      "Événements importants",
      "Timeline canonique Event Engine.",
      [],
      cockpit.context.timeline.events.slice(0, 12).map((x) => `${x.effectiveDate} · ${x.type}`),
      [],
      "/timeline",
    ),
    section(
      "beyonder",
      "Conclusions Beyonder",
      "Priorités déterministes, jamais une recommandation d’investissement.",
      [],
      advisor.insights.map((x) => x.title),
      advisor.insights.flatMap((x) => x.blockers),
      "/advisor",
    ),
    section(
      "quality",
      "Qualité, complétude et blockers",
      `Contexte ${cockpit.context.completeness}.`,
      [],
      [],
      cockpit.context.blockers.map((x) => x.code),
      "/net-worth",
    ),
    section(
      "provenance",
      "Hypothèses et provenance",
      "Les hypothèses restent distinctes des observations.",
      [],
      [
        cockpit.context.methodologyVersion,
        "ACTUAL ≠ OBSERVED ≠ CONTRACTUAL ≠ PROJECTED ≠ USER_ASSUMPTION ≠ MODEL_ASSUMPTION",
      ],
    ),
  ];
}

function reviewSections(
  state: DashboardState,
  params: ReportParameters,
): { sections: ReportSection[]; from: string; to: string } {
  let closes = orderedCloses(state.monthlyCloses);
  if (params.type === "ANNUAL_REVIEW")
    closes = closes.filter((x) => Number(x.closeDate.slice(0, 4)) === params.year);
  const selected =
    params.type === "MONTHLY_REVIEW"
      ? closes.slice(-2)
      : closes.length
        ? [closes[0]!, closes.at(-1)!]
        : [];
  const from =
    selected[0]?.closeDate ??
    (params.type === "ANNUAL_REVIEW" ? `${params.year}-01-01` : state.asOfDate);
  const to =
    selected.at(-1)?.closeDate ??
    (params.type === "ANNUAL_REVIEW" ? `${params.year}-12-31` : state.asOfDate);
  const first = selected[0],
    last = selected.at(-1);
  const comparable = selected.length === 2 && first!.id !== last!.id;
  const delta = comparable ? last!.netWorth - first!.netWorth : null;
  const relative = comparable && first!.netWorth !== 0 ? delta! / first!.netWorth : null;
  const blockers =
    selected.length === 0
      ? ["NO_HISTORICAL_CLOSE"]
      : selected.length === 1
        ? ["SINGLE_CLOSE_POINT_IN_TIME_ONLY"]
        : [];
  return {
    from,
    to,
    sections: [
      section(
        "historical-summary",
        "Évolution mesurable",
        comparable
          ? "Comparaison des clôtures historiques disponibles."
          : "Historique insuffisant pour une comparaison.",
        [
          amount(
            "Patrimoine de départ",
            first?.netWorth ?? null,
            state.reportingCurrency,
            from,
            "Monthly Close",
            "OBSERVED",
          ),
          amount(
            "Patrimoine d’arrivée",
            last?.netWorth ?? null,
            state.reportingCurrency,
            to,
            "Monthly Close",
            "OBSERVED",
          ),
          amount("Variation absolue", delta, state.reportingCurrency, to, "Reporting difference"),
          amount("Variation relative", relative, "%", to, "Reporting ratio"),
        ],
        [],
        blockers,
      ),
      section(
        "historical-events",
        "Événements observés",
        "Faits Event Engine compris dans la période.",
        [],
        (state.eventTimeline?.events ?? [])
          .filter(
            (x) => x.effectiveDate >= from && x.effectiveDate <= to && x.dataKind === "OBSERVED",
          )
          .map((x) => `${x.effectiveDate} · ${x.type}`),
      ),
      section(
        "historical-composition",
        "Composition historique",
        "La composition actuelle n’est jamais présentée comme historique.",
        [],
        [],
        ["HISTORICAL_COMPOSITION_NOT_PRESERVED"],
      ),
      section(
        "historical-goals",
        "Goals et décisions datables",
        "Éléments enregistrés ; aucune causalité avec la variation n’est inférée.",
        [],
        [
          ...state.goals.map((x) => `Goal · ${x.name}`),
          ...(state.decisionCases ?? []).map((x) => `Décision · ${x.name}`),
        ],
      ),
    ],
  };
}

function memoSections(state: DashboardState, caseId: string | null | undefined): ReportSection[] {
  const selected = (state.decisionCases ?? []).find((x) => x.id === caseId);
  if (!selected)
    return [
      section(
        "decision-question",
        "Question de décision",
        "Memo de surveillance incomplet : aucun Decision Case sélectionné.",
        [],
        [],
        ["DECISION_CASE_REQUIRED"],
        "/decision-lab",
      ),
      section(
        "human-decision",
        "Prochaine décision humaine attendue",
        "Sélectionner ou créer un Decision Case ; aucune action automatique.",
      ),
    ];
  const definition = selected.definition;
  const stale = Boolean(
    selected.latestRun && definition && selected.latestRun.caseVersion !== definition.version,
  );
  return [
    section(
      "decision-question",
      "Question de décision",
      definition?.name ?? selected.name,
      [],
      [],
      definition ? [] : ["DECISION_VERSION_MISSING"],
    ),
    section(
      "options",
      "Options enregistrées",
      "Aucune option n’est créée par Reporting.",
      [],
      definition?.options.map((x) => x.name) ?? [],
      definition?.options.length ? [] : ["NO_DECISION_OPTION"],
    ),
    section(
      "impacts",
      "Impacts Decision Lab",
      "Résultats du dernier run, sans recommandation ajoutée.",
      [],
      selected.latestResult ? [selected.latestResult.conclusion] : [],
      selected.latestResult ? [] : ["DECISION_RESULT_MISSING"],
    ),
    section(
      "risks",
      "Risques, sensibilité et blockers",
      "Une projection périmée n’est pas utilisée.",
      [],
      [],
      stale ? ["DECISION_RUN_STALE"] : [],
    ),
    section(
      "evidence",
      "Preuves",
      "Version et baseline du Decision Case.",
      [],
      [
        definition ? `Version ${definition.version}` : "Version absente",
        selected.latestRun?.baselineFingerprint ?? "Fingerprint absent",
      ],
    ),
    section(
      "human-decision",
      "Prochaine décision humaine attendue",
      "Examiner les options dans Decision Lab. Reporting ne décide et n’exécute jamais.",
      [],
      [],
      [],
      "/decision-lab",
    ),
  ];
}

export function buildInstitutionalReport(
  state: DashboardState,
  parameters: ReportParameters,
): InstitutionalReport {
  const context = buildTodayCockpit(state).context;
  let sections: ReportSection[],
    period = { from: state.asOfDate, to: state.asOfDate };
  if (parameters.type === "CURRENT_SNAPSHOT") sections = currentSections(state);
  else if (parameters.type === "INVESTMENT_COMMITTEE_MEMO")
    sections = memoSections(state, parameters.decisionCaseId);
  else {
    const review = reviewSections(state, parameters);
    sections = review.sections;
    period = { from: review.from, to: review.to };
  }
  sections = [...sections].sort((a, b) => a.id.localeCompare(b.id));
  const base = {
    type: parameters.type,
    observationDate: state.asOfDate,
    period,
    currency: state.reportingCurrency,
    contextFingerprint: `${context.baseline.openingFingerprint}:${context.baseline.eventSetVersion}`,
    openingFingerprint: context.baseline.openingFingerprint,
    eventSetVersion: context.baseline.eventSetVersion,
    methodologyVersions: [context.methodologyVersion, "INSTITUTIONAL_REPORTING_1"],
    parameters: {
      year: parameters.year ?? null,
      decisionCaseId: parameters.decisionCaseId ?? null,
    },
    sections,
  };
  const financialFingerprint = stableFingerprint(base);
  const manifest: ReportManifest = {
    formatVersion: "INSTITUTIONAL_REPORTING_1",
    ...base,
    computableSections: sections.filter((x) => x.status === "COMPUTABLE").map((x) => x.id),
    partialSections: sections.filter((x) => x.status === "PARTIAL").map((x) => x.id),
    nonComputableSections: sections.filter((x) => x.status === "NOT_COMPUTABLE").map((x) => x.id),
    blockers: [...new Set(sections.flatMap((x) => x.blockers))].sort(),
    provenance: [
      "Canonical Balance Sheet",
      "Event Engine",
      "Goals V2",
      "Decision Lab V2",
      "Today V2",
      "Beyonder V1",
      "Monthly Close",
    ],
    financialFingerprint,
  };
  const titles = {
    CURRENT_SNAPSHOT: "Rapport patrimonial actuel",
    MONTHLY_REVIEW: "Revue mensuelle",
    ANNUAL_REVIEW: `Revue annuelle ${parameters.year}`,
    INVESTMENT_COMMITTEE_MEMO: "Investment Committee Memo",
  };
  return { title: titles[parameters.type], manifest, sections };
}
