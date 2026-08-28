/**
 * FEC — RECONSTRUCTION D'ÉTATS FINANCIERS CANDIDATS.
 *
 * Chaque montant produit ici porte le NOM de la convention qui l'a produit. Un chiffre sans
 * convention nommée serait un chiffre orphelin : « EBITDA » ne veut rien dire tant qu'on
 * n'a pas dit lequel.
 *
 * La convention retenue pour l'excédent brut d'exploitation est celle des Soldes
 * Intermédiaires de Gestion du Plan Comptable Général :
 *
 *     Production de l'exercice      = 70 + 71 + 72
 *     Consommations de tiers        = 60 + 61 + 62
 *     Valeur ajoutée                = Production − Consommations
 *     EBE                           = VA + 74 − 63 − 64
 *
 * Elle exclut donc 65 et 75, comme le veut la définition de l'EBE. Ce n'est pas « l'EBITDA
 * anglo-saxon » ; c'est une convention française nommée, et l'utilisateur voit la
 * construction poste par poste.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT JAMAIS
 *
 * Aucun EBITDA NORMATIF. Le FEC ne peut pas déterminer seul un salaire normatif de
 * dirigeant, une dépense personnelle, une charge non récurrente, un coût de remplacement ni
 * une synergie. Ces éléments appartiennent au ledger de Quality of Earnings de Business
 * Equity, sur décision humaine documentée. Aucun retraitement automatique, même « évident ».
 */

import { issue } from "@/lib/acquisition/normalization";
import type { ImportIssue } from "@/lib/acquisition/types";
import { isProfitAndLossGroup, type PcgGroup } from "@/lib/acquisition/fec/pcg";
import type {
  FecAmount,
  FecBalanceLine,
  FecBalanceSheet,
  FecCoverage,
  FecGroupBalance,
  FecIncomeStatement,
  FecStatementCandidate,
  FecStatementStatus,
} from "@/lib/acquisition/fec/types";

/**
 * Arrondi de présentation, à six décimales.
 *
 * Le `+ 0` n'est pas cosmétique : `-0` se propagerait dans les soldes créditeurs d'un groupe
 * nul et afficherait « -0,00 » à l'utilisateur, ce qui suggère un signe là où il n'y a pas de
 * montant.
 */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6 + 0;
}

/**
 * Soldes par groupe comptable.
 *
 * Seules les lignes exploitables participent : une ligne bloquée n'a pas de montant fiable,
 * et l'inclure produirait un état financier faux avec l'air d'être complet.
 */
export function groupBalances(lines: readonly FecBalanceLine[]): FecGroupBalance[] {
  const byGroup = new Map<PcgGroup, FecGroupBalance>();
  for (const line of lines) {
    if (line.status === "BLOCKED" || line.status === "IGNORED") continue;
    const existing = byGroup.get(line.pcgGroup) ?? {
      group: line.pcgGroup,
      net: 0,
      totalDebit: 0,
      totalCredit: 0,
      lineCount: 0,
      accounts: [] as string[],
    };
    const debit = line.debit ?? 0;
    const credit = line.credit ?? 0;
    existing.totalDebit = round(existing.totalDebit + debit);
    existing.totalCredit = round(existing.totalCredit + credit);
    existing.net = round(existing.totalDebit - existing.totalCredit);
    existing.lineCount += 1;
    if (line.accountNumber && !existing.accounts.includes(line.accountNumber)) {
      existing.accounts.push(line.accountNumber);
    }
    byGroup.set(line.pcgGroup, existing);
  }
  for (const balance of byGroup.values()) balance.accounts.sort();
  return [...byGroup.values()].sort((left, right) => left.group.localeCompare(right.group));
}

/** Index de lecture des soldes. Un groupe absent du fichier n'a pas de solde. */
class GroupIndex {
  private readonly byGroup: Map<PcgGroup, FecGroupBalance>;
  readonly absent = new Set<PcgGroup>();

  constructor(balances: readonly FecGroupBalance[]) {
    this.byGroup = new Map(balances.map((balance) => [balance.group, balance]));
  }

