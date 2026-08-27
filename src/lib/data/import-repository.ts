import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  analyzeBankCsv,
  applyDedupe,
  bankCsvSignature,
  MAX_ROWS_PER_SESSION,
} from "@/lib/acquisition/bank-csv";
import { civilDateIn, resolveTimeZone } from "@/lib/acquisition/clock";
import type {
  BankCsvAnalysis,
  ExistingIdentity,
  ExistingTransactionFact,
  ImportRowCounts,
  ImportSessionStatus,
  NormalizedBankRow,
} from "@/lib/acquisition/types";
import type {
  BankColumnMapping,
  ImportAnalyzeRequest,
  ImportCommitResult,
  ImportPreview,
  ImportPreviewRow,
  ImportSessionSummary,
} from "@/lib/data/import-contracts";
import { readAllPages } from "@/lib/data/pagination";
import { finiteNumber, nullableFiniteNumber } from "@/lib/data/row-validation";
import { DOCUMENTS_BUCKET, ownerId, supabaseAdmin } from "@/lib/data/supabase-client";

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

/**
 * Date à laquelle l'import est réellement effectué.
 *
 * DÉLIBÉRÉMENT distincte de `AS_OF_DATE`, qui est la date d'arrêté du reporting. Une
 * opération bancaire bookée hier est un fait réel même si le cockpit arrête ses comptes le
 * mois précédent : l'acquisition l'ingère, et les moteurs aval décident ensuite s'ils la
 * retiennent à leur propre date d'analyse.
 *
 * Elle est CIVILE et dans le fuseau du produit, pas en UTC : un relevé porte des dates
 * locales, et à 00 h 30 à Paris l'UTC est encore la veille — une opération du jour serait
 * alors signalée « après le jour de l'import ».
 *
 * Lue ici, jamais dans le moteur : les fonctions pures reçoivent la date en paramètre.
 */
