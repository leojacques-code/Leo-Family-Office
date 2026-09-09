import "server-only";

import { computeObservedCashFlow, monthPeriod } from "@/lib/engine/cash-flow";
import { buildGlobalFinancialContext } from "@/lib/engine/global-financial-model";
import { railSourcesFor } from "@/lib/presentation/rail-sources";
import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import { DOMAIN_REGISTRY } from "@/lib/presentation/today/domains";
import { buildTodayView, type TodayViewInput } from "@/lib/presentation/today/view";
import type {
  DomainDeclaration,
  RailSourceView,
  TodayReadModel,
} from "@/lib/presentation/today/contracts";
import type { ReserveInput } from "@/lib/presentation/today/inbox";
import type { GoalTrajectoryInput } from "@/lib/presentation/today/flow";
import { rankGoals } from "@/lib/presentation/today-cockpit";
import type { DashboardState } from "@/lib/types";
import { getRepository } from "@/lib/data/repository";

/**
 * Modèle de lecture d'Aujourd'hui — `getTodayReadModel()` du §10.2.
 *
 * IL REMPLACE `getDashboardState()` POUR CETTE PAGE, ET POUR ELLE SEULE. Le §10.2 demande de
 * « remplacer `getDashboardState()` comme source de chaque page par des modèles de lecture
 * ciblés » et nomme `getTodayReadModel()` en premier. Les treize autres pages continuent de
 * recevoir l'état global : le §14 interdit de « refaire toutes les pages dans une seule PR »,
 * et chacune obtiendra son modèle dans sa propre phase.
 *
 * CE QUE CETTE FRONTIÈRE CHANGE RÉELLEMENT. Aujourd'hui recevait `DashboardState` entier —
 * quatre-vingts familles de faits, comptes, opérations, positions, échéanciers, écritures
 * comptables — et construisait son cockpit dans le composant, en appelant des moteurs depuis
 * du code client. Ce que la page reçoit maintenant est un objet dont chaque champ est déjà une
 * décision d'affichage. La différence n'est pas une préférence de style : tant que le composant
 * dispose de l'état, il peut recalculer, et la mesure technique du §13 reste inatteignable.
 *
 * LE MODÈLE NE LIT PAS L'HORLOGE. La date d'arrêté vient de l'état, qui la porte déjà. Une
 * seconde lecture de l'horloge ici produirait deux dates dans la même page, un soir sur mille.
 */

/** Horizon du contexte financier partagé, en mois. Repris de l'appel existant d'Aujourd'hui. */
const HORIZON_MONTHS = 960;

/**
 * Nom français du moteur émetteur d'une réserve. C'est la PREUVE d'une tâche d'inbox.
 *
 * La source d'une réserve est déclarée par le contexte partagé lui-même
 * (`GlobalFinancialModelBlocker.source`) : elle n'est pas devinée d'après le code.
 */
const RESERVE_ORIGIN: Readonly<Record<string, string>> = {
  BALANCE_SHEET: "le bilan canonique",
  EVENT_ENGINE: "le registre d’événements",
  GLOBAL_FINANCIAL_MODEL: "le contexte financier partagé",
};

/**
 * Destination utile pour traiter une réserve, selon le moteur qui l'a émise.
 *
 * L'attribution reste GROSSIÈRE et elle est assumée : une réserve porte un code, pas un
 * domaine. Mapper 144 codes vers un domaine demanderait soit une table écrite à la main sans
 * source, soit une heuristique de préfixe — et les préfixes réels (`MISSING_`, `LEDGER_`,
 * `NON_`, `FX_`) traversent plusieurs domaines. Une attribution fausse enverrait l'utilisateur
 * au mauvais endroit, ce qui est pire qu'une destination générique. L'attribution fine
 * appartient à chaque phase de domaine, qui connaît ses propres codes.
 */
function reserveHref(source: string): string {
  return source === "EVENT_ENGINE" ? "/timeline" : "/net-worth";
}

/**
 * Présence de faits par domaine.
 *
 * Elle est lue par les MÊMES familles de preuve que le rail de sources (`SourceEvidence`), et
 * par la même fonction : le registre des domaines déclare quelles familles prouvent qu'un
 * domaine est alimenté, et `railSourcesFor` sait déjà répondre « y en a-t-il ? ». Écrire ici
 * une seconde lecture de présence donnerait deux réponses possibles à la même question.
 */
function domainFacts(state: DashboardState) {
  return DOMAIN_REGISTRY.map((definition) => ({
    domain: definition.id,
    hasFacts: railSourcesFor(
      {
        ...PAGE_REGISTRY.today!,
        zones: ["SOURCE_RAIL"],
        sources: definition.evidence.map((evidence, index) => ({
          id: `${definition.id}-${index}`,
          category: definition.sourceCategory,
          name: definition.label,
          evidence,
          planRef: definition.planRef,
        })),
      },
      state,
    ).some((source) => source.status === "ACTIVE"),
  }));
}

