/**
 * PLAN COMPTABLE GÉNÉRAL — classification DÉTERMINISTE.
 *
 * Le numéro de compte porte une information comptable réelle et vérifiable : la classe et
 * le groupe disent où une écriture se range dans le bilan ou le compte de résultat. Cette
 * couche s'arrête EXACTEMENT là.
 *
 *   CLASSIFICATION COMPTABLE  ≠  JUGEMENT ÉCONOMIQUE
 *
 * Un compte 625 est un poste « déplacements, missions et réceptions ». Ce n'est PAS une
 * « dépense personnelle du dirigeant » : la même nature comptable couvre un déplacement
 * client parfaitement normal et un abus. Le retraitement appartient au ledger de Quality
 * of Earnings de Business Equity, sur décision humaine documentée — jamais à un préfixe.
 *
 * Aucune fonction de ce module ne produit donc de retraitement, de normalisation ni de
 * qualification `DEBT_LIKE`.
 */

/** Classe comptable : premier chiffre du numéro de compte. */
export type PcgClass = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Groupe fonctionnel utilisé par la reconstruction. Il reste COMPTABLE : chaque valeur
 * correspond à un poste du Plan Comptable Général, pas à une intention économique.
 */
export const PCG_GROUPS = [
  // Bilan — passif
  "EQUITY",
  "FINANCIAL_DEBT",
  "SHAREHOLDER_CURRENT_ACCOUNT",
  "BANK_OVERDRAFT",
  "SUPPLIERS",
  "TAX_AND_SOCIAL_LIABILITIES",
  "OTHER_OPERATING_LIABILITIES",
  "OTHER_LIABILITIES",
  "PROVISIONS",
  // Bilan — actif
  "FIXED_ASSETS_GROSS",
  "FIXED_ASSETS_DEPRECIATION",
  "INVENTORY",
  "TRADE_RECEIVABLES",
  "OTHER_OPERATING_RECEIVABLES",
  "OTHER_RECEIVABLES",
  "CASH",
  "MARKETABLE_SECURITIES",
  "INTERNAL_TRANSFER",
  // Résultat — charges
  "PURCHASES",
  "MERCHANDISE_PURCHASES",
  "INVENTORY_CHANGE",
  "MERCHANDISE_INVENTORY_CHANGE",
  "EXTERNAL_SERVICES",
  "TAXES_OTHER_THAN_INCOME",
  "PERSONNEL",
  "OTHER_OPERATING_EXPENSES",
  "DEPRECIATION_EXPENSE",
  "INTEREST_EXPENSE",
  "FINANCIAL_EXPENSES",
  "EXCEPTIONAL_EXPENSES",
  "EMPLOYEE_PROFIT_SHARING",
  "INCOME_TAX_EXPENSE",
  // Résultat — produits
  "REVENUE",
  "MERCHANDISE_SALES",
  "PRODUCTION_INVENTORY_CHANGE",
  "CAPITALISED_PRODUCTION",
  "OPERATING_SUBSIDIES",
  "OTHER_OPERATING_INCOME",
  "REVERSALS",
  "EXPENSE_TRANSFERS",
  "FINANCIAL_INCOME",
  "EXCEPTIONAL_INCOME",
  // Inconnu
  "UNCLASSIFIED",
] as const;
export type PcgGroup = (typeof PCG_GROUPS)[number];

/**
 * Règles de préfixe, du plus spécifique au moins spécifique. L'ordre compte : `455`
 * (comptes courants d'associés) doit être reconnu avant `45`, et `519` (concours bancaires
 * courants) avant `51`.
 */
