/**
 * FOURNISSEUR SANDBOX — CHAÎNE COMPLÈTE, AUCUN RÉSEAU
 *
 * Ce n'est PAS un adaptateur d'agrégateur réel déguisé. Il n'imite ni Bridge, ni Powens, ni
 * Nordigen, ni Tink, ni Plaid, ni aucun autre : il implémente le contrat neutre à partir
 * d'un scénario DÉCLARÉ, et sert à prouver que toute la chaîne fonctionne — pagination,
 * reprise, rejeu, `PENDING` → `BOOKED`, correction, annulation, devise étrangère, champs
 * manquants, expiration, révocation, 401, 403, 429, 5xx, timeout.
 *
 * AUCUN ADAPTATEUR RÉEL N'EST FOURNI dans cette PR, et c'est délibéré : sans contrat signé,
 * sans identifiants et sans réponse réelle à observer, écrire un adaptateur « Bridge » ou
 * « Powens » de mémoire produirait un FAUX SUPPORT — du code qui paraît prêt et qui échoue
 * au premier vrai appel, ou pire, qui lit le mauvais champ. Un vrai fournisseur reste
 * `BLOCKED_EXTERNAL` jusqu'à ce qu'un contrat et des identifiants existent.
 *
 * Aucun secret ne vit ici. Le scénario est déclaré par l'appelant, la référence de secret
 * est vérifiée pour sa PRÉSENCE et jamais lue.
 */
import { createHash } from "node:crypto";
import type {
  BankDataProvider,
  BankProviderCapabilities,
  BankProviderFailure,
  BankProviderFailureCode,
  BankSyncContext,
  ProviderAccount,
  ProviderBalance,
  ProviderPage,
  ProviderResult,
  ProviderTransaction,
} from "../types";

export const SANDBOX_PROVIDER_ID = "sandbox-ais";
export const SANDBOX_PROVIDER_VERSION = "1";

/** Capacités par défaut du sandbox. Chaque scénario peut les restreindre, jamais les élargir en silence. */
export const SANDBOX_CAPABILITIES: BankProviderCapabilities = {
  stableTransactionIds: true,
  pendingTransactions: true,
  bookingDate: true,
  valueDate: true,
  balanceTypes: ["BOOKED", "AVAILABLE"],
  transactionCorrections: true,
  webhooks: true,
  declaredHistoryDays: 90,
  pageSize: 2,
};

/**
 * Échec PROGRAMMÉ pour une page donnée. `attempts` dit combien de fois l'échec se produit
 * avant que l'appel réussisse : c'est ce qui permet de prouver qu'un 429 est réessayé et
 * qu'un consentement révoqué ne l'est pas.
 */
export interface SandboxFailurePlan {
  onPage: number;
  code: BankProviderFailureCode;
  attempts: number;
  retryAfterSeconds?: number | null;
}

export interface SandboxScenario {
  accounts: readonly ProviderAccount[];
  balances: readonly ProviderBalance[];
  /** Pages d'opérations, dans l'ordre. Une page vide au milieu est un cas LÉGITIME. */
  transactionPages: readonly (readonly ProviderTransaction[])[];
  capabilities?: Partial<BankProviderCapabilities>;
  failures?: readonly SandboxFailurePlan[];
  /** Le fournisseur rend-il un curseur qui ne progresse pas ? Pour prouver l'anti-boucle. */
  stuckCursorAtPage?: number | null;
  /** Échec programmé sur `listAccounts` ou `listBalances`. */
  accountsFailure?: BankProviderFailureCode | null;
  balancesFailure?: BankProviderFailureCode | null;
}

function failure(
  code: BankProviderFailureCode,
  retryAfterSeconds: number | null = null,
): BankProviderFailure {
  const messages: Record<BankProviderFailureCode, string> = {
    UNAUTHORIZED: "Le fournisseur refuse l'authentification (401). Le jeton doit être renouvelé.",
    FORBIDDEN: "Le fournisseur refuse l'accès à cette ressource (403).",
    CONSENT_EXPIRED: "Le consentement est expiré. Il doit être renouvelé par l'utilisateur.",
    CONSENT_REVOKED: "Le consentement a été révoqué. Aucune lecture n'est plus autorisée.",
    RATE_LIMITED: "Quota d'appels dépassé (429).",
    SERVER_ERROR: "Erreur serveur du fournisseur (5xx).",
    TIMEOUT: "Le fournisseur n'a pas répondu dans le délai imparti.",
    NETWORK_ERROR: "La connexion au fournisseur a échoué.",
    MALFORMED_RESPONSE: "Réponse du fournisseur illisible : elle n'est pas exploitée.",
    ACCOUNT_UNKNOWN: "Compte inconnu du fournisseur.",
    NOT_SERVED: "Ressource NON SERVIE par ce fournisseur.",
  };
  return { code, message: messages[code], retryAfterSeconds };
}

