// Module partagé serveur/client. Ne doit jamais porter "use client" ni importer de composants.
// Le bug de production venait de l'export d'un Set depuis un module client vers une page serveur :
// la sérialisation ne préserve pas les Set. On n'exporte donc que des données sérialisables
// et des fonctions pures.

/**
 * Navigation de la phase 1.
 *
 * Le constat 5.5 du plan de refonte : « la navigation présente 18 destinations comme
 * équivalentes ». Une liste plate mêlait tâches, domaines, outils, sources et administration,
 * de sorte que l'utilisateur devait comprendre l'architecture interne du produit avant de
 * savoir où agir.
 *
 * La section 7 du plan donne le regroupement en SIX entrées, avec ses sous-vues, et la liste
 * de ce qui SORT de la navigation principale. Les deux sont transcrites ici, pas inventées.
 *
 * AUCUNE ROUTE N'EST SUPPRIMÉE. Sortir Beyonder, Rapports, Activité et Paramètres de la
 * navigation principale ne veut pas dire les rendre inaccessibles : le plan les déplace vers
 * Today, l'action d'en-tête, la vue secondaire et le menu de profil. Casser leurs URL en
 * ferait des pages perdues, ce que la section 7 ne demande nulle part et qui invaliderait
 * tout lien déjà partagé.
 */

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
}

/**
 * Une entrée de premier niveau, avec ses sous-vues.
 *
 * `href` pointe vers la sous-vue d'entrée du groupe : cliquer le groupe mène quelque part,
 * plutôt que d'ouvrir un accordéon qui demande un second clic pour arriver au même endroit.
 */
export interface NavigationGroup {
  id: string;
  label: string;
  /** Ce que le groupe permet de faire, en une ligne. Sert d'aide au survol, pas de paragraphe. */
  purpose: string;
  /** Sous-vue ouverte quand on clique le groupe lui-même. */
  href: string;
  items: readonly NavigationItem[];
}

export const DEFAULT_SECTION = "today";

/**
 * Les six entrées de la section 7 du plan, dans son ordre.
 *
 * L'ordre n'est pas décoratif : il suit le parcours de la section 3, suivre puis comprendre
 * puis prévoir puis comparer puis décider puis revoir.
 */
export const NAV_GROUPS: readonly NavigationGroup[] = [
  {
    id: "today",
    label: "Aujourd’hui",
    purpose: "Comprendre la situation et agir",
    href: "/",
    // Le groupe et sa sous-vue portent le MÊME identifiant, donc le même libellé : deux
    // libellés pour un même identifiant de section feraient répondre `sectionLabel` autre chose
    // que la barre latérale n'affiche, et un titre de page se contredirait avec l'entrée
    // sélectionnée.
    items: [{ id: "today", label: "Aujourd’hui", href: "/" }],
  },
  {
    id: "wealth",
    label: "Patrimoine",
    purpose: "Suivre ce que l’on possède et doit",
    href: "/net-worth",
    items: [
      { id: "net-worth", label: "Vue d’ensemble", href: "/net-worth" },
      { id: "investments", label: "Comptes et placements", href: "/investments" },
      { id: "real-estate", label: "Immobilier", href: "/real-estate" },
      { id: "business-equity", label: "Entreprises", href: "/business-equity" },
      { id: "debt", label: "Dettes", href: "/debt" },
    ],
  },
  {
    id: "flows",
    label: "Flux",
    purpose: "Comprendre l’argent qui entre et sort",
    href: "/cash-flow",
    items: [
      { id: "cash-flow", label: "Transactions et budget", href: "/cash-flow" },
      { id: "career", label: "Revenus et carrière", href: "/career" },
      { id: "tax", label: "Fiscalité", href: "/tax" },
    ],
  },
  {
    id: "projects",
    label: "Projets",
    purpose: "Se projeter sans altérer le réel",
    href: "/goals",
    items: [
      { id: "goals", label: "Objectifs", href: "/goals" },
      { id: "scenarios", label: "Scénarios", href: "/scenarios" },
    ],
  },
  {
    id: "decisions",
    label: "Décisions",
    purpose: "Arbitrer avec des critères explicites",
    href: "/decision-lab",
    items: [{ id: "decision-lab", label: "Cas à comparer", href: "/decision-lab" }],
  },
  {
    id: "sources",
    label: "Sources",
    purpose: "Alimenter et auditer les faits",
    href: "/imports",
    items: [
      { id: "imports", label: "Connexions et imports", href: "/imports" },
      { id: "documents", label: "Documents", href: "/documents" },
      { id: "timeline", label: "Activité", href: "/timeline" },
    ],
  },
];

