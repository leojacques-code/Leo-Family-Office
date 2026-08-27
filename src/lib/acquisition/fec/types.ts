/**
 * FEC — TYPES CANONIQUES DE L'ACQUISITION COMPTABLE
 *
 * Un FEC est une SOURCE COMPTABLE. Ce n'est ni une valorisation, ni un EBITDA normatif, ni
 * une due diligence, ni une preuve que chaque écriture est économiquement normale.
 *
 * La chaîne s'arrête donc à des CANDIDATS : le domaine Business Equity reste propriétaire
 * de l'analyse financière, et rien n'entre chez lui sans décision explicite.
 */

import type { ImportIssue, ImportRowStatus } from "@/lib/acquisition/types";
import type { PcgClass, PcgGroup } from "@/lib/acquisition/fec/pcg";
import type { FecField } from "@/lib/acquisition/fec/spec";

/** Ligne d'écriture normalisée. Les dix-huit champs, plus la classification comptable. */
export interface FecLine {
  rowNumber: number;
  journalCode: string | null;
  journalLabel: string | null;
  entryNumber: string | null;
  entryDate: string | null;
  accountNumber: string | null;
  accountLabel: string | null;
  auxAccountNumber: string | null;
  auxAccountLabel: string | null;
  pieceReference: string | null;
  pieceDate: string | null;
  entryLabel: string | null;
  /**
   * Débit et crédit tels que la source les a fournis. `null` = champ ABSENT ; `0` = zéro
   * réellement transmis. Le format autorise explicitement un champ vide, et la
   * réglementation fait donc elle-même la distinction que le produit défend partout.
   */
  debit: number | null;
  credit: number | null;
  letterCode: string | null;
  letterDate: string | null;
  validationDate: string | null;
  currencyAmount: number | null;
  currencyCode: string | null;
  /** Classe et groupe comptables. DÉTERMINISTES, jamais un jugement économique. */
  pcgClass: PcgClass | null;
  pcgGroup: PcgGroup;
  status: ImportRowStatus;
  issues: ImportIssue[];
}

/**
 * Écriture comptable : plusieurs lignes qui ne se comprennent qu'ensemble.
 *
 * Une ligne de FEC n'est PAS une transaction économique indépendante. Une vente est un
 * débit client, un crédit produit et un crédit TVA : compter chaque ligne comme un flux
 * produirait trois fois la même opération.
 */
export interface FecEntry {
  journalCode: string;
  entryNumber: string;
  entryDate: string | null;
  lineNumbers: number[];
  totalDebit: number;
  totalCredit: number;
  /** `totalDebit − totalCredit`. Nul sur une écriture équilibrée. */
  imbalance: number;
  balanced: boolean;
}

/** Un solde par groupe comptable, avec ce qui l'a produit. */
export interface FecGroupBalance {
  group: PcgGroup;
  /** Σ débits − Σ crédits. Le signe reste comptable : positif = solde débiteur. */
  net: number;
  totalDebit: number;
  totalCredit: number;
  lineCount: number;
  /** Comptes réellement rencontrés. C'est le premier niveau d'explicabilité. */
  accounts: string[];
}

/**
 * Montant reconstruit à partir des écritures.
 *
 * `value` est `null` quand la reconstruction n'est pas fondée — et non zéro. `basis` nomme
 * la convention appliquée : un chiffre sans convention nommée serait un chiffre orphelin.
 */
export interface FecAmount {
  value: number | null;
  basis: string;
  /** Groupes comptables qui ont alimenté le montant. */
  contributors: PcgGroup[];
  /** Raison d'un `null`, ou réserve sur une valeur produite. */
  note: string | null;
}

