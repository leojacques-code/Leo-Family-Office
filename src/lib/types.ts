export type DataKind =
  "ACTUAL" | "USER_ASSUMPTION" | "MODEL_ASSUMPTION" | "EXTERNAL_DATA" | "DERIVED" | "MISSING";
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface Provenance {
  kind: DataKind;
  source?: string;
  effectiveDate?: string;
  updatedAt?: string;
  confidence: Confidence;
  notes?: string;
}

export interface FinancialAccount {
  id: string;
  institutionId: string;
  institution: string;
  name: string;
  type: "BANK" | "PEA" | "CTO" | "SAVINGS" | "OTHER";
  currency: string;
  balance: number;
  balanceDate: string;
  liquidity: "IMMEDIATE" | "LIQUID" | "ILLIQUID";
  provenance: Provenance;
}

/**
 * Observation historique de la valeur comptable d'un compte.
 *
 * Ce n'est ni un prix de marché ni une reconstitution depuis les positions : la table
 * `account_balances` est la vérité historique de l'enveloppe, comme le solde le plus
 * récent l'est déjà pour le Balance Sheet.
 */
export interface AccountBalanceObservation {
  id: string;
  accountId: string;
  balance: number;
  balanceDate: string;
  createdAt: string;
  provenance: Provenance;
}

export interface Position {
  id: string;
  accountId: string;
  /**
   * Instrument sous-jacent. Sert à rapprocher une position observée du ledger
   * portefeuille sans passer par le libellé, qu'un renommage suffirait à désaligner.
   * Optionnel : d'anciens fixtures n'en portent pas.
   */
  securityId?: string;
  securityName: string;
  ticker?: string;
  assetClass: string;
  quantity?: number;
  costBasis?: number;
  value: number;
  currency: string;
  /** Date de la valeur de marché observée, distincte du coût historique. */
  valuationDate?: string;
  isCash: boolean;
  provenance: Provenance;
}

/**
 * Forme économique du remboursement du capital. Quatre comportements suffisent à couvrir
 * les produits courants ; le différé, lui, reste une notion distincte car il décrit le
 * DÉBUT du prêt là où le profil décrit sa forme d'ensemble. Les deux se composent : un
 * in fine peut très bien démarrer par une franchise totale.
 */
export type AmortisationProfile = "AMORTIZING" | "INTEREST_ONLY" | "BULLET" | "BALLOON";

/** Périodicité contractuelle des échéances. Une dette n'est pas nécessairement mensuelle. */
export type PaymentFrequency = "MONTHLY" | "QUARTERLY" | "SEMIANNUAL" | "ANNUAL";

export const MONTHS_PER_PERIOD: Record<PaymentFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

/**
 * Convention de calcul des intérêts.
 *
 * `PROPORTIONAL` : taux annuel × mois de la période / 12. C'est la convention des prêts
 * amortissables français et le comportement historique du moteur. Sur un échéancier
 * régulier, le 30/360 lui est numériquement identique, d'où l'absence d'une troisième
 * valeur qui ne changerait aucun chiffre.
 *
 * `ACTUAL_365` : taux annuel × jours réels de la période / 365. Répandu sur la dette
 * professionnelle et à taux révisable, où il produit de vrais écarts.
 */
export type InterestConvention = "PROPORTIONAL" | "ACTUAL_365";

/** Un taux fixe est connu jusqu'à maturité. Un taux révisable ne l'est pas. */
export type RateType = "FIXED" | "VARIABLE";

/**
 * Terme daté : un taux ou un paiement qui change à partir d'une date.
 *
 * `CONTRACTUAL` : le contrat l'écrit noir sur blanc. `ASSUMPTION` : c'est nous qui le
 * supposons. Les deux ne doivent jamais se confondre, sans quoi une hypothèse de taux
 * finirait par se lire comme une clause.
 */
export type DatedTermKind = "CONTRACTUAL" | "ASSUMPTION";

export interface RateChange {
  effectiveFrom: string;
  annualRate: number;
  kind: DatedTermKind;
}

export interface PaymentChange {
  effectiveFrom: string;
  /** Paiement contractuel par échéance à partir de cette date. */
  amount: number;
  kind: DatedTermKind;
}

/** Nature d'un différé de remboursement. */
export type DeferralKind = "NONE" | "PRINCIPAL_ONLY" | "TOTAL";

/**
 * Sort des intérêts pendant un différé TOTAL. `UNKNOWN` est une vraie valeur : un contrat
 * peut capitaliser les intérêts, les faire payer à part, ou plus rarement les remettre.
 * Le moteur ne tranche pas à la place du contrat, il signale.
 */
