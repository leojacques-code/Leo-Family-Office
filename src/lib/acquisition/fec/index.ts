/**
 * FEC — ORCHESTRATEUR D'ANALYSE, et CONTRAT D'INTÉGRATION BUSINESS.
 *
 * L'analyse est un DRY-RUN comptable : elle lit, contrôle, reconstruit des candidats, et
 * n'écrit rien. Le passage au fait canonique est un acte distinct, et il exige que la
 * reconstruction soit `CALCULABLE`.
 */

import { formatSignature } from "@/lib/acquisition/csv";
import { decodeSourceBytes, issue } from "@/lib/acquisition/normalization";
import type { ImportIssue } from "@/lib/acquisition/types";
import {
  detectFecDelimiter,
  groupFecEntries,
  MAX_FEC_LINES,
  normalizeFecLine,
  parseDelimited,
  resolveFecConventions,
} from "@/lib/acquisition/fec/parse";
import { resolveFecHeader } from "@/lib/acquisition/fec/spec";
import { buildStatementCandidate } from "@/lib/acquisition/fec/statements";
import type {
  FecAnalysis,
  FecCounts,
  FecCoverage,
  FecLine,
  FecStatementCandidate,
} from "@/lib/acquisition/fec/types";

export * from "@/lib/acquisition/fec/types";
export { FEC_FIELDS, resolveFecHeader } from "@/lib/acquisition/fec/spec";
export { MAX_FEC_LINES, parseFecDate } from "@/lib/acquisition/fec/parse";
export { pcgClassOf, pcgGroupOf, PCG_GROUPS } from "@/lib/acquisition/fec/pcg";
export { buildStatementCandidate, groupBalances } from "@/lib/acquisition/fec/statements";

export interface FecAnalysisInput {
  bytes: Uint8Array;
  /** Devise de tenue de la comptabilité, DÉCLARÉE. Aucune conversion n'est faite ici. */
  currency: string;
  /**
   * Couverture DÉCLARÉE du fichier. `OBSERVED_ONLY` par défaut : des dates minimale et
   * maximale ne prouvent pas qu'un exercice est complet.
   */
  coverage: FecCoverage;
  /** Exercice déclaré, servant à signaler les écritures hors période. */
  fiscalYear: { start: string; end: string } | null;
  maxLines?: number;
}

function emptyCounts(): FecCounts {
  return {
    lines: 0,
    ready: 0,
    warning: 0,
    blocked: 0,
    ignored: 0,
    entries: 0,
    unbalancedEntries: 0,
    journals: 0,
    accounts: 0,
  };
}

