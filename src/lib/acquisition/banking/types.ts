/**
 * OPEN BANKING — AGRÉGATION DE COMPTES (AIS), LECTURE SEULE
 *
 * Cette couche lit une banque par l'intermédiaire d'un agrégateur. Elle ne calcule AUCUNE
 * finance, ne classe aucun flux, ne rapproche aucun transfert interne et n'écrit rien au
 * canonique par elle-même. Elle produit des OBSERVATIONS datées, avec leurs ambiguïtés
 * déclarées, et refuse de transporter ce qu'elle n'a pas compris.
 *
 * Quatre frontières, jamais franchies en silence :
 *
 *   PROVIDER          l'agrégateur et l'établissement, avec ses capacités DÉCLARÉES
 *   CONSENT           l'autorisation de lecture, datée, expirable et révocable
 *   OBSERVATION       ce que le fournisseur a dit à une date, immuable dans son brut
 *   CANONIQUE         ce que le Cash Flow Engine accepte d'écrire, après DÉCISION humaine
 *
 * ```text
 * OBSERVATION ≠ FAIT CANONIQUE          PENDING ≠ BOOKED
 * SOLDE ABSENT ≠ SOLDE À ZÉRO           MONTANT ABSENT ≠ ZÉRO
 * DATE D'OPÉRATION ≠ DATE DE VALEUR ≠ DATE DE COMPTABILISATION
 * COMPTE FOURNISSEUR ≠ COMPTE CANONIQUE FX ABSENT ≠ FX ÉGAL À 1
 * CAPACITÉ NON DÉCLARÉE ≠ CAPACITÉ ABSENTE
 * IDENTIFIANT FOURNI ≠ IDENTITÉ DÉMONTRÉE
 * ```
 *
 * AUCUNE INITIATION DE PAIEMENT. Le contrat d'adaptateur n'expose aucune primitive
 * d'écriture vers la banque, et ce n'est pas une omission : un module de lecture qui
 * porterait une méthode d'ordre de paiement serait un module de paiement.
 */
import type { ImportIssueCode, ImportIssueSeverity } from "../types";

/** Anomalie d'une synchronisation. Même forme et même vocabulaire que l'acquisition fichier. */
export interface BankSyncIssue {
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  /** Champ fournisseur concerné, ou `null` quand l'anomalie porte sur l'objet entier. */
  field: string | null;
  /** Valeur telle que le fournisseur l'a rendue, jamais normalisée. */
  sourceValue: string | null;
  message: string;
}

/**
 * Ce qu'un adaptateur DÉCLARE savoir faire.
 *
 * Rien n'est supposé. Un agrégateur qui ne dit pas si ses identifiants de transaction sont
 * stables n'en a pas : `stableTransactionIds` vaut `false` par défaut, et la déduplication
 * automatique est alors interdite — un identifiant instable rejetterait des opérations
 * réelles au fil des synchronisations.
 *
 * `CAPACITÉ NON DÉCLARÉE ≠ CAPACITÉ ABSENTE` reste vrai à l'envers : une capacité déclarée
 * `false` est une information, une capacité absente du contrat est une inconnue. C'est
 * pourquoi chaque champ est REQUIS ici : un adaptateur doit se prononcer.
 */
export interface BankProviderCapabilities {
  /** Le fournisseur garantit-il un identifiant de transaction stable dans le temps ? */
  stableTransactionIds: boolean;
  /** Distingue-t-il les opérations en attente des opérations comptabilisées ? */
  pendingTransactions: boolean;
  /** Rend-il une date de comptabilisation distincte de la date d'opération ? */
  bookingDate: boolean;
  /** Rend-il une date de valeur ? */
  valueDate: boolean;
  /** Rend-il des soldes, et lesquels ? Liste vide = aucun solde servi. */
  balanceTypes: readonly BankBalanceType[];
  /** Signale-t-il les opérations annulées ou corrigées, plutôt que de les faire disparaître ? */
  transactionCorrections: boolean;
  /** Émet-il des notifications (webhooks) ? */
  webhooks: boolean;
  /** Profondeur d'historique que le fournisseur DÉCLARE servir, en jours. `null` = non déclarée. */
  declaredHistoryDays: number | null;
  /** Nombre maximal d'éléments par page, tel que le fournisseur le déclare. */
  pageSize: number;
}

