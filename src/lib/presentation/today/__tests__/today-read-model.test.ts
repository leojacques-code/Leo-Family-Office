import { describe, expect, it } from "vitest";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import { KPI_REGISTRY } from "@/lib/presentation/registry/kpis";
import { buildTodayView, servedKpiIds, type TodayViewInput } from "@/lib/presentation/today/view";
import { MAX_PRIORITY_ACTIONS } from "@/lib/presentation/today/actions";
import { INBOX_VIEW_ORDER, STALE_VIEW_EMPTY_REASON } from "@/lib/presentation/today/inbox";
import { MAX_ITEMS_TO_CLARIFY } from "@/lib/presentation/today/onboarding";
import { DOMAIN_IDS } from "@/lib/presentation/today/domains";
import type { DomainDeclaration } from "@/lib/presentation/today/contracts";
import type { CanonicalEvent } from "@/lib/engine/event-contracts";
import type { MonthlyClose } from "@/lib/types";

/**
 * Modèle de lecture d'Aujourd'hui, sur les CINQ états du §41.
 *
 * « Vide mais domaines déclarés ; données manuelles partielles ; imports complets ; conflit ou
 * doublon entre sources ; scénario futur distinct du réel. » Le quatrième est ici la
 * contradiction entre une déclaration et un fait ; le cinquième n'a pas de matière sur cette
 * page, dont le manifeste ne porte que le mode `REAL` — Aujourd'hui montre la situation, une
 * simulation y ferait passer une hypothèse pour un état (§6.4).
 *
 * CES TESTS PORTENT SUR UNE FONCTION PURE. C'est tout l'intérêt de la frontière du §10.2 :
 * les cinq états se construisent en quelques lignes, sans Supabase, sans React et sans horloge.
 * Avant, le cockpit vivait dans le composant, et les couvrir aurait demandé de monter la page.
 */

const EMPTY_FLOW: TodayViewInput["observedFlow"] = {
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  transactionCount: 0,
  income: 0,
  essentialExpenses: 0,
  debtServicePaid: 0,
  cashFlowAfterDebt: 0,
  unclassifiedFlows: 0,
  fullyCovered: false,
};

function input(overrides: Partial<TodayViewInput> = {}): TodayViewInput {
  return {
    asOfDate: "2026-09-08",
    reportingCurrency: "EUR",
    netWorth: { value: null, blockers: [] },
    immediateCash: { value: null, blockers: [] },
    closes: [],
    observedFlow: EMPTY_FLOW,
    goal: null,
    events: [],
    reserves: [],
    declarations: [],
    domainFacts: DOMAIN_IDS.map((domain) => ({ domain, hasFacts: false })),
    railSources: [],
    readOnlyDemo: false,
    ...overrides,
  };
}

function close(date: string, netWorth: number, cash: number): MonthlyClose {
  return {
    id: `close-${date}`,
    version: 1,
    reportingCurrency: "EUR",
    completenessStatus: "COMPLETE",
    composition: {
      immediate_cash: cash,
      market_invested_assets: netWorth - cash,
      investment_envelope_cash: 0,
      illiquid_assets: 0,
      methodologyVersion: "CANONICAL_BALANCE_SHEET_V2",
    },
    closeDate: date,
    grossAssets: netWorth,
    debt: 0,
    netWorth,
    forecastNetWorth: null,
    variance: null,
    createdAt: `${date}T12:00:00Z`,
  };
}

function obligationEvent(id: string, date: string): CanonicalEvent {
  return {
    id,
    domain: "DEBT",
    type: "LOAN_PAYMENT",
    effectiveDate: date,
    eventDate: date,
    createdAt: null,
    dataKind: "CONTRACTUAL",
    confidence: "HIGH",
    source: null,
    provenance: {
      source: null,
      sourceRecordId: null,
      engine: "test",
      formulaReference: null,
      assumptions: [],
    },
    target: { entityType: "LIABILITY", entityId: "liab-1" },
    status: "PLANNED",
    shape: "SCHEDULE_CONSEQUENCE",
    effectiveConvention: "IMMEDIATE",
    sequence: 1,
    supersededBy: null,
    scenarioId: null,
    blockers: [],
    consequences: [],
  };
}