/** Analyse complète d'un FEC. Fonction PURE : aucun accès base, aucune horloge. */
export function analyzeFec(input: FecAnalysisInput): FecAnalysis {
  const maxLines = input.maxLines ?? MAX_FEC_LINES;
  const decoded = decodeSourceBytes(input.bytes);
  const detected = detectFecDelimiter(decoded.text);
  const document = parseDelimited(decoded.text, detected.delimiter, { maxRows: maxLines });
  const header = resolveFecHeader(document.headers);

  const fileIssues: ImportIssue[] = [
    ...decoded.issues,
    ...detected.issues,
    ...document.issues,
    ...header.issues,
  ];
  if (document.issues.some((entry) => entry.code === "FILE_TOO_MANY_ROWS")) {
    fileIssues.push(
      issue(
        "FEC_LINE_COUNT_EXCEEDED",
        "ERROR",
        `Au-delà de ${maxLines} lignes, le fichier est refusé plutôt que tronqué : un exercice amputé produirait des états financiers faux et d'apparence complète.`,
      ),
    );
  }
  if (header.unknownHeaders.length > 0) {
    fileIssues.push(
      issue(
        "FEC_HEADER_UNEXPECTED_FIELD",
        "INFO",
        `Colonnes hors format conservées mais non lues : ${header.unknownHeaders.join(", ")}.`,
      ),
    );
  }

  const signature = formatSignature(document.headers, detected.delimiter);
  const rawRows = document.rows.map((row) => ({
    rowNumber: row.rowNumber,
    cells: row.cells,
    rawLine: row.rawLine,
  }));

  const emptyStatement = (): FecStatementCandidate =>
    buildStatementCandidate({
      lines: [],
      coverage: input.coverage,
      currency: input.currency,
      periodStart: null,
      periodEnd: null,
      unbalancedEntries: 0,
      currencies: [],
    });

  // Un en-tête inexploitable ne produit AUCUNE ligne : lire des montants avec des colonnes
  // non résolues fabriquerait des faits comptables.
  if (header.issues.some((entry) => entry.severity === "ERROR") || document.rows.length === 0) {
    return {
      encoding: decoded.encoding,
      delimiter: detected.delimiter,
      headers: document.headers,
      fieldPositions: header.positions,
      unknownHeaders: header.unknownHeaders,
      signature,
      rawRows,
      lines: [],
      entries: [],
      counts: emptyCounts(),
      issues: fileIssues,
      observedPeriod: null,
      currencies: [],
      statement: emptyStatement(),
    };
  }

  const { conventions, issues: conventionIssues } = resolveFecConventions(
    document.rows,
    header.positions,
  );
  fileIssues.push(...conventionIssues);

  const context = {
    positions: header.positions,
    conventions,
    fiscalYear: input.fiscalYear,
  };
  const parsedLines = document.rows.map((row) => normalizeFecLine(row, context));
  const grouped = groupFecEntries(parsedLines);

  // Le déséquilibre d'une écriture se reporte sur chacune de ses lignes : l'utilisateur ne
  // corrige pas une écriture en regardant une ligne isolée.
  const lines: FecLine[] = parsedLines.map((line) => {
    const extra = grouped.issues.get(line.rowNumber);
    if (!extra) return line;
    const issues = [...line.issues, ...extra];
    return {
      ...line,
      issues,
      status: issues.some((entry) => entry.severity === "ERROR")
        ? "BLOCKED"
        : issues.some((entry) => entry.severity === "WARNING")
          ? "WARNING"
          : line.status,
    };
  });

  const counts = emptyCounts();
  counts.lines = lines.length;
  const journals = new Set<string>();
  const accounts = new Set<string>();
  const currencies = new Set<string>();
  const dates: string[] = [];
  for (const line of lines) {
    if (line.status === "READY") counts.ready += 1;
    else if (line.status === "WARNING") counts.warning += 1;
    else if (line.status === "BLOCKED") counts.blocked += 1;
    else counts.ignored += 1;
    if (line.journalCode) journals.add(line.journalCode);
    if (line.accountNumber) accounts.add(line.accountNumber);
    if (line.currencyCode) currencies.add(line.currencyCode);
    if (line.entryDate && line.status !== "BLOCKED") dates.push(line.entryDate);
  }
  counts.journals = journals.size;
  counts.accounts = accounts.size;
  counts.entries = grouped.entries.length;
  counts.unbalancedEntries = grouped.entries.filter((entry) => !entry.balanced).length;

  dates.sort();
  const observedPeriod =
    dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null;

  const statement = buildStatementCandidate({
    lines,
    coverage: input.coverage,
    currency: input.currency,
    periodStart: input.fiscalYear?.start ?? observedPeriod?.start ?? null,
    periodEnd: input.fiscalYear?.end ?? observedPeriod?.end ?? null,
    unbalancedEntries: counts.unbalancedEntries,
    currencies: [...currencies],
  });

  return {
    encoding: decoded.encoding,
    delimiter: detected.delimiter,
    headers: document.headers,
    fieldPositions: header.positions,
    unknownHeaders: header.unknownHeaders,
    signature,
    rawRows,
    lines,
    entries: grouped.entries,
    counts,
    issues: fileIssues,
    observedPeriod,
    currencies: [...currencies].sort(),
    statement,
  };
}

/**
 * CONTRAT D'INTÉGRATION BUSINESS.
 *
 * Ce que le domaine comptable propose au domaine Business Equity, et rien de plus. Les noms
 * reprennent EXACTEMENT ceux de `BusinessFinancialInput` : aucun second modèle de période
 * financière n'est créé, le contrat canonique existant est réutilisé tel quel.
 *
 * Les postes que `business_financials` ne modélise pas — stocks, clients, fournisseurs,
 * dettes fiscales, comptes courants d'associés — ne sont volontairement PAS ajoutés au
 * modèle canonique : ils restent dérivables à tout moment des écritures conservées, qui en
 * sont la source. Les persister deux fois créerait une seconde vérité.
 */
