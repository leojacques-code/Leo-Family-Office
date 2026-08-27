/**
 * ADAPTATEUR — RELEVÉ BANCAIRE CSV GÉNÉRIQUE
 *
 * Premier chemin d'import réel. Il ne dépend d'aucun connecteur, d'aucun abonnement et
 * d'aucune banque en particulier : il lit ce que n'importe quel établissement exporte.
 *
 * Ce que cet adaptateur produit : des CANDIDATS de transactions, avec leur provenance,
 * leurs ambiguïtés et leur verdict de déduplication. Ce qu'il ne produit pas :
 *
 *   * aucune catégorie de flux. Une transaction importée reste NON CLASSÉE, et le Cash
 *     Flow Engine la compte comme telle. Deviner « AMAZON EU » = « Shopping » serait
 *     inventer une classification économique pour rendre l'import plus joli.
 *   * aucun solde de compte. Le solde est une observation datée qui a sa propre vérité ;
 *     le reconstituer depuis une somme de lignes en créerait une seconde.
 *   * aucun transfert interne rapproché. Le rapprochement des deux jambes appartient au
 *     Cash Flow Engine, qui possède `transfer_group_id`.
 */

import { detectDelimiter, formatSignature, parseDelimited } from "@/lib/acquisition/csv";
import { classifyCandidates, type DedupeCandidate } from "@/lib/acquisition/dedupe";
import { inferBankMapping, validateBankMapping } from "@/lib/acquisition/mapping";
import {
  decodeSourceBytes,
  issue,
  normalizeLabel,
  parseAmountWithConvention,
  parseCurrencyCell,
  parseDateWithConvention,
  resolveAmountConvention,
  resolveDateConvention,
} from "@/lib/acquisition/normalization";
import type {
  AmountConvention,
  BankColumnMapping,
  BankCsvAnalysis,
  DateConvention,
  ExistingTransactionFact,
  ImportIssue,
  ImportRowCounts,
  ImportRowStatus,
  NormalizedBankRow,
  RawRow,
} from "@/lib/acquisition/types";

/**
 * Plafond de lignes par session. Un plafond dépassé ÉCHOUE : il ne tronque pas. Un
 * historique amputé produirait des flux parfaitement calculés sur des faits incomplets.
 */
export const MAX_ROWS_PER_SESSION = 20_000;

/** Libellés de lignes de synthèse, ignorées seulement si elles n'ont pas de date valide. */
const SUMMARY_LABEL = /^(total|totaux|solde|sous.?total|balance)\b/i;

export interface BankCsvAnalysisInput {
  bytes: Uint8Array;
  /** Enveloppe cible. Une ligne importée appartient toujours à un compte connu. */
  accountId: string;
  /**
   * Devise DÉCLARÉE pour la session quand la source n'en fournit aucune. C'est une
   * déclaration explicite de l'utilisateur, pas une déduction du compte cible.
   */
  declaredCurrency: string | null;
  /** Faits canoniques déjà présents, servant à la déduplication. */
  existing: readonly ExistingTransactionFact[];
  /** Préfixe des clés externes : identifiant stable de la source. */
  sourceKey: string;
  /** Date d'observation, pour signaler une opération postérieure. */
  asOfDate: string;
  /** Mapping imposé : confirmé par l'utilisateur, ou mémorisé pour ce format. */
  mappingOverride?: BankColumnMapping | null;
  maxRows?: number;
}

function column(row: RawRow, index: number | undefined): string {
  if (index === undefined) return "";
  return row.cells[index] ?? "";
}

function emptyCounts(): ImportRowCounts {
  return { total: 0, ready: 0, warning: 0, blocked: 0, duplicate: 0, ignored: 0 };
}

function countRows(rows: readonly NormalizedBankRow[]): ImportRowCounts {
  const counts = emptyCounts();
  counts.total = rows.length;
  for (const row of rows) {
    if (row.status === "READY") counts.ready += 1;
    else if (row.status === "WARNING") counts.warning += 1;
    else if (row.status === "BLOCKED") counts.blocked += 1;
    else if (row.status === "DUPLICATE") counts.duplicate += 1;
    else counts.ignored += 1;
  }
  return counts;
}

/** Statut déduit des seules anomalies : une erreur bloque, un avertissement alerte. */
function statusFromIssues(issues: readonly ImportIssue[]): ImportRowStatus {
  if (issues.some((entry) => entry.severity === "ERROR")) return "BLOCKED";
  if (issues.some((entry) => entry.severity === "WARNING")) return "WARNING";
  return "READY";
}