/**
 * Nature d'un solde. Un solde disponible n'est pas un solde comptable, et les additionner
 * produirait un patrimoine faux.
 */
export const BANK_BALANCE_TYPES = [
  "BOOKED",
  "AVAILABLE",
  "EXPECTED",
  "CLOSING_BOOKED",
  "INTERIM_AVAILABLE",
] as const;
export type BankBalanceType = (typeof BANK_BALANCE_TYPES)[number];

/** Cycle de vie d'un consentement. `REVOKED` et `EXPIRED` sont terminaux. */
export const BANK_CONSENT_STATUSES = [
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "REVOKED",
  "REAUTH_REQUIRED",
  "ERROR",
] as const;
export type BankConsentStatus = (typeof BANK_CONSENT_STATUSES)[number];

/**
 * Portée d'un consentement. `TRANSACTIONS` et `BALANCES` sont les deux seules portées
 * existantes, et il n'y en a pas de troisième : une portée d'initiation de paiement
 * n'existe pas dans ce module.
 */
export const BANK_CONSENT_SCOPES = ["ACCOUNTS", "BALANCES", "TRANSACTIONS"] as const;
export type BankConsentScope = (typeof BANK_CONSENT_SCOPES)[number];

/** État d'une opération telle que le fournisseur la présente. */
export const BANK_OBSERVATION_STATES = ["PENDING", "BOOKED", "CANCELLED", "CORRECTED"] as const;
export type BankObservationState = (typeof BANK_OBSERVATION_STATES)[number];

/**
 * Une opération telle que le fournisseur l'a rendue, avant toute interprétation.
 *
 * Les trois dates sont conservées SÉPARÉMENT. Les confondre ferait basculer une opération
 * d'un mois à l'autre sans que rien ne le dise, et le Cash Flow Engine arbitre à sa date,
 * pas à celle que l'agrégateur trouve commode.
 *
 * `amount` est SIGNÉ et exprimé dans `currency`. Un montant absent reste `null` : un débit
 * dont le fournisseur n'a pas rendu la valeur n'est pas un débit de zéro.
 */
export interface ProviderTransaction {
  /** Identifiant rendu par le fournisseur. PRÉTENDU, jamais une identité par lui-même. */
  providerTransactionId: string | null;
  /** Compte FOURNISSEUR concerné, jamais un compte canonique. */
  providerAccountId: string;
  state: BankObservationState;
  /** Date de l'opération telle que la banque la présente. */
  operationDate: string | null;
  valueDate: string | null;
  bookingDate: string | null;
  amount: number | null;
  currency: string | null;
  label: string | null;
  counterparty: string | null;
  /** Référence descriptive. Une banque peut la répéter : elle ne décide d'aucune identité. */
  reference: string | null;
  /**
   * Identifiant de l'opération que celle-ci REMPLACE, quand le fournisseur le déclare.
   * C'est la seule preuve acceptée d'un passage `PENDING` → `BOOKED` par identifiant.
   */
  replacesProviderTransactionId: string | null;
  /** Montant en devise d'origine quand l'opération a été convertie par la banque. */
  originalAmount: number | null;
  originalCurrency: string | null;
}

/** Un solde tel que le fournisseur l'a rendu. */
export interface ProviderBalance {
  providerAccountId: string;
  balanceType: BankBalanceType;
  /** `null` = solde NON SERVI par le fournisseur. Jamais zéro. */
  amount: number | null;
  currency: string | null;
  /** Date d'arrêté du solde telle que le fournisseur la déclare. */
  observedAt: string | null;
}

/** Un compte tel que le fournisseur le présente. Distinct de tout compte canonique. */
export interface ProviderAccount {
  providerAccountId: string;
  /** Identifiant d'établissement chez le fournisseur. */
  providerInstitutionId: string | null;
  name: string | null;
  /** IBAN partiel ou masqué selon le fournisseur. Jamais complété ni reconstruit. */
  maskedIdentifier: string | null;
  accountType: string | null;
  currency: string | null;
}

