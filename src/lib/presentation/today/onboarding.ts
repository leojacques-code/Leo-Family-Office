import { DOMAIN_REGISTRY, domainDefinition } from "./domains";
import type {
  DeclarableDomain,
  DomainApplicability,
  DomainDeclaration,
  DomainStatusView,
  InboxTask,
  InstallationPath,
  InstallationStep,
  ProfileStage,
} from "./contracts";

/**
 * Parcours d'installation du §19.2 (« chemin initial court ») et état des domaines du
 * §19.1 item 4.
 *
 * Le critère d'acceptation du §11 est le point dur : « un profil vide obtient un parcours
 * d'installation, pas une succession d'erreurs ». Un profil vide voyait quatorze pages de
 * cartes en attente et de réserves de moteur — le constat 5.6, « l'absence de données devient
 * la matière principale des écrans ». Un parcours n'est pas une carte de bienvenue : c'est un
 * ordre d'opérations où chaque étape sait si elle est faite, et où « je ne suis pas concerné »
 * termine une étape aussi valablement que l'avoir remplie.
 *
 * UNE ÉTAPE EST FAITE QUAND LES FAITS LE PROUVENT. Jamais quand l'utilisateur a cliqué :
 * ouvrir l'écran d'import et abandonner ne remplit rien, et cocher l'étape ferait croire à une
 * banque connectée. C'est la même règle que le rail de sources de la phase 1.
 */

/**
 * Les cinq étapes du §19.2, transcrites dans son ordre :
 *
 *   1. connecter ou importer la banque ;
 *   2. connecter ou importer les investissements ;
 *   3. ajouter un bien, une société ou une dette seulement si applicable ;
 *   4. déposer les documents disponibles ;
 *   5. afficher ensuite au maximum cinq éléments à préciser.
 *
 * La cinquième n'est pas une étape mais un RÉSULTAT : elle est portée par `toClarify` et non
 * par cette liste. La ranger parmi les étapes en ferait une action à faire, alors que le plan
 * la décrit comme ce qui s'affiche « ensuite ».
 *
 * L'ÉTAPE 3 GROUPE TROIS DOMAINES parce que le plan les groupe : « un bien, une société ou une
 * dette seulement si applicable ». Les séparer en trois étapes ferait de « je n'ai ni bien, ni
 * société, ni dette » trois refus successifs là où le plan en fait une seule question de
 * pertinence.
 */
interface StepDefinition {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly href: string;
  readonly domains: readonly DeclarableDomain[];
}

const STEP_DEFINITIONS: readonly StepDefinition[] = [
  {
    id: "bank",
    label: "Connecter ou importer la banque",
    reason: "Les comptes et les opérations datent tout le reste.",
    href: "/imports",
    domains: ["BANQUE"],
  },
  {
    id: "investments",
    label: "Connecter ou importer les placements",
    reason: "Les enveloppes expliquent la composition du patrimoine financier.",
    href: "/imports",
    domains: ["INVESTISSEMENT"],
  },
  {
    id: "assets",
    label: "Ajouter un bien, une société ou une dette",
    reason: "Seulement si vous êtes concerné : chacun des trois peut être déclaré absent.",
    href: "/net-worth",
    domains: ["IMMOBILIER", "ENTREPRISE", "DETTE"],
  },
  {
    id: "documents",
    label: "Déposer les documents disponibles",
    reason: "Un bulletin, un avis fiscal ou une liasse remplacent une saisie manuelle.",
    href: "/documents",
    domains: ["CARRIERE", "FISCALITE"],
  },
];

export interface DomainFactsPresence {
  readonly domain: DeclarableDomain;
  readonly hasFacts: boolean;
}

/**
 * L'état d'un domaine : ce que l'utilisateur a déclaré, et ce que les faits disent.
 *
 * `UNDECLARED` n'est PAS `UNDECIDED`. La première dit que la question n'a jamais été posée —
 * l'onboarding la posera ; la seconde qu'elle l'a été et que la réponse est « pas encore ». Les
 * confondre ferait reposer la question à quelqu'un qui y a déjà répondu, ce qui est exactement
 * ce que le §18 reproche aux formulaires du produit actuel.
 */
export function buildDomainStatuses(
  declarations: readonly DomainDeclaration[],
  facts: readonly DomainFactsPresence[],
): DomainStatusView[] {
  const byDomain = new Map<DeclarableDomain, DomainDeclaration>(
    declarations.map((declaration) => [declaration.domain, declaration]),
  );
  const factsByDomain = new Map<DeclarableDomain, boolean>(
    facts.map((entry) => [entry.domain, entry.hasFacts]),
  );
  return DOMAIN_REGISTRY.map((definition) => {
    const declaration = byDomain.get(definition.id) ?? null;
    return {
      domain: definition.id,
      label: definition.label,
      applicability: declaration?.applicability ?? ("UNDECLARED" as const),
      declaredOn: declaration?.declaredOn ?? null,
      note: declaration?.note ?? null,
      hasFacts: factsByDomain.get(definition.id) ?? false,
      sourceHref: definition.sourceHref,
      manualHref: definition.manualHref,
      sourceCategory: definition.sourceCategory,
    };
  });
}