function hashOf(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Construit le fournisseur sandbox pour un scénario.
 *
 * L'état des tentatives est porté par la fabrique, pas par un singleton : deux
 * synchronisations d'un même test ne se contaminent pas.
 */
export function createSandboxProvider(scenario: SandboxScenario): BankDataProvider {
  const capabilities: BankProviderCapabilities = {
    ...SANDBOX_CAPABILITIES,
    ...(scenario.capabilities ?? {}),
  };
  const attemptsByPage = new Map<number, number>();

  function requireSecret(context: BankSyncContext): BankProviderFailure | null {
    // La PRÉSENCE d'une référence de secret est vérifiée ; sa VALEUR n'est jamais lue par
    // cette couche, et aucun secret ne transite par elle.
    if (context.secret.vault.trim().length === 0 || context.secret.key.trim().length === 0) {
      return failure("UNAUTHORIZED");
    }
    return null;
  }

  function cursorFor(pageIndex: number): string | null {
    if (scenario.stuckCursorAtPage !== null && scenario.stuckCursorAtPage !== undefined) {
      if (pageIndex + 1 >= scenario.stuckCursorAtPage) return `page-${scenario.stuckCursorAtPage}`;
    }
    return pageIndex + 1 < scenario.transactionPages.length ? `page-${pageIndex + 1}` : null;
  }

  function pageIndexOf(cursor: string | null): number | null {
    if (cursor === null) return 0;
    const match = /^page-(\d+)$/.exec(cursor);
    if (match === null) return null;
    const index = Number(match[1]);
    return index < scenario.transactionPages.length ? index : null;
  }

  return {
    id: SANDBOX_PROVIDER_ID,
    version: SANDBOX_PROVIDER_VERSION,
    capabilities,

    async listAccounts(context): Promise<ProviderResult<readonly ProviderAccount[]>> {
      const missing = requireSecret(context);
      if (missing !== null) return { ok: false, failure: missing };
      if (scenario.accountsFailure !== null && scenario.accountsFailure !== undefined) {
        return { ok: false, failure: failure(scenario.accountsFailure) };
      }
      return { ok: true, value: scenario.accounts };
    },

    async listBalances(
      context,
      providerAccountId,
    ): Promise<ProviderResult<readonly ProviderBalance[]>> {
      const missing = requireSecret(context);
      if (missing !== null) return { ok: false, failure: missing };
      if (scenario.balancesFailure !== null && scenario.balancesFailure !== undefined) {
        return { ok: false, failure: failure(scenario.balancesFailure) };
      }
      if (!scenario.accounts.some((account) => account.providerAccountId === providerAccountId)) {
        return { ok: false, failure: failure("ACCOUNT_UNKNOWN") };
      }
      return {
        ok: true,
        value: scenario.balances.filter(
          (balance) => balance.providerAccountId === providerAccountId,
        ),
      };
    },

    async listTransactions(
      context,
      providerAccountId,
      cursor,
    ): Promise<ProviderResult<ProviderPage<ProviderTransaction>>> {
      const missing = requireSecret(context);
      if (missing !== null) return { ok: false, failure: missing };
      if (!scenario.accounts.some((account) => account.providerAccountId === providerAccountId)) {
        return { ok: false, failure: failure("ACCOUNT_UNKNOWN") };
      }

      const pageIndex = pageIndexOf(cursor);
      if (pageIndex === null) return { ok: false, failure: failure("MALFORMED_RESPONSE") };

      const planned = (scenario.failures ?? []).find((entry) => entry.onPage === pageIndex);
      if (planned !== undefined) {
        const already = attemptsByPage.get(pageIndex) ?? 0;
        if (already < planned.attempts) {
          attemptsByPage.set(pageIndex, already + 1);
          return {
            ok: false,
            failure: failure(planned.code, planned.retryAfterSeconds ?? null),
          };
        }
      }

      const items = (scenario.transactionPages[pageIndex] ?? []).filter(
        (transaction) => transaction.providerAccountId === providerAccountId,
      );
      // Le BRUT de la page est le corps réellement rendu. Son empreinte porte le numéro de
      // page : deux pages de contenu identique restent deux pages distinctes, et seule une
      // MÊME page rejouée est reconnue comme un rejeu.
      const rawPayload = JSON.stringify({ page: pageIndex, items });
      return {
        ok: true,
        value: {
          items,
          nextCursor: cursorFor(pageIndex),
          payloadHash: hashOf(rawPayload),
          rawPayload,
        },
      };
    },
  };
}