export type DeferredInterestTreatment = "PAID" | "CAPITALISED" | "UNKNOWN";

export interface LoanDeferral {
  kind: DeferralKind;
  /** Nombre d'échéances en différé, à compter de la première. */
  months: number;
  interestTreatment: DeferredInterestTreatment;
}

/**
 * Convention appliquée après un remboursement anticipé. `UNKNOWN` interdit au moteur de
 * choisir seul entre réduction de durée et réduction de mensualité : les deux produisent
 * des coûts d'intérêt très différents.
 */
export type EarlyRepaymentOutcome = "SHORTEN_TERM" | "REDUCE_PAYMENT" | "UNKNOWN";

export interface EarlyRepayment {
  id: string;
  liabilityId: string;
  date: string;
  /** Capital remboursé par anticipation. */
  amount: number;
  /** Indemnité de remboursement anticipé. `null` = inconnue, jamais supposée nulle. */
  penalty: number | null;
  outcome: EarlyRepaymentOutcome;
}

/** Frais ponctuel daté, hors échéancier : frais de dossier, garantie, avenant. */
export interface LoanCharge {
  id: string;
  liabilityId: string;
  date: string;
  amount: number;
  label: string;
  /**
   * `true` : le frais est incorporé au financement. Aucune trésorerie ne sort, mais
   * l'encours augmente d'autant. `false` : il est réglé comptant. Dans les deux cas c'est
   * un coût économique ; les confondre ferait sortir de la trésorerie qui n'est jamais
   * sortie, ou ferait disparaître une dette réellement contractée.
   */
  financed: boolean;
}

/**
 * Ligne d'un échéancier bancaire réellement fourni. Quand il existe, il prime sur toute
 * reconstruction théorique : c'est ce que la banque prélèvera, quelles que soient les
 * hypothèses du moteur.
 */
export interface ProvidedScheduleEntry {
  paymentNumber: number;
  dueDate: string;
  openingBalance: number;
  interest: number;
  principal: number;
  insurance: number;
  fees: number;
  closingBalance: number;
}

export interface Liability {
  id: string;
  name: string;
  lender: string;
  principal: number;
  currentBalance: number;
  /** Devise native de l'encours observé. */
  currency?: string;
  /** Date de l'observation d'encours qui porte la valeur de bilan. */
  balanceDate?: string;
  annualRate: number;
  /**
   * Paiement contractuel PAR ÉCHÉANCE, pas nécessairement par mois : voir
   * `paymentFrequency`. Le nom reste `monthlyPayment` pour ne pas casser la persistance
   * d'une donnée déjà en place, l'immense majorité des prêts du dossier étant mensuels.
   *
   * Voir aussi `paymentIncludesInsurance` : selon la convention du prêteur, ce montant
   * inclut ou non l'assurance emprunteur, ce qui change la vitesse d'amortissement.
   */
  monthlyPayment: number;
  /** Nombre d'ÉCHÉANCES, pas de mois. Un prêt annuel sur 10 ans en compte 10. */
  paymentCount: number;
  firstPaymentDate: string;
  maturityDate: string;
  /** Assurance emprunteur par échéance. `null` = non renseignée, jamais supposée nulle. */
  monthlyInsurance: number | null;
  /** Frais récurrents par échéance. `null` = non renseignés. */
  recurringFees: number | null;
  /**
   * `true` : `monthlyPayment` couvre déjà l'assurance, qui est donc retranchée de la part
   * amortissante. `false` : l'assurance s'ajoute par-dessus. `null` : convention inconnue,
   * le moteur applique l'hypothèse la moins déformante et le signale.
   */
  paymentIncludesInsurance: boolean | null;
  deferral: LoanDeferral | null;
  /** Forme du remboursement du capital. `AMORTIZING` reproduit le comportement historique. */
  amortisationProfile: AmortisationProfile;
  /**
   * Capital restant dû à la dernière échéance, remboursé en une fois. Requis par le profil
   * `BALLOON`. `null` sur les autres profils, où il n'a pas de sens.
   */
  balloonAmount: number | null;
  paymentFrequency: PaymentFrequency;
  interestConvention: InterestConvention;
  rateType: RateType;
  /**
   * Changements de taux datés. Un `annualRate` de la dette reste le taux en vigueur au
   * départ ; ces entrées le remplacent à partir de leur date, sans effet rétroactif.
   */
  rateSchedule: RateChange[];
  /** Changements de paiement datés : step-up, step-down, avenant. */
  paymentSchedule: PaymentChange[];
  earlyRepayments: EarlyRepayment[];
  oneOffCharges: LoanCharge[];
  /** Échéancier bancaire réel. Vide tant qu'aucun n'a été importé. */
  providedSchedule: ProvidedScheduleEntry[];
  /**
   * Rattachement à un concours multi-tranches. Une tranche reste une `Liability` à part
   * entière, avec son taux, sa maturité et son amortissement : les fondre dans un objet
   * polymorphe rendrait le moteur beaucoup plus difficile à raisonner pour un gain nul.
   */
  facilityId: string | null;
  provenance: Provenance;
}