function observationDate(): string {
  return civilDateIn(new Date(), resolveTimeZone(process.env.LFO_TIME_ZONE));
}

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
  /**
   * Valide une session. `file` n'est nécessaire que si la session a demandé la conservation
   * du fichier : la copie au coffre n'a lieu qu'ICI, après l'écriture des faits.
   */
  commit(
    sessionId: string,
    includeRecordIds: readonly string[],
    file?: ImportFileInput,
  ): Promise<ImportCommitResult>;
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
   * RESSEMBLANCE — faits canoniques de l'enveloppe, dans la fenêtre observée du fichier.
   *
   * La borne temporelle est légitime ICI et seulement ici : une ressemblance de date, de
   * montant et de libellé ne se cherche qu'au voisinage du fichier. Elle serait fausse pour
   * une identité, qui ne se périme pas — d'où la fonction séparée ci-dessous.
   */
  async function similarityFacts(
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

    return transactionRows.map((row) => ({
      id: str(row.id),
      accountId: str(row.account_id),
      date: str(row.transaction_date),
      label: str(row.label),
      amount: finiteNumber(row.amount, `transactions[id=${str(row.id)}].amount`),
      currency: str(row.currency),
    }));
  }

  /**
   * IDENTITÉ — clés d'identité déjà écrites, dans TOUT l'historique.
   *
   * AUCUN filtre de date, et c'est le point : une identité stable ne se périme pas. Une
   * opération dont la banque a corrigé la date de deux mois reste la même opération, et son
   * identifiant doit la retrouver. La chercher dans la fenêtre de ressemblance produisait un
   * verdict « nouvelle » suivi d'une violation de l'index unique au commit — donc un échec
   * global et opaque là où le moteur devait rendre un verdict lisible.
   *
   * La clé porte déjà le préfixe de sa source : lire tout l'historique du propriétaire ne
   * mélange pas deux banques.
   */
  async function existingIdentities(): Promise<ExistingIdentity[]> {
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>("identités déjà importées", async (from, to) => {
        const result = await db
          .from("import_normalized_records")
          .select("external_key, import_record_links!inner(transaction_id)")
          .eq("user_id", user)
          .eq("commit_state", "COMMITTED")
          .not("external_key", "is", null)
          .order("id", { ascending: true })
          .range(from, to);
        return { data: (result.data ?? null) as Row[] | null, error: result.error };
      }),
      "lecture des identités déjà importées",
    );

    const identities: ExistingIdentity[] = [];
    for (const row of rows) {
      const nested = row.import_record_links as Row | Row[] | null;
      const link = Array.isArray(nested) ? nested[0] : nested;
      const externalKey = nullableStr(row.external_key);
      if (!link || !externalKey) continue;
      const transactionId = nullableStr(link.transaction_id);
      if (!transactionId) continue;
      identities.push({ externalKey, transactionId });
    }
    return identities;
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
      external_transaction_id: row.externalTransactionId,
      reference: row.reference,
      counterparty: row.counterparty,
      balance_after: row.balanceAfter,
      status: row.status,
      dedupe_verdict: row.verdict,
      match_key: row.matchKey,
      external_key: row.externalKey,
      matched_transaction_id: row.matchedTransactionId,
      issues: row.issues,
    };
  }

  /**
   * Refuse tôt un contenu déjà validé pour cette enveloppe.
   *
   * La RPC porte la garantie ; ce contrôle sert à ne pas déposer un document au coffre
   * juste avant un refus. Il lit les sessions par empreinte et retient celles dont la
   * source visait le même compte.
   */
  async function refuseAlreadyCommitted(accountId: string, fileHash: string): Promise<void> {
    const rows = unwrap(
      await db
        .from("import_sessions")
        .select("status, import_sources!inner(target_account_id)")
        .eq("user_id", user)
        .eq("file_hash", fileHash)
        .eq("status", "COMMITTED"),
      "contrôle d'un fichier déjà importé",
    ) as Row[];
    for (const row of rows) {
      const nested = row.import_sources as Row | Row[] | null;
      const source = Array.isArray(nested) ? nested[0] : nested;
      if (source && str(source.target_account_id) === accountId) {
        throw new Error("Ce fichier a déjà été importé et validé pour cette source");
      }
    }
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

    // Refus AVANT tout dépôt au coffre : un fichier déjà validé pour cette source ne sera
    // pas réimporté, et il ne doit donc pas laisser une copie derrière lui. La RPC répète
    // ce contrôle — c'est elle qui le garantit sous concurrence.
    await refuseAlreadyCommitted(account.id, fileHash);

    const observedAt = observationDate();

    // Lecture PURE du fichier, sans base. Elle donne la période observée, donc la fenêtre
    // de transactions à relire.
    const parsed = analyzeBankCsv({
      bytes: file.bytes,
      accountId: account.id,
      declaredCurrency: request.declaredCurrency,
      existing: [],
      identities: [],
      sourceKey: `${PROVIDER}:${account.id}`,
      observationDate: observedAt,
      stableIdentifiers: request.stableTransactionIdDeclared,
      mappingOverride,
      maxRows: MAX_ROWS_PER_SESSION,
    });

    // Deux lectures DISTINCTES, aux portées distinctes : la ressemblance est bornée dans le
    // temps, l'identité ne l'est jamais.
    const [existing, identities] = await Promise.all([
      similarityFacts(account.id, parsed.observedPeriod),
      request.stableTransactionIdDeclared ? existingIdentities() : Promise.resolve([]),
    ]);

    // Déduplication : seule passe qui dépend de la base. Le fichier n'est pas relu.
    const analysis = applyDedupe(parsed, {
      accountId: account.id,
      sourceKey: `${PROVIDER}:${account.id}`,
      existing,
      identities,
      stableIdentifiers: request.stableTransactionIdDeclared,
    });

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
            observation_date: observedAt,
            stable_transaction_id_declared: request.stableTransactionIdDeclared,
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
            retain_file_requested: request.retainFile,
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
      verdicts: analysis.verdicts,
      observedPeriod: analysis.observedPeriod,
      rows: rendered.rows,
      readyRowsTruncated: rendered.truncated,
      mappingRestored,
    };
  }

  /**
   * Conserve le fichier d'une session VALIDÉE, une fois et une seule.
   *
   * Deux propriétés, et elles sont structurelles plutôt que vérifiées après coup :
   *
   *   * la conservation n'a lieu qu'APRÈS la validation. Une analyse abandonnée, réanalysée
   *     après correction de mapping, ou refusée parce que le contenu était déjà importé, ne
   *     peut donc laisser aucune copie derrière elle : elle ne dépose jamais rien ;
   *   * l'objet Storage est ADRESSÉ PAR SON CONTENU (`<user>/imports/<sha256>`). Deux
   *     validations simultanées du même fichier écrivent donc le même chemin, et c'est
   *     Storage qui refuse la seconde — la sérialisation ne repose pas sur une lecture
   *     préalable qui pourrait passer entre les deux.
   *
   * Best-effort assumé : un échec de conservation n'annule pas des faits déjà écrits. Il est
   * remonté, et la session porte alors son intention sans document.
   */
  async function retainSessionFile(
    sessionId: string,
    fileHash: string,
    file: ImportFileInput,
  ): Promise<void> {
    const extension = file.name.includes(".")
      ? `.${file.name
          .split(".")
          .pop()!
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, 7)}`
      : "";
    const storagePath = `${user}/imports/${fileHash}${extension}`;

    // `upsert: true` est SÛR ici, et seulement ici : le chemin est dérivé de l'empreinte du
    // contenu, donc réécrire ce chemin ne peut réécrire que des octets identiques. C'est ce
    // qui évite de classer un message d'erreur de collision — un test de chaîne aurait pu
    // prendre une vraie panne pour un doublon et enregistrer un document sans objet.
    const uploaded = await db.storage.from(DOCUMENTS_BUCKET).upload(storagePath, file.bytes, {
      contentType: file.contentType,
      upsert: true,
    });
    if (uploaded.error) throw new Error(`Supabase stockage : ${uploaded.error.message}`);

    const existing = unwrap(
      await db.from("documents").select("id").eq("user_id", user).eq("storage_path", storagePath),
      "recherche du document conservé",
    ) as Row[];

    let documentId = existing[0] ? str(existing[0].id) : null;
    if (!documentId) {
      const inserted = await db
        .from("documents")
        .insert({
          user_id: user,
          name: file.name.slice(0, 180),
          category: "bank",
          storage_path: storagePath,
          size_bytes: file.size,
          status: "INBOX",
        })
        .select("id");
      if (inserted.error) {
        // `documents_owner_storage_path_uidx` a tranché : un autre écrivain a gagné.
        const raced = unwrap(
          await db
            .from("documents")
            .select("id")
            .eq("user_id", user)
            .eq("storage_path", storagePath),
          "relecture du document conservé",
        ) as Row[];
        if (!raced[0])
          throw new Error(`Supabase enregistrement de document : ${inserted.error.message}`);
        documentId = str(raced[0].id);
      } else {
        documentId = str((inserted.data as Row[])[0].id);
      }
    }

    unwrap(
      await db.rpc("lfo_attach_import_document", {
        p_user_id: user,
        p_payload: { session_id: sessionId, document_id: documentId, file_hash: fileHash },
      }),
      "rattachement du fichier conservé",
    );
  }

  async function commit(
    sessionId: string,
    includeRecordIds: readonly string[],
    file?: ImportFileInput,
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
        .select("committed_count, retain_file_requested, document_id, file_hash")
        .eq("user_id", user)
        .eq("id", sessionId),
      "lecture du résultat d'import",
    ) as Row[];
    const session = rows[0];

    if (
      session &&
      file &&
      session.retain_file_requested === true &&
      session.document_id === null &&
      nullableStr(session.file_hash)
    ) {
      await retainSessionFile(sessionId, str(session.file_hash), file);
    }

    return {
      sessionId,
      committedCount: session
        ? finiteNumber(session.committed_count, "import_sessions.committed_count")
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
        observationDate: nullableStr(row.observation_date),
        stableTransactionIdDeclared: row.stable_transaction_id_declared === true,
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
