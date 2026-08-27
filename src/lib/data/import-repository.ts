import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  analyzeBankCsv,
  applyDedupe,
  bankCsvSignature,
  MAX_ROWS_PER_SESSION,
} from "@/lib/acquisition/bank-csv";
import type {
  BankCsvAnalysis,
  ExistingTransactionFact,
  ImportRowCounts,
  ImportSessionStatus,
  NormalizedBankRow,
} from "@/lib/acquisition/types";
import { AS_OF_DATE } from "@/lib/data/shared";
import type {
  BankColumnMapping,
  ImportAnalyzeRequest,
  ImportCommitResult,
  ImportPreview,
  ImportPreviewRow,
  ImportSessionSummary,
} from "@/lib/data/import-contracts";
import { readAllPages } from "@/lib/data/pagination";
import { getRepository } from "@/lib/data/repository";
import { finiteNumber, nullableFiniteNumber } from "@/lib/data/row-validation";
import { ownerId, supabaseAdmin } from "@/lib/data/supabase-client";

type Row = Record<string, unknown>;

const PARSER = "bank-csv";
const PARSER_VERSION = "1";
const PROVIDER = "GENERIC_BANK_CSV";
const ADAPTER_VERSION = `${PARSER}/${PARSER_VERSION}`;

/**
 * Marge, en jours, ajoutée de part et d'autre de la période observée pour lire les
 * transactions déjà canoniques. Elle sert la détection des doublons PROBABLES : une
 * opération datée par la banque au jour de valeur tombe à quelques jours de son jumeau.
 */
const DEDUPE_MARGIN_DAYS = 7;