/**
 * Statut d'une étape, à partir des domaines qu'elle couvre.
 *
 * L'ORDRE DE PRÉCÉDENCE EST DÉLIBÉRÉ, et il place le fait avant la déclaration : une étape
 * dont AU MOINS un domaine porte des faits est faite, même si les autres sont déclarés absents.
 * Puis, si tous les domaines de l'étape sont déclarés non concernés, l'étape est close — c'est
 * là que « je n'ai pas de bien/société/dette » devient un état valide et non un trou. Une
 * réponse « je ne sais pas encore » sur au moins un domaine met l'étape en attente, et non en
 * retard : le plan distingue les deux au §18.1.
 */
function stepStatus(
  step: StepDefinition,
  statuses: readonly DomainStatusView[],
): InstallationStep["status"] {
  const covered = statuses.filter((status) => step.domains.includes(status.domain));
  if (covered.some((status) => status.hasFacts)) return "DONE";
  if (covered.length > 0 && covered.every((status) => status.applicability === "DECLARED_NONE")) {
    return "DECLARED_NONE";
  }
  if (covered.some((status) => status.applicability === "UNDECIDED")) return "UNDECIDED";
  return "TODO";
}

/**
 * Étape du profil, qui décide si Aujourd'hui montre le parcours ou le cockpit.
 *
 * `EMPTY`   : aucun fait, aucune déclaration. Le parcours occupe le canvas.
 * `INSTALLING` : le parcours a commencé et n'est pas terminé. Les deux coexistent, le parcours
 *                d'abord — un cockpit dont la moitié des réponses est non calculable n'aide pas.
 * `OPERATING`  : toutes les étapes sont faites ou closes. Le parcours disparaît.
 */
export function profileStageOf(
  statuses: readonly DomainStatusView[],
  steps: readonly InstallationStep[],
): ProfileStage {
  const anyFacts = statuses.some((status) => status.hasFacts);
  const anyDeclaration = statuses.some((status) => status.applicability !== "UNDECLARED");
  if (!anyFacts && !anyDeclaration) return "EMPTY";
  return steps.every((step) => step.status === "DONE" || step.status === "DECLARED_NONE")
    ? "OPERATING"
    : "INSTALLING";
}

/** §19.2 item 5 : « afficher ensuite au maximum cinq éléments à préciser ». */
export const MAX_ITEMS_TO_CLARIFY = 5;

export function buildInstallationPath(
  statuses: readonly DomainStatusView[],
  toClarify: readonly InboxTask[],
): InstallationPath {
  const steps: InstallationStep[] = STEP_DEFINITIONS.map((definition, index) => ({
    id: definition.id,
    rank: index + 1,
    label: definition.label,
    reason: definition.reason,
    status: stepStatus(definition, statuses),
    href: definition.href,
    domains: definition.domains,
  }));
  return {
    steps,
    done: steps.filter((step) => step.status === "DONE").length,
    // Une étape close par une déclaration n'est PAS comptée comme applicable : un profil sans
    // bien, sans société et sans dette afficherait sinon « 2 étapes sur 4 » à quelqu'un qui a
    // fini son installation.
    applicable: steps.filter((step) => step.status !== "DECLARED_NONE").length,
    toClarify: toClarify.slice(0, MAX_ITEMS_TO_CLARIFY),
  };
}

/**
 * Les domaines qu'il reste à qualifier, dans l'ordre du registre.
 *
 * Sert l'écran de cadrage du §18.1 : la question « êtes-vous concerné ? » ne se pose que là où
 * elle n'a pas encore de réponse, et un domaine qui porte déjà des faits n'a pas besoin d'être
 * déclaré applicable — les faits le disent mieux qu'une case.
 */
export function domainsToQualify(statuses: readonly DomainStatusView[]): DomainStatusView[] {
  return statuses.filter(
    (status) =>
      !status.hasFacts &&
      status.applicability !== "DECLARED_NONE" &&
      status.applicability !== "APPLICABLE",
  );
}

export function applicabilityLabel(applicability: DomainApplicability | "UNDECLARED"): string {
  switch (applicability) {
    case "APPLICABLE":
      return "Concerné";
    case "DECLARED_NONE":
      return "Vous n’êtes pas concerné";
    case "UNDECIDED":
      return "Je ne sais pas encore";
    case "UNDECLARED":
      return "À qualifier";
  }
}

/** Le libellé d'un domaine, pour les surfaces qui n'ont que son identifiant. */
export function domainLabel(domain: DeclarableDomain): string {
  return domainDefinition(domain).label;
}