describe("état VIDE — le critère du §11", () => {
  it("rend un parcours d'installation, pas une succession d'erreurs", () => {
    const model = buildTodayView(input());
    expect(model.profileStage).toBe("EMPTY");
    expect(model.installation).not.toBeNull();
    expect(model.installation!.steps).toHaveLength(4);
    // Aucune tâche d'inbox : sur un profil vide, les moteurs n'ont rien sur quoi émettre une
    // réserve, et la page ne fabrique pas d'alerte pour occuper l'écran.
    expect(model.inbox.pendingCount).toBe(0);
  });

  it("ne remplace AUCUN montant manquant par zéro", () => {
    const model = buildTodayView(input());
    // Les cinq réponses monétaires ou de progression restent `null` ; seule la sixième, qui
    // COMPTE des éléments, vaut zéro — et zéro y est une information : rien n'attend.
    expect(model.answers.map((answer) => answer.value)).toEqual([null, null, null, null, null, 0]);
    expect(model.monthFlow).toBeNull();
    expect(model.closeChange).toBeNull();
    expect(model.goalTrajectory).toBeNull();
  });

  it("propose des actions d'installation avant toute réserve de calcul", () => {
    const model = buildTodayView(
      input({
        reserves: [
          {
            code: "ACQUISITION_PRICE_MISSING",
            blocking: false,
            origin: "le bilan canonique",
            href: "/net-worth",
          },
        ],
      }),
    );
    // Envoyer quelqu'un préciser un prix d'acquisition avant qu'il n'ait connecté sa banque est
    // la « succession d'erreurs » que le §11 refuse.
    expect(model.actions[0]!.id.startsWith("install-")).toBe(true);
  });
});

describe("« je n'ai pas de bien / société / dette » est un état valide", () => {
  const declared: DomainDeclaration[] = [
    { domain: "IMMOBILIER", applicability: "DECLARED_NONE", declaredOn: "2026-09-01", note: null },
    { domain: "ENTREPRISE", applicability: "DECLARED_NONE", declaredOn: "2026-09-01", note: null },
    { domain: "DETTE", applicability: "DECLARED_NONE", declaredOn: "2026-09-01", note: null },
  ];

  it("clôt l'étape du parcours et la retire des étapes applicables", () => {
    const model = buildTodayView(input({ declarations: declared }));
    const step = model.installation!.steps.find((entry) => entry.id === "assets");
    expect(step!.status).toBe("DECLARED_NONE");
    // Trois étapes applicables sur quatre : compter la quatrième afficherait « 0 sur 4 » à
    // quelqu'un qui a répondu à tout ce qui le concerne.
    expect(model.installation!.applicable).toBe(3);
  });

  it("ne produit aucune action ni aucune tâche pour un domaine déclaré absent", () => {
    const model = buildTodayView(input({ declarations: declared }));
    expect(model.actions.some((action) => action.id === "install-assets")).toBe(false);
    expect(
      model.inbox.sections
        .flatMap((section) => section.tasks)
        .some((task) => task.title.includes("Immobilier")),
    ).toBe(false);
  });

  it("n'est PAS confondu avec « je ne sais pas encore »", () => {
    const undecided = buildTodayView(
      input({
        declarations: [
          {
            domain: "IMMOBILIER",
            applicability: "UNDECIDED",
            declaredOn: "2026-09-01",
            note: null,
          },
        ],
      }),
    );
    const step = undecided.installation!.steps.find((entry) => entry.id === "assets");
    // Une question vue et laissée ouverte n'est ni faite, ni close, ni à faire.
    expect(step!.status).toBe("UNDECIDED");
    expect(undecided.installation!.applicable).toBe(4);
  });

  it("distingue l'absence de déclaration d'une déclaration « pas encore »", () => {
    const model = buildTodayView(input());
    const immobilier = model.domains.find((domain) => domain.domain === "IMMOBILIER");
    expect(immobilier!.applicability).toBe("UNDECLARED");
    expect(immobilier!.declaredOn).toBeNull();
  });
});