interface ConventionResolution {
  amount: AmountConvention;
  date: DateConvention;
  valueDate: DateConvention | null;
  issues: ImportIssue[];
}

/**
 * Conventions du fichier, résolues sur l'ensemble des cellules de chaque colonne.
 *
 * Une colonne entièrement ambiguë n'est pas tranchée : elle produit une anomalie de
 * fichier, et chaque ligne qui en dépend sera bloquée. C'est volontairement radical —
 * choisir entre 1,234 et 1 234 sur 800 lignes n'est pas un détail de présentation.
 */
function resolveConventions(
  rows: readonly RawRow[],
  mapping: BankColumnMapping,
): ConventionResolution {
  const issues: ImportIssue[] = [];
  const amountCells: string[] = [];
  for (const field of ["amount", "debit", "credit"] as const) {
    const index = mapping[field];
    if (index === undefined) continue;
    for (const row of rows) amountCells.push(column(row, index));
  }
  const amount = resolveAmountConvention(amountCells);
  if (amount === "AMBIGUOUS") {
    issues.push(
      issue(
        "AMOUNT_CONVENTION_AMBIGUOUS",
        "ERROR",
        "La convention décimale de la colonne de montants est indécidable : « 1,234 » peut valoir 1,234 ou 1 234. Aucun montant n'est lu tant qu'elle n'est pas tranchée.",
        "amount",
      ),
    );
  }

  const dateCells = rows.map((row) => column(row, mapping.transactionDate));
  const date = resolveDateConvention(dateCells);
  if (date === "AMBIGUOUS") {
    issues.push(
      issue(
        "DATE_CONVENTION_AMBIGUOUS",
        "ERROR",
        "L'ordre jour/mois de la colonne de dates est indécidable : aucune date du fichier ne dépasse le 12. Aucune date n'est lue tant qu'elle n'est pas tranchée.",
        "transactionDate",
      ),
    );
  }

  const valueDate =
    mapping.valueDate === undefined
      ? null
      : resolveDateConvention(rows.map((row) => column(row, mapping.valueDate)));

  return { amount, date, valueDate, issues };
}

