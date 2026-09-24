import type { Liability, OutstandingDebt, Scenario } from "@/lib/types";
import type { FinancialDateContext } from "@/lib/financial-date";
import type { DerivedRailSource } from "@/lib/presentation/rail-sources";
import type { CanonicalAggregate } from "@/lib/engine/balance-sheet";

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
  readonly cashQuality: CanonicalAggregate;
  readonly railSources: DerivedRailSource[];
  readonly readAt: string;
}
