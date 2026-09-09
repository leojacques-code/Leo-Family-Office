import { PAGE_REGISTRY } from "@/lib/presentation/registry/pages";
import { railSourcesFor } from "@/lib/presentation/rail-sources";
import type { CanonicalEvent } from "@/lib/engine/event-contracts";
import type { MonthlyClose } from "@/lib/types";
import { buildAnswers, type AggregateInput } from "./answers";
import type { DomainDeclaration, InboxTask, RailSourceView, TodayReadModel } from "./contracts";
import { DOMAIN_REGISTRY } from "./domains";
import {
  buildCloseChange,
  buildGoalTrajectory,
  buildMonthFlow,
  type GoalTrajectoryInput,
  type ObservedFlowInput,
} from "./flow";
import { buildInbox, type ReserveInput } from "./inbox";
import { buildObligations } from "./obligations";
import { buildPriorityActions } from "./actions";
import {
  buildDomainStatuses,
  buildInstallationPath,
  profileStageOf,
  type DomainFactsPresence,
} from "./onboarding";

/**
 * Assemblage du modèle de lecture d'Aujourd'hui.
 *
 * FONCTION PURE. Elle ne lit ni base, ni requête, ni horloge : la date d'arrêté lui est
 * DONNÉE. C'est ce qui la rend testable sur les cinq états du §41 — vide, partiel, complet,
 * conflit, scénario — sans monter ni Supabase ni React, et c'est la couche que le §10.2 nomme
 * `src/lib/presentation/today/`.
 *
 * ELLE NE CALCULE AUCUNE FINANCE. Tous ses montants arrivent déjà agrégés par les moteurs
 * canoniques ; elle décide ce qui est AFFICHABLE, dans quel ordre, et sous quel état parmi les
 * huit du §6.3. Le §2 de la constitution du dépôt et le §14 du plan disent la même chose de
 * deux côtés : la présentation ne refait pas la finance, et on ne modifie pas les moteurs pour
 * simplifier l'interface.
 */

export interface TodayViewInput {
  readonly asOfDate: string;
  readonly reportingCurrency: string;
  /** Agrégats du bilan canonique, déjà lus. */
  readonly netWorth: AggregateInput;
  readonly immediateCash: AggregateInput;
  readonly closes: readonly MonthlyClose[];
  readonly observedFlow: ObservedFlowInput;
  readonly goal: GoalTrajectoryInput | null;
  readonly events: readonly CanonicalEvent[];
  /** Réserves du contexte financier partagé, non traduites. */
  readonly reserves: readonly ReserveInput[];
  readonly declarations: readonly DomainDeclaration[];
  readonly domainFacts: readonly DomainFactsPresence[];
  readonly railSources: readonly RailSourceView[];
  readonly readOnlyDemo: boolean;
}

/**
 * Les tâches proposées comme « éléments à préciser » du §19.2 item 5.
 *
 * Ce sont celles qui APPELLENT une intervention, dans l'ordre des vues de l'inbox. Une échéance
 * à venir n'en est pas : elle n'attend rien. Une résolution automatique non plus.
 */
function clarifiable(tasks: readonly InboxTask[]): InboxTask[] {
  return tasks.filter((task) => task.family !== null);
}

export function buildTodayView(input: TodayViewInput): TodayReadModel {
  const manifest = PAGE_REGISTRY.today;
  // Le manifeste est LU, pas supposé. Une page qui compose autre chose que son manifeste est un
  // bug même si l'écran est joli (§16, en-tête de `registry/contracts.ts`).
  if (!manifest) throw new Error("Manifeste `today` absent du registre des pages");

  const domains = buildDomainStatuses(input.declarations, input.domainFacts);
  const obligations = buildObligations({
    events: input.events,
    asOfDate: input.asOfDate,
    reportingCurrency: input.reportingCurrency,
  });
  const inbox = buildInbox({ reserves: input.reserves, obligations, domains });
  const allTasks = inbox.sections.flatMap((section) => section.tasks);
  const installation = buildInstallationPath(domains, clarifiable(allTasks));
  const profileStage = profileStageOf(domains, installation.steps);

  const monthFlow = buildMonthFlow(input.observedFlow);
  const closeChange = buildCloseChange(input.closes, input.reportingCurrency);
  const goalTrajectory = buildGoalTrajectory(input.goal);

  return {
    manifestVersion: manifest.version,
    asOfDate: input.asOfDate,
    reportingCurrency: input.reportingCurrency,
    profileStage,
    // Le parcours disparaît en exploitation. Le garder afficherait une liste de cases cochées
    // en haut de la page la plus consultée du produit, ce que le §21 de V10 refuse.
    installation: profileStage === "OPERATING" ? null : installation,
    answers: buildAnswers({
      netWorth: input.netWorth,
      immediateCash: input.immediateCash,
      closeChange: closeChange.view?.amount ?? null,
      closeChangeReserve: closeChange.reserve,
      monthFlow,
      goalTrajectory,
      pendingCount: inbox.pendingCount,
      obligationCount: obligations.length,
    }),
    monthFlow,
    closeChange: closeChange.view,
    closeChangeReserve: closeChange.reserve,
    goalTrajectory,
    actions: buildPriorityActions({
      installationSteps: installation.steps,
      tasks: allTasks,
      domains,
    }),
    obligations,
    inbox,
    railSources: input.railSources,
    domains,
    readOnlyDemo: input.readOnlyDemo,
  };
}

/**
 * Les KPI que la composition SERT réellement, dans l'ordre des six réponses.
 *
 * Exposé pour être confronté au manifeste par un test. Le §39 fait refuser par le CI « une page
 * qui référence un KPI hors registre », et le refus de la phase 0 ne portait que sur
 * `essentialKpis` : il ne pouvait pas voir ce qu'une page rend, aucune page n'étant branchée.
 * Ce tableau ferme l'écart pour Aujourd'hui, qui est la première page branchée.
 */
export function servedKpiIds(model: TodayReadModel): string[] {
  return [...new Set(model.answers.flatMap((answer) => answer.kpiIds))];
}

/** Les sources que le manifeste déclare pour Aujourd'hui, telles que le rail les lira. */
export { railSourcesFor, DOMAIN_REGISTRY };