/** Lit une ligne brute selon le mapping et les conventions retenues. */
function normalizeRow(
  row: RawRow,
  mapping: BankColumnMapping,
  conventions: ConventionResolution,
  input: BankCsvAnalysisInput,
): NormalizedBankRow {
  const issues: ImportIssue[] = [];
  const base: NormalizedBankRow = {
    rowNumber: row.rowNumber,
    transactionDate: null,
    valueDate: null,
    label: null,
    amount: null,
    currency: null,
    externalReference: null,
    counterparty: null,
    balanceAfter: null,
    status: "IGNORED",
    verdict: null,
    fingerprint: null,
    externalKey: null,
    matchedTransactionId: null,
    issues,
  };

  if (row.cells.every((cell) => cell.trim().length === 0)) {
    issues.push(issue("ROW_EMPTY", "INFO", "Ligne vide : ignorée."));
    return base;
  }

  // ── Date d'opération ──────────────────────────────────────────────────────────────
  const rawDate = column(row, mapping.transactionDate);
  const parsedDate = parseDateWithConvention(rawDate, conventions.date);
  const label = normalizeLabel(column(row, mapping.label));

  // Ligne de synthèse : un « Solde au 31/07 » sans date exploitable n'est pas une opération.
  if (parsedDate.value === null && label !== null && SUMMARY_LABEL.test(label)) {
    issues.push(
      issue(
        "ROW_TOTAL_SUSPECTED",
        "INFO",
        "Ligne de synthèse ou de solde, sans date d'opération : ignorée.",
        "label",
        label,
      ),
    );
    return { ...base, label };
  }

  if (parsedDate.code === "EMPTY") {
    issues.push(
      issue("DATE_MISSING", "ERROR", "Date d'opération absente.", "transactionDate", rawDate),
    );
  } else if (parsedDate.code === "UNPARSEABLE") {
    issues.push(
      issue("DATE_UNPARSEABLE", "ERROR", "Date d'opération illisible.", "transactionDate", rawDate),
    );
  } else if (parsedDate.code === "NOT_A_CALENDAR_DATE") {
    issues.push(
      issue(
        "DATE_NOT_A_CALENDAR_DATE",
        "ERROR",
        "Cette date n'existe pas au calendrier.",
        "transactionDate",
        rawDate,
      ),
    );
  } else if (parsedDate.code === "AMBIGUOUS") {
    issues.push(
      issue(
        "DATE_CONVENTION_AMBIGUOUS",
        "ERROR",
        "Ordre jour/mois indécidable pour cette date.",
        "transactionDate",
        rawDate,
      ),
    );
  }
  if (parsedDate.twoDigitYear && parsedDate.value !== null) {
    issues.push(
      issue(
        "DATE_TWO_DIGIT_YEAR",
        "WARNING",
        `Année sur deux chiffres : lue comme ${parsedDate.value}. Vérifier le siècle.`,
        "transactionDate",
        rawDate,
      ),
    );
  }
  if (parsedDate.value !== null && parsedDate.value > input.asOfDate) {
    issues.push(
      issue(
        "DATE_IN_FUTURE",
        "WARNING",
        "Opération postérieure à la date d'observation.",
        "transactionDate",
        rawDate,
      ),
    );
  }

  // ── Date de valeur ────────────────────────────────────────────────────────────────
  let valueDate: string | null = null;
  if (mapping.valueDate !== undefined && conventions.valueDate) {
    const parsed = parseDateWithConvention(column(row, mapping.valueDate), conventions.valueDate);
    valueDate = parsed.value;
  }

  // ── Libellé ───────────────────────────────────────────────────────────────────────
  if (label === null) {
    issues.push(issue("LABEL_MISSING", "ERROR", "Libellé absent.", "label", null));
  }

  // ── Montant ───────────────────────────────────────────────────────────────────────
  let amount: number | null = null;
  if (mapping.amount !== undefined) {
    const rawAmount = column(row, mapping.amount);
    const parsed = parseAmountWithConvention(rawAmount, conventions.amount);
    amount = parsed.value;
    if (parsed.code === "EMPTY") {
      issues.push(issue("AMOUNT_MISSING", "ERROR", "Montant absent.", "amount", rawAmount));
    } else if (parsed.code === "UNPARSEABLE") {
      issues.push(issue("AMOUNT_UNPARSEABLE", "ERROR", "Montant illisible.", "amount", rawAmount));
    } else if (parsed.code === "AMBIGUOUS") {
      issues.push(
        issue(
          "AMOUNT_CONVENTION_AMBIGUOUS",
          "ERROR",
          "Convention décimale indécidable pour ce montant.",
          "amount",
          rawAmount,
        ),
      );
    }
  } else {
    const rawDebit = column(row, mapping.debit);
    const rawCredit = column(row, mapping.credit);
    const debit = parseAmountWithConvention(rawDebit, conventions.amount);
    const credit = parseAmountWithConvention(rawCredit, conventions.amount);
    const debitSet = debit.value !== null && debit.value !== 0;
    const creditSet = credit.value !== null && credit.value !== 0;
    if (debit.code === "UNPARSEABLE" || debit.code === "AMBIGUOUS") {
      issues.push(
        issue("AMOUNT_UNPARSEABLE", "ERROR", "Colonne débit illisible.", "debit", rawDebit),
      );
    }
    if (credit.code === "UNPARSEABLE" || credit.code === "AMBIGUOUS") {
      issues.push(
        issue("AMOUNT_UNPARSEABLE", "ERROR", "Colonne crédit illisible.", "credit", rawCredit),
      );
    }
    if (debitSet && creditSet) {
      issues.push(
        issue(
          "DEBIT_AND_CREDIT_BOTH_SET",
          "ERROR",
          "Débit et crédit renseignés sur la même ligne : le sens du flux est indéterminé.",
          "amount",
          `${rawDebit} / ${rawCredit}`,
        ),
      );
    } else if (debitSet) {
      // Une colonne débit porte une magnitude : le sens vient de la colonne, pas du signe.
      amount = -Math.abs(debit.value!);
    } else if (creditSet) {
      amount = Math.abs(credit.value!);
    } else if (debit.value === 0 || credit.value === 0) {
      amount = 0;
    } else {
      issues.push(
        issue("AMOUNT_MISSING", "ERROR", "Ni débit ni crédit renseigné.", "amount", null),
      );
    }
  }
  if (amount === 0) {
    issues.push(
      issue(
        "AMOUNT_ZERO",
        "WARNING",
        "Montant nul : opération sans effet de trésorerie.",
        "amount",
        "0",
      ),
    );
  }

  // ── Devise ────────────────────────────────────────────────────────────────────────
  let currency: string | null = null;
  if (mapping.currency !== undefined) {
    const rawCurrency = column(row, mapping.currency);
    const parsed = parseCurrencyCell(rawCurrency);
    if (parsed.code === "OK") currency = parsed.value;
    else if (parsed.code === "UNKNOWN") {
      issues.push(
        issue("CURRENCY_UNKNOWN", "ERROR", "Devise non reconnue.", "currency", rawCurrency),
      );
    }
  }
  if (currency === null) {
    if (input.declaredCurrency) {
      currency = input.declaredCurrency;
      issues.push(
        issue(
          "CURRENCY_FROM_SESSION_DECLARATION",
          "INFO",
          `Devise non fournie par la source : la devise déclarée pour cet import (${input.declaredCurrency}) est appliquée.`,
          "currency",
          null,
        ),
      );
    } else {
      issues.push(
        issue(
          "CURRENCY_MISSING",
          "ERROR",
          "Devise absente et aucune devise déclarée pour l'import.",
          "currency",
          null,
        ),
      );
    }
  }

  const externalReference = normalizeLabel(column(row, mapping.externalReference));
  const counterparty = normalizeLabel(column(row, mapping.counterparty));
  const balanceAfter =
    mapping.balanceAfter === undefined
      ? null
      : parseAmountWithConvention(column(row, mapping.balanceAfter), conventions.amount).value;

  return {
    ...base,
    transactionDate: parsedDate.value,
    valueDate,
    label,
    amount,
    currency,
    externalReference,
    counterparty,
    balanceAfter,
    status: statusFromIssues(issues),
    issues,
  };
}

