import type { PresentationState } from "./states";

/**
 * Traduction des codes de réserve émis par les moteurs.
 *
 * Les moteurs poussent des codes dans des tableaux `blockers`, `flags` et `reasons`, et les
 * pages les rendaient TELS QUELS, le plus souvent par un `.join(" · ")`. L'utilisateur lisait
 * donc « LIABILITY_ATTRIBUTION_MISSING · REAL_ESTATE_VALUATION_MISSING », et dans un cas
 * (`ENVELOPE_EXPOSURE_UNKNOWN:<uuid>`) un identifiant technique entier apparaissait dans le
 * texte visible. C'est le constat 5.4 du plan de refonte.
 *
 * Ce registre est construit sur la source AUTORITATIVE, pas sur une heuristique : les
 * moteurs déclarent leurs codes de réserve dans des unions et des tableaux `as const` nommés
 * (`BusinessBlockerCode`, `BusinessFlagCode`, `LoanFlagCode`, `MarketFlagCode`,
 * `RealEstateFlagCode`, `GOAL_BLOCKER_CODES`, `SCENARIO_BLOCKER_CODES`,
 * `REGISTRY_SKIP_REASONS`), et `code-inventory.ts` les extrait de là. Une première tentative
 * d'extraction par proximité du mot `blockers` rendait 284 candidats dont la moitié étaient
 * des membres d'unions de domaine (nature de donnée, type d'événement, méthode de
 * valorisation) : leur inventer une traduction de réserve aurait fait passer une valeur
 * normale pour un problème.
 *
 * Il ne porte donc PAS les valeurs de domaine, et il ne porte pas non plus les motifs de
 * refus de saisie (`NumberParseReason`, `DateParseReason`) : ceux-là sont traduits par leur
 * propre primitive, au plus près du champ, et les dupliquer ici créerait une seconde vérité.
 *
 * Chaque entrée porte DEUX choses, et la seconde est la plus importante :
 *
 *   `label` : ce que l'utilisateur lit, en français, sans code ;
 *   `state` : ce que la surface doit FAIRE, parmi les huit états de la section 6.3.
 *
 * Aucun code n'est classé `UNKNOWN_BLOCKING` ici. La section 16 interdit à une IA de décider
 * « si une anomalie est assez importante pour alerter » : promouvoir un code en tâche
 * priorisée est une décision humaine, prise dans la phase du domaine concerné. Le mécanisme
 * est prêt, la décision ne l'est pas, et la deuxième ne se déduit pas de la première.
 */
export interface CodeTranslation {
  readonly label: string;
  readonly state: PresentationState;
}

/**
 * Un code peut porter un identifiant après un deux-points : `DEBT_OVER_ALLOCATED:<uuid>`.
 * L'identifiant est du ressort du volet technique, jamais du texte visible.
 */
export function splitCode(raw: string): { code: string; identifier: string | null } {
  const index = raw.indexOf(":");
  if (index === -1) return { code: raw, identifier: null };
  return { code: raw.slice(0, index), identifier: raw.slice(index + 1) || null };
}

const A: PresentationState = "UNKNOWN_ACTIVATABLE";
const P: PresentationState = "PARTIAL";
const C: PresentationState = "SOURCE_CONFLICT";
const N: PresentationState = "DECLARED_NONE";
const E: PresentationState = "SYSTEM_ERROR";