  /** Solde débiteur d'un groupe : positif quand les débits dominent. */
  debitSide(group: PcgGroup): number {
    const balance = this.byGroup.get(group);
    if (!balance) {
      this.absent.add(group);
      return 0;
    }
    return balance.net;
  }

  /** Solde créditeur d'un groupe : positif quand les crédits dominent. */
  creditSide(group: PcgGroup): number {
    return round(-this.debitSide(group));
  }

  has(group: PcgGroup): boolean {
    return this.byGroup.has(group);
  }
}

function amount(
  value: number | null,
  basis: string,
  contributors: PcgGroup[],
  note: string | null = null,
): FecAmount {
  return { value: value === null ? null : round(value), basis, contributors, note };
}

/**
 * Compte de résultat reconstruit.
 *
 * Une somme sur un groupe ABSENT du fichier vaut zéro, et cette absence est déclarée dans
 * les blockers de l'état. Ce n'est pas un `null` déguisé : les lignes fournies ont bien été
 * lues intégralement. Mais l'interpréter comme un exercice complet demande une déclaration
 * de couverture — c'est cette déclaration, et non la somme, qui manque.
 */
export function buildIncomeStatement(index: GroupIndex): FecIncomeStatement {
  // 707 et 607 sont comptabilisés à part pour la marge commerciale, mais les agrégats de
  // classe reprennent bien l'intégralité de 70 et de 60 : isoler ne retire rien.
  const merchandiseSales = index.creditSide("MERCHANDISE_SALES");
  const merchandisePurchases = index.debitSide("MERCHANDISE_PURCHASES");
  const merchandiseInventoryChange = index.debitSide("MERCHANDISE_INVENTORY_CHANGE");
  const hasMerchandise =
    index.has("MERCHANDISE_SALES") ||
    index.has("MERCHANDISE_PURCHASES") ||
    index.has("MERCHANDISE_INVENTORY_CHANGE");

  const revenue = index.creditSide("REVENUE") + merchandiseSales;
  const productionInventory = index.creditSide("PRODUCTION_INVENTORY_CHANGE");
  const capitalised = index.creditSide("CAPITALISED_PRODUCTION");
  const production = revenue + productionInventory + capitalised;

  const purchases = index.debitSide("PURCHASES") + merchandisePurchases;
  const inventoryChange = index.debitSide("INVENTORY_CHANGE") + merchandiseInventoryChange;
  const externalServices = index.debitSide("EXTERNAL_SERVICES");
  const consumption = purchases + inventoryChange + externalServices;

  // MARGE COMMERCIALE au sens du SIG : ventes de marchandises − coût d'achat des
  // marchandises vendues. Sans compte de marchandises, elle n'existe pas — et la valeur
  // ajoutée ne peut pas en tenir lieu : ce sont deux soldes différents. Renvoyer `null`
  // plutôt qu'un chiffre mal nommé est la seule lecture honnête d'une société de services.
  const merchandiseMargin = hasMerchandise
    ? merchandiseSales - merchandisePurchases - merchandiseInventoryChange
    : null;

  const addedValue = production - consumption;
  const subsidies = index.creditSide("OPERATING_SUBSIDIES");
  const taxes = index.debitSide("TAXES_OTHER_THAN_INCOME");
  const personnel = index.debitSide("PERSONNEL");
  const ebe = addedValue + subsidies - taxes - personnel;

  const otherOperatingIncome = index.creditSide("OTHER_OPERATING_INCOME");
  const reversals = index.creditSide("REVERSALS");
  const expenseTransfers = index.creditSide("EXPENSE_TRANSFERS");
  const otherOperatingExpenses = index.debitSide("OTHER_OPERATING_EXPENSES");
  const depreciation = index.debitSide("DEPRECIATION_EXPENSE");
  const operatingResult =
    ebe +
    otherOperatingIncome +
    reversals +
    expenseTransfers -
    otherOperatingExpenses -
    depreciation;

  const financialIncome = index.creditSide("FINANCIAL_INCOME");
  // 661 est comptabilisé à part, mais le résultat financier reprend bien l'intégralité de la
  // classe 66 : isoler les intérêts n'en retire aucun.
  const interestExpense = index.debitSide("INTEREST_EXPENSE");
  const otherFinancialExpenses = index.debitSide("FINANCIAL_EXPENSES");
  const financialExpenses = interestExpense + otherFinancialExpenses;
  const financialResult = financialIncome - financialExpenses;

  const exceptionalIncome = index.creditSide("EXCEPTIONAL_INCOME");
  const exceptionalExpenses = index.debitSide("EXCEPTIONAL_EXPENSES");
  const exceptionalResult = exceptionalIncome - exceptionalExpenses;

  const incomeTax = index.debitSide("INCOME_TAX_EXPENSE");
  const currentResult = operatingResult + financialResult;
  const netResult = currentResult + exceptionalResult - incomeTax;

  return {
    revenue: amount(revenue, "Comptes 70, solde créditeur (chiffre d'affaires net)", [
      "REVENUE",
      "MERCHANDISE_SALES",
    ]),
    merchandiseMargin: amount(
      merchandiseMargin,
      "Comptes 707 − 607 − 6037 (marge commerciale au sens du SIG)",
      ["MERCHANDISE_SALES", "MERCHANDISE_PURCHASES", "MERCHANDISE_INVENTORY_CHANGE"],
      merchandiseMargin === null
        ? "Aucun compte de marchandises : la marge commerciale n'existe pas pour cette société. La valeur ajoutée n'en tient pas lieu."
        : "Marge commerciale de REPORTING, sur les marchandises seules.",
    ),
    production: amount(production, "Comptes 70 + 71 + 72 (production de l'exercice)", [
      "REVENUE",
      "PRODUCTION_INVENTORY_CHANGE",
      "CAPITALISED_PRODUCTION",
    ]),
    externalConsumption: amount(
      consumption,
      "Comptes 60 + 61 + 62 (consommations en provenance de tiers)",
      [
        "PURCHASES",
        "MERCHANDISE_PURCHASES",
        "INVENTORY_CHANGE",
        "MERCHANDISE_INVENTORY_CHANGE",
        "EXTERNAL_SERVICES",
      ],
    ),
    addedValue: amount(addedValue, "Production − consommations de tiers (valeur ajoutée SIG)", [
      "REVENUE",
      "PURCHASES",
      "EXTERNAL_SERVICES",
    ]),
    grossOperatingSurplus: amount(
      ebe,
      "Valeur ajoutée + 74 − 63 − 64 (EBE au sens du SIG, hors 65 et 75)",
      ["OPERATING_SUBSIDIES", "TAXES_OTHER_THAN_INCOME", "PERSONNEL"],
      "EBE de REPORTING. Aucun retraitement normatif n'y est appliqué.",
    ),
    operatingResult: amount(
      operatingResult,
      "EBE + 75 + 78 + 79 − 65 − 68 (résultat d'exploitation)",
      ["OTHER_OPERATING_INCOME", "REVERSALS", "EXPENSE_TRANSFERS", "DEPRECIATION_EXPENSE"],
    ),
    financialResult: amount(financialResult, "Comptes 76 − 66 (résultat financier)", [
      "FINANCIAL_INCOME",
      "FINANCIAL_EXPENSES",
    ]),
    currentResultBeforeTax: amount(
      currentResult,
      "Résultat d'exploitation + résultat financier (résultat courant avant impôt)",
      ["FINANCIAL_INCOME", "FINANCIAL_EXPENSES"],
    ),
    exceptionalResult: amount(exceptionalResult, "Comptes 77 − 67 (résultat exceptionnel)", [
      "EXCEPTIONAL_INCOME",
      "EXCEPTIONAL_EXPENSES",
    ]),
    incomeTaxExpense: amount(incomeTax, "Comptes 69 (impôts sur les bénéfices)", [
      "INCOME_TAX_EXPENSE",
    ]),
    netResult: amount(
      netResult,
      "Résultat courant + résultat exceptionnel − comptes 69 (résultat net)",
      ["INCOME_TAX_EXPENSE"],
    ),
    depreciationExpense: amount(depreciation, "Comptes 68 (dotations)", ["DEPRECIATION_EXPENSE"]),
    interestExpense: amount(
      interestExpense,
      "Comptes 661 (charges d'intérêts, hors 664 à 667)",
      ["INTEREST_EXPENSE"],
      "Intérêts COMPTABILISÉS. Ce n'est ni un échéancier du Debt Engine, ni un décaissement.",
    ),
    personnelExpense: amount(personnel, "Comptes 64 (charges de personnel)", ["PERSONNEL"]),
    externalServices: amount(externalServices, "Comptes 61 + 62 (services extérieurs)", [
      "EXTERNAL_SERVICES",
    ]),
  };
}