/**
 * Nature d'une ligne d'échéancier. Un frais ponctuel et un remboursement anticipé sont de
 * vraies sorties de trésorerie, mais ce ne sont pas des échéances : les confondre fausse
 * autant le comptage des échéances que leur omission fausserait la trésorerie.
 */
export type ScheduleEntryKind = "PAYMENT" | "CHARGE" | "EARLY_REPAYMENT";

export interface LoanScheduleEntry {
  liabilityId: string;
  paymentNumber: number;
  entryKind: ScheduleEntryKind;
  /** Date d'exigibilité réelle de l'échéance. */
  dueDate: string;
  openingBalance: number;
  /** Intérêt réellement décaissé sur cette échéance. */
  interest: number;
  /**
   * Intérêt couru mais non décaissé, ajouté au capital restant dû : différé total à
   * intérêts capitalisés, ou mensualité insuffisante à couvrir l'intérêt. Il ne sort pas
   * de la trésorerie mais appauvrit bien le patrimoine, d'où sa comptabilisation séparée.
   */
  capitalisedInterest: number;
  /**
   * Frais incorporés au financement : aucune sortie de trésorerie, mais l'encours augmente.
   * Séparés de `fees`, qui sont décaissés, pour que les deux invariants tiennent ensemble.
   */
  capitalisedCharges: number;
  principal: number;
  insurance: number;
  fees: number;
  /** Ce qui sort réellement du compte : principal + interest + insurance + fees. */
  totalCashOut: number;
  /** closingBalance = openingBalance − principal + capitalisedInterest + capitalisedCharges. */
  closingBalance: number;
  kind: DataKind;
}

export interface IncomeSource {
  id: string;
  name: string;
  monthlyNet: number | null;
  active: boolean;
  startDate: string | null;
  provenance: Provenance;
}

/**
 * Nature économique canonique d'un flux. C'est ce champ, jamais le signe du montant ni le
 * libellé français de la catégorie, qui détermine comment un mouvement est agrégé.
 */
export type CashFlowKind =
  | "INCOME"
  | "EXPENSE"
  | "INTERNAL_TRANSFER"
  | "INVESTMENT"
  | "SAVING"
  | "DEBT_SERVICE"
  | "TAX"
  | "REFUND"
  | "OTHER_INFLOW"
  | "OTHER_OUTFLOW"
  | "UNCLASSIFIED";

export const CASH_FLOW_KINDS: CashFlowKind[] = [
  "INCOME",
  "EXPENSE",
  "INTERNAL_TRANSFER",
  "INVESTMENT",
  "SAVING",
  "DEBT_SERVICE",
  "TAX",
  "REFUND",
  "OTHER_INFLOW",
  "OTHER_OUTFLOW",
  "UNCLASSIFIED",
];

export type Essentiality = "ESSENTIAL" | "NON_ESSENTIAL" | "UNKNOWN";
export type ExpenseBehavior = "FIXED" | "VARIABLE" | "DISCRETIONARY" | "UNKNOWN";

export interface ExpenseCategory {
  id: string;
  name: string;
  groupName: string;
  /** Nature canonique des flux portés par cette catégorie. */
  cashFlowKind: CashFlowKind;
  essentiality: Essentiality;
  behavior: ExpenseBehavior;
  monthlyAmount: number | null;
  /** Dérivé de `essentiality`. Conservé pour les consommateurs existants, jamais stocké. */
  essential: boolean;
  archived: boolean;
  provenance: Provenance;
}

export interface Transaction {
  id: string;
  accountId: string;
  accountName: string;
  date: string;
  label: string;
  categoryId: string;
  categoryName: string;
  /** Montant signé : négatif pour une sortie. Le signe ne détermine jamais la nature. */
  amount: number;
  currency: string;
  /**
   * Nature imposée à cette transaction seule, prioritaire sur celle de sa catégorie.
   * Sert notamment à marquer un mouvement comme transfert interne.
   */
  kindOverride: CashFlowKind | null;
  /** Rapproche les deux jambes d'un même transfert interne. */
  transferGroupId: string | null;
  /**
   * Bien immobilier auquel ce flux est rattaché. ATTRIBUTION seule : ni le montant ni la
   * nature canonique du flux n'en dépendent, et le domaine immobilier ne crée jamais de
   * transaction. `null` = non rattaché.
   */
  propertyId: string | null;
  notes: string | null;
  provenance: Provenance;
}

