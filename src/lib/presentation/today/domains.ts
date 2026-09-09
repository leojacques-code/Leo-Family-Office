import type { SourceCategory, SourceEvidence } from "@/lib/presentation/registry/contracts";
import type { DeclarableDomain } from "./contracts";

/**
 * Registre des huit domaines déclarables (§19.1 item 4).
 *
 * Il est ÉCRIT, pas dérivé. Le §16 interdit à une IA de décider « quelles sections
 * apparaissent » et le §38 règle 3 exige que toute nouvelle donnée « indique le KPI ou
 * l'utilité qu'elle débloque ». Chaque entrée porte donc sa référence de plan, comme les
 * lignes de source des manifestes de la phase 0.
 *
 * LES ROUTES NE SONT PAS INVENTÉES : elles sont reprises de `NAV_GROUPS` et des manifestes de
 * la phase 0, où chaque page déclare déjà quelles familles de faits l'alimentent. Écrire ici
 * une route qui n'existe pas produirait un parcours d'installation qui mène à une page 404,
 * ce qui est pire qu'un parcours absent.
 */

export interface DomainDefinition {
  readonly id: DeclarableDomain;
  /** Libellé français. Au plus deux mots : budget de texte du §3 de V10. */
  readonly label: string;
  /**
   * Pourquoi déclarer ce domaine, en une phrase concrète.
   *
   * Ce n'est pas une paraphrase du libellé : c'est ce que la déclaration DÉBLOQUE ou CLÔT.
   * Un domaine sans raison lisible ferait cocher une case pour rien, ce que le §16.2 refuse
   * pour les objectifs et qui vaut ici pour la même raison.
   */
  readonly reason: string;
  /**
   * Familles de faits dont la présence prouve que le domaine est alimenté.
   *
   * DÉCLARÉ ≠ ALIMENTÉ. Le domaine est déclaré par l'utilisateur ; son alimentation se LIT
   * dans les faits. C'est la même indirection que le rail de sources de la phase 1, et pour
   * la même raison : personne ne peut déclarer à la place des faits.
   */
  readonly evidence: readonly SourceEvidence[];
  /** Où connecter ou importer la source (§19.2 items 1, 2 et 4). */
  readonly sourceHref: string;
  /** Où saisir le fait à la main (§19.2 item 3). La saisie reste toujours disponible. */
  readonly manualHref: string;
  readonly sourceCategory: SourceCategory;
  readonly planRef: string;
}

export const DOMAIN_REGISTRY: readonly DomainDefinition[] = [
  {
    id: "BANQUE",
    label: "Banque",
    reason: "Les comptes et les opérations datent tout le reste : solde, flux et rapprochements.",
    evidence: ["BANK_ACCOUNTS", "BANK_TRANSACTIONS"],
    sourceHref: "/imports",
    manualHref: "/cash-flow",
    sourceCategory: "BANQUE",
    planRef: "§19.1 item 4 « banque » ; §19.2 item 1 « connecter ou importer la banque »",
  },
  {
    id: "INVESTISSEMENT",
    label: "Placements",
    reason: "Les enveloppes et leurs positions expliquent la composition du patrimoine financier.",
    evidence: ["POSITIONS", "PORTFOLIO_EVENTS"],
    sourceHref: "/imports",
    manualHref: "/investments",
    sourceCategory: "RELEVE_COURTIER",
    planRef:
      "§19.1 item 4 « investissement » ; §19.2 item 2 « connecter ou importer les investissements »",
  },
  {
    id: "DETTE",
    label: "Dettes",
    reason: "Un échéancier fourni remplace un échéancier reconstruit et fixe les sorties réelles.",
    evidence: ["LIABILITIES", "LIABILITY_PROVIDED_SCHEDULE"],
    sourceHref: "/imports",
    manualHref: "/debt",
    sourceCategory: "ECHEANCIER",
    planRef:
      "§19.1 item 4 « dette » ; §19.2 item 3 « ajouter ... une dette seulement si applicable »",
  },
  {
    id: "IMMOBILIER",
    label: "Immobilier",
    reason: "Un bien détenu porte une valeur datée, une exploitation et un financement rattaché.",
    evidence: ["REAL_ESTATE_ASSETS", "REAL_ESTATE_VALUATIONS"],
    sourceHref: "/documents",
    manualHref: "/real-estate",
    sourceCategory: "ACTE",
    planRef: "§19.1 item 4 « immobilier » ; §19.2 item 3 « ajouter un bien ... si applicable »",
  },
  {
    id: "CARRIERE",
    label: "Revenus",
    reason: "Le contrat et le bulletin rapprochent le net perçu de ce que la banque encaisse.",
    evidence: ["CAREER_ROLES", "CAREER_COMPENSATION"],
    sourceHref: "/documents",
    manualHref: "/career",
    sourceCategory: "BULLETIN",
    planRef: "§19.1 item 4 « carrière/revenus »",
  },
  {
    id: "ENTREPRISE",
    label: "Sociétés",
    reason:
      "Une participation entre au patrimoine par sa valeur attribuable, jamais par ses actifs.",
    evidence: ["BUSINESS_ENTITIES", "BUSINESS_FINANCIALS"],
    sourceHref: "/documents",
    manualHref: "/business-equity",
    sourceCategory: "LIASSE",
    planRef: "§19.1 item 4 « entreprise » ; §19.2 item 3 « ajouter ... une société si applicable »",
  },
  {
    id: "FISCALITE",
    label: "Fiscalité",
    reason: "Sans régime déclaré, un résultat après impôt reste non calculable plutôt qu'estimé.",
    evidence: ["TAX_OBSERVATIONS", "TAX_RULE_SETS"],
    sourceHref: "/documents",
    manualHref: "/tax",
    sourceCategory: "AVIS_FISCAL",
    planRef: "§19.1 item 4 « fiscalité »",
  },
  {
    id: "OBJECTIFS",
    label: "Objectifs",
    reason: "Un objectif daté transforme un patrimoine observé en trajectoire vérifiable.",
    evidence: ["GOALS"],
    sourceHref: "/goals",
    manualHref: "/goals",
    sourceCategory: "SAISIE_MANUELLE",
    planRef:
      "§19.1 item 4 « objectifs » ; §20 item 4 « trajectoire courte vers les objectifs actifs »",
  },
];

export const DOMAIN_IDS: readonly DeclarableDomain[] = DOMAIN_REGISTRY.map((entry) => entry.id);

const BY_ID = new Map<DeclarableDomain, DomainDefinition>(
  DOMAIN_REGISTRY.map((entry) => [entry.id, entry]),
);

export function domainDefinition(id: DeclarableDomain): DomainDefinition {
  const found = BY_ID.get(id);
  // Le type rend ce cas impossible ; l'exception existe pour le jour où une valeur arrive de
  // la base sans passer par le type, c'est-à-dire au premier ajout de domaine côté SQL seul.
  if (!found) throw new Error(`Domaine déclarable inconnu du registre : ${id}`);
  return found;
}