/**
 * Postes de bilan reconstruits.
 *
 * Trois isolements comptent particulièrement pour l'aval :
 *
 *   * la TRÉSORERIE exclut les concours bancaires courants (519). Un solde de banque
 *     négatif est un DÉCOUVERT, pas une trésorerie — même doctrine que le compte bancaire
 *     personnel dans le bilan canonique ;
 *   * les COMPTES COURANTS D'ASSOCIÉS sont isolés et jamais qualifiés. `debt-like` est une
 *     convention de deal, pas une propriété du compte 455 ;
 *   * la DETTE FINANCIÈRE comptable n'est pas un contrat de prêt. Le Debt Engine reste
 *     propriétaire des échéanciers quand ils existent.
 */
export function buildBalanceSheet(index: GroupIndex): FecBalanceSheet {
  const inventory = index.debitSide("INVENTORY");
  const tradeReceivables = index.debitSide("TRADE_RECEIVABLES");
  const otherOperatingReceivables = index.debitSide("OTHER_OPERATING_RECEIVABLES");
  const suppliers = index.creditSide("SUPPLIERS");
  const taxAndSocial = index.creditSide("TAX_AND_SOCIAL_LIABILITIES");
  const otherOperatingLiabilities = index.creditSide("OTHER_OPERATING_LIABILITIES");
  const cash = index.debitSide("CASH");

  const operatingWorkingCapital =
    inventory +
    tradeReceivables +
    otherOperatingReceivables -
    suppliers -
    taxAndSocial -
    otherOperatingLiabilities;

  return {
    fixedAssetsGross: amount(
      index.debitSide("FIXED_ASSETS_GROSS"),
      "Comptes 20 à 27 (valeur brute)",
      ["FIXED_ASSETS_GROSS"],
    ),
    fixedAssetsDepreciation: amount(
      index.creditSide("FIXED_ASSETS_DEPRECIATION"),
      "Comptes 28 et 29 (amortissements et dépréciations)",
      ["FIXED_ASSETS_DEPRECIATION"],
      "Amortissement CUMULÉ au bilan. Ce n'est ni la dotation de l'exercice, ni un capex de trésorerie.",
    ),
    inventory: amount(inventory, "Comptes 3 (stocks, net de dépréciations)", ["INVENTORY"]),
    tradeReceivables: amount(tradeReceivables, "Comptes 41 (clients)", ["TRADE_RECEIVABLES"]),
    otherOperatingReceivables: amount(
      otherOperatingReceivables,
      "Comptes 409 et 486 (autres créances d'exploitation)",
      ["OTHER_OPERATING_RECEIVABLES"],
    ),
    cash: amount(
      cash,
      "Comptes 51 hors 519, 53 et 54 (trésorerie comptable)",
      ["CASH"],
      "Trésorerie COMPTABLE de la société. Ce n'est ni une observation d'API bancaire, ni la trésorerie personnelle.",
    ),
    marketableSecurities: amount(
      index.debitSide("MARKETABLE_SECURITIES"),
      "Comptes 50 (valeurs mobilières de placement)",
      ["MARKETABLE_SECURITIES"],
      "Non incluses dans la trésorerie : leur caractère « cash-like » est une convention de deal.",
    ),
    suppliers: amount(suppliers, "Comptes 40 hors 409 (fournisseurs)", ["SUPPLIERS"]),
    taxAndSocialLiabilities: amount(
      taxAndSocial,
      "Comptes 42, 43 et 44 (dettes fiscales et sociales)",
      ["TAX_AND_SOCIAL_LIABILITIES"],
    ),
    otherOperatingLiabilities: amount(
      otherOperatingLiabilities,
      "Comptes 419 et 487 (autres dettes d'exploitation)",
      ["OTHER_OPERATING_LIABILITIES"],
    ),
    financialDebt: amount(
      index.creditSide("FINANCIAL_DEBT"),
      "Comptes 16 et 17 (emprunts et dettes assimilées)",
      ["FINANCIAL_DEBT"],
      "Dette COMPTABLE de la société. Ni un contrat du Debt Engine, ni une dette personnelle.",
    ),
    bankOverdraft: amount(
      index.creditSide("BANK_OVERDRAFT"),
      "Comptes 519 (concours bancaires courants)",
      ["BANK_OVERDRAFT"],
      "Exclu de la trésorerie : un découvert est un passif, il ne réduit pas le cash.",
    ),
    shareholderCurrentAccounts: amount(
      index.creditSide("SHAREHOLDER_CURRENT_ACCOUNT"),
      "Comptes 455 et 108 (comptes courants d'associés)",
      ["SHAREHOLDER_CURRENT_ACCOUNT"],
      "ISOLÉ et NON qualifié. Le caractère debt-like est une convention de deal, jamais une propriété du compte.",
    ),
    equity: amount(index.creditSide("EQUITY"), "Comptes 10 à 13 et 456 (capitaux propres)", [
      "EQUITY",
    ]),
    operatingWorkingCapital: amount(
      operatingWorkingCapital,
      "Stocks + clients + autres créances d'exploitation − fournisseurs − dettes fiscales et sociales − autres dettes d'exploitation",
      ["INVENTORY", "TRADE_RECEIVABLES", "SUPPLIERS", "TAX_AND_SOCIAL_LIABILITIES"],
      "BFR d'EXPLOITATION. Hors trésorerie, hors dette financière, hors comptes courants d'associés. Ce n'est PAS le NWC contractuel d'un SPA.",
    ),
  };
}