export type RecurrenceFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";

/**
 * Règle de flux récurrent, persistée et traçable. Aucune récurrence n'est jamais déduite
 * en silence d'un historique : elle est créée explicitement et porte sa provenance.
 */
export interface RecurringCashFlowRule {
  id: string;
  name: string;
  cashFlowKind: CashFlowKind;
  categoryId: string;
  categoryName: string;
  accountId: string | null;
  /** Montant signé d'une occurrence. */
  amount: number;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  /** Jour d'exigibilité. À défaut, le jour de `startDate`. */
  dayOfMonth: number | null;
  active: boolean;
  provenance: Provenance;
}

/** Clôture mensuelle du périmètre Cash Flow. Versionnée, jamais écrasée en silence. */
export interface CashFlowMonthlyClose {
  id: string;
  /** Mois clôturé, au format AAAA-MM. */
  month: string;
  version: number;
  income: number;
  consumerExpenses: number;
  essentialExpenses: number;
  taxesPaid: number;
  debtServicePaid: number;
  investmentFlows: number;
  internalTransfers: number;
  operatingSurplusBeforeDebt: number;
  postDebtSurplus: number;
  unclassifiedTransactionCount: number;
  closedAt: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  version: number;
  color: string;
  annualReturn: number;
  annualVolatility: number;
  annualInflation: number;
  /**
   * Surplus mensuel AVANT service de dette : après revenus, fiscalité et dépenses de vie,
   * mais avant intérêts, principal, assurance et frais de prêt. La colonne persistée garde
   * son nom historique `monthly_savings`.
   */
  monthlySavings: number;
  /** Part du surplus post-dette dirigée vers les actifs de marché, entre 0 et 1. */
  investmentAllocationRate: number;
  salaryGrowth: number;
  stressProbability: number;
  shockYear: number | null;
  shockMagnitude: number | null;
  provenance: Provenance;
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  targetDate: string | null;
  priority: number;
  status: "ACTIVE" | "ACHIEVED" | "PAUSED";
}

export interface Alert {
  id: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  detail: string;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
}

export interface MonthlyClose {
  id: string;
  closeDate: string;
  grossAssets: number;
  debt: number;
  netWorth: number;
  forecastNetWorth: number | null;
  variance: number | null;
  createdAt: string;
}

export interface NetWorthSnapshot {
  id: string;
  snapshotDate: string;
  version: number;
  grossAssets: number;
  totalLiabilities: number;
  netWorth: number;
  liquidAssets: number | null;
  reportingCurrency: string;
  completenessStatus: "COMPLETE" | "PARTIAL" | "NOT_COMPUTABLE";
  dataKind: DataKind;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  category: string;
  size: number;
  uploadedAt: string;
  status: "INBOX" | "CLASSIFIED";
}

/**
 * Métriques de FLUX déclarés du cockpit.
 *
 * Elles ne sortent pas encore du Canonical Balance Sheet : ce sont des agrégats de
 * revenus, de dépenses et de service de dette déclarés, sans conversion de change (aucun
 * de ces objets ne porte de devise dans le modèle actuel, ils sont donc implicitement en
 * devise de reporting). Les remplacer suppose de faire du Cash Flow Engine V2 la source
 * unique des flux du cockpit : c'est un chantier Cash Flow, pas un alignement de
 * consommateur, et il reste hors de ce périmètre.
 */
export interface DeclaredFlowMetrics {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyDebtService: number;
  freeCashFlow: number;
  /** Flux constatés au ledger. `null` = non calculable faute de flux observés. */
  savingsRate: number | null;
  investmentRate: number | null;
  dataCompleteness: number;
}

/**
 * Métriques du cockpit. Tout ce qui relève du bilan vient EXCLUSIVEMENT du Canonical
 * Balance Sheet : aucune de ces valeurs n'est resommée localement à partir des soldes
 * natifs, sans quoi deux vérités patrimoniales coexisteraient.
 */
