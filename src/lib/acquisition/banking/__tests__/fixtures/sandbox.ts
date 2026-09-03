/**
 * Scénarios de fixture pour le fournisseur sandbox.
 *
 * Ils ne reproduisent AUCUN format d'agrégateur réel : chaque scénario existe pour exercer
 * un comportement du contrat neutre — pagination, page vide au milieu, boucle de curseur,
 * `PENDING` → `BOOKED`, correction, annulation, devise étrangère, champs manquants, échecs
 * nommés.
 */
import type { ProviderAccount, ProviderBalance, ProviderTransaction } from "../../types";

export const ACCOUNT: ProviderAccount = {
  providerAccountId: "pa-1",
  providerInstitutionId: "inst-1",
  name: "Compte courant",
  maskedIdentifier: "FR76****1234",
  accountType: "CHECKING",
  currency: "EUR",
};

export const SECOND_ACCOUNT: ProviderAccount = {
  providerAccountId: "pa-2",
  providerInstitutionId: "inst-1",
  name: "Livret",
  maskedIdentifier: "FR76****9876",
  accountType: "SAVINGS",
  currency: "EUR",
};

export const BALANCES: readonly ProviderBalance[] = [
  {
    providerAccountId: "pa-1",
    balanceType: "BOOKED",
    amount: 4210.55,
    currency: "EUR",
    observedAt: "2026-08-19",
  },
  // Solde NON SERVI : le fournisseur rend la nature et pas le montant.
  {
    providerAccountId: "pa-1",
    balanceType: "AVAILABLE",
    amount: null,
    currency: "EUR",
    observedAt: "2026-08-19",
  },
];

export function transaction(overrides: Partial<ProviderTransaction> = {}): ProviderTransaction {
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
