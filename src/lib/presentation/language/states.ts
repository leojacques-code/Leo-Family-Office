/**
 * Les huit états utilisateur de la section 6.3 du plan de refonte.
 *
 * Le produit ne connaissait qu'une distinction : « valeur ou `null` », et `null` était rendu
 * par une chaîne unique, « Non calculable », répétée 102 fois dans 19 fichiers. Or une
 * information absente parce qu'elle n'a jamais été saisie, une information absente parce que
 * l'utilisateur a DÉCLARÉ ne pas être concerné, deux sources qui se contredisent et une panne
 * de chargement ne demandent pas la même chose à l'écran ni à l'utilisateur.
 *
 * Cet état ne dit pas seulement quoi ÉCRIRE : il dit quoi FAIRE. C'est la différence entre
 * traduire un code et le rendre utilisable.
 */
export type PresentationState =
  /** Valeur disponible et sourcée. */
  | "AVAILABLE"
  /** Valeur utilisable, avec une limite à montrer près d'elle. */
  | "PARTIAL"
  /** Inconnu et non essentiel : ne rien afficher plutôt qu'encombrer. */
  | "UNKNOWN_NON_ESSENTIAL"
  /** Inconnu mais activable par une action locale et non alarmiste. */
  | "UNKNOWN_ACTIVATABLE"
  /** Inconnu et bloquant une décision concrète : devient une tâche priorisée. */
  | "UNKNOWN_BLOCKING"
  /** L'utilisateur a déclaré ne pas être concerné. Ce n'est pas une absence de donnée. */
  | "DECLARED_NONE"
  /** Deux sources se contredisent : l'arbitrage est explicite, jamais silencieux. */
  | "SOURCE_CONFLICT"
  /** Panne technique : un incident, pas une information financière. */
  | "SYSTEM_ERROR";

/** Ce que la surface doit FAIRE de l'état, et non seulement ce qu'elle doit écrire. */
export type PresentationBehaviour =
  | "RENDER"
  | "RENDER_WITH_RESERVE"
  | "HIDE"
  | "OFFER_LOCAL_ACTION"
  | "QUEUE_PRIORITISED_TASK"
  | "HIDE_DOMAIN_REACTIVABLE"
  | "REQUIRE_EXPLICIT_REVIEW"
  | "REPORT_INCIDENT";

export interface StateContract {
  /** Titre court, en français, jamais un code. */
  readonly label: string;
  /** Ce que la surface fait de cet état. */
  readonly behaviour: PresentationBehaviour;
  /**
   * L'état autorise-t-il à afficher une valeur ?
   *
   * Sert de garde-fou de composition : un état qui ne porte pas de valeur ne doit pas
   * occuper une carte de métrique, ce qui est précisément le défaut du constat 5.6.
   */
  readonly carriesValue: boolean;
}

export const STATE_CONTRACTS: Readonly<Record<PresentationState, StateContract>> = {
  AVAILABLE: { label: "Disponible", behaviour: "RENDER", carriesValue: true },
  PARTIAL: { label: "Partiel", behaviour: "RENDER_WITH_RESERVE", carriesValue: true },
  UNKNOWN_NON_ESSENTIAL: { label: "Non renseigné", behaviour: "HIDE", carriesValue: false },
  UNKNOWN_ACTIVATABLE: {
    label: "À compléter",
    behaviour: "OFFER_LOCAL_ACTION",
    carriesValue: false,
  },
  UNKNOWN_BLOCKING: {
    label: "À compléter en priorité",
    behaviour: "QUEUE_PRIORITISED_TASK",
    carriesValue: false,
  },
  DECLARED_NONE: {
    label: "Vous n’êtes pas concerné",
    behaviour: "HIDE_DOMAIN_REACTIVABLE",
    carriesValue: false,
  },
  SOURCE_CONFLICT: {
    label: "À vérifier",
    behaviour: "REQUIRE_EXPLICIT_REVIEW",
    carriesValue: false,
  },
  SYSTEM_ERROR: {
    label: "Impossible de charger",
    behaviour: "REPORT_INCIDENT",
    carriesValue: false,
  },
};

/**
 * Taxonomie commune demandée par la section 11 : incomplet, à confirmer, conflit, incident.
 *
 * C'est la famille sous laquelle un état se regroupe dans une boîte de réception. Elle est
 * plus grossière que l'état lui-même, volontairement : une inbox à huit onglets serait
 * l'inventaire technique que le plan reproche déjà à Beyonder.
 */
export type IssueFamily = "INCOMPLETE" | "TO_CONFIRM" | "CONFLICT" | "INCIDENT";

export const ISSUE_FAMILY_LABELS: Readonly<Record<IssueFamily, string>> = {
  INCOMPLETE: "Données manquantes",
  TO_CONFIRM: "À confirmer",
  CONFLICT: "Conflits",
  INCIDENT: "Incidents",
};

const STATE_FAMILIES: Readonly<Record<PresentationState, IssueFamily | null>> = {
  // Un état qui n'appelle aucune intervention n'entre pas dans la boîte de réception.
  AVAILABLE: null,
  UNKNOWN_NON_ESSENTIAL: null,
  DECLARED_NONE: null,
  PARTIAL: "TO_CONFIRM",
  UNKNOWN_ACTIVATABLE: "INCOMPLETE",
  UNKNOWN_BLOCKING: "INCOMPLETE",
  SOURCE_CONFLICT: "CONFLICT",
  SYSTEM_ERROR: "INCIDENT",
};

/** `null` signifie que l'état n'appelle aucune intervention et ne rejoint aucune vue d'inbox. */
export function issueFamilyOf(state: PresentationState): IssueFamily | null {
  return STATE_FAMILIES[state];
}

/**
 * Gravité relative des états, pour choisir CELUI qui domine un ensemble de réserves.
 *
 * Un incident technique n'est pas une information financière et prime sur tout : afficher
 * « à compléter » alors que le chargement a échoué ferait chercher une donnée qui existe.
 * Un conflit de sources vient ensuite, parce qu'une valeur affichée peut être fausse.
 */
const STATE_SEVERITY: Readonly<Record<PresentationState, number>> = {
  SYSTEM_ERROR: 7,
  SOURCE_CONFLICT: 6,
  UNKNOWN_BLOCKING: 5,
  UNKNOWN_ACTIVATABLE: 4,
  PARTIAL: 3,
  UNKNOWN_NON_ESSENTIAL: 2,
  DECLARED_NONE: 1,
  AVAILABLE: 0,
};

/** État dominant d'un ensemble. Un ensemble vide est `AVAILABLE` : rien ne fait réserve. */
export function dominantState(states: readonly PresentationState[]): PresentationState {
  return states.reduce<PresentationState>(
    (worst, state) => (STATE_SEVERITY[state] > STATE_SEVERITY[worst] ? state : worst),
    "AVAILABLE",
  );
}
