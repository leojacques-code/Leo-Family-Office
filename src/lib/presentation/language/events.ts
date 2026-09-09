import type {
  CanonicalDataKind,
  CanonicalEventType,
  EventDomain,
} from "@/lib/engine/event-contracts";

/**
 * Libellés français des types d'événement canoniques et de leurs domaines.
 *
 * Le §10.2 demande un « traducteur central des états et raisons » dont « toute sortie
 * technique non traduite échoue en développement ». La phase 0 l'a livré pour les codes de
 * réserve ; les types d'ÉVÉNEMENT y échappaient encore, et Aujourd'hui les rendait par
 * `type.replaceAll("_", " ")`. Un code anglais dont on retire les soulignés n'est pas devenu
 * du français : « RENT RECEIPT » et « EQUITY VEST » s'affichaient tels quels sur la page la
 * plus consultée du produit. C'est le constat 5.4, et le §14 le dit précisément : « ne pas
 * traduire littéralement les codes techniques ; les reformuler en situation et action ».
 *
 * L'EXHAUSTIVITÉ EST TENUE PAR LE TYPE, pas par un test de comptage. `Record<CanonicalEventType,
 * string>` force le compilateur à refuser la table dès qu'un type est ajouté au registre
 * canonique sans son libellé. C'est le seul mécanisme qui ne peut pas être oublié : un test
 * qui compte 61 entrées se met à mentir dès que quelqu'un en ajoute une soixante-deuxième et
 * met le compte à jour sans regarder ce qu'il compte.
 */

export const EVENT_DOMAIN_LABELS: Readonly<Record<EventDomain, string>> = {
  CAREER: "Revenus",
  TAX: "Fiscalité",
  DEBT: "Dettes",
  CASH_FLOW: "Flux",
  PORTFOLIO: "Placements",
  REAL_ESTATE: "Immobilier",
  BUSINESS: "Sociétés",
  PERSONAL: "Personnel",
};

/**
 * Un libellé décrit ce qui SE PASSE, à la date de l'événement, du point de vue de
 * l'utilisateur. Pas le nom de l'entité informatique qui le porte.
 */
export const CANONICAL_EVENT_TYPE_LABELS: Readonly<Record<CanonicalEventType, string>> = {
  // ── Revenus et carrière ────────────────────────────────────────────────────────────
  EMPLOYMENT_START: "Début d’emploi",
  EMPLOYMENT_END: "Fin d’emploi",
  COMPENSATION_CHANGE: "Changement de rémunération",
  BONUS_EARNED: "Prime acquise",
  BONUS_PAID: "Prime versée",
  PROMOTION: "Promotion",
  EQUITY_GRANT: "Attribution d’actions",
  EQUITY_VEST: "Acquisition définitive d’actions",
  EQUITY_EXERCISE: "Exercice d’options",
  FREELANCE_START: "Début d’activité indépendante",
  FREELANCE_END: "Fin d’activité indépendante",

  // ── Fiscalité ──────────────────────────────────────────────────────────────────────
  TAX_RULE_CHANGE: "Changement de règle fiscale",
  TAX_PROFILE_CHANGE: "Changement de situation fiscale",
  TAX_PAYMENT: "Paiement d’impôt",
  TAX_REFUND: "Remboursement d’impôt",
  TAX_ASSESSMENT: "Avis d’imposition",
  WITHHOLDING_CHANGE: "Changement de prélèvement à la source",

  // ── Dettes ─────────────────────────────────────────────────────────────────────────
  LOAN_START: "Début de prêt",
  RATE_CHANGE: "Changement de taux",
  PAYMENT_CHANGE: "Changement d’échéance",
  DEFERRAL_START: "Début de différé",
  DEFERRAL_END: "Fin de différé",
  EARLY_REPAYMENT: "Remboursement anticipé",
  REFINANCE: "Renégociation",
  LOAN_PAYMENT: "Échéance de prêt",
  LOAN_END: "Fin de prêt",

  // ── Placements ─────────────────────────────────────────────────────────────────────
  CONTRIBUTION: "Versement",
  WITHDRAWAL: "Retrait",
  BUY: "Achat de titres",
  SELL: "Vente de titres",
  DIVIDEND: "Dividende",
  INTEREST: "Intérêts",
  FEE: "Frais",
  PORTFOLIO_TAX: "Fiscalité de portefeuille",
  TRANSFER: "Transfert",
  CAPITAL_CALL: "Appel de capital",
  DISTRIBUTION: "Distribution",

  // ── Immobilier ─────────────────────────────────────────────────────────────────────
  ACQUISITION: "Acquisition",
  DISPOSAL: "Cession",
  LEASE_START: "Début de bail",
  LEASE_END: "Fin de bail",
  RENT_CHANGE: "Révision de loyer",
  RENT_RECEIPT: "Encaissement de loyer",
  WORKS_START: "Début de travaux",
  WORKS_PAYMENT: "Paiement de travaux",
  VACANCY_START: "Début de vacance",
  VACANCY_END: "Fin de vacance",
  PROPERTY_TAX: "Taxe foncière",
  INSURANCE_CHANGE: "Changement d’assurance",

  // ── Sociétés ───────────────────────────────────────────────────────────────────────
  FUNDING_ROUND: "Tour de table",
  SHAREHOLDER_LOAN: "Compte courant d’associé",
  OWNERSHIP_CHANGE: "Changement de quote-part",
  VALUATION_OBSERVATION: "Valorisation observée",
  CAPEX: "Investissement",

  // ── Flux et personnel ──────────────────────────────────────────────────────────────
  RECURRING_CASH_FLOW: "Flux récurrent",
  OBSERVED_TRANSACTION: "Opération observée",
  GIFT: "Donation reçue",
  DONATION: "Don consenti",
  INHERITANCE: "Succession",
  LARGE_PURCHASE: "Achat important",
  CUSTOM_EVENT: "Événement déclaré",
};

/**
 * Niveau de preuve d'un événement, en français.
 *
 * C'est la taxonomie `CanonicalDataKind` de la timeline, qui MÊLE volontairement les deux
 * axes que la phase 0 avait séparés ailleurs : `OBSERVED`/`CONTRACTUAL`/`PROJECTED` disent
 * d'où vient la certitude, `USER_ASSUMPTION`/`MODEL_ASSUMPTION` disent qui a posé la valeur.
 * Elle est traduite telle qu'elle est, sans être recomposée : le moteur possède sa vérité, et
 * le §2 de la constitution interdit à une couche aval de la refaire.
 */
export const CANONICAL_DATA_KIND_LABELS: Readonly<Record<CanonicalDataKind, string>> = {
  OBSERVED: "Observé",
  CONTRACTUAL: "Contractuel",
  PROJECTED: "Projeté",
  USER_ASSUMPTION: "Votre hypothèse",
  MODEL_ASSUMPTION: "Hypothèse du modèle",
};

export function eventTypeLabel(type: CanonicalEventType): string {
  return CANONICAL_EVENT_TYPE_LABELS[type];
}

export function eventDomainLabel(domain: EventDomain): string {
  return EVENT_DOMAIN_LABELS[domain];
}

export function canonicalDataKindLabel(kind: CanonicalDataKind): string {
  return CANONICAL_DATA_KIND_LABELS[kind];
}
