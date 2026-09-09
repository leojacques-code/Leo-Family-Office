import { STATE_CONTRACTS } from "@/lib/presentation/language/states";
import type { DomainStatusView, InboxTask, InstallationStep, PriorityAction } from "./contracts";

/**
 * Les trois actions prioritaires (§20 item 5 : « trois actions maximum »).
 *
 * TROIS EST UN PLAFOND, PAS UN QUOTA. Le §13 en fait une mesure de réussite — « Today
 * n'affiche jamais plus de trois actions prioritaires » — et le manifeste `today` de la phase 0
 * l'écrit dans son `deferred` : « plus de trois actions prioritaires : au-delà, ce n'est plus
 * une priorité ». Une page qui en montre douze ne priorise pas, elle inventorie ; c'est ce que
 * le §35 refuse de Beyonder, « pas une page de logs ».
 *
 * L'ORDRE EST DÉTERMINISTE ET IL EST ÉCRIT ICI. Le §16 interdit à une IA de décider « si une
 * anomalie est assez importante pour alerter » : le rang ne vient donc d'aucun score calculé
 * ni d'aucun jugement de modèle. Il vient de trois clés lues dans l'ordre, et l'identifiant
 * départage en dernier, de sorte que l'ordre d'entrée n'a aucun effet.
 *
 * BEYONDER N'ORDONNE PAS CETTE LISTE. Le §35 est explicite : « le moteur déterministe décide
 * des faits, de la calculabilité, de la matérialité et des actions autorisées. Le provider
 * génératif peut reformuler EXCLUSIVEMENT à partir des preuves citées ». Cette fonction est ce
 * moteur déterministe ; la reformulation, si elle a lieu un jour, s'appliquera à un texte déjà
 * décidé ici.
 */

export const MAX_PRIORITY_ACTIONS = 3;

/**
 * Gravité d'un état pour le classement des actions.
 *
 * Reprise de la sévérité de la phase 0 plutôt que réécrite : deux barèmes concurrents pour la
 * même notion divergeraient au premier ajout d'état. Les seuls états qui produisent une action
 * sont ceux dont le contrat demande une intervention.
 */
const ACTIONABLE_BEHAVIOURS = new Set([
  "QUEUE_PRIORITISED_TASK",
  "REQUIRE_EXPLICIT_REVIEW",
  "REPORT_INCIDENT",
  "OFFER_LOCAL_ACTION",
]);

const BEHAVIOUR_RANK: Readonly<Record<string, number>> = {
  REPORT_INCIDENT: 0,
  REQUIRE_EXPLICIT_REVIEW: 1,
  QUEUE_PRIORITISED_TASK: 2,
  OFFER_LOCAL_ACTION: 3,
};

export interface BuildActionsInput {
  /** Étapes du parcours d'installation. Une installation inachevée précède tout le reste. */
  readonly installationSteps: readonly InstallationStep[];
  /** Tâches de la boîte de réception, déjà expliquées. */
  readonly tasks: readonly InboxTask[];
  readonly domains: readonly DomainStatusView[];
}

/**
 * Une étape d'installation devient une action.
 *
 * Elle passe AVANT les réserves de moteur, et ce n'est pas un choix esthétique : une réserve de
 * calcul sur un patrimoine vide demande de préciser une donnée qui n'a pas encore de raison
 * d'exister. Envoyer quelqu'un compléter une quote-part avant qu'il n'ait connecté sa banque
 * est la « succession d'erreurs » que le critère du §11 interdit.
 */
function installationAction(step: InstallationStep): PriorityAction {
  return {
    id: `install-${step.id}`,
    label: step.label,
    href: step.href,
    fact:
      step.status === "UNDECIDED"
        ? `Vous avez répondu « je ne sais pas encore » pour cette étape : ${step.label.toLowerCase()}.`
        : `Cette étape de l’installation n’est pas faite : ${step.label.toLowerCase()}.`,
    importance: step.reason,
    evidence:
      "Aucun fait n’est enregistré pour les domaines de cette étape, et aucune déclaration ne la clôt.",
    effect:
      "Les indicateurs qui dépendent de ces données deviennent calculables, et l’étape disparaît du parcours. Répondre « je ne suis pas concerné » la clôt aussi.",
    state: step.status === "UNDECIDED" ? "UNKNOWN_ACTIVATABLE" : "UNKNOWN_BLOCKING",
  };
}

function taskAction(task: InboxTask): PriorityAction {
  return {
    id: `task-${task.id}`,
    label: task.title,
    href: task.href ?? "/timeline",
    fact: task.fact,
    importance: task.importance,
    evidence: task.evidence,
    effect: task.effect,
    state: task.state,
  };
}

/**
 * Les actions prioritaires, au plus trois.
 *
 * Le PLAFOND est appliqué en dernier, après un classement complet : tronquer avant de classer
 * ferait dépendre le résultat de l'ordre d'entrée, et deux lectures de la même situation ne
 * donneraient pas les mêmes trois actions.
 */
export function buildPriorityActions(input: BuildActionsInput): PriorityAction[] {
  const candidates: PriorityAction[] = [];

  for (const step of input.installationSteps) {
    if (step.status === "TODO" || step.status === "UNDECIDED") {
      candidates.push(installationAction(step));
    }
  }

  for (const task of input.tasks) {
    const behaviour = STATE_CONTRACTS[task.state].behaviour;
    if (!ACTIONABLE_BEHAVIOURS.has(behaviour)) continue;
    candidates.push(taskAction(task));
  }

  return candidates
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      // 1. Une étape d'installation d'abord : rien ne se précise sur un profil vide.
      const install =
        Number(right.action.id.startsWith("install-")) -
        Number(left.action.id.startsWith("install-"));
      if (install !== 0) return install;
      // 2. Puis la gravité de l'état, selon le contrat de la phase 0.
      const behaviour =
        BEHAVIOUR_RANK[STATE_CONTRACTS[left.action.state].behaviour]! -
        BEHAVIOUR_RANK[STATE_CONTRACTS[right.action.state].behaviour]!;
      if (behaviour !== 0) return behaviour;
      // 3. Puis l'ordre d'apparition, qui est celui des étapes puis des vues de l'inbox.
      if (left.index !== right.index) return left.index - right.index;
      // 4. L'identifiant départage, pour que l'ordre soit total et reproductible.
      return left.action.id.localeCompare(right.action.id);
    })
    .map((entry) => entry.action)
    .slice(0, MAX_PRIORITY_ACTIONS);
}