/**
 * Construit l'entrée du modèle depuis l'état canonique.
 *
 * Séparée de la lecture du dépôt pour être testable sans Supabase : c'est le même découpage
 * que partout ailleurs dans ce dépôt, et il permet aux tests de couvrir les cinq états du §41
 * à partir d'un état construit à la main.
 */
export function todayViewInputFrom(
  state: DashboardState,
  declarations: readonly DomainDeclaration[],
  options: { readonly readOnlyDemo?: boolean } = {},
): TodayViewInput {
  // UN SEUL contexte partagé, et le bilan et la timeline en sont LUS.
  //
  // `canonicalBalanceSheetOf` et `buildDashboardEventTimeline` produiraient les mêmes objets,
  // mais deux fois : le contexte les a déjà construits, et les reconstruire ferait courir le
  // risque que la page affiche un bilan et des échéances issus de deux passes distinctes.
  //
  // `deriveCanonicalBalanceSheetMetrics` n'est PAS utilisé, et c'est délibéré : le §10.3
  // demande de contenir la coexistence de `deriveMetrics()` avec le bilan canonique, et « la
  // refonte ne doit créer aucun nouveau KPI depuis cette seconde vérité ». Les agrégats
  // viennent donc du bilan canonique lui-même.
  const context = buildGlobalFinancialContext(state, HORIZON_MONTHS);
  const balanceSheet = context.balanceSheet;

  const month = monthPeriod(state.asOfDate);
  const observed = computeObservedCashFlow(
    state.transactions ?? [],
    state.expenseCategories ?? [],
    month.start,
    month.end,
    { ledgerCoverageStart: state.ledgerCoverageStart, asOfDate: state.asOfDate },
  );
  const ranked = rankGoals(
    (state.goals ?? []).filter((goal) => goal.status === "ACTIVE"),
    context,
  );
  const primary = ranked[0] ?? null;
  const goal: GoalTrajectoryInput | null = primary
    ? {
        goalId: primary.goal.id,
        name: primary.goal.name,
        targetDate: primary.goal.definition?.targetDate ?? primary.goal.targetDate ?? null,
        relativeGap: primary.evaluation?.gap?.relativeGap ?? null,
        satisfiedNow: primary.evaluation?.satisfiedNow ?? null,
        blockers: (primary.evaluation?.blockers ?? [])
          .filter((blocker) => blocker.blocking)
          .map((blocker) => blocker.code),
      }
    : null;

  const reserves: ReserveInput[] = context.blockers.map((blocker) => ({
    code: blocker.code,
    blocking: blocker.blocking,
    origin: RESERVE_ORIGIN[blocker.source] ?? "un moteur de domaine",
    href: reserveHref(blocker.source),
  }));

  const railSources: RailSourceView[] = railSourcesFor(PAGE_REGISTRY.today!, state).map(
    (source) => ({
      id: source.id,
      category: source.category,
      name: source.name,
      status: source.status,
      // La date est AFFICHÉE et l'utilisateur juge : aucun seuil de fraîcheur n'est déclaré
      // dans le produit, et en poser un ici serait décider « si une anomalie est assez
      // importante pour alerter », ce que le §16 refuse.
      hint: source.latestDate,
    }),
  );

  return {
    asOfDate: state.asOfDate,
    reportingCurrency: state.reportingCurrency,
    netWorth: {
      value: balanceSheet.netWorth.value,
      blockers: balanceSheet.netWorth.blockers,
    },
    immediateCash: {
      value: balanceSheet.immediateCash.value,
      blockers: balanceSheet.immediateCash.blockers,
    },
    closes: state.monthlyCloses ?? [],
    observedFlow: {
      periodStart: month.start,
      periodEnd: month.end,
      transactionCount: observed.transactionCount,
      income: observed.income,
      essentialExpenses: observed.essentialExpenses,
      debtServicePaid: observed.debtServicePaid,
      cashFlowAfterDebt: observed.cashFlowAfterDebt,
      unclassifiedFlows: observed.unclassifiedFlows,
      // La couverture est celle que le moteur DÉCLARE, jamais une déduction depuis la présence
      // d'opérations : un mois avec trois opérations n'est pas un mois couvert, et une absence
      // d'historique n'est pas un mois à zéro.
      fullyCovered: observed.coverage.status === "COMPLETE",
    },
    goal,
    events: context.timeline.events,
    reserves,
    declarations,
    domainFacts: domainFacts(state),
    railSources,
    readOnlyDemo: options.readOnlyDemo ?? false,
  };
}

/**
 * Le modèle de lecture servi à la route.
 *
 * Les deux lectures — état canonique et déclarations — sont faites EN PARALLÈLE : elles ne
 * dépendent pas l'une de l'autre, et les enchaîner doublerait la latence de la page d'accueil
 * du produit sans rien garantir de plus.
 */
export async function getTodayReadModel(): Promise<TodayReadModel> {
  const repository = await getRepository();
  const [state, declarations] = await Promise.all([
    repository.getDashboardState(),
    repository.getDomainDeclarations(),
  ]);
  return buildTodayView(todayViewInputFrom(state, declarations));
}