export interface BusinessFinancialImportCandidate {
  periodEnd: string;
  periodStart: string | null;
  periodKind: "ANNUAL";
  currency: string;
  revenue: number | null;
  grossProfit: number | null;
  ebitda: number | null;
  ebit: number | null;
  netIncome: number | null;
  cash: number | null;
  grossDebt: number | null;
  workingCapital: number | null;
  capex: number | null;
  depreciationAmortisation: number | null;
  interestExpense: number | null;
  taxExpense: number | null;
  freeCashFlow: number | null;
  /** Convention retenue pour chaque montant. C'est la première marche de l'explicabilité. */
  basis: Record<string, string>;
  /** Ce qui empêche l'écriture. Non vide ⇒ le candidat n'est PAS intégrable. */
  blockers: ImportIssue[];
}

/**
 * Traduit un candidat comptable en contrat Business.
 *
 * Deux refus explicites, et ils sont structurels :
 *
 *   * un état non `CALCULABLE` ne produit aucun candidat intégrable — les totaux peuvent
 *     être justes sans constituer un exercice ;
 *   * une trésorerie comptable NÉGATIVE n'est pas transmise comme `cash`. C'est un
 *     découvert, le fait canonique aval interdit un cash négatif, et l'y écrire échouerait
 *     en base au lieu d'être expliqué.
 *
 * `capex` et `freeCashFlow` restent `null` : le FEC donne des dotations, pas un flux
 * d'investissement décaissé. D&A ≠ CAPEX CASH, et inventer le second à partir du premier
 * serait exactement la fausse précision que le produit refuse.
 */
export function toBusinessFinancialCandidate(
  statement: FecStatementCandidate,
): BusinessFinancialImportCandidate | null {
  if (statement.periodEnd === null) return null;

  const blockers = statement.blockers.filter((entry) => entry.severity === "ERROR");

  /**
   * Le fait canonique refuse un négatif sur ces postes, et il a raison : une dette brute
   * négative ou un amortissement négatif ne sont pas des montants, ce sont des anomalies.
   * Les transmettre échouerait en base sans rien expliquer ; les transmettre en valeur
   * absolue inventerait un chiffre. Ils deviennent donc `null`, et l'anomalie a déjà été
   * signalée dans les blockers de l'état.
   */
  const nonNegativeOrNull = (value: number | null): number | null =>
    value !== null && value >= 0 ? value : null;

  return {
    periodEnd: statement.periodEnd,
    periodStart: statement.periodStart,
    periodKind: "ANNUAL",
    currency: statement.currency,
    revenue: statement.income.revenue.value,
    // `gross_profit` canonique = marge commerciale. Une société de services n'en a pas, et
    // y écrire la valeur ajoutée renommerait un solde en un autre.
    grossProfit: statement.income.merchandiseMargin.value,
    ebitda: statement.income.grossOperatingSurplus.value,
    ebit: statement.income.operatingResult.value,
    netIncome: statement.income.netResult.value,
    cash: nonNegativeOrNull(statement.balanceSheet.cash.value),
    grossDebt: nonNegativeOrNull(statement.balanceSheet.financialDebt.value),
    workingCapital: statement.balanceSheet.operatingWorkingCapital.value,
    // Le FEC ne dit pas ce qui a été DÉCAISSÉ en investissement : il dit ce qui a été
    // immobilisé et amorti. Un capex inventé depuis les dotations serait faux.
    capex: null,
    depreciationAmortisation: nonNegativeOrNull(statement.income.depreciationExpense.value),
    interestExpense: nonNegativeOrNull(statement.income.interestExpense.value),
    taxExpense: statement.income.incomeTaxExpense.value,
    freeCashFlow: null,
    basis: {
      revenue: statement.income.revenue.basis,
      grossProfit: statement.income.merchandiseMargin.basis,
      ebitda: statement.income.grossOperatingSurplus.basis,
      ebit: statement.income.operatingResult.basis,
      netIncome: statement.income.netResult.basis,
      cash: statement.balanceSheet.cash.basis,
      grossDebt: statement.balanceSheet.financialDebt.basis,
      workingCapital: statement.balanceSheet.operatingWorkingCapital.basis,
      depreciationAmortisation: statement.income.depreciationExpense.basis,
      interestExpense: statement.income.interestExpense.basis,
      taxExpense: statement.income.incomeTaxExpense.basis,
    },
    blockers:
      statement.status === "CALCULABLE"
        ? blockers
        : [
            ...blockers,
            issue(
              "FEC_COVERAGE_NOT_DECLARED",
              "ERROR",
              `Reconstruction ${statement.status} : elle ne peut pas devenir un fait Business.`,
            ),
          ],
  };
}
