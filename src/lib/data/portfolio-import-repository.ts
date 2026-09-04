import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import { civilDateIn, resolveTimeZone } from "@/lib/acquisition/clock";
import {
  analyzePortfolioFile,
  detectFormat,
  instrumentSourceKey,
  MAX_PORTFOLIO_ROWS,
  PORTFOLIO_PARSER,
  PORTFOLIO_PARSER_VERSION,
  type KnownSecurity,
  type NormalizedLedgerRow,
  type NormalizedPositionRow,
  type PortfolioAnalysis,
} from "@/lib/acquisition/portfolio";
import { formatSignature } from "@/lib/acquisition/csv";
import type { ImportIssue } from "@/lib/acquisition/types";
import type {
  InstrumentResolutionView,
  PortfolioCommitResult,
  PortfolioExistingObservation,
  PortfolioImportCommand,
  PortfolioObservedValues,
  PortfolioPreview,
  PortfolioPreviewRow,
  PortfolioSessionSummary,
  PortfolioUploadTicket,
} from "@/lib/data/portfolio-import-contracts";
import { changedObservedFields } from "@/lib/data/observed-amounts";
import { LEDGER_PAGE_SIZE, pagesFor, readAllPages } from "@/lib/data/pagination";
import { nullableFiniteNumber } from "@/lib/data/row-validation";
import { IMPORT_STAGING_BUCKET, ownerId, supabaseAdmin } from "@/lib/data/supabase-client";

type Row = Record<string, unknown>;

/** Lignes envoyées par appel de RPC. */
const ROW_CHUNK = 400;
/** Plafond d'AFFICHAGE. Le staging en contient toujours l'intégralité. */
const PREVIEW_ROW_LIMIT = 300;
const UPLOAD_TICKET_TTL_MINUTES = 30;