export const CODE_TRANSLATIONS: Readonly<Record<string, CodeTranslation>> = {
  // ─── Immobilier : acquisition et cession ────────────────────────────────────────────
  ACQUISITION_PRICE_MISSING: { label: "Prix d’acquisition à renseigner", state: A },
  ACQUISITION_COST_MISSING: { label: "Coût de revient à compléter", state: A },
  ACQUISITION_COSTS_NOT_DECLARED: { label: "Frais d’acquisition à déclarer", state: A },
  ACQUISITION_FEES_UNKNOWN: { label: "Frais d’acquisition inconnus", state: A },
  ACQUISITION_EVENT_MISSING: { label: "Acte d’acquisition à enregistrer", state: A },
  ACQUISITION_FUNDING_MISSING: { label: "Financement de l’acquisition à renseigner", state: A },
  ACQUISITION_CASH_MISMATCH: { label: "Décaissement d’acquisition à vérifier", state: C },
  DISPOSAL_PROCEEDS_MISSING: { label: "Prix de cession à renseigner", state: A },
  DISPOSAL_COSTS_NOT_DECLARED: { label: "Frais de cession à déclarer", state: A },
  DISPOSAL_CASH_MISMATCH: { label: "Encaissement de cession à vérifier", state: C },
  CAPEX_NOT_DECLARED: { label: "Travaux capitalisés à déclarer", state: A },

  // ─── Immobilier : exploitation ──────────────────────────────────────────────────────
  REAL_ESTATE_VALUATION_MISSING: { label: "Valorisation du bien à renseigner", state: A },
  REAL_ESTATE_RENT_MISSING: { label: "Loyer annuel à renseigner", state: A },
  REAL_ESTATE_VACANCY_MISSING: { label: "Taux de vacance à déclarer", state: A },
  REAL_ESTATE_OPERATING_COSTS_MISSING: { label: "Charges d’exploitation à déclarer", state: A },
  REAL_ESTATE_OWNERSHIP_SHARE_MISSING: { label: "Quote-part détenue à renseigner", state: A },
  OPERATING_TERMS_MISSING: { label: "Conditions d’exploitation à renseigner", state: A },
  OPERATING_TERM_UNDECLARED: { label: "Une charge d’exploitation n’est pas déclarée", state: A },
  VACANCY_RATE_MISSING: { label: "Taux de vacance à déclarer", state: A },
  USAGE_UNDECLARED: { label: "Usage du bien à préciser", state: A },
  SURFACE_NOT_DECLARED: { label: "Surface à renseigner", state: A },
  RENT_DECLARED_ON_NON_RENTAL: { label: "Loyer déclaré sur un bien non locatif", state: C },
  OBSERVED_INCOME_NOT_RENT_QUALIFIED: {
    label: "Recette observée non qualifiée de loyer",
    state: C,
  },
  MISSING_AREA_EXCLUDED: { label: "Bien sans surface, écarté du prix au m²", state: P },
  MULTI_LOT_EXCLUDED: { label: "Vente multi-lots écartée, sans prix unitaire", state: P },
  NO_USABLE_COMPARABLE: { label: "Aucun comparable exploitable", state: A },
  SAMPLE_TOO_SMALL: { label: "Trop peu de comparables pour estimer", state: A },
  HIGH_DISPERSION: { label: "Comparables très dispersés", state: P },
  VALUATION_MISSING: { label: "Valorisation à renseigner", state: A },
  VALUATION_STALE: { label: "Valorisation ancienne", state: P },
  SNAPSHOT_STALE: { label: "Observation ancienne", state: P },

  // ─── Dette ──────────────────────────────────────────────────────────────────────────
  LIABILITY_ATTRIBUTION_MISSING: { label: "Dette non rattachée à un bien", state: A },
  LIABILITY_PROJECTION_TERMS_MISSING: { label: "Termes du prêt à compléter", state: A },
  DEBT_DECLARED_NOT_LINKED: { label: "Dette déclarée mais non rattachée", state: A },
  DEBT_FREE_DECLARED: { label: "Aucune dette déclarée sur ce bien", state: N },
  DEBT_OVER_ALLOCATED: { label: "Dette rattachée au-delà de 100 %", state: C },
  FINANCING_UNDECLARED: { label: "Financement non déclaré", state: A },
  FINANCING_DECLARATION_CONTRADICTED: { label: "Déclaration de financement contredite", state: C },
  FINANCING_LINK_ORPHAN: { label: "Rattachement de dette orphelin", state: C },
  FINANCING_ORIGINATION_DATE_UNKNOWN: { label: "Date de déblocage inconnue", state: A },
  BALLOON_AMOUNT_MISSING: { label: "Montant du balloon à renseigner", state: A },
  DEFERRAL_CONTRADICTORY: { label: "Différé contradictoire avec l’échéancier", state: C },
  DEFERRAL_INTEREST_UNKNOWN: { label: "Traitement des intérêts de différé inconnu", state: A },
  EARLY_PAYOFF: { label: "Remboursement anticipé constaté", state: P },
  EARLY_REPAYMENT_CONVENTION_UNKNOWN: {
    label: "Effet du remboursement anticipé inconnu",
    state: A,
  },
  EARLY_REPAYMENT_PENALTY_UNKNOWN: {
    label: "Indemnité de remboursement anticipé inconnue",
    state: A,
  },
  INSURANCE_TREATMENT_UNKNOWN: { label: "Traitement de l’assurance emprunteur inconnu", state: A },
  MATURITY_MISMATCH: { label: "Maturité incohérente avec l’échéancier", state: C },
  NEGATIVE_AMORTISATION: { label: "Amortissement négatif : l’encours augmente", state: C },
  PAYMENT_EXCEEDS_AMORTISATION: { label: "Échéance supérieure à l’amortissement", state: C },
  PROVIDED_SCHEDULE_USED: { label: "Échéancier fourni par la banque", state: "AVAILABLE" },
  RATE_ASSUMPTION_APPLIED: { label: "Taux issu d’une hypothèse", state: P },
  RECONCILIATION_REQUIRED: { label: "Échéancier et débits à rapprocher", state: C },
  VARIABLE_RATE_UNPROJECTABLE: { label: "Taux variable non projetable", state: A },
  ACCOUNT_OVERDRAFT: { label: "Compte à découvert", state: "AVAILABLE" },
  BALANCE_MISMATCH: { label: "Solde à vérifier", state: C },

  // ─── Change ─────────────────────────────────────────────────────────────────────────
  FX_MISSING: { label: "Taux de change indisponible", state: A },
  FX_STALE: { label: "Taux de change ancien", state: P },
  FUTURE_FX_UNAVAILABLE: { label: "Pas de courbe de change future", state: A },
  CURRENCY_MIXED: { label: "Plusieurs devises sans conversion", state: A },
  ALLOCATION_ACCOUNT_NOT_CONVERTED: {
    label: "Enveloppe non convertie en devise de reporting",
    state: A,
  },
  ENVELOPE_FX_RESIDUAL_NEGATIVE: { label: "Résidu de change négatif sur l’enveloppe", state: C },
  FX_PNL_INCLUDES_CURRENCY_EFFECT: { label: "Résultat incluant l’effet de change", state: P },
  FX_PNL_NOT_ISOLATED: { label: "Effet de change non isolé", state: P },

  // ─── Portefeuille : ledger et couverture ────────────────────────────────────────────
  LEDGER_COVERAGE_UNDECLARED: { label: "Profondeur d’historique non déclarée", state: A },
  LEDGER_EVENTS_BEFORE_COVERAGE: {
    label: "Opérations antérieures à l’historique déclaré",
    state: C,
  },
  LEDGER_ANCHOR_BEFORE_COVERAGE: {
    label: "Position d’ouverture antérieure à l’historique",
    state: C,
  },
  LEDGER_CASH_ANCHOR_MISSING: { label: "Solde d’espèces d’ouverture à renseigner", state: A },
  LEDGER_CASH_INCOMPLETE: { label: "Mouvements d’espèces incomplets", state: A },
  LEDGER_MULTI_CURRENCY: { label: "Ledger en plusieurs devises", state: P },
  LEDGER_QUANTITY_NOT_ANCHORED: { label: "Quantité détenue sans point de départ", state: A },
  MULTIPLE_CASH_ANCHORS: { label: "Plusieurs points de départ d’espèces", state: C },
  MULTIPLE_POSITION_ANCHORS: { label: "Plusieurs points de départ de position", state: C },
  COVERAGE_NOT_DECLARED: { label: "Couverture non déclarée", state: A },
  OBSERVED_LEDGER_NOT_COVERED: { label: "Opérations hors période couverte", state: C },
  OPENING_SECURITY_VALUATIONS_MISSING: {
    label: "Valorisations d’ouverture à renseigner",
    state: A,
  },
  POSITION_VALUATION_DATE_MISSING: { label: "Date de valorisation à renseigner", state: A },

  // ─── Portefeuille : coût de revient et lots ─────────────────────────────────────────
  COST_BASIS_UNKNOWN: { label: "Coût de revient inconnu", state: A },
  LOT_MATCHING_UNDECLARED: { label: "Méthode d’appariement des lots non déclarée", state: A },
  LOT_MATCHING_METHOD_UNDECLARED: {
    label: "Méthode d’appariement des lots non déclarée",
    state: A,
  },
  LOT_ALLOCATION_PREVIOUSLY_UNKNOWN: {
    label: "Appariement de lots précédemment inconnu",
    state: P,
  },
  SPECIFIC_LOT_REFERENCE_MISSING: { label: "Lot désigné manquant", state: A },
  SPECIFIC_LOT_NOT_OPEN: { label: "Lot désigné déjà cédé", state: C },
  SPECIFIC_LOT_INSUFFICIENT_QUANTITY: {
    label: "Quantité insuffisante sur le lot désigné",
    state: C,
  },
  SPECIFIC_LOT_OPEN_QUANTITY_UNKNOWN: { label: "Quantité ouverte du lot inconnue", state: A },
  SPECIFIC_LOT_ACQUISITION_AFTER_DISPOSAL: { label: "Lot acquis après la cession", state: C },
  TRANSACTION_CHARGES_ALREADY_EMBEDDED_IN_PNL: {
    label: "Frais déjà inclus dans le résultat",
    state: P,
  },
  TRANSFER_OUT_NO_PROCEEDS: { label: "Transfert sortant sans produit", state: "AVAILABLE" },
  EXTERNAL_TRANSFER_IN_KIND: {
    label: "Transfert de titres, sans flux d’espèces",
    state: "AVAILABLE",
  },

  // ─── Portefeuille : exposition et concentration ─────────────────────────────────────
  ENVELOPE_EXPOSURE_UNKNOWN: { label: "Exposition de l’enveloppe inconnue", state: A },
  ENVELOPE_VALUE_MISSING: { label: "Valeur de l’enveloppe à renseigner", state: A },
  PORTFOLIO_EXPOSURE_INCOMPLETE: { label: "Exposition du portefeuille incomplète", state: A },
  CONCENTRATION_EXCLUDES_ENVELOPE_CASH: {
    label: "Concentration hors espèces d’enveloppe",
    state: P,
  },
  NO_MARKET_EXPOSURE: { label: "Aucune exposition de marché", state: N },
  NO_INVESTMENT_ENVELOPE: { label: "Aucune enveloppe d’investissement", state: N },
  NON_POSITIVE_MARKET_POSITION: { label: "Position de marché non positive", state: C },
  NON_POSITIVE_PORTFOLIO_VALUE: { label: "Valeur de portefeuille non positive", state: C },

  // ─── Flux externes et rapprochement bancaire ────────────────────────────────────────
  EXTERNAL_FLOW_UNLINKED: { label: "Flux externe non rapproché", state: A },
  EXTERNAL_FLOW_TRANSACTION_MISSING: {
    label: "Opération bancaire correspondante absente",
    state: A,
  },
  EXTERNAL_FLOW_AMOUNT_MISMATCH: { label: "Montant du flux externe à vérifier", state: C },
  EXTERNAL_FLOW_CLASSIFIED_AS_EXPENSE: { label: "Versement classé en dépense", state: C },
  INTERNAL_EVENT_LINKED_TO_BANK: {
    label: "Mouvement interne rattaché à un débit bancaire",
    state: C,
  },
  ACTUAL_OVERRIDES_FORECAST: { label: "Constaté retenu plutôt que prévu", state: "AVAILABLE" },
  ACTUAL_TRANSACTION_OVERRIDES_FORECAST: {
    label: "Opération constatée retenue",
    state: "AVAILABLE",
  },
  CASH_INCLUDED_IN_CAREER_TAX_MONTH: {
    label: "Encaissement déjà compté au mois de paie",
    state: P,
  },
  MISSING_ESSENTIAL_EXPENSE: { label: "Dépense essentielle à renseigner", state: A },
  MISSING_VALUE: { label: "Valeur à renseigner", state: A },

  // ─── Carrière ───────────────────────────────────────────────────────────────────────
  BASE_COMPENSATION_MISSING: { label: "Rémunération de base à renseigner", state: A },
  COMPENSATION_TERMS_MISSING: { label: "Termes de rémunération à renseigner", state: A },
  GROSS_INCOME_MISSING: { label: "Revenu brut à renseigner", state: A },

  // ─── Fiscalité ──────────────────────────────────────────────────────────────────────
  TAX_RULES_MISSING: { label: "Règles fiscales non renseignées", state: A },
  TAX_RULES_STALE: { label: "Règles fiscales anciennes", state: P },
  TAX_RULE_YEAR_MISMATCH: { label: "Règles fiscales d’une autre année", state: C },
  TAX_PROFILE_MISSING: { label: "Foyer fiscal à renseigner", state: A },
  TAX_RATE_UNDECLARED: { label: "Taux d’imposition non déclaré", state: A },
  INCOME_TAX_RULE_MISSING: { label: "Règle d’impôt sur le revenu absente", state: A },
  DECLARED_TAX_RULE: { label: "Règle fiscale déclarée par vous", state: P },

  // ─── Business Equity ────────────────────────────────────────────────────────────────
  OWNERSHIP_SHARE_MISSING: { label: "Quote-part détenue à renseigner", state: A },
  CAPITAL_EVENT_FUTURE_IGNORED: { label: "Opération future non prise en compte", state: P },
  BUSINESS_PERSONAL_CASH_MISSING: { label: "Flux personnels de la société à renseigner", state: A },
  INCOMPATIBLE_METHODOLOGY: { label: "Méthodes de valorisation incompatibles", state: C },
  EQUITY_ENGAGED_NOT_POSITIVE: { label: "Capital engagé non positif", state: C },
  CURRENT_EQUITY_NOT_POSITIVE: { label: "Valeur des titres non positive", state: C },
  ATTRIBUTION_DOES_NOT_RECONCILE: { label: "Attribution qui ne se réconcilie pas", state: C },
  FUNDING_GAP: { label: "Besoin de financement non couvert", state: "AVAILABLE" },

  // ─── Actifs non financiers et modèle mensuel ────────────────────────────────────────
  NON_FINANCIAL_ASSET_PROJECTION_TERMS_MISSING: {
    label: "Termes de projection de l’actif absents",
    state: A,
  },
  NON_FINANCIAL_ASSET_VALUE_PARTIAL: { label: "Valeur d’actif partielle", state: P },
  DEBT_NOT_PROJECTABLE: { label: "Dette non projetable", state: A },
  PARTIAL_CONSEQUENCE: { label: "Conséquence économique partielle", state: P },
  CONSEQUENCE_FIELD_MISSING: { label: "Conséquence économique incomplète", state: A },
  DECLARED_WITHOUT_CASH_ANCHOR: { label: "Déclaré sans ancrage de trésorerie", state: A },
  COVERAGE_WINDOWS_NOT_ALIGNED: { label: "Fenêtres de couverture non alignées", state: C },
  COVERAGE_UNKNOWN: { label: "Couverture inconnue", state: A },

  // ─── Objectifs, scénarios, décisions ────────────────────────────────────────────────
  TRAJECTORY_NOT_COMPUTABLE: { label: "Trajectoire non calculable", state: A },
  HISTORICAL_TARGET_VALUE_UNAVAILABLE: { label: "Valeur cible historique indisponible", state: A },
  HORIZON_BEFORE_DEADLINE: { label: "Horizon plus court que l’échéance", state: C },
  BASELINE_UNAVAILABLE: { label: "Référence réelle indisponible", state: A },
  MONTE_CARLO_SAMPLES_UNAVAILABLE: { label: "Simulations indisponibles", state: A },
  OVERRIDE_CONFLICT: { label: "Hypothèses en conflit", state: C },
  OVERRIDE_TARGET_MISSING: { label: "Élément visé par l’hypothèse absent", state: C },
  ENTITY_NOT_FOUND: { label: "Élément introuvable", state: C },
  DUPLICATE_OPTION: { label: "Option en double", state: C },
  INVALID_OPTION_COUNT: { label: "Nombre d’options invalide", state: C },
  INVALID_CASE_VERSION: { label: "Version de cas invalide", state: E },
  STALE_GOAL_VERSION: { label: "Objectif modifié entre-temps", state: C },
  STALE_SCENARIO_VERSION: { label: "Scénario modifié entre-temps", state: C },
  HISTORY_PROTECTED: { label: "Historique protégé", state: "AVAILABLE" },
  AT_RISK: { label: "Objectif en risque", state: "AVAILABLE" },

  // ─── Business Equity : valorisation et pont EV vers Equity ──────────────────────────
  FX_RATE_REQUIRED: { label: "Taux de change nécessaire", state: A },

  // ─── Business Equity : détention, holding, capital ──────────────────────────────────

  // ─── Objectifs ──────────────────────────────────────────────────────────────────────
  GOAL_INACTIVE: { label: "Objectif inactif", state: N },
  METRIC_NOT_SUPPORTED: { label: "Indicateur non pris en charge", state: A },
  METRIC_NOT_AVAILABLE_CURRENT: { label: "Indicateur indisponible aujourd’hui", state: A },
  METRIC_NOT_AVAILABLE_PROJECTED: { label: "Indicateur indisponible en projection", state: A },
  MISSING_CURRENT_STATE: { label: "Situation actuelle à renseigner", state: A },
  MISSING_CURRENCY: { label: "Devise de l’objectif à renseigner", state: A },
  MISSING_ENTITY_TARGET: { label: "Élément visé par l’objectif à choisir", state: A },
  CURRENCY_MISMATCH: { label: "Devises différentes entre l’objectif et sa mesure", state: C },
  STALE_BASELINE: { label: "Référence réelle périmée", state: P },
  TRAJECTORY_PARTIAL: { label: "Trajectoire partielle", state: P },

  // ─── Scénarios ──────────────────────────────────────────────────────────────────────
  MISSING_MARKET_ASSUMPTION: { label: "Hypothèse de marché à renseigner", state: A },
  MISSING_COMPENSATION: { label: "Rémunération à renseigner", state: A },
  MISSING_LOAN_TERMS: { label: "Termes du prêt à renseigner", state: A },
  MISSING_PROPERTY_PRICE: { label: "Prix du bien à renseigner", state: A },
  MISSING_SALE_PRICE: { label: "Prix de vente à renseigner", state: A },
  MISSING_TAX_RULES: { label: "Règles fiscales à renseigner", state: A },
  MISSING_FX: { label: "Taux de change à renseigner", state: A },

  // ─── Immobilier : cycle de vie ──────────────────────────────────────────────────────
  DISPOSED: { label: "Bien cédé", state: N },

  // ─── Registre d'entreprises : enrichissement non appliqué ───────────────────────────
  ALREADY_ALIGNED: { label: "Donnée déjà conforme au registre", state: "AVAILABLE" },
  CANDIDATE_MISSING: { label: "Le registre ne publie pas cette donnée", state: A },
  CAPABILITY_NOT_SERVED: { label: "Donnée non servie par cette source", state: A },

  // ─── Marqueurs d'origine, non traduits comme des réserves ───────────────────────────
  // Ces codes nomment le MOTEUR qui a produit une trace, pas une réserve financière. Ils
  // n'ont donc rien à dire à l'utilisateur, et leur état les fait masquer plutôt que
  // traduire en une phrase qui laisserait croire à un problème.
  EVENT_ENGINE: { label: "Moteur d’événements", state: "UNKNOWN_NON_ESSENTIAL" },
  GOALS_V2: { label: "Moteur d’objectifs", state: "UNKNOWN_NON_ESSENTIAL" },
};

/**
 * Traduit un code, identifiant technique éventuel retiré.
 *
 * `null` signifie « code inconnu du registre ». L'appelant NE DOIT PAS afficher le code brut
 * en repli : c'est précisément ce que la phase 0 supprime. Le test du registre échoue quand
 * un moteur émet un code non traduit, de sorte que le cas ne se produise pas en production.
 */
export function translateCode(
  raw: string,
): (CodeTranslation & { identifier: string | null }) | null {
  const { code, identifier } = splitCode(raw);
  const translation = CODE_TRANSLATIONS[code];
  return translation ? { ...translation, identifier } : null;
}
