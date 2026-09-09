import { issueFamilyOf, translateIssues, type IssueFamily } from "@/lib/presentation/language";
import { STATE_CONTRACTS, type PresentationState } from "@/lib/presentation/language/states";
import type {
  DomainStatusView,
  InboxSection,
  InboxTask,
  InboxView,
  InboxViewId,
  ObligationView,
} from "./contracts";

/**
 * Boîte de réception d'Aujourd'hui : les SIX vues du §32.
 *
 * « Six vues : À vérifier, Conflits, Données manquantes, Données anciennes, À venir et
 * Résolus automatiquement. » Le §11 en fait une exigence de contenu de cette phase, et ajoute
 * le contrat de CHAQUE tâche : « chaque tâche explique fait, importance, preuve et effet de
 * l'acceptation ». Le §17 zone F le redit dans les mêmes termes.
 *
 * SIX VUES ≠ QUATRE FAMILLES, et les confondre était le premier piège de cette phase. La
 * phase 0 a livré `IssueFamily` — incomplet, à confirmer, conflit, incident — qui répond à
 * « de quelle NATURE est cette réserve ». Les six vues du §32 répondent à « dans quel ONGLET
 * se range-t-elle », et trois d'entre elles ne dérivent d'aucune famille : une échéance à
 * venir n'est pas une anomalie, une résolution automatique n'est pas un problème, et une
 * donnée ancienne n'est pas une donnée absente.
 */

/** Libellés des six vues, transcrits du §32. */
export const INBOX_VIEW_LABELS: Readonly<Record<InboxViewId, string>> = {
  TO_VERIFY: "À vérifier",
  CONFLICTS: "Conflits",
  MISSING: "Données manquantes",
  STALE: "Données anciennes",
  UPCOMING: "À venir",
  AUTO_RESOLVED: "Résolus automatiquement",
};

/** Ordre des vues, celui du §32. Il n'est pas décoratif : il va du plus urgent au plus calme. */
export const INBOX_VIEW_ORDER: readonly InboxViewId[] = [
  "TO_VERIFY",
  "CONFLICTS",
  "MISSING",
  "STALE",
  "UPCOMING",
  "AUTO_RESOLVED",
];

/**
 * De la famille d'une réserve à sa vue.
 *
 * ARBITRAGE, écrit ici plutôt que laissé implicite : `INCIDENT` va dans « À vérifier ». Le §32
 * n'a pas de vue « Incidents », alors que la taxonomie du §11 a une famille de ce nom. Les
 * trois autres placements sont évidents ; celui-là est un choix. « À vérifier » est la vue de
 * ce qui demande un examen explicite (`REQUIRE_EXPLICIT_REVIEW`), et un incident en demande
 * un. Le ranger dans « Conflits » aurait affirmé une contradiction de sources là où il n'y a
 * qu'une panne, et lui inventer une septième vue aurait modifié le §32 sans décision écrite,
 * ce que le §38 règle 2 interdit. La tâche garde son état `SYSTEM_ERROR`, donc son rendu reste
 * distinct de celui d'une réserve ordinaire.
 */
const FAMILY_TO_VIEW: Readonly<Record<IssueFamily, InboxViewId>> = {
  TO_CONFIRM: "TO_VERIFY",
  CONFLICT: "CONFLICTS",
  INCOMPLETE: "MISSING",
  INCIDENT: "TO_VERIFY",
};

/**
 * Pourquoi une réserve compte, et ce que la traiter change.
 *
 * LE NIVEAU DE CETTE EXPLICATION EST ASSUMÉ. Elle est écrite par FAMILLE et non par code : le
 * registre en porte 144, et leur écrire à chacun une phrase d'importance sans source serait
 * inventer 144 jugements — précisément ce que le §16 refuse (« si une anomalie est assez
 * importante pour alerter »). Ce que la tâche dit de SPÉCIFIQUE est son fait, qui vient du
 * libellé traduit du code, et sa preuve, qui nomme le moteur émetteur. L'importance et l'effet
 * décrivent la CONSÉQUENCE de la famille, qui est vraie pour tous ses membres.
 */
const FAMILY_EXPLANATION: Readonly<
  Record<IssueFamily, { readonly importance: string; readonly effect: string }>
> = {
  INCOMPLETE: {
    importance:
      "Les indicateurs qui dépendent de cette donnée restent non calculables. Ils ne sont pas remplacés par zéro, ils sont absents.",
    effect:
      "La donnée fournie, l’indicateur devient calculable et apparaît sans autre action de votre part.",
  },
  TO_CONFIRM: {
    importance:
      "La valeur est utilisable mais incomplète : elle porte une réserve qui limite ce qu’on peut en conclure.",
    effect: "La confirmation lève la réserve et la valeur devient pleinement exploitable.",
  },
  CONFLICT: {
    importance:
      "Deux sources ne disent pas la même chose. Tant que l’arbitrage n’est pas fait, la valeur affichée peut être fausse.",
    effect:
      "Votre arbitrage est enregistré avec son motif : la source retenue est tracée et la valeur cesse d’être douteuse.",
  },
  INCIDENT: {
    importance:
      "Ce n’est pas une information financière : un chargement a échoué. La donnée existe peut-être et n’a pas pu être lue.",
    effect: "Une fois l’incident levé, la donnée est relue telle qu’elle est, sans être devinée.",
  },
};