const str = (value: unknown): string => String(value ?? "");
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${context} : réponse vide`);
  return result.data;
}

/**
 * Date à laquelle l'import est effectué. DÉLIBÉRÉMENT distincte de la date d'arrêté du
 * reporting : une opération de bourse passée hier est un fait réel même si le cockpit
 * arrête ses comptes le mois précédent.
 */
function observationDate(): string {
  return civilDateIn(new Date(), resolveTimeZone(process.env.LFO_TIME_ZONE));
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface PortfolioImportRepository {
  adapter: "supabase";
  issueUploadTicket(
    input: Extract<PortfolioImportCommand, { action: "ticket" }>,
  ): Promise<PortfolioUploadTicket>;
  analyze(input: Extract<PortfolioImportCommand, { action: "analyze" }>): Promise<PortfolioPreview>;
  resolveInstrument(
    input: Extract<PortfolioImportCommand, { action: "resolve-instrument" }>,
  ): Promise<PortfolioPreview>;
  correct(input: Extract<PortfolioImportCommand, { action: "correct" }>): Promise<PortfolioPreview>;
  commit(
    input: Extract<PortfolioImportCommand, { action: "commit" }>,
  ): Promise<PortfolioCommitResult>;
  discard(sessionId: string): Promise<void>;
  getPreview(sessionId: string): Promise<PortfolioPreview>;
  listSessions(accountId?: string): Promise<PortfolioSessionSummary[]>;
}

function createPortfolioImportRepository(): PortfolioImportRepository {
  const db = supabaseAdmin();
  const user = ownerId();

  /**
   * Billet de dépôt. Le chemin est CALCULÉ par la RPC à partir du propriétaire et de
   * l'identifiant du billet ; l'URL signée n'autorise qu'un dépôt, à ce chemin, et expire.
   *
   * Le fichier ne traverse donc jamais la fonction serveur : un classeur dépasse la taille
   * de corps qu'une plateforme serverless accepte, et un import qui échouerait AVANT
   * d'exécuter le moindre code n'existerait pas en production.
   */
  async function issueUploadTicket(
    input: Extract<PortfolioImportCommand, { action: "ticket" }>,
  ): Promise<PortfolioUploadTicket> {
    const ticketId = unwrap(
      await db.rpc("lfo_issue_import_upload_ticket", {
        p_user_id: user,
        p_payload: {
          domain: "PORTFOLIO_FILE",
          file_name: input.fileName.slice(0, 240),
          content_type: input.contentType,
          byte_size: input.byteSize,
          ttl_minutes: UPLOAD_TICKET_TTL_MINUTES,
        },
      }),
      "émission du billet de dépôt",
    ) as string;

    const ticket = (
      unwrap(
        await db
          .from("import_upload_tickets")
          .select("id, storage_path, expires_at")
          .eq("user_id", user)
          .eq("id", ticketId)
          .limit(1),
        "relecture du billet de dépôt",
      ) as Row[]
    )[0];

    const storagePath = str(ticket.storage_path);
    const signed = await db.storage.from(IMPORT_STAGING_BUCKET).createSignedUploadUrl(storagePath);
    if (signed.error || !signed.data) {
      throw new Error(`Supabase URL de dépôt : ${signed.error?.message ?? "réponse vide"}`);
    }

    return {
      ticketId,
      uploadUrl: signed.data.signedUrl,
      bucket: IMPORT_STAGING_BUCKET,
      path: storagePath,
      // Le JETON, et non une URL assemblée à la main : le client officiel construit le corps
      // `multipart/form-data` que le service attend.
      token: signed.data.token,
      expiresAt: str(ticket.expires_at),
    };
  }

  /** Instruments du référentiel. Lus, jamais créés par cette couche. */
  async function knownSecurities(): Promise<KnownSecurity[]> {
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>(
        "référentiel d'instruments",
        async (from, to) => {
          const result = await db
            .from("securities")
            .select("id, name, ticker, isin, currency")
            .eq("user_id", user)
            .order("name", { ascending: true })
            .range(from, to);
          return { data: result.data as Row[] | null, error: result.error };
        },
        { pageSize: LEDGER_PAGE_SIZE, maxPages: pagesFor(20_000) },
      ),
      "lecture du référentiel d'instruments",
    );
    return rows.map((row) => ({
      securityId: str(row.id),
      name: str(row.name),
      isin: nullableStr(row.isin),
      ticker: nullableStr(row.ticker),
      currency: str(row.currency),
    }));
  }

  async function analyze(
    input: Extract<PortfolioImportCommand, { action: "analyze" }>,
  ): Promise<PortfolioPreview> {
    // Consomme le billet : usage unique, contrôlé en base. Le chemin de stockage vient de la
    // base, jamais du client.
    const consumed = (
      unwrap(
        await db.rpc("lfo_consume_import_upload_ticket", {
          p_user_id: user,
          p_ticket_id: input.ticketId,
        }),
        "consommation du billet de dépôt",
      ) as Row[]
    )[0];
    const storagePath = str(consumed.storage_path);
    const fileName = str(consumed.file_name);
    const retainFile = Boolean(consumed.retain_file);

    const download = await db.storage.from(IMPORT_STAGING_BUCKET).download(storagePath);
    if (download.error || !download.data) {
      throw new Error(
        `Fichier déposé illisible : ${download.error?.message ?? "réponse vide"}. Aucune lecture n'a été tentée`,
      );
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    const account = (
      unwrap(
        await db
          .from("financial_accounts")
          .select("id, name, currency")
          .eq("user_id", user)
          .eq("id", input.accountId)
          .limit(1),
        "lecture de l'enveloppe",
      ) as Row[]
    )[0];
    if (account === undefined) throw new Error("Enveloppe introuvable");

    const known = await knownSecurities();
    const sourceKey = "GENERIC_PORTFOLIO_FILE";

    // Faits déjà canoniques : ils servent la déduplication. La fenêtre est celle de
    // l'enveloppe entière, parce qu'une identité déclarée se cherche dans TOUT l'historique.
    const existingEvents =
      input.kind === "PORTFOLIO_LEDGER" ? await loadExistingEvents(input.accountId) : [];
    const existingIdentities =
      input.kind === "PORTFOLIO_LEDGER" ? await loadExistingIdentities() : [];
    const existingPositions =
      input.kind === "PORTFOLIO_POSITION" ? await loadExistingPositions(input.accountId) : [];

    const analysis = analyzePortfolioFile({
      bytes,
      fileName,
      kind: input.kind,
      accountId: input.accountId,
      declaredCurrency: input.declaredCurrency ?? nullableStr(account.currency),
      mapping: input.mapping ?? undefined,
      sheetName: input.sheetName,
      known,
      existingEvents,
      existingIdentities,
      existingPositions,
      sourceKey,
      stableReferences: input.stableReferenceDeclared,
    });

    const sessionId = unwrap(
      await db.rpc("lfo_open_portfolio_session", {
        p_user_id: user,
        p_payload: {
          source: {
            kind: analysis.format === "XLSX" ? "FILE_CSV" : "FILE_CSV",
            domain: input.kind,
            provider: sourceKey,
            label: `Portefeuille — ${str(account.name)}`,
            target_account_id: input.accountId,
            adapter_version: `${PORTFOLIO_PARSER}/${PORTFOLIO_PARSER_VERSION}`,
          },
          session: {
            file_name: fileName,
            file_hash: hashBytes(bytes),
            file_size_bytes: bytes.byteLength,
            content_type: str(consumed.content_type),
            encoding: analysis.format === "XLSX" ? "XLSX" : "UTF_8",
            delimiter: analysis.format === "XLSX" ? null : null,
            parser: analysis.parser,
            parser_version: analysis.parserVersion,
            // ENVELOPPE DE LECTURE, et pas seulement l'affectation des colonnes. Un
            // mapping relu six mois plus tard sans les en-têtes qu'il désignait, sans le
            // format lu, sans la feuille retenue et sans la liste des cellules issues d'une
            // formule serait un contrat illisible. `import_sessions` ne porte pas de colonne
            // d'en-têtes : c'est donc ici, dans le jsonb prévu pour le contrat de lecture,
            // que tout cela vit.
            mapping: {
              fields: analysis.mapping,
              headers: analysis.headers,
              confidence: analysis.mappingConfidence,
              format: analysis.format,
              sheet_name: analysis.sheetName,
              other_sheets: analysis.otherSheets,
              formula_cells: analysis.formulaCells,
            },
            conventions: analysis.conventions,
            declared_currency: input.declaredCurrency,
            observation_date: observationDate(),
            stable_reference_declared: input.stableReferenceDeclared,
            retain_file_requested: retainFile,
            staging_storage_path: storagePath,
            issues: analysis.issues,
          },
        },
      }),
      "ouverture de la session d'import",
    ) as string;

    await appendRows(sessionId, analysis);
    await stageInstruments(sessionId, analysis);
    unwrap(
      await db.rpc("lfo_finalize_portfolio_session", {
        p_user_id: user,
        p_payload: { session_id: sessionId, issues: analysis.issues },
      }),
      "finalisation de la session d'import",
    );

    if (input.rememberMapping && analysis.mappingConfidence === "CERTAIN") {
      // Le mapping n'est mémorisé que pour une SIGNATURE identique. « Presque le même
      // fichier » n'est pas le même : un export dont une colonne a changé de nom doit être
      // reconfirmé.
      unwrap(
        await db.rpc("lfo_save_import_mapping", {
          p_user_id: user,
          p_payload: {
            signature: formatSignature(analysis.headers, analysis.format),
            provider: sourceKey,
            label: `Portefeuille ${input.kind}`,
            headers: analysis.headers,
            mapping: analysis.mapping,
            conventions: analysis.conventions,
          },
        }),
        "mémorisation du mapping",
      );
    }

    return getPreview(sessionId);
  }

  /** Envoie les lignes par lots. Un échec au milieu d'un lot annule le lot entier. */
  async function appendRows(sessionId: string, analysis: PortfolioAnalysis): Promise<void> {
    const rawByRow = new Map(analysis.rawRows.map((row) => [row.rowNumber, row]));
    const payloads =
      analysis.kind === "PORTFOLIO_LEDGER"
        ? analysis.ledgerRows.map((row) => ledgerPayload(row, rawByRow, analysis))
        : analysis.positionRows.map((row) => positionPayload(row, rawByRow, analysis));

    for (let offset = 0; offset < payloads.length; offset += ROW_CHUNK) {
      unwrap(
        await db.rpc("lfo_append_portfolio_rows", {
          p_user_id: user,
          p_payload: { session_id: sessionId, rows: payloads.slice(offset, offset + ROW_CHUNK) },
        }),
        "réception des lignes d'import",
      );
    }
  }

  function securityIdFor(analysis: PortfolioAnalysis, sourceKey: string | null): string | null {
    if (sourceKey === null) return null;
    const resolution = analysis.instruments.find((entry) => entry.sourceKey === sourceKey);
    return resolution?.state === "RESOLVED" ? resolution.securityId : null;
  }

  function ledgerPayload(
    row: NormalizedLedgerRow,
    rawByRow: Map<number, { rowNumber: number; cells: string[]; rawLine: string }>,
    analysis: PortfolioAnalysis,
  ): Record<string, unknown> {
    const raw = rawByRow.get(row.rowNumber);
    return {
      row_number: row.rowNumber,
      raw_line: raw?.rawLine ?? "",
      cells: raw?.cells ?? [],
      fact_date: row.eventDate,
      settlement_date: row.settlementDate,
      event_type: row.eventType,
      security_id: securityIdFor(analysis, row.instrumentSourceKey),
      quantity: row.quantity,
      unit_price: row.unitPrice,
      gross_amount: row.grossAmount,
      fee_amount: row.feeAmount,
      tax_amount: row.taxAmount,
      envelope_cash_amount: row.envelopeCashAmount,
      currency: row.currency,
      instrument_source_key: row.instrumentSourceKey,
      source_isin: row.instrument.isin,
      source_ticker: row.instrument.ticker,
      source_instrument_name: row.instrument.name,
      external_reference: row.externalReference,
      label: row.label,
      status: row.status,
      dedupe_verdict: row.verdict,
      match_key: row.matchKey,
      external_key: row.externalKey,
      matched_event_id: row.matchedEventId,
      issues: row.issues,
      source: "Import portefeuille",
    };
  }

  function positionPayload(
    row: NormalizedPositionRow,
    rawByRow: Map<number, { rowNumber: number; cells: string[]; rawLine: string }>,
    analysis: PortfolioAnalysis,
  ): Record<string, unknown> {
    const raw = rawByRow.get(row.rowNumber);
    return {
      row_number: row.rowNumber,
      raw_line: raw?.rawLine ?? "",
      cells: raw?.cells ?? [],
      fact_date: row.asOfDate,
      security_id: securityIdFor(analysis, row.instrumentSourceKey),
      quantity: row.quantity,
      market_value: row.marketValue,
      cost_basis: row.costBasis,
      currency: row.currency,
      instrument_source_key: row.instrumentSourceKey,
      source_isin: row.instrument.isin,
      source_ticker: row.instrument.ticker,
      source_instrument_name: row.instrument.name,
      status: row.status,
      dedupe_verdict: row.verdict,
      match_key: row.matchKey,
      external_key: row.matchKey,
      matched_snapshot_id: row.matchedSnapshotId,
      issues: row.issues,
      source: "Import portefeuille",
    };
  }

  async function stageInstruments(sessionId: string, analysis: PortfolioAnalysis): Promise<void> {
    if (analysis.instruments.length === 0) return;
    unwrap(
      await db.rpc("lfo_stage_import_instruments", {
        p_user_id: user,
        p_payload: {
          session_id: sessionId,
          instruments: analysis.instruments.map((entry) => ({
            source_key: entry.sourceKey,
            source_isin: entry.key.isin,
            source_ticker: entry.key.ticker,
            source_name: entry.key.name,
            // `NOT_REQUIRED` n'existe pas en base : une nature sans instrument ne produit
            // aucune clé de source, donc aucune ligne ici.
            state:
              entry.state === "RESOLVED"
                ? "RESOLVED"
                : entry.state === "AMBIGUOUS"
                  ? "AMBIGUOUS"
                  : "CANDIDATE",
            security_id: entry.securityId,
            basis: { candidates: entry.candidates, issues: entry.issues },
          })),
        },
      }),
      "enregistrement des instruments rencontrés",
    );
  }

  async function loadExistingEvents(accountId: string) {
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>(
        "événements de portefeuille",
        async (from, to) => {
          const result = await db
            .from("portfolio_events")
            .select(
              "id, account_id, security_id, event_type, event_date, quantity, gross_amount, currency",
            )
            .eq("user_id", user)
            .eq("account_id", accountId)
            .order("event_date", { ascending: true })
            .range(from, to);
          return { data: result.data as Row[] | null, error: result.error };
        },
        { pageSize: LEDGER_PAGE_SIZE, maxPages: pagesFor(100_000) },
      ),
      "lecture du ledger existant",
    );
    return rows.map((row) => ({
      eventId: str(row.id),
      accountId: str(row.account_id),
      securityId: nullableStr(row.security_id),
      eventType: str(row.event_type),
      eventDate: str(row.event_date),
      quantity: nullableFiniteNumber(row.quantity, "portfolio_events.quantity"),
      grossAmount: nullableFiniteNumber(row.gross_amount, "portfolio_events.gross_amount"),
      currency: str(row.currency),
    }));
  }

  /**
   * Identités DÉJÀ DÉMONTRÉES, cherchées dans TOUT l'historique et sans filtre de date : une
   * identité déclarée stable vaut partout, là où une ressemblance se cherche dans une fenêtre.
   */
  async function loadExistingIdentities() {
    const rows = unwrap(
      await db
        .from("import_normalized_records")
        .select("external_key, portfolio_event_id")
        .eq("user_id", user)
        .eq("target_domain", "PORTFOLIO_LEDGER")
        .not("external_key", "is", null)
        .not("portfolio_event_id", "is", null)
        .limit(20_000),
      "lecture des identités déjà démontrées",
    ) as Row[];
    return rows.map((row) => ({
      externalKey: str(row.external_key),
      eventId: str(row.portfolio_event_id),
    }));
  }

  async function loadExistingPositions(accountId: string) {
    const rows = unwrap(
      await db
        .from("position_snapshots")
        .select("id, snapshot_date, positions!inner(id, account_id, security_id, user_id)")
        .eq("user_id", user)
        .eq("positions.account_id", accountId)
        .limit(20_000),
      "lecture des observations existantes",
    ) as Row[];
    return rows.flatMap((row) => {
      const position = row.positions as Row | null;
      if (position === null) return [];
      return [
        {
          snapshotId: str(row.id),
          accountId: str(position.account_id),
          securityId: str(position.security_id),
          asOfDate: str(row.snapshot_date),
        },
      ];
    });
  }

  async function resolveInstrument(
    input: Extract<PortfolioImportCommand, { action: "resolve-instrument" }>,
  ): Promise<PortfolioPreview> {
    const resolution = (
      unwrap(
        await db
          .from("import_instrument_resolutions")
          .select("id, session_id")
          .eq("user_id", user)
          .eq("id", input.resolutionId)
          .limit(1),
        "lecture de la résolution d'instrument",
      ) as Row[]
    )[0];
    if (resolution === undefined) throw new Error("Résolution d'instrument introuvable");

    unwrap(
      await db.rpc("lfo_resolve_import_instrument", {
        p_user_id: user,
        p_payload: {
          resolution_id: input.resolutionId,
          decision: input.decision,
          security_id: input.securityId,
          reason: input.reason,
        },
      }),
      "décision de rattachement d'instrument",
    );

    // Le statut des lignes est RECALCULÉ : rattacher un instrument peut débloquer des lignes,
    // l'écarter doit les bloquer. Laisser un statut périmé rendrait committable une ligne
    // dont l'instrument a été refusé.
    await refreshRowStatuses(str(resolution.session_id));
    return getPreview(str(resolution.session_id));
  }

  /**
   * Recalcule le statut des lignes d'une session selon l'état de résolution de leur
   * instrument. Ne touche à aucun autre motif de blocage : les anomalies de lecture restent
   * telles quelles, et une ligne bloquée pour une autre raison le reste.
   */
  async function refreshRowStatuses(sessionId: string): Promise<void> {
    const resolutions = unwrap(
      await db
        .from("import_instrument_resolutions")
        .select("source_key, state")
        .eq("user_id", user)
        .eq("session_id", sessionId),
      "lecture des résolutions de la session",
    ) as Row[];
    const stateByKey = new Map(resolutions.map((row) => [str(row.source_key), str(row.state)]));

    const rows = unwrap(
      await db
        .from("import_normalized_records")
        .select("id, status, issues, instrument_source_key, commit_state")
        .eq("user_id", user)
        .eq("session_id", sessionId)
        .eq("commit_state", "PENDING"),
      "lecture des lignes de la session",
    ) as Row[];

    for (const row of rows) {
      const key = nullableStr(row.instrument_source_key);
      if (key === null) continue;
      const state = stateByKey.get(key);
      if (state === undefined) continue;
      const issues = Array.isArray(row.issues) ? (row.issues as ImportIssue[]) : [];
      // Un blocage NON lié à l'instrument reste un blocage : on ne débloque que ce qu'on a
      // soi-même bloqué.
      const blockedForOtherReason = issues.some(
        (issue) => issue.severity === "ERROR" && issue.field !== "isin" && issue.field !== "ticker",
      );
      const nextStatus =
        state === "RESOLVED"
          ? blockedForOtherReason
            ? "BLOCKED"
            : issues.length > 0
              ? "WARNING"
              : "READY"
          : "BLOCKED";
      if (nextStatus === str(row.status)) continue;
      unwrap(
        await db.rpc("lfo_correct_portfolio_row", {
          p_user_id: user,
          p_payload: {
            record_id: str(row.id),
            status: nextStatus,
            reason: `Statut recalculé après décision sur l'instrument « ${key} »`,
            field_corrections: {
              status: { from: str(row.status), to: nextStatus, cause: "INSTRUMENT_DECISION" },
            },
          },
        }),
        "recalcul du statut de ligne",
      );
    }
  }

  async function correct(
    input: Extract<PortfolioImportCommand, { action: "correct" }>,
  ): Promise<PortfolioPreview> {
    const record = (
      unwrap(
        await db
          .from("import_normalized_records")
          .select(
            "id, session_id, status, event_type, transaction_date, quantity, unit_price, gross_amount, fee_amount, tax_amount, envelope_cash_amount, market_value, cost_basis, currency, label",
          )
          .eq("user_id", user)
          .eq("id", input.recordId)
          .limit(1),
        "lecture de la ligne à corriger",
      ) as Row[]
    )[0];
    if (record === undefined) throw new Error("Ligne d'import introuvable");

    // Provenance au niveau du CHAMP : pour chaque champ modifié, la valeur d'ORIGINE et la
    // valeur retenue. Sans le « from », une correction ne se relit pas.
    const corrections: Record<string, unknown> = {};
    const payload: Record<string, unknown> = { record_id: input.recordId, reason: input.reason };
    const columnOf: Record<string, string> = {
      factDate: "transaction_date",
      eventType: "event_type",
      quantity: "quantity",
      unitPrice: "unit_price",
      grossAmount: "gross_amount",
      feeAmount: "fee_amount",
      taxAmount: "tax_amount",
      envelopeCashAmount: "envelope_cash_amount",
      marketValue: "market_value",
      costBasis: "cost_basis",
      currency: "currency",
      label: "label",
    };
    const rpcKeyOf: Record<string, string> = {
      factDate: "fact_date",
      eventType: "event_type",
      quantity: "quantity",
      unitPrice: "unit_price",
      grossAmount: "gross_amount",
      feeAmount: "fee_amount",
      taxAmount: "tax_amount",
      envelopeCashAmount: "envelope_cash_amount",
      marketValue: "market_value",
      costBasis: "cost_basis",
      currency: "currency",
      label: "label",
    };

    for (const [field, value] of Object.entries(input.values)) {
      const column = columnOf[field];
      if (column === undefined) continue;
      corrections[field] = { from: nullableStr(record[column]), to: value };
      payload[rpcKeyOf[field]] = value;
    }
    if (Object.keys(corrections).length === 0) {
      throw new Error("Aucun champ corrigible fourni : une correction dit quel champ change");
    }
    payload.field_corrections = corrections;

    unwrap(
      await db.rpc("lfo_correct_portfolio_row", { p_user_id: user, p_payload: payload }),
      "correction de la ligne d'import",
    );
    return getPreview(str(record.session_id));
  }

  async function commit(
    input: Extract<PortfolioImportCommand, { action: "commit" }>,
  ): Promise<PortfolioCommitResult> {
    const written = unwrap(
      await db.rpc("lfo_commit_portfolio_session", {
        p_user_id: user,
        p_payload: {
          session_id: input.sessionId,
          record_ids: input.recordIds,
          // DÉCISIONS de correction d'observations déjà persistées. Vide par défaut : la RPC
          // refuse alors le remplacement et nomme ce qui change.
          //
          // Chaque décision porte son motif, son auteur déclaré et l'état qu'elle CROIT
          // corriger. La base compare cet état attendu à l'état réellement persisté, sous
          // verrou : deux sessions décidant de la même observation ne s'écrasent plus, la
          // seconde échoue avec un conflit révisable.
          //
          // Les montants attendus repartent VERBATIM tels que la prévisualisation les a lus
          // en texte : les reformater ici fabriquerait un conflit, ou en masquerait un.
          //
          // AUCUNE clé d'acteur n'est transmise. La RPC pose `actor_user_id` depuis
          // `p_user_id`, c'est-à-dire depuis `ownerId()` — l'UUID Supabase Auth lu de
          // l'environnement SERVEUR, derrière une session authentifiée. L'identité ne
          // traverse donc jamais le navigateur, et la base REFUSE toute clé d'acteur
          // présente dans la charge.
          corrections: input.corrections.map((decision) => ({
            record_id: decision.recordId,
            reason: decision.reason,
            expected: {
              snapshot_id: decision.expected.snapshotId,
              quantity: decision.expected.quantity,
              cost_basis: decision.expected.costBasis,
              market_value: decision.expected.marketValue,
              currency: decision.expected.currency,
            },
          })),
        },
      }),
      "validation de la session d'import",
    ) as number;

    const preview = await getPreview(input.sessionId);
    return { sessionId: input.sessionId, written: Number(written), session: preview.session };
  }

  async function discard(sessionId: string): Promise<void> {
    unwrap(
      await db.rpc("lfo_discard_import_session", { p_user_id: user, p_session_id: sessionId }),
      "abandon de la session d'import",
    );
  }

  function sessionSummary(row: Row, accountName: string): PortfolioSessionSummary {
    return {
      sessionId: str(row.id),
      sourceId: str(row.source_id),
      kind: str(row.target_domain ?? row.domain) as PortfolioSessionSummary["kind"],
      accountId: str(row.account_id ?? row.target_account_id),
      accountName,
      fileName: nullableStr(row.file_name),
      fileHash: nullableStr(row.file_hash),
      format: ((row.mapping ?? {}) as Row).format === "XLSX" ? "XLSX" : "CSV",
      parser: str(row.parser),
      parserVersion: str(row.parser_version),
      status: str(row.status) as PortfolioSessionSummary["status"],
      counts: {
        total: Number(row.row_count ?? 0),
        ready: Number(row.ready_count ?? 0),
        warning: Number(row.warning_count ?? 0),
        blocked: Number(row.blocked_count ?? 0),
        duplicate: Number(row.duplicate_count ?? 0),
        ignored: 0,
      },
      committedCount: Number(row.committed_count ?? 0),
      declaredCurrency: nullableStr(row.declared_currency),
      stableReferenceDeclared: Boolean(row.stable_transaction_id_declared),
      analyzedAt: nullableStr(row.analyzed_at),
      committedAt: nullableStr(row.committed_at),
      issues: Array.isArray(row.issues) ? (row.issues as ImportIssue[]) : [],
    };
  }

  /**
   * Clé d'une observation : une détention (enveloppe + instrument) à une DATE.
   *
   * L'enveloppe est celle de la session, donc constante : la clé n'a besoin que de
   * l'instrument et de la date.
   */
  function observationKey(securityId: string, snapshotDate: string): string {
    return `${securityId}\u0000${snapshotDate}`;
  }

  /**
   * Lit, pour les lignes de POSITION d'une session, l'observation déjà persistée à la même
   * date pour la même détention.
   *
   * Deux lectures, jamais une par ligne : les détentions de l'enveloppe, puis les
   * observations de ces détentions aux dates concernées.
   *
   * LES MONTANTS SONT LUS EN TEXTE (`::text`). C'est la clé du contrat de concurrence : ce
   * texte est renvoyé verbatim par la décision comme état attendu, et un aller-retour par un
   * nombre JavaScript perdrait de la précision sur un `numeric(30,10)`.
   */
  async function readExistingObservations(
    accountId: string,
    rows: readonly Row[],
  ): Promise<Map<string, { snapshotId: string; snapshotDate: string; observed: Row }>> {
    const result = new Map<string, { snapshotId: string; snapshotDate: string; observed: Row }>();

    const securityIds = [
      ...new Set(
        rows.map((row) => nullableStr(row.security_id)).filter((id): id is string => id !== null),
      ),
    ];
    const dates = [
      ...new Set(
        rows
          .map((row) => nullableStr(row.transaction_date))
          .filter((date): date is string => date !== null),
      ),
    ];
    if (securityIds.length === 0 || dates.length === 0) return result;

    const positions = unwrap(
      await db
        .from("positions")
        .select("id, security_id")
        .eq("user_id", user)
        .eq("account_id", accountId)
        .in("security_id", securityIds),
      "lecture des détentions de l'enveloppe",
    ) as Row[];
    if (positions.length === 0) return result;

    const securityByPosition = new Map<string, string>();
    for (const position of positions) {
      securityByPosition.set(str(position.id), str(position.security_id));
    }

    const snapshots = unwrap(
      await db
        .from("position_snapshots")
        .select(
          // `::text` DÉLIBÉRÉ : c'est ce texte que la décision renvoie comme état attendu.
          "id, position_id, snapshot_date, quantity::text, cost_basis::text, market_value::text, currency",
        )
        .eq("user_id", user)
        .in("position_id", [...securityByPosition.keys()])
        .in("snapshot_date", dates),
      "lecture des observations déjà persistées",
    ) as Row[];

    for (const snapshot of snapshots) {
      const securityId = securityByPosition.get(str(snapshot.position_id));
      if (securityId === undefined) continue;
      const snapshotDate = str(snapshot.snapshot_date);
      result.set(observationKey(securityId, snapshotDate), {
        snapshotId: str(snapshot.id),
        snapshotDate,
        observed: snapshot,
      });
    }
    return result;
  }

  /**
   * Projette l'observation déjà persistée d'une ligne, et dit ce qui CHANGERAIT.
   *
   * `state` est INDICATIF : cette lecture n'est pas sous verrou. C'est sans danger et c'est
   * le contrat — la décision transmet `observed` comme état attendu, la base le compare sous
   * verrou, et une divergence produit un conflit révisable, jamais un écrasement. Une
   * prévisualisation périmée fait échouer, elle ne fait pas perdre un fait.
   */
  function existingObservationFor(
    row: Row,
    existing: Map<string, { snapshotId: string; snapshotDate: string; observed: Row }>,
  ): PortfolioExistingObservation | null {
    const securityId = nullableStr(row.security_id);
    const factDate = nullableStr(row.transaction_date);
    if (securityId === null || factDate === null) return null;
    const found = existing.get(observationKey(securityId, factDate));
    if (found === undefined) return null;

    const observed: PortfolioObservedValues = {
      snapshotId: found.snapshotId,
      quantity: nullableStr(found.observed.quantity),
      costBasis: nullableStr(found.observed.cost_basis),
      marketValue: nullableStr(found.observed.market_value),
      currency: str(found.observed.currency),
    };

    // Les valeurs de staging sont comparées EN TEXTE elles aussi, pour ne pas comparer un
    // nombre JavaScript à un `numeric`. La règle est portée par `observed-amounts.ts`, où
    // elle est testée : `1810.000000` et `1810` sont le même nombre, et `null` n'est pas zéro.
    const changedFields = changedObservedFields(observed, {
      quantity: nullableStr(row.quantity),
      costBasis: nullableStr(row.cost_basis),
      marketValue: nullableStr(row.market_value),
      currency: nullableStr(row.currency),
    });

    return {
      observed,
      snapshotDate: found.snapshotDate,
      state: changedFields.length === 0 ? "IDENTICAL" : "DIFFERENT",
      changedFields,
    };
  }

  async function getPreview(sessionId: string): Promise<PortfolioPreview> {
    const session = (
      unwrap(
        await db
          .from("import_sessions")
          .select("*, import_sources!inner(id, domain, target_account_id, provider)")
          .eq("user_id", user)
          .eq("id", sessionId)
          .limit(1),
        "lecture de la session d'import",
      ) as Row[]
    )[0];
    if (session === undefined) throw new Error("Session d'import introuvable");
    const source = session.import_sources as Row;

    const account = (
      unwrap(
        await db
          .from("financial_accounts")
          .select("id, name")
          .eq("user_id", user)
          .eq("id", str(source.target_account_id))
          .limit(1),
        "lecture de l'enveloppe de la session",
      ) as Row[]
    )[0];

    const rows = unwrap(
      await db
        .from("import_normalized_records")
        .select("*, import_raw_records!inner(row_number, raw_line), securities(name)")
        .eq("user_id", user)
        .eq("session_id", sessionId)
        .order("id", { ascending: true })
        .limit(PREVIEW_ROW_LIMIT + 1),
      "lecture des lignes de la session",
    ) as Row[];

    const resolutions = unwrap(
      await db
        .from("import_instrument_resolutions")
        .select("*")
        .eq("user_id", user)
        .eq("session_id", sessionId)
        .order("source_key", { ascending: true }),
      "lecture des résolutions d'instrument",
    ) as Row[];

    // Observations DÉJÀ persistées, uniquement pour une session de POSITION : un événement
    // de ledger n'écrase aucune observation, et interroger la table serait un aller-retour
    // sans objet.
    const existing =
      str(source.domain) === "PORTFOLIO_POSITION"
        ? await readExistingObservations(str(source.target_account_id), rows)
        : new Map<string, { snapshotId: string; snapshotDate: string; observed: Row }>();

    const rowCountByKey = new Map<string, number>();
    for (const row of rows) {
      const key = nullableStr(row.instrument_source_key);
      if (key === null) continue;
      rowCountByKey.set(key, (rowCountByKey.get(key) ?? 0) + 1);
    }

    const instruments: InstrumentResolutionView[] = resolutions.map((row) => {
      const basis = (row.basis ?? {}) as Row;
      const candidates = Array.isArray(basis.candidates)
        ? (basis.candidates as InstrumentResolutionView["candidates"])
        : [];
      return {
        id: str(row.id),
        sourceKey: str(row.source_key),
        sourceIsin: nullableStr(row.source_isin),
        sourceTicker: nullableStr(row.source_ticker),
        sourceName: nullableStr(row.source_name),
        state: str(row.state) as InstrumentResolutionView["state"],
        securityId: nullableStr(row.security_id),
        candidates,
        decidedAt: nullableStr(row.decided_at),
        decidedReason: nullableStr(row.decided_reason),
        rowCount: rowCountByKey.get(str(row.source_key)) ?? 0,
      };
    });

    const previewRows: PortfolioPreviewRow[] = rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => {
      const raw = row.import_raw_records as Row;
      const security = row.securities as Row | null;
      return {
        recordId: str(row.id),
        rowNumber: Number(raw.row_number ?? 0),
        rawLine: str(raw.raw_line),
        status: str(row.status) as PortfolioPreviewRow["status"],
        verdict: nullableStr(row.dedupe_verdict) as PortfolioPreviewRow["verdict"],
        eventType: nullableStr(row.event_type) as PortfolioPreviewRow["eventType"],
        factDate: nullableStr(row.transaction_date),
        settlementDate: nullableStr(row.settlement_date),
        instrumentSourceKey: nullableStr(row.instrument_source_key),
        sourceIsin: nullableStr(row.source_isin),
        sourceTicker: nullableStr(row.source_ticker),
        sourceInstrumentName: nullableStr(row.source_instrument_name),
        securityId: nullableStr(row.security_id),
        securityName: security === null ? null : nullableStr(security.name),
        quantity: nullableFiniteNumber(row.quantity, "records.quantity"),
        unitPrice: nullableFiniteNumber(row.unit_price, "records.unit_price"),
        grossAmount: nullableFiniteNumber(row.gross_amount, "records.gross_amount"),
        feeAmount: nullableFiniteNumber(row.fee_amount, "records.fee_amount"),
        taxAmount: nullableFiniteNumber(row.tax_amount, "records.tax_amount"),
        envelopeCashAmount: nullableFiniteNumber(
          row.envelope_cash_amount,
          "records.envelope_cash_amount",
        ),
        marketValue: nullableFiniteNumber(row.market_value, "records.market_value"),
        costBasis: nullableFiniteNumber(row.cost_basis, "records.cost_basis"),
        currency: nullableStr(row.currency),
        externalReference: nullableStr(row.external_transaction_id),
        label: nullableStr(row.label),
        fieldCorrections: (row.field_corrections ?? null) as Record<string, unknown> | null,
        correctedAt: nullableStr(row.corrected_at),
        correctionReason: nullableStr(row.correction_reason),
        portfolioEventId: nullableStr(row.portfolio_event_id),
        positionSnapshotId: nullableStr(row.position_snapshot_id),
        commitState: str(row.commit_state) as PortfolioPreviewRow["commitState"],
        existingObservation: existingObservationFor(row, existing),
        issues: Array.isArray(row.issues) ? (row.issues as ImportIssue[]) : [],
      };
    });

    // Contrat de lecture tel qu'il a été persisté à l'analyse.
    const envelope = (session.mapping ?? {}) as Row;
    const mapping = (envelope.fields ?? {}) as PortfolioPreview["mapping"];
    const conventions = (session.conventions ?? {
      amount: "AMBIGUOUS",
      date: "AMBIGUOUS",
      valueDate: null,
    }) as PortfolioPreview["conventions"];

    return {
      session: sessionSummary(
        { ...session, target_domain: source.domain, account_id: source.target_account_id },
        str(account?.name ?? ""),
      ),
      headers: Array.isArray(envelope.headers) ? (envelope.headers as string[]) : [],
      mapping,
      mappingConfidence:
        (nullableStr(envelope.confidence) as PortfolioPreview["mappingConfidence"] | null) ??
        "CERTAIN",
      conventions,
      sheetName: nullableStr(envelope.sheet_name),
      otherSheets: Array.isArray(envelope.other_sheets) ? (envelope.other_sheets as string[]) : [],
      formulaCells: Array.isArray(envelope.formula_cells)
        ? (envelope.formula_cells as string[])
        : [],
      instruments,
      rows: previewRows,
      rowsTruncated: rows.length > PREVIEW_ROW_LIMIT,
      issues: Array.isArray(session.issues) ? (session.issues as ImportIssue[]) : [],
    };
  }

  async function listSessions(accountId?: string): Promise<PortfolioSessionSummary[]> {
    let query = db
      .from("import_sessions")
      .select("*, import_sources!inner(id, domain, target_account_id)")
      .eq("user_id", user)
      .in("import_sources.domain", ["PORTFOLIO_LEDGER", "PORTFOLIO_POSITION"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (accountId !== undefined) {
      query = query.eq("import_sources.target_account_id", accountId);
    }
    const rows = unwrap(await query, "lecture des sessions d'import de portefeuille") as Row[];

    const accountIds = [
      ...new Set(rows.map((row) => str((row.import_sources as Row).target_account_id))),
    ];
    const accounts =
      accountIds.length === 0
        ? []
        : (unwrap(
            await db
              .from("financial_accounts")
              .select("id, name")
              .eq("user_id", user)
              .in("id", accountIds),
            "lecture des enveloppes",
          ) as Row[]);
    const nameById = new Map(accounts.map((row) => [str(row.id), str(row.name)]));

    return rows.map((row) => {
      const source = row.import_sources as Row;
      return sessionSummary(
        { ...row, target_domain: source.domain, account_id: source.target_account_id },
        nameById.get(str(source.target_account_id)) ?? "",
      );
    });
  }

  return {
    adapter: "supabase",
    issueUploadTicket,
    analyze,
    resolveInstrument,
    correct,
    commit,
    discard,
    getPreview,
    listSessions,
  };
}

let cached: PortfolioImportRepository | undefined;

export function getPortfolioImportRepository(): PortfolioImportRepository {
  if (!cached) cached = createPortfolioImportRepository();
  return cached;
}

export { MAX_PORTFOLIO_ROWS, detectFormat, instrumentSourceKey };