describe("état PARTIEL — au plus trois actions", () => {
  const many = Array.from({ length: 9 }, (_, index) => ({
    code: [
      "ACQUISITION_PRICE_MISSING",
      "REAL_ESTATE_VALUATION_MISSING",
      "ENVELOPE_VALUE_MISSING",
      "POSITION_ORPHAN",
      "POSITION_MISSING",
      "OPERATING_TERMS_MISSING",
      "VACANCY_RATE_MISSING",
      "USAGE_UNDECLARED",
      "ACQUISITION_FEES_UNKNOWN",
    ][index]!,
    blocking: index % 3 === 0,
    origin: "le bilan canonique",
    href: "/net-worth",
  }));

  it("plafonne les actions à trois, quel que soit le nombre de réserves", () => {
    const model = buildTodayView(input({ reserves: many }));
    expect(model.inbox.pendingCount).toBeGreaterThan(MAX_PRIORITY_ACTIONS);
    expect(model.actions).toHaveLength(MAX_PRIORITY_ACTIONS);
  });

  it("classe de façon TOTALE : deux lectures du même état donnent les mêmes trois actions", () => {
    const first = buildTodayView(input({ reserves: many }));
    const shuffled = buildTodayView(input({ reserves: [...many].reverse() }));
    // L'ordre d'entrée des réserves ne doit avoir aucun effet : le §16 interdit qu'une IA
    // décide de la matérialité, et un ordre qui dépend de l'entrée est une décision cachée.
    expect(shuffled.actions.map((action) => action.label).sort()).toEqual(
      first.actions.map((action) => action.label).sort(),
    );
  });

  it("borne les éléments à préciser à cinq, §19.2 item 5", () => {
    const model = buildTodayView(input({ reserves: many }));
    expect(model.installation!.toClarify.length).toBeLessThanOrEqual(MAX_ITEMS_TO_CLARIFY);
  });
});