export interface DashboardMetrics extends DeclaredFlowMetrics {
  grossAssets: number | null;
  debt: number | null;
  netWorth: number | null;
  bankCash: number | null;
  /** Actifs mobilisables : comptes dont la liquidité n'est pas ILLIQUID. */
  liquidAssets: number | null;
  /** LiquidAssets − dettes. Peut être négatif sans que le patrimoine net le soit. */
  liquidNetWorth: number | null;
  investedAssets: number | null;
  productiveNetWorth: number | null;
  /** `null` signifie que les sorties incompressibles sont inconnues ou nulles. */
  emergencyCoverageMonths: number | null;
}

/**
 * Origine d'une déclaration de profondeur d'historique. Volontairement grossier : trois
 * provenances observables, aucun niveau de confiance inventé par-dessus.
 */
export const LEDGER_COVERAGE_SOURCES = ["MANUAL", "IMPORT", "API"] as const;
export type LedgerCoverageSource = (typeof LEDGER_COVERAGE_SOURCES)[number];

/**
 * PORTFOLIO DATA FOUNDATION
 *
 * Une position observée dit ce qu'une ligne VAUT. Elle ne dit pas comment elle s'est
 * constituée. Le ledger portefeuille porte cette seconde vérité : des faits datés, jamais
 * un calcul. Lots, coût de revient et PnL réalisé en sont DÉRIVÉS par
 * `src/lib/engine/portfolio.ts` ; ils ne sont pas persistés, sans quoi une correction
 * d'événement laisserait derrière elle un coût de revient périmé.
 */