/**
 * Une page de résultats. `nextCursor` à `null` signifie « le fournisseur déclare la fin »,
 * ce qui n'est PAS la même chose qu'une page vide : un fournisseur peut rendre une page
 * vide et un curseur, et interrompre la pagination sur ce vide perdrait le reste.
 */
export interface ProviderPage<T> {
  items: readonly T[];
  nextCursor: string | null;
  /** Empreinte du corps réellement reçu, pour la protection contre le rejeu. */
  payloadHash: string;
  /** Corps réellement reçu, conservé tel quel comme BRUT de la page. */
  rawPayload: string;
}

/** Codes d'échec d'un appel fournisseur, nommés. Un échec sans code n'est pas diagnosticable. */
export const BANK_PROVIDER_FAILURE_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "CONSENT_EXPIRED",
  "CONSENT_REVOKED",
  "RATE_LIMITED",
  "SERVER_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
  "MALFORMED_RESPONSE",
  "ACCOUNT_UNKNOWN",
  "NOT_SERVED",
] as const;
export type BankProviderFailureCode = (typeof BANK_PROVIDER_FAILURE_CODES)[number];

/** Échecs qu'un nouvel essai peut résoudre. Une expiration de consentement n'en fait pas partie. */
export const RETRYABLE_PROVIDER_FAILURES: readonly BankProviderFailureCode[] = [
  "RATE_LIMITED",
  "SERVER_ERROR",
  "TIMEOUT",
  "NETWORK_ERROR",
];

export interface BankProviderFailure {
  code: BankProviderFailureCode;
  message: string;
  /** Délai de réessai déclaré par le fournisseur, en secondes. `null` = non déclaré. */
  retryAfterSeconds: number | null;
}

export type ProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: BankProviderFailure };

/**
 * Référence OPAQUE vers un secret conservé hors de cette couche.
 *
 * Aucun jeton, aucun secret client, aucune signature de webhook ne traverse ce module. Un
 * adaptateur reçoit une référence et la présente au porteur de secrets ; il n'en connaît
 * jamais la valeur. Tant qu'aucun coffre à secrets n'est validé pour ce dépôt, la base ne
 * persiste QUE cette référence, et jamais un jeton, même chiffré.
 */
export interface SecretReference {
  /** Coffre externe déclaré (par exemple `ENV`, `SUPABASE_VAULT`, `EXTERNAL_KMS`). */
  vault: string;
  /** Clé dans ce coffre. Jamais la valeur. */
  key: string;
}

/**
 * Contexte d'un appel : le consentement visé et sa référence de secret. Volontairement
 * SANS aucun champ de valeur secrète.
 */
export interface BankSyncContext {
  consentReference: string;
  secret: SecretReference;
  /** Instant de lecture, injecté : une couche pure ne lit pas l'horloge. */
  now: Date;
}

/**
 * Contrat d'adaptateur. NEUTRE au fournisseur, et volontairement minimal.
 *
 * Il n'expose que de la LECTURE. Il n'y a ni `initiatePayment`, ni `createTransfer`, ni
 * `submitOrder`, et il ne s'agit pas d'un oubli : le périmètre est l'agrégation.
 */
export interface BankDataProvider {
  readonly id: string;
  readonly version: string;
  readonly capabilities: BankProviderCapabilities;
  listAccounts(context: BankSyncContext): Promise<ProviderResult<readonly ProviderAccount[]>>;
  listBalances(
    context: BankSyncContext,
    providerAccountId: string,
  ): Promise<ProviderResult<readonly ProviderBalance[]>>;
  /**
   * Une page d'opérations. `cursor` à `null` demande la première page. L'adaptateur ne
   * décide JAMAIS de la fin par lui-même : il rend ce que le fournisseur a dit.
   */
  listTransactions(
    context: BankSyncContext,
    providerAccountId: string,
    cursor: string | null,
  ): Promise<ProviderResult<ProviderPage<ProviderTransaction>>>;
}