describe("état COMPLET — les six réponses et leur évolution", () => {
  const complete = input({
    netWorth: { value: 120_000, blockers: [] },
    immediateCash: { value: 18_000, blockers: [] },
    closes: [close("2026-07-31", 100_000, 15_000), close("2026-08-31", 110_000, 16_500)],
    observedFlow: {
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      transactionCount: 12,
      income: 4_000,
      essentialExpenses: 1_500,
      debtServicePaid: 400,
      cashFlowAfterDebt: 1_800,
      unclassifiedFlows: 0,
      fullyCovered: true,
    },
    goal: {
      goalId: "g1",
      name: "Épargne",
      targetDate: "2027-12-31",
      relativeGap: -0.2,
      blockers: [],
    },
    events: [obligationEvent("e1", "2026-09-20")],
    declarations: DOMAIN_IDS.map((domain) => ({
      domain,
      applicability: "APPLICABLE" as const,
      declaredOn: "2026-09-01",
      note: null,
    })),
    domainFacts: DOMAIN_IDS.map((domain) => ({ domain, hasFacts: true })),
  });

  it("répond aux six questions du §3, dans son ordre", () => {
    const model = buildTodayView(complete);
    expect(model.answers).toHaveLength(6);
    expect(model.answers.map((answer) => answer.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(model.answers.every((answer) => answer.state === "AVAILABLE")).toBe(true);
  });

  it("retire le parcours d'installation une fois toutes les étapes faites", () => {
    const model = buildTodayView(complete);
    expect(model.profileStage).toBe("OPERATING");
    expect(model.installation).toBeNull();
  });

  it("décompose l'évolution en causes, la plus matérielle d'abord", () => {
    const model = buildTodayView(complete);
    expect(model.closeChange!.amount).toBe(10_000);
    expect(model.closeChange!.causes.map((cause) => cause.label)).toEqual([
      "Actifs investis",
      "Trésorerie immédiate",
    ]);
    expect(model.closeChange!.causes[0]!.amount).toBe(8_500);
  });

  it("refuse toute variation si les deux clôtures ne sont pas comparables", () => {
    const incomparable = buildTodayView({
      ...complete,
      closes: [
        { ...close("2026-07-31", 100_000, 15_000), reportingCurrency: "USD" },
        close("2026-08-31", 110_000, 16_500),
      ],
    });
    expect(incomparable.closeChange).toBeNull();
    // Le refus est MOTIVÉ, en français : un refus muet se lit comme une panne.
    expect(incomparable.closeChangeReserve).toBeTruthy();
    expect(incomparable.closeChangeReserve).not.toMatch(/[A-Z]{2,}_[A-Z]{2,}/);
  });
});

describe("état CONFLIT — déclaration contre fait", () => {
  const conflicting = input({
    declarations: [
      { domain: "DETTE", applicability: "DECLARED_NONE", declaredOn: "2026-09-01", note: null },
    ],
    domainFacts: DOMAIN_IDS.map((domain) => ({ domain, hasFacts: domain === "DETTE" })),
  });

  it("montre la contradiction sans la trancher", () => {
    const model = buildTodayView(conflicting);
    const conflicts = model.inbox.sections.find((section) => section.id === "CONFLICTS")!;
    expect(conflicts.tasks).toHaveLength(1);
    const task = conflicts.tasks[0]!;
    expect(task.state).toBe("SOURCE_CONFLICT");
    // Ni la déclaration ni les faits ne sont supprimés d'office : le §16 interdit de choisir.
    expect(task.effect).toContain("jamais de cette tâche");
  });
});

describe("boîte de réception — les six vues du §32", () => {
  it("rend exactement les six vues, dans l'ordre du plan", () => {
    const model = buildTodayView(input());
    expect(model.inbox.sections.map((section) => section.id)).toEqual([...INBOX_VIEW_ORDER]);
    expect(model.inbox.sections.map((section) => section.label)).toEqual([
      "À vérifier",
      "Conflits",
      "Données manquantes",
      "Données anciennes",
      "À venir",
      "Résolus automatiquement",
    ]);
  });

  it("dit pourquoi « Données anciennes » est vide, au lieu d'affirmer une fraîcheur", () => {
    const model = buildTodayView(input());
    const stale = model.inbox.sections.find((section) => section.id === "STALE")!;
    expect(stale.emptyBecause).toBe(STALE_VIEW_EMPTY_REASON);
    expect(stale.emptyBecause).toContain("Aucun seuil de fraîcheur");
    // Les cinq autres vues n'ont pas de motif : elles sont vides parce que rien n'y entre.
    expect(
      model.inbox.sections
        .filter((section) => section.id !== "STALE")
        .every((section) => section.emptyBecause === null),
    ).toBe(true);
  });

  it("explique CHAQUE tâche par fait, importance, preuve et effet", () => {
    const model = buildTodayView(
      input({
        reserves: [
          {
            code: "REAL_ESTATE_VALUATION_MISSING",
            blocking: false,
            origin: "le bilan canonique",
            href: "/net-worth",
          },
          {
            code: "ACQUISITION_CASH_MISMATCH",
            blocking: true,
            origin: "le registre d’événements",
            href: "/timeline",
          },
        ],
        events: [obligationEvent("e1", "2026-09-20")],
        declarations: [
          { domain: "DETTE", applicability: "DECLARED_NONE", declaredOn: "2026-09-01", note: null },
        ],
        domainFacts: DOMAIN_IDS.map((domain) => ({ domain, hasFacts: domain === "DETTE" })),
      }),
    );
    const tasks = model.inbox.sections.flatMap((section) => section.tasks);
    expect(tasks.length).toBeGreaterThan(3);
    for (const task of tasks) {
      for (const field of [task.fact, task.importance, task.evidence, task.effect]) {
        expect(field.length).toBeGreaterThan(20);
        // Aucun code technique dans le texte visible : constat 5.4.
        expect(field).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
      }
    }
  });

  it("ne compte comme « à vérifier » que ce qui attend une décision", () => {
    const model = buildTodayView(input({ events: [obligationEvent("e1", "2026-09-20")] }));
    const upcoming = model.inbox.sections.find((section) => section.id === "UPCOMING")!;
    expect(upcoming.tasks).toHaveLength(1);
    // Une échéance à venir n'attend rien : la compter gonflerait le compteur de ce qui ne
    // vous attend pas.
    expect(model.inbox.pendingCount).toBe(0);
  });

  it("signale une réserve non traduite SANS citer son code", () => {
    const model = buildTodayView(
      input({
        reserves: [
          {
            code: "CODE_TOTALEMENT_INCONNU",
            blocking: false,
            origin: "un moteur de domaine",
            href: null,
          },
        ],
      }),
    );
    const tasks = model.inbox.sections.flatMap((section) => section.tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.state).toBe("SYSTEM_ERROR");
    expect(tasks[0]!.title).not.toContain("CODE_TOTALEMENT_INCONNU");
    // Le code part au volet technique, où il est fait pour être lu et copié.
    expect(tasks[0]!.technicalId).toContain("CODE_TOTALEMENT_INCONNU");
  });
});

describe("conformité au manifeste — §39, quatrième refus de CI", () => {
  it("ne sert AUCUN KPI hors des KPI essentiels du manifeste", () => {
    const model = buildTodayView(input());
    const declared = new Set(PAGE_REGISTRY.today!.essentialKpis);
    for (const id of servedKpiIds(model)) {
      expect(declared.has(id), `KPI servi hors manifeste : ${id}`).toBe(true);
      expect(KPI_REGISTRY[id], `KPI hors registre : ${id}`).toBeDefined();
    }
  });

  it("porte la version du manifeste servi", () => {
    expect(buildTodayView(input()).manifestVersion).toBe(PAGE_REGISTRY.today!.version);
  });
});