export const PORTFOLIO_EVENT_TYPES = [
  /** Ancrage : la position telle qu'observée au début de la couverture déclarée. */
  "OPENING_POSITION",
  /** Ancrage : le cash d'enveloppe au début de la couverture déclarée. */
  "OPENING_CASH",
  "CONTRIBUTION",
  "WITHDRAWAL",
  "BUY",
  "SELL",
  "DIVIDEND",
  /** Coupon obligataire ou intérêt crédité dans l'enveloppe. */
  "INTEREST",
  "FEE",
  "TAX",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;
export type PortfolioEventType = (typeof PORTFOLIO_EVENT_TYPES)[number];

/**
 * Position d'un événement vis-à-vis de la FRONTIÈRE de l'enveloppe.
 *
 * `OPENING` n'est ni externe ni interne : c'est un point de départ observé. Le compter
 * comme un apport ferait passer pour de l'argent neuf un capital déjà investi, et
 * détruirait toute mesure de performance construite plus tard sur ce ledger.
 *
 * Un dividende encaissé DANS l'enveloppe est `INTERNAL` : c'est un rendement du capital
 * déjà investi, jamais un apport. `DIVIDENDE ≠ CONTRIBUTION`.
 */
export type PortfolioFlowDirection = "OPENING" | "EXTERNAL_IN" | "EXTERNAL_OUT" | "INTERNAL";

/**
 * Convention d'appariement des lots à la cession. Elle change le coût de revient retenu,
 * donc le PnL réalisé : le moteur ne la choisit jamais à la place de l'utilisateur.
 */
export const LOT_MATCHING_METHODS = ["FIFO", "LIFO", "WEIGHTED_AVERAGE", "SPECIFIC_LOT"] as const;
export type LotMatchingMethod = (typeof LOT_MATCHING_METHODS)[number];

export interface PortfolioEvent {
  id: string;
  /** Enveloppe qui porte l'événement. */
  accountId: string;
  /** `null` = événement de cash d'enveloppe, sans instrument. */
  securityId: string | null;
  securityName: string | null;
  ticker: string | null;
  assetClass: string | null;
  type: PortfolioEventType;
  eventDate: string;
  settlementDate: string | null;
  /** Toujours positive : la direction vient du type, jamais du signe. */
  quantity: number | null;
  unitPrice: number | null;
  /** Montant brut, avant frais et taxes. */
  grossAmount: number | null;
  /** `null` = frais inconnus, jamais des frais nuls. */
  feeAmount: number | null;
  taxAmount: number | null;
  /**
   * Effet SIGNÉ sur le cash de l'enveloppe ; NIVEAU d'ancrage sur les deux types
   * d'ouverture. `null` = effet inconnu, jamais nul.
   */
  envelopeCashAmount: number | null;
  currency: string;
  /** Contrepartie bancaire d'un flux externe. Aucune écriture n'en découle. */
  counterpartyAccountId: string | null;
  /** Jambe Cash Flow déjà existante. Le portefeuille ne reclasse ni ne crée aucun flux. */
  transactionId: string | null;
  /** Lot désigné, requis par la seule convention `SPECIFIC_LOT`. */
  matchedAcquisitionEventId: string | null;
  externalReference: string | null;
  provenance: Provenance;
}

/** Ce que l'utilisateur a DÉCLARÉ d'une enveloppe. Un `null` y signifie « non déclaré ». */
export interface PortfolioEnvelopePolicy {
  id: string;
  accountId: string;
  lotMatchingMethod: LotMatchingMethod | null;
  /**
   * Date à partir de laquelle le ledger de CETTE enveloppe est exhaustif. Distincte de
   * `DashboardState.ledgerCoverageStart`, qui porte sur le ledger bancaire.
   */
  ledgerCoverageStart: string | null;
  ledgerCoverageSource: LedgerCoverageSource | null;
  notes: string | null;
  provenance: Provenance;
}

/**
 * REAL ESTATE V2 — TYPES CANONIQUES
 *
 * L'immobilier est une couche de FAITS, pas un simulateur. Quatre familles de faits, et
 * rien d'autre : ce que le bien EST, ce qu'il VAUT, ce qu'il a COÛTÉ, ce qu'il RAPPORTE.
 * Le financement n'en fait pas partie : il vit dans `Liability` et le domaine immobilier
 * s'y RATTACHE. Aucun échéancier n'est reconstruit ici.
 *
 * Rendement, equity, plus-value, coût économique du financement et scénarios sont DÉRIVÉS
 * par `src/lib/engine/real-estate.ts`. Rien de tout cela n'est persisté : une correction
 * de valorisation laisserait derrière elle un rendement périmé.
 */
export const REAL_ESTATE_USAGES = [
  "PRIMARY_RESIDENCE",
  "SECONDARY_RESIDENCE",
  "RENTAL",
  "MIXED_USE",
  "LAND",
  "OTHER",
] as const;
/**
 * Usage économique du bien. `null` sur l'actif signifie « non déclaré » et jamais
 * « OTHER » : une résidence principale ne produit aucun loyer et n'a pas de rendement, un
 * locatif en a un. Supposer l'un à la place de l'autre fausse les deux lectures.
 */
export type RealEstateUsage = (typeof REAL_ESTATE_USAGES)[number];

export const REAL_ESTATE_VALUATION_METHODS = [
  "MARKET_APPRAISAL",
  "NOTARY_ESTIMATE",
  "AGENT_ESTIMATE",
  "INDEX_ADJUSTED",
  "USER_ESTIMATE",
  "PURCHASE_PRICE",
] as const;
export type RealEstateValuationMethod = (typeof REAL_ESTATE_VALUATION_METHODS)[number];

/**
 * Faits de capital. Le montant est TOUJOURS positif : la direction économique vient du
 * type. `ACQUISITION_COST` et `CAPEX` entrent dans la base de coût ; l'entretien courant
 * n'est pas ici, c'est une charge d'exploitation. COÛT DE REVIENT ≠ CHARGE.
 */
export const REAL_ESTATE_CAPITAL_EVENT_TYPES = [
  "ACQUISITION_PRICE",
  "ACQUISITION_COST",
  "CAPEX",
  "DISPOSAL_PRICE",
  "DISPOSAL_COST",
] as const;
export type RealEstateCapitalEventType = (typeof REAL_ESTATE_CAPITAL_EVENT_TYPES)[number];

/** Identité d'un bien détenu. Ne porte aucun montant : les montants sont des faits datés. */
export interface RealEstateAsset {
  id: string;
  name: string;
  location: string | null;
  surfaceSqm: number | null;
  /** `null` = usage non déclaré. */
  usage: RealEstateUsage | null;
  /**
   * Quote-part détenue, dans ]0,1]. `null` = non déclarée : la valeur attribuable au
   * patrimoine devient alors NON CALCULABLE, elle n'est jamais supposée entière.
   */
  ownershipShare: number | null;
  /**
   * Le bien est-il financé par une dette ? TRI-ÉTAT, et la distinction est financière :
   *
   *   `false` → l'utilisateur DÉCLARE que le bien n'est financé par aucune dette. Zéro est
   *             alors une valeur, et l'equity du bien vaut sa valeur attribuable.
   *   `true`  → une dette le finance. Tant qu'aucun concours n'est rattaché, la dette
   *             attribuée reste INCONNUE ; elle n'est jamais nulle.
   *   `null`  → non déclaré. Aucune métrique dépendant du financement n'est calculable.
   *
   * ABSENCE DE RATTACHEMENT ≠ ABSENCE DE DETTE. Sans ce champ, un bien dont le crédit n'a
   * pas encore été saisi afficherait la même equity qu'un bien acheté comptant, et le
   * patrimoine serait surévalué du montant entier de la dette.
   */
  isDebtFinanced: boolean | null;
  acquisitionDate: string | null;
  /** Date de cession effective. Un bien cédé quitte le bilan à cette date. */
  disposalDate: string | null;
  archived: boolean;
  notes: string | null;
  provenance: Provenance;
}

/** Valorisation datée. Une OBSERVATION : le moteur ne l'indexe ni ne la fait vieillir. */
export interface RealEstateValuation {
  id: string;
  propertyId: string;
  valuedAt: string;
  /** Valeur du bien ENTIER, en devise native. La quote-part est appliquée par le moteur. */
  value: number;
  currency: string;
  method: RealEstateValuationMethod;
  notes: string | null;
  provenance: Provenance;
}

export interface RealEstateCapitalEvent {
  id: string;
  propertyId: string;
  type: RealEstateCapitalEventType;
  eventDate: string;
  /** Toujours positif. La direction vient du type. */
  amount: number;
  currency: string;
  label: string | null;
  /** Jambe de trésorerie déjà existante. Aucun flux n'est créé ni recopié. */
  transactionId: string | null;
  notes: string | null;
  provenance: Provenance;
}

/**
 * Termes d'exploitation DÉCLARÉS, datés. Tout terme `null` signifie « non déclaré » et
 * jamais « zéro » : un rendement net calculé en traitant une charge inconnue comme nulle
 * serait flatteur et faux. Tous les montants sont ANNUELS et en devise `currency`.
 */
export interface RealEstateOperatingTerms {
  id: string;
  propertyId: string;
  effectiveFrom: string;
  currency: string;
  /** Loyer contractuel brut annuel, hors vacance. */
  annualGrossRent: number | null;
  /** Dans [0,1]. `null` = non déclaré : le loyer effectif devient non calculable. */
  vacancyRate: number | null;
  annualOperatingCharges: number | null;
  annualPropertyTax: number | null;
  annualInsurance: number | null;
  annualMaintenance: number | null;
  annualManagementFees: number | null;
  /** Part du loyer encaissé. Exclusif de `annualManagementFees`. */
  managementFeeRate: number | null;
  annualOtherCosts: number | null;
  /**
   * Taux d'imposition effectif DÉCLARÉ sur le résultat foncier. LFO ne porte aucune règle
   * fiscale immobilière fiable : à `null`, aucun résultat après impôt n'est produit. Ce
   * n'est pas un taux par défaut.
   */
  effectiveIncomeTaxRate: number | null;
  notes: string | null;
  provenance: Provenance;
}

/**
 * Rattachement d'un bien à une dette EXISTANTE. Ne porte aucun montant de passif : le
 * passif du bilan vient de `Liability` et de lui seul. Ce lien répond à une question
 * d'ATTRIBUTION, et c'est ce qui permet de calculer l'equity dans un bien sans jamais
 * compter la même dette deux fois.
 */
export interface RealEstateFinancingLink {
  id: string;
  propertyId: string;
  liabilityId: string;
  /** Part du concours affectée à ce bien, dans ]0,1]. */
  allocationShare: number;
  notes: string | null;
  provenance: Provenance;
}

export interface DashboardState {
  asOfDate: string;
  reportingCurrency: string;
  /**
   * Date à partir de laquelle l'ensemble du ledger actuellement considéré par LFO est
   * déclaré exhaustif.
   *
   * C'est une propriété GLOBALE du ledger, pas la couverture d'un établissement donné :
   * LFO n'a pas encore de modèle multi-source où chaque banque ou connecteur porterait sa
   * propre profondeur. Le jour où il l'aura, cette valeur globale pourra en être dérivée
   * de façon conservatrice ; elle n'est pas construite aujourd'hui.
   *
   * `null` est la valeur normale et signifie « non déclarée », jamais « depuis toujours ».
   * Le produit ne la déduit jamais de la plus ancienne transaction trouvée, qui n'est
   * qu'une observation.
   */
  ledgerCoverageStart: string | null;
  /** Origine de la déclaration ci-dessus. Ce n'est pas un niveau de confiance. */
  ledgerCoverageSource: LedgerCoverageSource;
  accounts: FinancialAccount[];
  /** Historique comptable daté ; absent seulement dans les anciens fixtures/tests. */
  accountBalanceHistory?: AccountBalanceObservation[];
  positions: Position[];
  /** Ledger portefeuille : faits datés. Vide tant qu'aucun événement n'a été saisi. */
  portfolioEvents: PortfolioEvent[];
  /** Déclarations d'enveloppe. Une enveloppe sans entrée n'a rien déclaré. */
  portfolioPolicies: PortfolioEnvelopePolicy[];
  /** Biens détenus. Vide tant qu'aucun bien n'a été enregistré. */
  realEstateAssets: RealEstateAsset[];
  realEstateValuations: RealEstateValuation[];
  realEstateCapitalEvents: RealEstateCapitalEvent[];
  realEstateOperatingTerms: RealEstateOperatingTerms[];
  /** Rattachements bien ↔ dette. Ne portent aucun passif. */
  realEstateFinancingLinks: RealEstateFinancingLink[];
  /** Business Equity V2 — faits canoniques, puis lecture dérivée. */
  businesses: import("@/lib/engine/business-equity").BusinessEntity[];
  businessOwnership: import("@/lib/engine/business-equity").BusinessOwnership[];
  businessFinancials: import("@/lib/engine/business-equity").BusinessFinancialSnapshot[];
  businessValuations: import("@/lib/engine/business-equity").BusinessValuation[];
  businessCapitalEvents: import("@/lib/engine/business-equity").BusinessCapitalEvent[];
  businessHoldings: import("@/lib/engine/business-equity").BusinessHoldingLink[];
  liabilities: Liability[];
  incomes: IncomeSource[];
  expenseCategories: ExpenseCategory[];
  transactions: Transaction[];
  recurringRules: RecurringCashFlowRule[];
  cashFlowCloses: CashFlowMonthlyClose[];
  scenarios: Scenario[];
  goals: Goal[];
  alerts: Alert[];
  monthlyCloses: MonthlyClose[];
  netWorthSnapshots?: NetWorthSnapshot[];
  currencyRates?: import("@/lib/engine/fx").CurrencyRate[];
  documents: DocumentRecord[];
  metrics: DashboardMetrics;
  /** Vérité patrimoniale canonique ; absente seulement dans les anciens fixtures/tests. */
  balanceSheet?: import("@/lib/engine/balance-sheet").CanonicalBalanceSheet;
  balanceSheetMetrics?: import("@/lib/engine/balance-sheet-metrics").CanonicalBalanceSheetMetrics;
  /** Lecture dérivée du ledger portefeuille ; absente seulement dans d'anciens fixtures. */
  portfolioLedger?: import("@/lib/engine/portfolio").PortfolioLedger;
  /** Analytics dérivées, jamais une seconde source de faits. */
  portfolioAnalytics?: import("@/lib/engine/portfolio-analytics").PortfolioAnalytics;
  /** Lecture dérivée du domaine immobilier ; absente seulement dans d'anciens fixtures. */
  realEstate?: import("@/lib/engine/real-estate").RealEstatePortfolio;
  /** Business Equity dérivé, jamais une seconde source de faits. */
  businessEquity?: import("@/lib/engine/business-equity").BusinessEquityPortfolio;
  assumptions: Array<{
    id: string;
    name: string;
    value: number | string | null;
    unit: string;
    provenance: Provenance;
  }>;
}

export interface ProjectionPoint {
  year: number;
  age: number;
  deterministic?: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface ProjectionResult {
  scenarioId: string;
  seed: number;
  simulations: number;
  /** Percentiles du PATRIMOINE NET financier, année par année. */
  points: ProjectionPoint[];
  methodology: string;
}

/** Point annuel réduit depuis le déroulé mensuel. Aucun calcul annuel parallèle. */
export interface AnnualBalanceSheetPoint {
  year: number;
  monthIndex: number;
  grossFinancialAssets: number;
  debt: number;
  fundingGap: number;
  netWorth: number;
  bankCash: number;
  marketInvestedAssets: number;
  cumulativeOperatingSurplus: number;
  cumulativeMarketPnL: number;
  cumulativeCashInterestPaid: number;
  cumulativeCapitalisedInterest: number;
  cumulativeInsurancePaid: number;
  cumulativeCashFeesPaid: number;
  cumulativeCapitalisedCharges: number;
  cumulativeEconomicDebtCosts: number;
  cumulativePrincipalPaid: number;
  /** Vrai dès qu'un besoin de financement est apparu : la trajectoire est partielle. */
  financingCostMissing: boolean;
}

export interface ProjectionEnvelope extends ProjectionResult {
  /** Trajectoire déterministe issue de la même transition mensuelle. */
  deterministic: AnnualBalanceSheetPoint[];
  openingNetWorth: number;
  assumptions: {
    operatingSurplusBeforeDebt: number;
    investmentAllocationRate: number;
    annualReturn: number;
  };
}