/** Plafond d'AFFICHAGE des lignes prêtes. Le staging en contient toujours l'intégralité. */
const PREVIEW_READY_LIMIT = 200;

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${context} : réponse vide`);
  return result.data;
}

const str = (value: unknown): string => String(value ?? "");
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function shiftDate(iso: string, days: number): string {
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function countsOf(row: Row): ImportRowCounts {
  return {
    total: finiteNumber(row.row_count, "import_sessions.row_count"),
    ready: finiteNumber(row.ready_count, "import_sessions.ready_count"),
    warning: finiteNumber(row.warning_count, "import_sessions.warning_count"),
    blocked: finiteNumber(row.blocked_count, "import_sessions.blocked_count"),
    duplicate: finiteNumber(row.duplicate_count, "import_sessions.duplicate_count"),
    ignored: finiteNumber(row.ignored_count, "import_sessions.ignored_count"),
  };
}

/**
 * COUCHE D'ACQUISITION — accès données.
 *
 * Volontairement SÉPARÉE de `FamilyOfficeRepository`. Deux raisons, pas une :
 *
 *   * le staging d'un import est volumineux et ne concerne aucun écran financier. Le
 *     charger dans `getDashboardState()` alourdirait chaque lecture du cockpit pour une
 *     donnée que seule la page Imports consomme ;
 *   * le contrat existant reste inchangé, donc aucun autre chantier en cours ne dépend de
 *     cette PR pour compiler.
 */
export interface ImportRepository {
  readonly adapter: "supabase";
  analyze(request: ImportAnalyzeRequest, file: ImportFileInput): Promise<ImportPreview>;
  commit(sessionId: string, includeRecordIds: readonly string[]): Promise<ImportCommitResult>;
  discard(sessionId: string): Promise<string>;
  listSessions(limit?: number): Promise<ImportSessionSummary[]>;
  getSessionRows(sessionId: string): Promise<ImportPreviewRow[]>;
}

export interface ImportFileInput {
  name: string;
  contentType: string;
  size: number;
  bytes: Uint8Array;
}

export function createImportRepository(): ImportRepository {
  const db = supabaseAdmin();
  const user = ownerId();

  /** Comptes du propriétaire : sert à valider la cible et à nommer la source. */
  async function accountOf(
    accountId: string,
  ): Promise<{ id: string; name: string; currency: string }> {
    const rows = unwrap(
      await db
        .from("financial_accounts")
        .select("id, name, currency, status")
        .eq("user_id", user)
        .eq("id", accountId),
      "lecture du compte cible",
    ) as Row[];
    const row = rows[0];
    if (!row) throw new Error("Compte cible introuvable");
    if (str(row.status) !== "ACTIVE") throw new Error("Compte cible inactif");
    return { id: str(row.id), name: str(row.name), currency: str(row.currency) };
  }

  /**
   * Faits canoniques déjà présents sur l'enveloppe, dans la fenêtre observée du fichier.
   *
   * La clé externe ne vit pas sur `transactions` : elle est portée par la ligne normalisée
   * qui a produit la transaction. Elle est donc rapportée par jointure, ce qui évite
   * d'ajouter une colonne à une table du domaine Cash Flow pour un besoin d'acquisition.
   */
  async function existingFacts(
    accountId: string,
    period: { start: string; end: string } | null,
  ): Promise<ExistingTransactionFact[]> {
    if (!period) return [];
    const from = shiftDate(period.start, -DEDUPE_MARGIN_DAYS);
    const to = shiftDate(period.end, DEDUPE_MARGIN_DAYS);

    const transactionRows = unwrap(
      await readAllPages<Row, PostgrestError>(
        `transactions du compte ${accountId} pour déduplication`,
        async (start, end) => {
          const result = await db
            .from("transactions")
            .select("id, account_id, transaction_date, label, amount, currency")
            .eq("user_id", user)
            .eq("account_id", accountId)
            .gte("transaction_date", from)
            .lte("transaction_date", to)
            .order("transaction_date", { ascending: true })
            .order("id", { ascending: true })
            .range(start, end);
          return { data: (result.data ?? null) as Row[] | null, error: result.error };
        },
      ),
      "lecture des transactions pour déduplication",
    );

    const linkRows = unwrap(
      await db
        .from("import_record_links")
        .select("transaction_id, import_normalized_records!inner(external_key, commit_state)")
        .eq("user_id", user)
        .not("transaction_id", "is", null),
      "lecture des clés externes déjà importées",
    ) as Row[];

    const externalKeyByTransaction = new Map<string, string>();
    for (const link of linkRows) {
      const nested = link.import_normalized_records as Row | Row[] | null;
      const record = Array.isArray(nested) ? nested[0] : nested;
      if (!record) continue;
      if (str(record.commit_state) !== "COMMITTED") continue;
      const key = nullableStr(record.external_key);
      if (key) externalKeyByTransaction.set(str(link.transaction_id), key);
    }

    return transactionRows.map((row) => ({
      id: str(row.id),
      accountId: str(row.account_id),
      date: str(row.transaction_date),
      label: str(row.label),
      amount: finiteNumber(row.amount, `transactions[id=${str(row.id)}].amount`),
      currency: str(row.currency),
      externalKey: externalKeyByTransaction.get(str(row.id)) ?? null,
    }));
  }

  /** Mapping déjà validé pour cette signature exacte, s'il existe. */
  async function storedMapping(signature: string): Promise<BankColumnMapping | null> {
    const rows = unwrap(
      await db
        .from("import_column_mappings")
        .select("mapping")
        .eq("user_id", user)
        .eq("signature", signature),
      "lecture d'un mapping mémorisé",
    ) as Row[];
    const mapping = rows[0]?.mapping;
    return mapping && typeof mapping === "object" ? (mapping as BankColumnMapping) : null;
  }

  function previewRows(
    analysis: BankCsvAnalysis,
    idByRowNumber: Map<number, string>,
  ): { rows: ImportPreviewRow[]; truncated: boolean } {
    let readyShown = 0;
    let truncated = false;
    const rows: ImportPreviewRow[] = [];
    for (const row of analysis.rows) {
      if (row.status === "READY") {
        if (readyShown >= PREVIEW_READY_LIMIT) {
          truncated = true;
          continue;
        }
        readyShown += 1;
      }
      rows.push({
        id: idByRowNumber.get(row.rowNumber) ?? "",
        rowNumber: row.rowNumber,
        transactionDate: row.transactionDate,
        label: row.label,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        verdict: row.verdict,
        issues: row.issues,
      });
    }
    return { rows, truncated };
  }

  function normalizedPayload(row: NormalizedBankRow): Record<string, unknown> {
    return {
      row_number: row.rowNumber,
      transaction_date: row.transactionDate,
      value_date: row.valueDate,
      label: row.label,
      amount: row.amount,
      currency: row.currency,
      external_reference: row.externalReference,
      counterparty: row.counterparty,
      balance_after: row.balanceAfter,
      status: row.status,
      dedupe_verdict: row.verdict,
      dedupe_fingerprint: row.fingerprint,
      external_key: row.externalKey,
      matched_transaction_id: row.matchedTransactionId,
      issues: row.issues,
    };
  }

  async function analyze(
    request: ImportAnalyzeRequest,
    file: ImportFileInput,
  ): Promise<ImportPreview> {
    const account = await accountOf(request.accountId);
    const fileHash = createHash("sha256").update(file.bytes).digest("hex");

    // Un mapping mémorisé se retrouve par la SIGNATURE du format, qui ne demande que
    // l'en-tête : le fichier n'est donc découpé qu'une fois, avec le bon mapping.
    const probe = bankCsvSignature(file.bytes);
    let mappingOverride = request.mapping;
    let mappingRestored = false;
    if (!mappingOverride) {
      const remembered = await storedMapping(probe.signature);
      if (remembered) {
        mappingOverride = remembered;
        mappingRestored = true;
      }
    }

    // Lecture PURE du fichier, sans base. Elle donne la période observée, donc la fenêtre
    // de transactions à relire.
    const parsed = analyzeBankCsv({
      bytes: file.bytes,
      accountId: account.id,
      declaredCurrency: request.declaredCurrency,
      existing: [],
      sourceKey: `${PROVIDER}:${account.id}`,
      asOfDate: AS_OF_DATE,
      mappingOverride,
      maxRows: MAX_ROWS_PER_SESSION,
    });

    const existing = await existingFacts(account.id, parsed.observedPeriod);

    // Déduplication : seule passe qui dépend de la base. Le fichier n'est pas relu.
    const analysis = applyDedupe(parsed, {
      accountId: account.id,
      sourceKey: `${PROVIDER}:${account.id}`,
      existing,
    });

    // Fichier conservé AVANT l'écriture de la session, pour que celle-ci puisse le citer.
    // Si l'écriture échoue ensuite, le fichier reste dans le coffre comme n'importe quel
    // document bancaire déposé : rien d'invisible n'est créé.
    let documentId: string | null = null;
    if (request.retainFile) {
      const repository = await getRepository();
      const document = await repository.storeDocument({
        name: file.name.slice(0, 180),
        category: "bank",
        contentType: file.contentType,
        size: file.size,
        bytes: file.bytes,
      });
      documentId = document.id;
    }

    const sessionId = unwrap(
      await db.rpc("lfo_analyze_import_session", {
        p_user_id: user,
        p_payload: {
          source: {
            kind: "FILE_CSV",
            domain: "CASH_FLOW_TRANSACTION",
            provider: PROVIDER,
            label: `Relevé CSV — ${account.name}`,
            target_account_id: account.id,
            adapter_version: ADAPTER_VERSION,
            source: "Import de fichier",
          },
          session: {
            file_name: file.name.slice(0, 180),
            file_hash: fileHash,
            file_size_bytes: file.size,
            content_type: file.contentType,
            encoding: analysis.encoding,
            delimiter: analysis.delimiter,
            parser: PARSER,
            parser_version: PARSER_VERSION,
            mapping: analysis.mapping,
            conventions: analysis.conventions,
            declared_currency: request.declaredCurrency,
            declared_period_start: request.declaredPeriodStart,
            declared_period_end: request.declaredPeriodEnd,
            observed_period_start: analysis.observedPeriod?.start ?? null,
            observed_period_end: analysis.observedPeriod?.end ?? null,
            row_count: analysis.counts.total,
            ready_count: analysis.counts.ready,
            warning_count: analysis.counts.warning,
            blocked_count: analysis.counts.blocked,
            duplicate_count: analysis.counts.duplicate,
            ignored_count: analysis.counts.ignored,
            document_id: documentId,
            issues: analysis.issues,
          },
          // Le brut est persisté TEL QUEL : c'est lui qui répond plus tard à « qu'est-ce
          // que la banque a réellement écrit ? », indépendamment de la lecture qu'en a
          // faite le parseur.
          raw: analysis.rawRows.map((row) => ({
            row_number: row.rowNumber,
            raw_line: row.rawLine,
            cells: row.cells,
          })),
          normalized: analysis.rows.map(normalizedPayload),
        },
      }),
      "analyse d'import",
    ) as string;

    if (request.rememberMapping && analysis.mappingConfidence === "CERTAIN") {
      unwrap(
        await db.rpc("lfo_save_import_mapping", {
          p_user_id: user,
          p_payload: {
            signature: analysis.signature,
            provider: PROVIDER,
            label: `Relevé CSV — ${account.name}`,
            headers: analysis.headers,
            mapping: analysis.mapping,
            conventions: analysis.conventions,
          },
        }),
        "mémorisation du mapping",
      );
    }

    const sessionRows = unwrap(
      await db.from("import_sessions").select("source_id").eq("user_id", user).eq("id", sessionId),
      "lecture de la session d'import",
    ) as Row[];

    const idRows = unwrap(
      await db
        .from("import_normalized_records")
        .select("id, import_raw_records!inner(row_number)")
        .eq("user_id", user)
        .eq("session_id", sessionId),
      "lecture des identifiants de staging",
    ) as Row[];
    const idByRowNumber = new Map<number, string>();
    for (const row of idRows) {
      const nested = row.import_raw_records as Row | Row[] | null;
      const raw = Array.isArray(nested) ? nested[0] : nested;
      if (!raw) continue;
      idByRowNumber.set(finiteNumber(raw.row_number, "import_raw_records.row_number"), str(row.id));
    }

    const rendered = previewRows(analysis, idByRowNumber);

    return {
      sessionId,
      sourceId: sessionRows[0] ? str(sessionRows[0].source_id) : "",
      accountId: account.id,
      accountName: account.name,
      fileName: file.name,
      fileHash,
      encoding: analysis.encoding,
      delimiter: analysis.delimiter,
      headers: analysis.headers,
      mapping: analysis.mapping,
      mappingConfidence: analysis.mappingConfidence,
      conventions: analysis.conventions,
      signature: analysis.signature,
      counts: analysis.counts,
      issues: analysis.issues,
      observedPeriod: analysis.observedPeriod,
      rows: rendered.rows,
      readyRowsTruncated: rendered.truncated,
      mappingRestored,
    };
  }

  async function commit(
    sessionId: string,
    includeRecordIds: readonly string[],
  ): Promise<ImportCommitResult> {
    unwrap(
      await db.rpc("lfo_commit_import_session", {
        p_user_id: user,
        p_payload: { session_id: sessionId, include_record_ids: includeRecordIds },
      }),
      "validation d'import",
    );
    const rows = unwrap(
      await db
        .from("import_sessions")
        .select("committed_count")
        .eq("user_id", user)
        .eq("id", sessionId),
      "lecture du résultat d'import",
    ) as Row[];
    return {
      sessionId,
      committedCount: rows[0]
        ? finiteNumber(rows[0].committed_count, "import_sessions.committed_count")
        : 0,
    };
  }

  async function discard(sessionId: string): Promise<string> {
    unwrap(
      await db.rpc("lfo_discard_import_session", {
        p_user_id: user,
        p_session_id: sessionId,
      }),
      "abandon d'import",
    );
    return sessionId;
  }

  async function listSessions(limit = 50): Promise<ImportSessionSummary[]> {
    const rows = unwrap(
      await db
        .from("import_sessions")
        .select("*, import_sources!inner(id, label, target_account_id)")
        .eq("user_id", user)
        .order("created_at", { ascending: false })
        .limit(limit),
      "historique des imports",
    ) as Row[];

    const accountRows = unwrap(
      await db.from("financial_accounts").select("id, name").eq("user_id", user),
      "lecture des comptes",
    ) as Row[];
    const accountNames = new Map(accountRows.map((row) => [str(row.id), str(row.name)]));

    return rows.map((row) => {
      const nested = row.import_sources as Row | Row[] | null;
      const source = Array.isArray(nested) ? nested[0] : nested;
      const accountId = source ? nullableStr(source.target_account_id) : null;
      return {
        id: str(row.id),
        sourceId: str(row.source_id),
        sourceLabel: source ? str(source.label) : "",
        accountId,
        accountName: accountId ? (accountNames.get(accountId) ?? "") : "",
        fileName: nullableStr(row.file_name),
        status: str(row.status) as ImportSessionStatus,
        parser: str(row.parser),
        parserVersion: str(row.parser_version),
        encoding: nullableStr(row.encoding),
        delimiter: nullableStr(row.delimiter),
        declaredCurrency: nullableStr(row.declared_currency),
        observedPeriodStart: nullableStr(row.observed_period_start),
        observedPeriodEnd: nullableStr(row.observed_period_end),
        declaredPeriodStart: nullableStr(row.declared_period_start),
        declaredPeriodEnd: nullableStr(row.declared_period_end),
        counts: countsOf(row),
        committedCount: finiteNumber(row.committed_count, "import_sessions.committed_count"),
        analyzedAt: str(row.analyzed_at),
        committedAt: nullableStr(row.committed_at),
        discardedAt: nullableStr(row.discarded_at),
        error: nullableStr(row.error),
      };
    });
  }

  async function getSessionRows(sessionId: string): Promise<ImportPreviewRow[]> {
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>(
        `lignes normalisées de la session ${sessionId}`,
        async (from, to) => {
          const result = await db
            .from("import_normalized_records")
            .select(
              "id, transaction_date, label, amount, currency, status, dedupe_verdict, issues, import_raw_records!inner(row_number)",
            )
            .eq("user_id", user)
            .eq("session_id", sessionId)
            .order("id", { ascending: true })
            .range(from, to);
          return { data: (result.data ?? null) as Row[] | null, error: result.error };
        },
      ),
      "lecture des lignes d'une session",
    );

    const mapped = rows.map((row) => {
      const nested = row.import_raw_records as Row | Row[] | null;
      const raw = Array.isArray(nested) ? nested[0] : nested;
      return {
        id: str(row.id),
        rowNumber: raw ? finiteNumber(raw.row_number, "import_raw_records.row_number") : 0,
        transactionDate: nullableStr(row.transaction_date),
        label: nullableStr(row.label),
        amount: nullableFiniteNumber(row.amount, "import_normalized_records.amount"),
        currency: nullableStr(row.currency),
        status: str(row.status) as ImportPreviewRow["status"],
        verdict: nullableStr(row.dedupe_verdict) as ImportPreviewRow["verdict"],
        issues: Array.isArray(row.issues) ? (row.issues as ImportPreviewRow["issues"]) : [],
      };
    });
    return mapped.sort((left, right) => left.rowNumber - right.rowNumber);
  }

  return { adapter: "supabase", analyze, commit, discard, listSessions, getSessionRows };
}

let cached: ImportRepository | undefined;

export function getImportRepository(): ImportRepository {
  if (!cached) cached = createImportRepository();
  return cached;
}
