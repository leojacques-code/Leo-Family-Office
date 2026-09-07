import type { PageManifest } from "./contracts";

/**
 * Registre des pages (section 16.1 du plan de refonte).
 *
 * Les quatorze manifestes sont TRANSCRITS des sections 20 à 33 : question dominante, ordre
 * des zones, KPI essentiels, objectifs autorisés, ce qui est masqué ou différé. Rien n'y est
 * inventé, parce que la section 16 interdit à une IA de décider quelles sections apparaissent
 * ou quels KPI sont prioritaires.
 *
 * Settings (section 34) et Beyonder (section 35) ne sont pas des manifestes de page : le plan
 * les SORT de la navigation principale, l'un vers le menu du profil, l'autre vers Today,
 * l'inspecteur, l'inbox, les décisions et les rapports. Leur donner un manifeste de page
 * reconstituerait la navigation à dix-huit destinations équivalentes que la section 5.5
 * reproche au produit actuel.
 *
 * La phase 0 ne BRANCHE aucune page sur son manifeste. Un manifeste est une donnée, et son
 * branchement appartient à la phase de son domaine, qui le revoit avant d'implémenter sa page
 * comme la section 39 l'exige. Les écrire maintenant sert à ce que chaque phase parte d'un
 * contrat déjà écrit, plutôt que de le rédiger en même temps que le code qu'il est censé
 * contraindre.
 */

/**
 * Ordre de zones du contrat universel (section 17), suivi par la plupart des pages.
 *
 * L'analyse disponible vient APRÈS le canvas, jamais avant : c'est le catalogue « Aller plus
 * loin », et le remonter ferait de la liste des indicateurs manquants le contenu principal,
 * exactement le défaut du constat 5.6.
 */
const STANDARD_ZONES = [
  "OPERATIONAL_HEADER",
  "SOURCE_RAIL",
  "FINANCIAL_CANVAS",
  "AVAILABLE_ANALYSIS",
  "INSPECTOR",
  "CONTEXTUAL_ACTIONS",
] as const;

function manifests(entries: readonly PageManifest[]): Readonly<Record<string, PageManifest>> {
  const map: Record<string, PageManifest> = {};
  for (const entry of entries) map[entry.id] = entry;
  return map;
}