export interface StatementInput {
  lines: readonly FecBalanceLine[];
  coverage: FecCoverage;
  currency: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Nombre d'écritures déséquilibrées : une comptabilité déséquilibrée n'est pas fiable. */
  unbalancedEntries: number;
  /** Devises rencontrées. Plusieurs devises rendent l'agrégat non fondé sans FX. */
  currencies: readonly string[];
}

/**
 * Candidat d'états financiers.
 *
 * Le statut n'est pas cosmétique : `CALCULABLE` signifie que l'utilisateur a DÉCLARÉ que le
 * fichier couvre l'exercice entier. Sans cette déclaration, les sommes restent justes pour
 * les lignes fournies mais ne constituent pas un compte de résultat annuel — et le contrat
 * d'intégration Business refuse de les écrire.
 */
export function buildStatementCandidate(input: StatementInput): FecStatementCandidate {
  const balances = groupBalances(input.lines);
  const index = new GroupIndex(balances);
  const income = buildIncomeStatement(index);
  const balanceSheet = buildBalanceSheet(index);

  const blockers: ImportIssue[] = [];

  // Un fichier sans AUCUNE ligne exploitable ne produit pas un exercice à zéro : il ne produit
  // rien du tout. Sans ce garde-fou, un en-tête inexploitable ou un fichier réduit à sa
  // première ligne ressortirait `CALCULABLE` avec tous les postes à zéro — un état financier
  // faux ayant l'apparence d'un état complet.
  const exploitableLines = input.lines.filter(
    (line) => line.status !== "BLOCKED" && line.status !== "IGNORED",
  ).length;
  if (exploitableLines === 0) {
    blockers.push(
      issue(
        "FEC_NO_EXPLOITABLE_LINE",
        "ERROR",
        "Aucune ligne exploitable : aucun état financier n'est reconstruit. Les postes à zéro traduisent l'absence de lecture, pas une comptabilité nulle.",
      ),
    );
  }

  if (input.coverage !== "DECLARED_COMPLETE") {
    blockers.push(
      issue(
        "FEC_COVERAGE_NOT_DECLARED",
        "ERROR",
        "La couverture de l'exercice n'est pas déclarée : les totaux sont exacts pour les lignes fournies, mais rien ne prouve qu'ils constituent un exercice complet.",
      ),
    );
  }
  if (input.unbalancedEntries > 0) {
    blockers.push(
      issue(
        "FEC_ENTRY_UNBALANCED",
        "ERROR",
        `${input.unbalancedEntries} écriture(s) déséquilibrée(s) : la partie double n'est pas vérifiée, les états reconstruits ne sont pas fiables.`,
      ),
    );
  }
  const foreignCurrencies = input.currencies.filter((code) => code !== input.currency);
  if (foreignCurrencies.length > 0) {
    blockers.push(
      issue(
        "FEC_MULTI_CURRENCY",
        "WARNING",
        `Devises étrangères rencontrées (${foreignCurrencies.join(", ")}). Les montants restent en devise de tenue ; aucune conversion n'est faite ici, le FX Engine reste l'unique convertisseur.`,
      ),
    );
  }

  // Une classe entièrement absente n'est pas une erreur, mais elle change ce que l'on peut
  // lire : sans compte de classe 7, il n'y a pas de chiffre d'affaires à reconstruire.
  for (const [group, label] of [
    ["REVENUE", "chiffre d'affaires (comptes 70)"],
    ["CASH", "trésorerie (comptes 51, 53, 54)"],
  ] as const) {
    if (!index.has(group)) {
      blockers.push(
        issue(
          "FEC_ACCOUNT_GROUP_ABSENT",
          "WARNING",
          `Aucune ligne de ${label} dans le fichier : le poste correspondant est nul faute d'écriture, pas faute de valeur.`,
        ),
      );
    }
  }

  // Une trésorerie comptable négative est un découvert. La refuser comme « cash » n'est pas
  // un excès de prudence : le fait canonique aval interdit un cash négatif, et l'y écrire
  // échouerait en base au lieu d'être expliqué ici.
  if (balanceSheet.cash.value !== null && balanceSheet.cash.value < 0) {
    blockers.push(
      issue(
        "FEC_CASH_NEGATIVE",
        "WARNING",
        `Trésorerie comptable négative (${balanceSheet.cash.value.toFixed(2)}) : c'est un découvert, pas une trésorerie. Elle ne sera pas transmise comme cash.`,
      ),
    );
  }

  // Deux postes ne peuvent pas être NÉGATIFS au canonique : la dette brute et
  // l'amortissement. Un solde inversé n'est pas une dette négative, c'est une anomalie de
  // lecture ou d'imputation — elle est signalée ici, et le poste n'est pas transmis. Le
  // faire échouer plus tard sur une contrainte de base ne l'aurait pas expliqué.
  for (const [label, value] of [
    ["dette financière (comptes 16 et 17)", balanceSheet.financialDebt.value],
    ["dotations aux amortissements (comptes 68)", income.depreciationExpense.value],
    ["charges d'intérêts (comptes 661)", income.interestExpense.value],
  ] as const) {
    if (value !== null && value < 0) {
      blockers.push(
        issue(
          "FEC_UNEXPECTED_SIGN",
          "WARNING",
          `Solde de sens inattendu sur ${label} (${value.toFixed(2)}) : le poste n'est pas transmis, faute de lecture fondée.`,
        ),
      );
    }
  }

  const status: FecStatementStatus = blockers.some((entry) => entry.severity === "ERROR")
    ? exploitableLines > 0
      ? "PARTIAL"
      : "NOT_COMPUTABLE"
    : "CALCULABLE";

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    coverage: input.coverage,
    status,
    currency: input.currency,
    income,
    balanceSheet,
    groups: balances,
    blockers,
  };
}

export { isProfitAndLossGroup };