/** Compte de résultat reconstruit, selon la nomenclature du SIG français. */
export interface FecIncomeStatement {
  revenue: FecAmount;
  production: FecAmount;
  externalConsumption: FecAmount;
  addedValue: FecAmount;
  /** EBE au sens du SIG : VA + subventions d'exploitation − impôts et taxes − personnel. */
  grossOperatingSurplus: FecAmount;
  operatingResult: FecAmount;
  financialResult: FecAmount;
  currentResultBeforeTax: FecAmount;
  exceptionalResult: FecAmount;
  incomeTaxExpense: FecAmount;
  netResult: FecAmount;
  /**
   * Marge commerciale (707 − 607 − 6037). `null` quand la société n'a aucun compte de
   * marchandises : la valeur ajoutée n'en tient pas lieu.
   */
  merchandiseMargin: FecAmount;
  depreciationExpense: FecAmount;
  /** Charges d'intérêts (661), isolées des autres charges financières. */
  interestExpense: FecAmount;
  personnelExpense: FecAmount;
  externalServices: FecAmount;
}

/** Postes de bilan reconstruits. Aucun n'est réduit à une formule unique sans nomenclature. */
export interface FecBalanceSheet {
  fixedAssetsGross: FecAmount;
  fixedAssetsDepreciation: FecAmount;
  inventory: FecAmount;
  tradeReceivables: FecAmount;
  otherOperatingReceivables: FecAmount;
  cash: FecAmount;
  marketableSecurities: FecAmount;
  suppliers: FecAmount;
  taxAndSocialLiabilities: FecAmount;
  otherOperatingLiabilities: FecAmount;
  /** Dette financière COMPTABLE. Ce n'est pas un contrat de prêt du Debt Engine. */
  financialDebt: FecAmount;
  bankOverdraft: FecAmount;
  /**
   * Comptes courants d'associés, ISOLÉS et jamais qualifiés. Leur nature `debt-like` est
   * une convention de deal, décidée par le moteur M&A ou par l'utilisateur.
   */
  shareholderCurrentAccounts: FecAmount;
  equity: FecAmount;
  /** BFR d'EXPLOITATION. Hors trésorerie, hors dette financière, hors comptes courants. */
  operatingWorkingCapital: FecAmount;
}

/** Ce que l'utilisateur DÉCLARE de la couverture du fichier. */
export type FecCoverage = "OBSERVED_ONLY" | "DECLARED_COMPLETE";

/** État d'un candidat d'état financier. */
export type FecStatementStatus = "CALCULABLE" | "PARTIAL" | "NOT_COMPUTABLE";

/**
 * Candidat d'états financiers pour une période.
 *
 * `ACCOUNTING DERIVED CANDIDATE` : il n'est pas un fait canonique tant qu'il n'a pas
 * franchi le contrat d'intégration Business, sur décision explicite.
 */
export interface FecStatementCandidate {
  periodStart: string | null;
  periodEnd: string | null;
  coverage: FecCoverage;
  status: FecStatementStatus;
  currency: string;
  income: FecIncomeStatement;
  balanceSheet: FecBalanceSheet;
  /** Soldes par groupe : la matière première de tous les montants ci-dessus. */
  groups: FecGroupBalance[];
  /** Ce qui empêche une lecture fiable. Vide ne signifie pas « audité ». */
  blockers: ImportIssue[];
}

/** Décompte d'un FEC. Rien n'est estimé. */
export interface FecCounts {
  lines: number;
  ready: number;
  warning: number;
  blocked: number;
  ignored: number;
  entries: number;
  unbalancedEntries: number;
  journals: number;
  accounts: number;
}

/** Analyse complète d'un FEC : le dry-run comptable. */
export interface FecAnalysis {
  encoding: string;
  delimiter: string;
  headers: string[];
  /** Positions résolues des champs réglementaires. */
  fieldPositions: Partial<Record<FecField, number>>;
  unknownHeaders: string[];
  signature: string;
  /** Lignes brutes, persistées telles quelles. */
  rawRows: Array<{ rowNumber: number; cells: string[]; rawLine: string }>;
  lines: FecLine[];
  entries: FecEntry[];
  counts: FecCounts;
  /** Anomalies de FICHIER, distinctes des anomalies de ligne. */
  issues: ImportIssue[];
  /** Bornes des dates d'écriture RÉELLEMENT observées. Ne certifient aucune exhaustivité. */
  observedPeriod: { start: string; end: string } | null;
  /** Devises rencontrées dans `Idevise`. Aucune conversion n'est faite ici. */
  currencies: string[];
  statement: FecStatementCandidate;
}