/**
 * Analyse complète d'un relevé CSV : le DRY-RUN.
 *
 * Aucune écriture canonique n'a lieu ici, et rien dans cette fonction ne connaît la base :
 * elle est pure, donc testable sur des cas limites qu'aucune banque ne produira jamais
 * volontairement mais qui arrivent quand même.
 */
export function analyzeBankCsv(input: BankCsvAnalysisInput): BankCsvAnalysis {
  const maxRows = input.maxRows ?? MAX_ROWS_PER_SESSION;
  const decoded = decodeSourceBytes(input.bytes);
  const detected = detectDelimiter(decoded.text);
  const document = parseDelimited(decoded.text, detected.delimiter, { maxRows });

  const fileIssues: ImportIssue[] = [...decoded.issues, ...detected.issues, ...document.issues];

  const inferred = input.mappingOverride
    ? validateBankMapping(document.headers, input.mappingOverride)
    : inferBankMapping(document.headers);
  fileIssues.push(...inferred.issues);

  const signature = formatSignature(document.headers, detected.delimiter);
  const conventions = resolveConventions(document.rows, inferred.mapping);
  fileIssues.push(...conventions.issues);

  // Un fichier dont le mapping est incomplet ne produit AUCUNE ligne normalisée : lire des
  // montants avec des colonnes non résolues fabriquerait des faits.
  if (inferred.confidence === "INCOMPLETE" || document.rows.length === 0) {
    return {
      encoding: decoded.encoding,
      delimiter: detected.delimiter,
      headers: document.headers,
      mapping: inferred.mapping,
      mappingConfidence: inferred.confidence,
      conventions: {
        amount: conventions.amount,
        date: conventions.date,
        valueDate: conventions.valueDate,
      },
      signature,
      rawRows: document.rows,
      rows: [],
      counts: emptyCounts(),
      issues: fileIssues,
      observedPeriod: null,
    };
  }

  const rows = document.rows.map((row) => normalizeRow(row, inferred.mapping, conventions, input));

  const analysis: BankCsvAnalysis = {
    encoding: decoded.encoding,
    delimiter: detected.delimiter,
    headers: document.headers,
    mapping: inferred.mapping,
    mappingConfidence: inferred.confidence,
    conventions: {
      amount: conventions.amount,
      date: conventions.date,
      valueDate: conventions.valueDate,
    },
    signature,
    rawRows: document.rows,
    rows,
    counts: countRows(rows),
    issues: fileIssues,
    observedPeriod: observedPeriodOf(rows),
  };

  // La déduplication est une PASSE distincte, appelable seule : le repository lit d'abord
  // la période observée pour savoir quelles transactions relire, puis rejoue cette seule
  // passe. Sans cette séparation, il faudrait analyser le fichier deux fois.
  //
  // Elle s'exécute TOUJOURS, y compris sans aucun fait déjà canonique : c'est elle qui
  // attribue les rangs d'occurrence et les empreintes, dont dépend l'idempotence des
  // imports suivants. La sauter quand la base est vide laisserait des lignes sans identité.
  return applyDedupe(analysis, {
    accountId: input.accountId,
    sourceKey: input.sourceKey,
    existing: input.existing,
  });
}

