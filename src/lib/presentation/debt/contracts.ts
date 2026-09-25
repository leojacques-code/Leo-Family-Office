import type { Liability, OutstandingDebt, Scenario } from "@/lib/types";
import type { FinancialDateContext } from "@/lib/financial-date";
import type { DerivedRailSource } from "@/lib/presentation/rail-sources";
import type { CanonicalAggregate } from "@/lib/engine/balance-sheet";
import type { FormDraft } from "@/lib/presentation/drafts/contracts";

/** B09 : aucune famille étrangère au domaine ni bilan global partiel. */
export interface DebtReadModel {
  readonly asOfDate: string;
  readonly dates: FinancialDateContext;
  readonly reportingCurrency: string;
  readonly liabilities: Liability[];
  /** Dettes connues par leur seul encours : aucun échéancier, aucun coût calculé. */
  readonly outstandingDebts: OutstandingDebt[];
  readonly scenarios: Scenario[];
  readonly metrics: { readonly bankCash: number | null };
  readonly cashObservationPresent: boolean;
  /**
   * Comptes de cash actifs, proposés comme compte débité d'une assurance séparée. Une
   * référence à un compte absent de cette liste reste affichée comme « non visible ».
   */
  readonly debitAccounts: ReadonlyArray<{ id: string; name: string; institution: string }>;
  readonly cashQuality: CanonicalAggregate;
  readonly railSources: DerivedRailSource[];
  /** Brouillons de contrat : état de saisie, jamais lu par un moteur ni compté au bilan. */
  readonly drafts: FormDraft[];
  readonly readAt: string;
}