const PREFIX_RULES: ReadonlyArray<readonly [string, PcgGroup]> = [
  // Classe 1 — capitaux
  ["108", "SHAREHOLDER_CURRENT_ACCOUNT"],
  ["10", "EQUITY"],
  ["11", "EQUITY"],
  ["12", "EQUITY"],
  ["13", "EQUITY"],
  ["14", "PROVISIONS"],
  ["15", "PROVISIONS"],
  ["16", "FINANCIAL_DEBT"],
  ["17", "FINANCIAL_DEBT"],
  ["18", "OTHER_LIABILITIES"],
  // Classe 2 — immobilisations
  ["28", "FIXED_ASSETS_DEPRECIATION"],
  ["29", "FIXED_ASSETS_DEPRECIATION"],
  ["2", "FIXED_ASSETS_GROSS"],
  // Classe 3 — stocks
  ["39", "INVENTORY"],
  ["3", "INVENTORY"],
  // Classe 4 — tiers
  ["409", "OTHER_OPERATING_RECEIVABLES"],
  ["40", "SUPPLIERS"],
  ["419", "OTHER_OPERATING_LIABILITIES"],
  ["41", "TRADE_RECEIVABLES"],
  ["42", "TAX_AND_SOCIAL_LIABILITIES"],
  ["43", "TAX_AND_SOCIAL_LIABILITIES"],
  ["44", "TAX_AND_SOCIAL_LIABILITIES"],
  ["455", "SHAREHOLDER_CURRENT_ACCOUNT"],
  ["456", "EQUITY"],
  ["45", "OTHER_RECEIVABLES"],
  ["46", "OTHER_RECEIVABLES"],
  ["47", "OTHER_RECEIVABLES"],
  ["486", "OTHER_OPERATING_RECEIVABLES"],
  ["487", "OTHER_OPERATING_LIABILITIES"],
  ["48", "OTHER_RECEIVABLES"],
  ["49", "TRADE_RECEIVABLES"],
  // Classe 5 — financier
  ["50", "MARKETABLE_SECURITIES"],
  ["519", "BANK_OVERDRAFT"],
  ["51", "CASH"],
  ["53", "CASH"],
  ["54", "CASH"],
  ["58", "INTERNAL_TRANSFER"],
  ["59", "MARKETABLE_SECURITIES"],
  // Classe 6 — charges
  // 607 et 6037 isolés : la MARGE COMMERCIALE du SIG se calcule sur les marchandises seules
  // (707 − 607 − 6037). Sans cet isolement, seule la valeur ajoutée serait calculable, et
  // l'appeler « marge brute » serait un chiffre mal nommé.
  ["6037", "MERCHANDISE_INVENTORY_CHANGE"],
  ["607", "MERCHANDISE_PURCHASES"],
  ["603", "INVENTORY_CHANGE"],
  ["60", "PURCHASES"],
  ["61", "EXTERNAL_SERVICES"],
  ["62", "EXTERNAL_SERVICES"],
  ["63", "TAXES_OTHER_THAN_INCOME"],
  ["64", "PERSONNEL"],
  ["65", "OTHER_OPERATING_EXPENSES"],
  // 661 est isolé des autres charges financières : les intérêts sont une donnée Business
  // (couverture, pont EV → Equity), là où 664 à 667 mêlent escomptes et pertes de change.
  // L'isolement ne retire rien au résultat financier, qui additionne les deux groupes.
  ["661", "INTEREST_EXPENSE"],
  ["66", "FINANCIAL_EXPENSES"],
  ["67", "EXCEPTIONAL_EXPENSES"],
  ["686", "FINANCIAL_EXPENSES"],
  ["687", "EXCEPTIONAL_EXPENSES"],
  ["68", "DEPRECIATION_EXPENSE"],
  // PARTICIPATION ≠ IMPÔT SUR LES BÉNÉFICES. Le Plan Comptable Général distingue, dans la
  // classe 69 : 691 participation des salariés aux résultats, 695 impôts sur les bénéfices,
  // 696 suppléments d'impôt liés aux distributions, 698 intégration fiscale, 699 produits
  // du report en arrière des déficits.
  //
  // Regrouper 691 avec 695 laisserait le résultat net exact tout en écrivant une charge de
  // personnel sous l'étiquette « impôt » : le taux d'imposition apparent d'une société
  // distribuant de la participation en serait faussé, et c'est précisément le genre de
  // chiffre mal nommé que le produit refuse.
  //
  // 696, 698 et 699 restent dans l'impôt : ce sont bien des composantes de la ligne
  // « impôts sur les bénéfices » du compte de résultat, 699 y jouant en diminution.
  ["691", "EMPLOYEE_PROFIT_SHARING"],
  ["69", "INCOME_TAX_EXPENSE"],
  // Classe 7 — produits
  ["707", "MERCHANDISE_SALES"],
  ["70", "REVENUE"],
  ["71", "PRODUCTION_INVENTORY_CHANGE"],
  ["72", "CAPITALISED_PRODUCTION"],
  ["74", "OPERATING_SUBSIDIES"],
  ["75", "OTHER_OPERATING_INCOME"],
  ["76", "FINANCIAL_INCOME"],
  ["77", "EXCEPTIONAL_INCOME"],
  ["786", "FINANCIAL_INCOME"],
  ["787", "EXCEPTIONAL_INCOME"],
  ["78", "REVERSALS"],
  ["79", "EXPENSE_TRANSFERS"],
];