/** Bornes des dates réellement OBSERVÉES. Ne certifient aucune exhaustivité. */
function observedPeriodOf(
  rows: readonly NormalizedBankRow[],
): { start: string; end: string } | null {
  const dates = rows
    .filter((row) => row.status !== "IGNORED" && row.transactionDate !== null)
    .map((row) => row.transactionDate!)
    .sort();
  return dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : null;
}

/** Anomalies produites par la seule déduplication : elles sont remplacées, jamais empilées. */
const DEDUPE_ISSUE_CODES = new Set(["DUPLICATE_EXACT", "DUPLICATE_PROBABLE", "POSSIBLE_MATCH"]);

export interface DedupeContext {
  accountId: string;
  sourceKey: string;
  existing: readonly ExistingTransactionFact[];
}

/**
 * Confronte une analyse aux faits déjà canoniques et en renvoie une nouvelle, verdicts et
 * statuts remis à jour. Fonction pure : elle ne relit pas le fichier.
 */
export function applyDedupe(analysis: BankCsvAnalysis, context: DedupeContext): BankCsvAnalysis {
  // Une ligne bloquée ou hors périmètre n'a pas d'identité : lui inventer un verdict
  // masquerait la vraie raison de son rejet.
  const candidates: DedupeCandidate[] = [];
  for (const row of analysis.rows) {
    if (row.status === "BLOCKED" || row.status === "IGNORED") continue;
    if (
      row.transactionDate === null ||
      row.label === null ||
      row.amount === null ||
      row.currency === null
    ) {
      continue;
    }
    candidates.push({
      rowNumber: row.rowNumber,
      accountId: context.accountId,
      date: row.transactionDate,
      label: row.label,
      amount: row.amount,
      currency: row.currency,
      externalReference: row.externalReference,
    });
  }

  const outcomes = new Map(
    classifyCandidates({
      candidates,
      existing: context.existing,
      sourceKey: context.sourceKey,
    }).map((outcome) => [outcome.rowNumber, outcome]),
  );

  const rows = analysis.rows.map((row) => {
    const outcome = outcomes.get(row.rowNumber);
    if (!outcome) return row;
    // Rejouer la passe REMPLACE le verdict précédent au lieu de s'y ajouter : le
    // repository l'appelle une fois à vide puis une fois avec les faits canoniques, et
    // deux verdicts empilés donneraient deux fois la même anomalie sur la même ligne.
    const issues = [
      ...row.issues.filter((entry) => !DEDUPE_ISSUE_CODES.has(entry.code)),
      ...outcome.issues,
    ];
    const status: ImportRowStatus =
      outcome.verdict === "EXACT_DUPLICATE" ? "DUPLICATE" : statusFromIssues(issues);
    return {
      ...row,
      verdict: outcome.verdict,
      fingerprint: outcome.fingerprint,
      externalKey: outcome.externalKey,
      matchedTransactionId: outcome.matchedTransactionId,
      issues,
      status,
    };
  });

  return { ...analysis, rows, counts: countRows(rows), observedPeriod: observedPeriodOf(rows) };
}

/**
 * Signature d'un fichier sans l'analyser : décodage, séparateur et en-tête seulement.
 *
 * Sert à retrouver un mapping mémorisé AVANT de lire les lignes, pour que le fichier ne
 * soit découpé qu'une fois avec le bon mapping.
 */
export function bankCsvSignature(bytes: Uint8Array): {
  signature: string;
  headers: string[];
  delimiter: string;
} {
  const decoded = decodeSourceBytes(bytes);
  const detected = detectDelimiter(decoded.text);
  const document = parseDelimited(decoded.text, detected.delimiter, {
    maxRows: MAX_ROWS_PER_SESSION,
  });
  return {
    signature: formatSignature(document.headers, detected.delimiter),
    headers: document.headers,
    delimiter: detected.delimiter,
  };
}