/** Ce qu'une réserve bloquante ajoute à son importance. */
const BLOCKING_SUFFIX =
  " Cette réserve est BLOQUANTE : le contexte financier partagé ne produit pas de résultat tant qu’elle tient.";

export interface ReserveInput {
  /** Code brut du moteur, identifiant technique compris. Jamais affiché tel quel. */
  readonly code: string;
  /** La réserve empêche-t-elle le contexte partagé de conclure ? */
  readonly blocking: boolean;
  /** Nom français du moteur émetteur. C'est la PREUVE de la tâche. */
  readonly origin: string;
  /** Destination utile pour traiter, ou `null`. */
  readonly href: string | null;
}

/**
 * Une réserve qu'aucune traduction ne couvre.
 *
 * Elle devient une tâche d'INCIDENT et son code part au volet technique. Le §10.2 veut que
 * « toute sortie technique non traduite échoue en développement » : c'est le rôle du gate de
 * registre de la phase 0. Ici, à l'exécution, la taire ferait croire que tout va bien, et
 * l'afficher ramènerait le `SCREAMING_SNAKE_CASE` du constat 5.4. Elle est donc SIGNALÉE sans
 * être citée.
 */
const UNTRANSLATED_TITLE = "Réserve non traduite";

function taskFor(
  reserve: ReserveInput,
  label: string,
  state: PresentationState,
  technicalId: string | null,
  index: number,
): InboxTask {
  const family = issueFamilyOf(state);
  const view = family ? FAMILY_TO_VIEW[family] : "AUTO_RESOLVED";
  const explanation = family ? FAMILY_EXPLANATION[family] : null;
  return {
    id: `reserve-${index}-${state}`,
    view,
    title: label,
    fact: `${label} — réserve émise par ${reserve.origin}.`,
    importance: explanation
      ? explanation.importance + (reserve.blocking ? BLOCKING_SUFFIX : "")
      : // Une réserve sans famille n'attend RIEN de l'utilisateur : le moteur l'a réglée
        // lui-même, depuis une déclaration ou parce qu'elle ne conditionne aucun résultat
        // essentiel. C'est ce que le §32 appelle « résolus automatiquement ».
        "Aucune action n’est attendue : le moteur a réglé ce point sans vous le demander.",
    evidence: `Constat lu dans ${reserve.origin}, à la date d’arrêté du contexte partagé.`,
    effect: explanation
      ? explanation.effect
      : `État retenu : ${STATE_CONTRACTS[state].label}. Rien ne change si vous ne faites rien.`,
    state,
    family,
    href: family ? reserve.href : null,
    technicalId,
  };
}

/** Une échéance devient une tâche de la vue « À venir ». */
function obligationTask(obligation: ObligationView): InboxTask {
  return {
    id: `obligation-${obligation.id}`,
    view: "UPCOMING",
    title: obligation.label,
    fact: `${obligation.label} — ${obligation.domainLabel}, au ${obligation.date}.`,
    importance:
      obligation.amount === null
        ? "L’échéance est datée mais son montant n’est pas connu : elle ne peut pas être provisionnée."
        : "Elle tombe dans les trente jours et pèse sur la trésorerie disponible.",
    evidence: `Échéance ${obligation.evidenceLabel.toLowerCase()} du registre d’événements canoniques.`,
    effect:
      "Rien à valider : l’échéance est déjà un fait daté. Elle disparaît de cette vue une fois passée.",
    // Une échéance à venir n'est ni un manque ni un conflit : c'est une information
    // disponible. Lui donner un état de réserve la ferait compter comme un problème dans
    // `pending_review_count`, alors qu'elle n'attend aucune décision.
    state: "AVAILABLE",
    family: null,
    href: "/timeline",
    technicalId: null,
  };
}

/**
 * Une contradiction entre une déclaration et les faits.
 *
 * « Je ne suis pas concerné » n'autorise PAS à effacer des faits déjà saisis, et le §16
 * interdit de choisir entre la déclaration et le fait. La contradiction est donc montrée sans
 * être tranchée : c'est un conflit de sources, l'utilisateur étant l'une des deux.
 */
