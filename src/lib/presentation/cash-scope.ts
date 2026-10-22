import type { CanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import type { DomainDeclaration } from "@/lib/presentation/today/contracts";

/** Une somme canonique vide à zéro ne prouve pas que la banque a été renseignée. */
export function hasImmediateCashScope(
  sheet: Pick<CanonicalBalanceSheet, "contributions">,
  declarations: readonly DomainDeclaration[] = [],
): boolean {
  return (
    sheet.contributions.some(
      (line) =>
        (line.category === "CASH_ACCOUNT" || line.category === "ACCOUNT_OVERDRAFT") &&
        line.liquidity === "IMMEDIATE",
    ) ||
    declarations.some(
      (declaration) =>
        declaration.domain === "BANQUE" && declaration.applicability === "DECLARED_NONE",
    )
  );
}