/**
 * Sections accessibles mais SORTIES de la navigation principale (section 7 du plan).
 *
 * Chacune porte l'endroit d'où on l'atteint désormais. Ce champ n'est pas de la
 * documentation : le shell s'en sert pour placer l'accès, et un test vérifie qu'aucune de ces
 * sections n'est devenue inatteignable.
 */
export interface SecondarySection extends NavigationItem {
  /** Où le plan replace l'accès à cette section. */
  reachedFrom: "PROFILE_MENU" | "HEADER_ACTION" | "SECONDARY_VIEW";
}

export const SECONDARY_SECTIONS: readonly SecondarySection[] = [
  // Section 35 : « Beyonder n'est plus une destination principale ». Ses capacités
  // rejoignent Today, l'inspecteur, l'inbox, les décisions et les rapports ; la page
  // autonome subsiste comme vue d'audit avancée.
  { id: "advisor", label: "Analyse Beyonder", href: "/advisor", reachedFrom: "SECONDARY_VIEW" },
  // Section 7 : « Reports : action globale Rapports et historique de clôtures ».
  { id: "reports", label: "Rapports", href: "/reports", reachedFrom: "HEADER_ACTION" },
  // Section 34 : « Settings quitte la navigation principale et se trouve dans le menu du
  // profil ».
  { id: "settings", label: "Paramètres", href: "/settings", reachedFrom: "PROFILE_MENU" },
];

/**
 * Toutes les sections adressables, groupes et secondaires confondus.
 *
 * Le nom `NAV_ITEMS` est CONSERVÉ : c'est la liste que les routes utilisent pour valider une
 * section, et la renommer aurait cassé `isValidSection` sans rien apporter. Ce qui change est
 * son rôle : elle n'est plus ce que la barre latérale affiche, elle est ce que le routeur
 * accepte. La barre latérale lit `NAV_GROUPS`.
 */
export const NAV_ITEMS: readonly NavigationItem[] = [
  ...NAV_GROUPS.flatMap((group) => group.items),
  ...SECONDARY_SECTIONS.map(({ id, label, href }) => ({ id, label, href })),
];

/** Sections adressables par /[section]. La racine "today" est servie par /. */
export const ROUTED_SECTION_IDS: readonly string[] = NAV_ITEMS.filter(
  (item) => item.id !== DEFAULT_SECTION,
).map((item) => item.id);

export function isValidSection(section: string): boolean {
  return NAV_ITEMS.some((item) => item.id === section);
}

export function isRoutedSection(section: string): boolean {
  return isValidSection(section) && section !== DEFAULT_SECTION;
}

export function sectionLabel(section: string): string {
  const found = NAV_ITEMS.find((item) => item.id === section)?.label;
  if (found !== undefined) return found;
  // Le repli est LU dans la table, jamais réécrit en littéral : un libellé recopié ici
  // divergerait silencieusement de celui de la barre latérale au premier changement.
  return NAV_ITEMS.find((item) => item.id === DEFAULT_SECTION)?.label ?? DEFAULT_SECTION;
}

/** Groupe auquel appartient une section, ou `null` si elle est secondaire. */
export function groupOfSection(section: string): NavigationGroup | null {
  return NAV_GROUPS.find((group) => group.items.some((item) => item.id === section)) ?? null;
}

/** Une section sortie de la navigation principale, avec l'endroit d'où on l'atteint. */
export function secondarySection(section: string): SecondarySection | null {
  return SECONDARY_SECTIONS.find((item) => item.id === section) ?? null;
}