function contradictionTask(domain: DomainStatusView): InboxTask {
  return {
    id: `declaration-conflict-${domain.domain}`,
    view: "CONFLICTS",
    title: `${domain.label} : déclaré non concerné, mais des données existent`,
    fact: `Vous avez déclaré ne pas être concerné par ${domain.label.toLowerCase()}${
      domain.declaredOn ? ` le ${domain.declaredOn}` : ""
    }, et des faits de ce domaine sont pourtant enregistrés.`,
    importance:
      "Les deux ne peuvent pas être vrais ensemble. Ni la déclaration ni les faits ne sont supprimés d’office : masquer le domaine ferait disparaître des montants réels du patrimoine.",
    evidence: `Déclaration d’applicabilité du domaine, et présence de faits lus dans ${domain.label.toLowerCase()}.`,
    effect:
      "Déclarer le domaine applicable le rouvre avec ses données. Retirer les données relève du domaine lui-même, jamais de cette tâche.",
    state: "SOURCE_CONFLICT",
    family: "CONFLICT",
    href: domain.manualHref,
    technicalId: null,
  };
}

/**
 * Motif d'une vue vide POUR UNE RAISON, distinct d'une vue vide parce que rien n'y entre.
 *
 * « Données anciennes » est le seul cas, et c'est le plan qui le crée. La vue suppose un seuil
 * de fraîcheur — trois mois pour un relevé, deux ans pour une valorisation ? — et le §16
 * interdit à un agent de décider « si une anomalie est assez importante pour alerter ». Le §40
 * range la fraîcheur parmi les couches dont les règles restent VERSIONNÉES et sourcées. Aucun
 * seuil n'est déclaré dans ce dépôt : `rail-sources.ts` de la phase 1 le consigne déjà sous
 * `RENEWAL_THRESHOLD_IS_UNDECLARED`.
 *
 * Afficher « aucune donnée ancienne » affirmerait une fraîcheur qui n'a jamais été mesurée. La
 * vue dit donc ce qui est vrai : la question n'a pas de convention pour être posée.
 */
export const STALE_VIEW_EMPTY_REASON =
  "Aucun seuil de fraîcheur n’est déclaré dans le produit. Une donnée ancienne ne peut donc pas être distinguée d’une donnée récente : la date de chaque source est affichée dans le rail, et le jugement vous revient.";

export interface BuildInboxInput {
  readonly reserves: readonly ReserveInput[];
  readonly obligations: readonly ObligationView[];
  readonly domains: readonly DomainStatusView[];
}

export function buildInbox(input: BuildInboxInput): InboxView {
  const tasks: InboxTask[] = [];

  // Les réserves sont traduites EN BLOC, ce qui les dédoublonne par libellé : deux codes
  // distincts disant la même phrase ne font pas deux tâches. La correspondance code → réserve
  // se refait ensuite par le code rendu par le traducteur.
  const byCode = new Map<string, ReserveInput>();
  for (const reserve of input.reserves) {
    const bare = reserve.code.split(":")[0]!;
    const existing = byCode.get(bare);
    // Une réserve bloquante l'emporte sur la même réserve non bloquante : le contexte partagé
    // émet parfois les deux, et retenir la moins grave masquerait le blocage.
    if (!existing || (reserve.blocking && !existing.blocking)) byCode.set(bare, reserve);
  }

  const translated = translateIssues(input.reserves.map((reserve) => reserve.code));
  translated.issues.forEach((issue, index) => {
    const reserve = byCode.get(issue.code);
    if (!reserve) return;
    tasks.push(taskFor(reserve, issue.label, issue.state, issue.identifier, index));
  });

  if (translated.untranslated.length > 0) {
    tasks.push({
      id: "reserve-untranslated",
      view: "TO_VERIFY",
      title: UNTRANSLATED_TITLE,
      fact: `${translated.untranslated.length} réserve(s) émise(s) par un moteur ne portent pas de libellé dans le registre de traduction.`,
      importance:
        "Le produit ne sait pas ce qu’il devrait vous dire. Le taire laisserait croire que tout va bien ; l’afficher tel quel remettrait un code technique sous vos yeux.",
      evidence: "Registre de traduction des codes de réserve : aucune entrée pour ce code.",
      effect:
        "Rien de votre côté. Le code est consultable dans le volet technique et relève d’une correction du produit.",
      state: "SYSTEM_ERROR",
      family: "INCIDENT",
      href: null,
      // Le code brut part au volet technique, jamais dans le corps de la tâche.
      technicalId: translated.untranslated.join(", "),
    });
  }

  for (const domain of input.domains) {
    if (domain.applicability === "DECLARED_NONE" && domain.hasFacts) {
      tasks.push(contradictionTask(domain));
    }
  }

  for (const obligation of input.obligations) tasks.push(obligationTask(obligation));

  const sections: InboxSection[] = INBOX_VIEW_ORDER.map((id) => ({
    id,
    label: INBOX_VIEW_LABELS[id],
    tasks: tasks.filter((task) => task.view === id),
    emptyBecause: id === "STALE" ? STALE_VIEW_EMPTY_REASON : null,
  }));

  return {
    sections,
    // `pending_review_count` du registre des KPI : « nombre de réserves dont l'état demande
    // une intervention ». Une échéance à venir et une résolution automatique n'en demandent
    // aucune : les compter gonflerait le compteur de ce qui ne vous attend pas.
    pendingCount: tasks.filter((task) => task.family !== null).length,
  };
}