export const PAGE_REGISTRY = manifests([
  // ─── Section 20 ─────────────────────────────────────────────────────────────────────
  {
    id: "today",
    version: 1,
    title: "Aujourd’hui",
    question: "Que dois-je comprendre et faire maintenant ?",
    // Pas de rail de sources : Today n'est pas un domaine, il n'a pas de source propre. Il
    // lit les vérités des autres domaines et n'a donc rien à montrer dans cette zone.
    zones: [
      "OPERATIONAL_HEADER",
      "FINANCIAL_CANVAS",
      "CONTEXTUAL_ACTIONS",
      "AVAILABLE_ANALYSIS",
      "INSPECTOR",
    ],
    primaryAction: null,
    essentialKpis: [
      "net_worth",
      "immediate_cash",
      "net_worth_change_since_close",
      "free_cash_flow_after_debt",
      "pending_review_count",
      "upcoming_obligations_30d",
    ],
    allowedObjectives: ["track_net_worth_change", "sources_review_inbox"],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "UNKNOWN_BLOCKING",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    // Today montre la situation RÉELLE. Une simulation y ferait passer une hypothèse pour un
    // état, ce que la section 6.4 interdit.
    realityModes: ["REAL"],
    viewport: "ALL_VIEWPORTS",
    deferred: [
      "Empreintes, identifiants et provenance détaillée : volet technique uniquement",
      "Plus de trois actions prioritaires : au-delà, ce n’est plus une priorité",
      "Toute variation dont les deux clôtures ne sont pas comparables",
      "Tout formulaire financier : Today n’en a pas, seulement un réglage d’affichage",
    ],
  },

  // ─── Section 21 ─────────────────────────────────────────────────────────────────────
  {
    id: "net-worth",
    version: 1,
    title: "Patrimoine",
    question: "Que possédé-je réellement, que dois-je et quelle part est liquide ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Ajouter un actif ou un passif",
    essentialKpis: [
      "net_worth",
      "gross_assets",
      "total_liabilities",
      "asset_allocation",
      "immediate_cash",
      "net_worth_change_since_close",
    ],
    allowedObjectives: [
      "manage_shared_ownership",
      "represent_dismemberment",
      "represent_holding",
      "track_liquidity",
      "track_net_worth_change",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL"],
    viewport: "DESKTOP_AND_TABLET",
    deferred: [
      "Avertissements techniques : ils vont dans l’inspecteur",
      "Formulaires de saisie : ils s’ouvrent en tiroir, pas au premier écran",
      "Toute lecture directe d’une API externe : le patrimoine consomme les vérités des domaines",
    ],
  },

  // ─── Section 22 ─────────────────────────────────────────────────────────────────────
  {
    id: "cash-flow",
    version: 1,
    title: "Flux",
    question:
      "Où va mon argent, quelle part est contrainte et combien puis-je réellement épargner ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Ajouter une opération",
    essentialKpis: [
      "observed_income",
      "essential_expenses",
      "debt_service_30d",
      "free_cash_flow_after_debt",
      "savings_rate",
      "unclassified_flows",
    ],
    allowedObjectives: [
      "understand_budget",
      "measure_savings",
      "build_safety_fund",
      "detect_recurrences",
      "forecast_treasury",
      "stress_income_drop",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "ALL_VIEWPORTS",
    deferred: [
      "Catégories vides : elles sont masquées plutôt qu’affichées à zéro",
      "Hypothèses non choisies : une simulation ne s’affiche pas sans avoir été demandée",
      "Annualisation d’un mois partiel : le mois est étiqueté, jamais extrapolé",
    ],
  },

  // ─── Section 23 ─────────────────────────────────────────────────────────────────────
  {
    id: "investments",
    version: 1,
    title: "Placements",
    question:
      "Que détiens-je, combien cela vaut, quels risques je porte et quelle performance est réellement prouvable ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Importer un portefeuille",
    essentialKpis: [
      "portfolio_value",
      "envelope_cash",
      "asset_allocation",
      "portfolio_concentration",
      "unrealised_pnl",
    ],
    allowedObjectives: [
      "see_allocation",
      "measure_performance",
      "understand_investment_risk",
      "project_portfolio",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "UNKNOWN_NON_ESSENTIAL",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "DESKTOP_AND_TABLET",
    deferred: [
      "TWR, XIRR, drawdown, volatilité et tracking error tant que les données requises manquent",
      "Grille de dix métriques indisponibles : la page en comptait dix-neuf occurrences",
      "Formulaires avancés : ils vivent dans l’inspecteur",
    ],
  },

  // ─── Section 24 ─────────────────────────────────────────────────────────────────────
  {
    id: "debt",
    version: 1,
    title: "Dette",
    question:
      "Combien dois-je, quand le cash sort-il, quel est le coût restant et quelles options ai-je ?",
    zones: [...STANDARD_ZONES],
    // Section 24 : « la règle document-first ». L'action primaire est l'import de
    // l'échéancier, pas l'ouverture d'un formulaire de contrat.
    primaryAction: "Importer un échéancier",
    essentialKpis: [
      "debt_outstanding",
      "next_cash_out",
      "debt_future_cash_out",
      "debt_economic_cost_12m",
      "debt_maturity",
      "debt_service_30d",
    ],
    allowedObjectives: [
      "loan_has_deferral",
      "loan_variable_rate",
      "loan_insurance_varies",
      "loan_has_fees",
      "loan_link_to_asset",
      "loan_simulate_early_repayment",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "DESKTOP_AND_TABLET",
    deferred: [
      "Modèle de contrat complet au premier écran : il s’ouvre après l’import ou en mode avancé",
      "Décomposition ligne à ligne de l’échéancier : elle s’ouvre dans l’inspecteur",
    ],
  },

  // ─── Section 25 ─────────────────────────────────────────────────────────────────────
  {
    id: "real-estate",
    version: 1,
    title: "Immobilier",
    question:
      "Que vaut ce bien ou projet, quelle économie produit-il et quel risque financier porte-t-il ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Ajouter un bien ou un projet",
    essentialKpis: [
      "property_value",
      "property_total_cost",
      "property_equity",
      "property_noi",
      "property_gross_yield",
      "property_ltv",
    ],
    allowedObjectives: [
      "property_track_value",
      "property_track_rental",
      "property_compute_yield",
      "property_measure_leverage",
      "property_prepare_sale",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "DESKTOP_AND_TABLET",
    deferred: [
      "Projet d’acquisition mélangé au bien détenu : la bifurcation est obligatoire et première",
      "Un projet détenu par une société : il reste dans la société, et le patrimoine montre la participation",
      "Rendement et DSCR tant que flux et dette ne sont pas réellement rattachés",
    ],
  },

  // ─── Section 26 ─────────────────────────────────────────────────────────────────────
  {
    id: "career",
    version: 1,
    title: "Carrière",
    question: "Quels revenus mon activité produit-elle réellement et comment peuvent-ils évoluer ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Ajouter une activité",
    essentialKpis: ["gross_compensation", "net_cash_received"],
    allowedObjectives: [
      "career_understand_payslip",
      "career_track_compensation",
      "career_forecast_income",
      "career_simulate_evolution",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "ALL_VIEWPORTS",
    deferred: [
      "Écran vide sans action : un profil sans activité déclarée reçoit un parcours, pas un vide",
      "Net fabriqué à partir d’un brut sans règle ni preuve",
    ],
  },

  // ─── Section 27 ─────────────────────────────────────────────────────────────────────
  {
    id: "business-equity",
    version: 1,
    title: "Entreprises",
    question: "Quelle valeur économique et quels flux me reviennent de chaque entreprise ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Ajouter une société",
    essentialKpis: [
      "business_equity_value",
      "business_attributable_value",
      "business_distributions",
    ],
    allowedObjectives: [
      "business_estimate_value",
      "business_understand_cash",
      "business_quality_of_earnings",
      "business_track_personal_flows",
      "business_model_disposal",
      "represent_holding",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "DESKTOP_ONLY",
    deferred: [
      "Codes de qualité et réserves en liste brute : ils sont traduits et regroupés",
      "Retraitements de Quality of Earnings au premier écran : ils s’ouvrent en mode expert",
      "Toute pondération automatique non déclarée entre méthodes de triangulation",
    ],
  },

  // ─── Section 28 ─────────────────────────────────────────────────────────────────────
  {
    id: "tax",
    version: 1,
    title: "Fiscalité",
    question:
      "Qu’ai-je réellement payé, que reste-t-il potentiellement dû et avec quel niveau de certitude ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Ajouter un document fiscal",
    essentialKpis: ["tax_paid", "tax_estimate", "upcoming_obligations_30d"],
    allowedObjectives: ["tax_track_payments", "tax_estimate_liability", "tax_compare_before_after"],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "ALL_VIEWPORTS",
    deferred: [
      "Zéro apparent lorsque la règle manque : une règle absente ne produit jamais 0 €",
      "Toute estimation sans son niveau de confiance ni sa fourchette",
    ],
  },

  // ─── Section 29 ─────────────────────────────────────────────────────────────────────
  {
    id: "goals",
    version: 1,
    title: "Objectifs",
    question: "Quel objectif finance-je, où en suis-je et quel effort réaliste reste nécessaire ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Créer un objectif",
    essentialKpis: ["goal_progress", "goal_monthly_effort"],
    allowedObjectives: ["goal_set_target", "goal_plan_effort"],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL", "SIMULATION"],
    viewport: "ALL_VIEWPORTS",
    deferred: [
      "États internes et noms de métriques : ils sont traduits",
      "Probabilité simulée tant qu’aucun modèle stochastique n’est sélectionné",
    ],
  },

  // ─── Section 30 ─────────────────────────────────────────────────────────────────────
  {
    id: "scenarios",
    version: 1,
    title: "Scénarios",
    question: "Que devient ma trajectoire si je change une ou plusieurs hypothèses ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Créer un scénario",
    essentialKpis: ["scenario_trajectory", "net_worth", "cash_runway"],
    allowedObjectives: [
      "scenario_change_market",
      "scenario_add_events",
      "stress_income_drop",
      "career_simulate_evolution",
      "project_portfolio",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    // Le scénario réel de référence n'est pas modifiable : il est la BORNE du mode réel dans
    // une page de simulation, et c'est à lui que les trajectoires se comparent.
    realityModes: ["REAL", "SIMULATION"],
    viewport: "DESKTOP_AND_TABLET",
    deferred: [
      "Cinq cartes de scénarios équivalentes au-dessus du résultat : l’éventail vient d’abord",
      "Tout nom de scénario présenté comme une conclusion",
      "Toute inflation appliquée uniformément à toutes les dates et à tous les actifs",
    ],
  },

  // ─── Section 31 ─────────────────────────────────────────────────────────────────────
  {
    id: "decision-lab",
    version: 1,
    title: "Décisions",
    question:
      "Quel arbitrage répond à mon objectif, compte tenu de la liquidité, du risque, du temps et de la fiscalité ?",
    zones: [...STANDARD_ZONES],
    primaryAction: "Poser une question de décision",
    essentialKpis: ["decision_option_comparison"],
    allowedObjectives: [
      "loan_simulate_early_repayment",
      "property_prepare_sale",
      "business_model_disposal",
      "tax_compare_before_after",
    ],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["SIMULATION"],
    // Deux ou trois options côte à côte ne tiennent pas sur un téléphone. En produire une
    // version tronquée ferait croire à une comparaison complète.
    viewport: "DESKTOP_ONLY",
    deferred: [
      "Tout calcul lancé sans question ni objectif déclarés",
      "Tout score opaque et toute recommandation automatique sans politique déclarée",
    ],
  },

  // ─── Section 32 ─────────────────────────────────────────────────────────────────────
  {
    id: "sources",
    version: 1,
    title: "Sources",
    question:
      "Quelles preuves alimentent ma situation et quels éléments dois-je actualiser ou confirmer ?",
    zones: [
      "OPERATIONAL_HEADER",
      "SOURCE_RAIL",
      "FINANCIAL_CANVAS",
      "CONTEXTUAL_ACTIONS",
      "INSPECTOR",
    ],
    primaryAction: "Ajouter une source",
    essentialKpis: ["source_freshness", "pending_review_count"],
    allowedObjectives: ["sources_connect_bank", "sources_review_inbox"],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SOURCE_CONFLICT",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL"],
    viewport: "ALL_VIEWPORTS",
    deferred: [
      "Sept pipelines techniques en onglets équivalents : l’entrée se fait par le TYPE de source possédée",
      "Toute déduplication automatique sur date et montant seulement",
    ],
  },

  // ─── Section 33 ─────────────────────────────────────────────────────────────────────
  {
    id: "reports",
    version: 1,
    title: "Rapports",
    question: "Qu’est-ce qui a changé et quelles décisions ou mises à jour sont nécessaires ?",
    zones: [
      "OPERATIONAL_HEADER",
      "FINANCIAL_CANVAS",
      "AVAILABLE_ANALYSIS",
      "CONTEXTUAL_ACTIONS",
      "INSPECTOR",
    ],
    primaryAction: "Produire un rapport",
    essentialKpis: ["close_summary", "net_worth_change_since_close"],
    allowedObjectives: ["track_net_worth_change"],
    supportedStates: [
      "AVAILABLE",
      "PARTIAL",
      "UNKNOWN_ACTIVATABLE",
      "DECLARED_NONE",
      "SYSTEM_ERROR",
    ],
    realityModes: ["REAL"],
    viewport: "DESKTOP_AND_TABLET",
    deferred: [
      "Liste brute de réserves et d’empreintes : elle va en annexe technique",
      "Toute variation entre deux clôtures non comparables",
    ],
  },
]);