// Le tri par longueur décroissante rend l'ordre d'écriture ci-dessus non significatif :
// la règle la plus spécifique gagne toujours, même si la liste est réordonnée un jour.
const SORTED_RULES = [...PREFIX_RULES].sort((left, right) => right[0].length - left[0].length);

/** Chiffres du numéro de compte, sans séparateur ni espace. */
export function normalizeAccountNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Classe comptable, ou `null` si le numéro ne commence pas par un chiffre de 1 à 7. */
export function pcgClassOf(accountNumber: string): PcgClass | null {
  const first = normalizeAccountNumber(accountNumber).charAt(0);
  const parsed = Number(first);
  return parsed >= 1 && parsed <= 7 ? (parsed as PcgClass) : null;
}

/** Groupe fonctionnel comptable d'un compte. `UNCLASSIFIED` quand aucune règle ne s'applique. */
export function pcgGroupOf(accountNumber: string): PcgGroup {
  const account = normalizeAccountNumber(accountNumber);
  for (const [prefix, group] of SORTED_RULES) {
    if (account.startsWith(prefix)) return group;
  }
  return "UNCLASSIFIED";
}

/** Un groupe relève-t-il du compte de résultat (classes 6 et 7) ? */
export function isProfitAndLossGroup(group: PcgGroup): boolean {
  return PROFIT_AND_LOSS_GROUPS.has(group);
}

const PROFIT_AND_LOSS_GROUPS: ReadonlySet<PcgGroup> = new Set([
  "PURCHASES",
  "MERCHANDISE_PURCHASES",
  "INVENTORY_CHANGE",
  "MERCHANDISE_INVENTORY_CHANGE",
  "EXTERNAL_SERVICES",
  "TAXES_OTHER_THAN_INCOME",
  "PERSONNEL",
  "OTHER_OPERATING_EXPENSES",
  "DEPRECIATION_EXPENSE",
  "INTEREST_EXPENSE",
  "FINANCIAL_EXPENSES",
  "EXCEPTIONAL_EXPENSES",
  "EMPLOYEE_PROFIT_SHARING",
  "INCOME_TAX_EXPENSE",
  "REVENUE",
  "MERCHANDISE_SALES",
  "PRODUCTION_INVENTORY_CHANGE",
  "CAPITALISED_PRODUCTION",
  "OPERATING_SUBSIDIES",
  "OTHER_OPERATING_INCOME",
  "REVERSALS",
  "EXPENSE_TRANSFERS",
  "FINANCIAL_INCOME",
  "EXCEPTIONAL_INCOME",
]);
