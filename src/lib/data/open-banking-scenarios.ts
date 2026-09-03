import "server-only";

import type { ProviderTransaction, SandboxScenario } from "@/lib/acquisition/banking";

/**
 * CATALOGUE DE SCÉNARIOS SANDBOX, CÔTÉ SERVEUR
 *
 * Le navigateur choisit un scénario par son NOM ; il n'en fournit jamais le contenu. Laisser
 * le client décrire les opérations ferait de l'écran une porte d'injection de faits, et une
 * observation « bancaire » saisie à la main ne serait plus une observation.
 *
 * Ces scénarios n'imitent AUCUN agrégateur réel. Ils existent pour exercer la chaîne
 * complète sans réseau : pagination, page vide au milieu, `PENDING` → `BOOKED`, correction,
 * annulation, devise étrangère, champs manquants, quota dépassé, consentement révoqué.
 */

function transaction(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
  return {
    providerTransactionId: "tx-1",
    providerAccountId: "pa-1",
    state: "BOOKED",
    operationDate: "2026-08-19",
    valueDate: "2026-08-20",
    bookingDate: "2026-08-20",
    amount: -51.84,
    currency: "EUR",
    label: "CAFE DU COIN",
    counterparty: "BAR DU COIN",
    reference: "REF-MENSUELLE",
    replacesProviderTransactionId: null,
    originalAmount: null,
    originalCurrency: null,
    ...overrides,
  };
}

const ACCOUNTS = [
  {
    providerAccountId: "pa-1",
    providerInstitutionId: "inst-sandbox",
    name: "Compte courant sandbox",
    maskedIdentifier: "FR76****1234",
    accountType: "CHECKING",
    currency: "EUR",
  },
  {
    providerAccountId: "pa-2",
    providerInstitutionId: "inst-sandbox",
    name: "Livret sandbox",
    maskedIdentifier: "FR76****9876",
    accountType: "SAVINGS",
    currency: "EUR",
  },
] as const;

const BALANCES = [
  {
    providerAccountId: "pa-1",
    balanceType: "BOOKED" as const,
    amount: 4210.55,
    currency: "EUR",
    observedAt: "2026-08-20",
  },
  // Solde NON SERVI : la nature est rendue, le montant non. Il reste absent.
  {
    providerAccountId: "pa-1",
    balanceType: "AVAILABLE" as const,
    amount: null,
    currency: "EUR",
    observedAt: "2026-08-20",
  },
] as const;

export const SANDBOX_SCENARIOS = {
  /** Trois pages, dont une VIDE au milieu : PAGE VIDE ≠ FIN DE PAGINATION. */
  NOMINAL: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [
      [
        transaction(),
        transaction({
          providerTransactionId: "tx-2",
          amount: 2450,
          label: "VIREMENT SALAIRE",
          counterparty: "EMPLOYEUR",
        }),
      ],
      [],
      [
        transaction({
          providerTransactionId: "tx-3",
          operationDate: "2026-08-20",
          amount: -78.2,
          label: "SUPERMARCHE",
        }),
      ],
    ],
  },

  /** Une opération EN ATTENTE, puis sa version comptabilisée qui la REMPLACE explicitement. */
  PENDING_THEN_BOOKED: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [
      [
        transaction({
          providerTransactionId: "tx-pending",
          state: "PENDING",
          amount: -120,
          label: "RESTAURANT (autorisation)",
          bookingDate: null,
        }),
      ],
      [
        transaction({
          providerTransactionId: "tx-booked",
          state: "BOOKED",
          amount: -118.4,
          label: "RESTAURANT",
          replacesProviderTransactionId: "tx-pending",
        }),
      ],
    ],
  },

  /** Correction et annulation signalées par la banque, jamais silencieuses. */
  CORRECTED_AND_CANCELLED: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [
      [
        transaction({
          providerTransactionId: "tx-corrigee",
          state: "CORRECTED",
          amount: -49.9,
          label: "ABONNEMENT (corrigé)",
        }),
        transaction({
          providerTransactionId: "tx-annulee",
          state: "CANCELLED",
          amount: -300,
          label: "PAIEMENT ANNULE",
        }),
      ],
    ],
  },

  /** Devise étrangère et opération convertie : aucun taux n'est déduit du rapport. */
  FOREIGN_CURRENCY: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [
      [
        transaction({
          providerTransactionId: "tx-usd",
          amount: -9.2,
          currency: "EUR",
          originalAmount: -9.9,
          originalCurrency: "USD",
          label: "SERVICE EN LIGNE",
        }),
        transaction({
          providerTransactionId: "tx-chf",
          amount: -42,
          currency: "CHF",
          label: "PEAGE SUISSE",
        }),
      ],
    ],
  },

  /** Champs manquants : chaque absence BLOQUE sa ligne, et rien n'est comblé. */
  MISSING_FIELDS: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [
      [
        transaction({ providerTransactionId: "tx-sans-montant", amount: null }),
        transaction({ providerTransactionId: "tx-sans-date", operationDate: null }),
        transaction({ providerTransactionId: "tx-sans-libelle", label: null }),
        transaction({ providerTransactionId: "tx-sans-devise", currency: null }),
        transaction({ providerTransactionId: null, label: "SANS IDENTIFIANT" }),
      ],
    ],
  },

  /** Identifiants NON déclarés stables : aucune identité n'est construite. */
  UNSTABLE_IDS: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    capabilities: { stableTransactionIds: false },
    transactionPages: [[transaction({ providerTransactionId: "tx-instable" })]],
  },

  /** Quota dépassé sur la deuxième page, puis succès : la reprise fait le reste. */
  RATE_LIMITED: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [
      [transaction()],
      [transaction({ providerTransactionId: "tx-2" })],
      [transaction({ providerTransactionId: "tx-3" })],
    ],
    failures: [{ onPage: 1, code: "RATE_LIMITED" as const, attempts: 1, retryAfterSeconds: 1 }],
  },

  /** Erreur serveur persistante : la synchronisation est PARTIELLE et le dit. */
  SERVER_ERROR: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [[transaction()], [transaction({ providerTransactionId: "tx-2" })]],
    failures: [{ onPage: 1, code: "SERVER_ERROR" as const, attempts: 99 }],
  },

  /** Consentement révoqué côté fournisseur : aucun nouvel essai. */
  CONSENT_REVOKED: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [[transaction()]],
    failures: [{ onPage: 0, code: "CONSENT_REVOKED" as const, attempts: 99 }],
  },

  /** Jeton refusé (401) : le consentement doit être renouvelé. */
  UNAUTHORIZED: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [[transaction()]],
    failures: [{ onPage: 0, code: "UNAUTHORIZED" as const, attempts: 99 }],
  },

  /** Curseur qui ne progresse pas : une BOUCLE, interrompue et nommée. */
  STUCK_CURSOR: {
    accounts: ACCOUNTS,
    balances: BALANCES,
    transactionPages: [
      [transaction()],
      [transaction({ providerTransactionId: "tx-2" })],
      [transaction({ providerTransactionId: "tx-3" })],
    ],
    stuckCursorAtPage: 2,
  },
} as const satisfies Record<string, SandboxScenario>;

export type SandboxScenarioName = keyof typeof SANDBOX_SCENARIOS;

export const SANDBOX_SCENARIO_NAMES = Object.keys(SANDBOX_SCENARIOS) as SandboxScenarioName[];

export function sandboxScenario(name: SandboxScenarioName): SandboxScenario {
  return SANDBOX_SCENARIOS[name];
}
