import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import { civilDateIn, resolveTimeZone } from "@/lib/acquisition/clock";
import type { ImportIssue, ImportRowStatus } from "@/lib/acquisition/types";
import {
  analyzeFec,
  BALANCE_TOLERANCE,
  buildStatementCandidate,
  MAX_FEC_LINES,
  toBusinessFinancialCandidate,
  type BusinessFinancialImportCandidate,
  type FecAnalysis,
  type FecBalanceLine,
  type FecCoverage,
  type FecStatementCandidate,
} from "@/lib/acquisition/fec";
import type { PcgGroup } from "@/lib/acquisition/fec/pcg";
import type {
  FecAnalyzeRequest,
  FecCommitResult,
  FecDocumentStatus,
  FecPreview,
  FecPreviewLine,
  FecUploadTicket,
} from "@/lib/data/fec-contracts";
import { MAX_FEC_FILE_BYTES, MAX_RETAINED_FEC_FILE_BYTES } from "@/lib/validation/fec-imports";
import type { ImportFileInput } from "@/lib/data/import-repository";
import { readAllPages } from "@/lib/data/pagination";
import { finiteNumber, nullableFiniteNumber } from "@/lib/data/row-validation";
import { DOCUMENTS_BUCKET, ownerId, supabaseAdmin } from "@/lib/data/supabase-client";

type Row = Record<string, unknown>;

const PARSER = "fec";
const PARSER_VERSION = "1";
const PROVIDER = "FEC_FR";
const ADAPTER_VERSION = `${PARSER}/${PARSER_VERSION}`;

/** Le format réglementaire est un fichier texte à plat. */
const FEC_CONTENT_TYPE = "text/plain";

/**
 * Durée de vie d'un billet d'upload. Assez longue pour déposer un fichier de plusieurs
 * dizaines de mégaoctets sur une connexion médiocre, assez courte pour qu'un billet oublié
 * ne reste pas une porte ouverte.
 */
const UPLOAD_TICKET_TTL_MINUTES = 30;

/**
 * Taille d'un lot de réception.
 *
 * Un FEC d'exercice complet dépasse largement ce qu'un appel RPC unique peut transporter en
 * jsonb. Le lot est la seule concession faite au volume, et il ne change rien à la
 * sémantique : chaque écriture reste rattachée à SA ligne brute par son numéro de ligne.
 */
const APPEND_CHUNK = 2_000;

/** Plafond d'AFFICHAGE des écritures. Le staging en contient toujours l'intégralité. */
const PREVIEW_LINE_LIMIT = 300;

/**
 * Date à laquelle l'import est réellement effectué. DÉLIBÉRÉMENT distincte de `AS_OF_DATE`,
 * et civile dans le fuseau du produit — même doctrine que l'import bancaire.
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

/**
 * Charge de la RPC Business, en clés canoniques.
 *
 * Les noms sont EXACTEMENT ceux que `lfo_record_business_financials` attend : le fait est
 * écrit par la RPC existante, et par elle seule. Un second chemin d'écriture sur
 * `business_financials` serait une seconde vérité sur la même table.
 */
function financialsPayload(
  candidate: BusinessFinancialImportCandidate,
  sessionId: string,
): Record<string, unknown> {
  return {
    period_end: candidate.periodEnd,
    period_start: candidate.periodStart,
    period_kind: candidate.periodKind,
    period_label: `Exercice ${candidate.periodEnd.slice(0, 4)} (FEC)`,
    revenue: candidate.revenue,
    gross_profit: candidate.grossProfit,
    ebitda: candidate.ebitda,
    ebit: candidate.ebit,
    net_income: candidate.netIncome,
    cash: candidate.cash,
    gross_debt: candidate.grossDebt,
    working_capital: candidate.workingCapital,
    capex: candidate.capex,
    free_cash_flow: candidate.freeCashFlow,
    depreciation_amortisation: candidate.depreciationAmortisation,
    interest_expense: candidate.interestExpense,
    tax_expense: candidate.taxExpense,
    currency: candidate.currency,
    // Observé dans la comptabilité de la société, pas supposé par LFO.
    data_kind: "ACTUAL",
    confidence: "HIGH",
    source: `Import FEC ${sessionId}`,
    notes: "Reconstruit depuis un fichier des écritures comptables. Aucun retraitement normatif.",
  };
}

/**
 * Dépôt de l'acquisition comptable.
 *
 * Volontairement SÉPARÉ de `FamilyOfficeRepository`, comme l'import bancaire : le staging
 * d'un FEC est volumineux et ne concerne aucun écran financier.
 */
export interface FecRepository {
  readonly adapter: "supabase";
  /**
   * Émet un billet d'upload : le navigateur déposera le fichier DIRECTEMENT au stockage
   * privé, et la route d'analyse n'en recevra qu'une référence.
   */
  issueUploadTicket(input: {
    fileName: string;
    byteSize: number;
    retainFile: boolean;
  }): Promise<FecUploadTicket>;
  /** Analyse le fichier déjà déposé, désigné par son billet. Aucun contenu ne transite. */
  analyze(request: FecAnalyzeRequest): Promise<FecPreview>;
  /**
   * Valide une session. Le fichier n'est PAS retransmis : quand la session a demandé sa
   * conservation, le serveur le reprend depuis l'objet de staging qu'il a lui-même écrit.
   */
  commit(sessionId: string): Promise<FecCommitResult>;
  discard(sessionId: string): Promise<string>;
  getSessionLines(sessionId: string): Promise<FecPreviewLine[]>;
}

export function createFecRepository(): FecRepository {
  const db = supabaseAdmin();
  const user = ownerId();

  async function businessOf(businessId: string): Promise<{ id: string; name: string }> {
    const rows = unwrap(
      await db
        .from("businesses")
        .select("id, name, archived")
        .eq("user_id", user)
        .eq("id", businessId),
      "lecture de la société cible",
    ) as Row[];
    const row = rows[0];
    if (!row) throw new Error("Société cible introuvable");
    if (row.archived === true) throw new Error("Société cible archivée");
    return { id: str(row.id), name: str(row.name) };
  }

  /** Charge d'une écriture pour la RPC de réception. Les 18 champs, en clés canoniques. */
  function linePayload(line: FecAnalysis["lines"][number]): Record<string, unknown> {
    return {
      journal_code: line.journalCode ?? "",
      journal_lib: line.journalLabel,
      entry_num: line.entryNumber ?? "",
      entry_date: line.entryDate,
      account_num: line.accountNumber ?? "",
      account_lib: line.accountLabel,
      aux_account_num: line.auxAccountNumber,
      aux_account_lib: line.auxAccountLabel,
      piece_ref: line.pieceReference,
      piece_date: line.pieceDate,
      entry_label: line.entryLabel,
      debit: line.debit,
      credit: line.credit,
      lettering_code: line.letterCode,
      lettering_date: line.letterDate,
      validation_date: line.validationDate,
      currency_amount: line.currencyAmount,
      currency_code: line.currencyCode,
      pcg_class: line.pcgClass,
      pcg_group: line.pcgGroup,
      status: line.status,
      issues: line.issues,
    };
  }

  /**
   * Billet d'upload. Le chemin est calculé par la RPC à partir du propriétaire et de
   * l'identifiant du billet ; l'URL signée n'autorise qu'un dépôt, à ce chemin, et expire.
   */
  async function issueUploadTicket(input: {
    fileName: string;
    byteSize: number;
    retainFile: boolean;
  }): Promise<FecUploadTicket> {
    const ticketId = unwrap(
      await db.rpc("lfo_issue_import_upload_ticket", {
        p_user_id: user,
        p_payload: {
          domain: "BUSINESS_ACCOUNTING",
          file_name: input.fileName.slice(0, 240),
          content_type: FEC_CONTENT_TYPE,
          byte_size: input.byteSize,
          ttl_minutes: UPLOAD_TICKET_TTL_MINUTES,
        },
      }),
      "émission du billet d'upload",
    ) as string;

    const rows = unwrap(
      await db
        .from("import_upload_tickets")
        .select("storage_path, expires_at")
        .eq("user_id", user)
        .eq("id", ticketId),
      "lecture du billet d'upload",
    ) as Row[];
    const ticket = rows[0];
    if (!ticket) throw new Error("Billet d'upload introuvable après émission");
    const storagePath = str(ticket.storage_path);

    const signed = await db.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(storagePath);
    if (signed.error || !signed.data) {
      throw new Error(`Supabase URL de dépôt : ${signed.error?.message ?? "réponse vide"}`);
    }

    return {
      ticketId,
      uploadUrl: signed.data.signedUrl,
      storagePath,
      expiresAt: str(ticket.expires_at),
      retainable: input.byteSize <= MAX_RETAINED_FEC_FILE_BYTES,
    };
  }

  /**
   * Reprend l'objet de staging désigné par un billet.
   *
   * Le chemin vient de la BASE, jamais de la requête. Le billet est consommé d'abord : à
   * usage unique, sous verrou de ligne, de sorte que deux analyses simultanées du même
   * dépôt ne puissent pas conclure toutes les deux qu'il est libre.
   */
  async function claimStagedFile(
    ticketId: string,
  ): Promise<{ storagePath: string; fileName: string; bytes: Uint8Array }> {
    unwrap(
      await db.rpc("lfo_consume_import_upload_ticket", {
        p_user_id: user,
        p_ticket_id: ticketId,
      }),
      "consommation du billet d'upload",
    );

    const rows = unwrap(
      await db
        .from("import_upload_tickets")
        .select("storage_path, file_name, byte_size")
        .eq("user_id", user)
        .eq("id", ticketId),
      "lecture du billet d'upload",
    ) as Row[];
    const ticket = rows[0];
    if (!ticket) throw new Error("Billet d'upload introuvable");

    const storagePath = str(ticket.storage_path);
    const downloaded = await db.storage.from(DOCUMENTS_BUCKET).download(storagePath);
    if (downloaded.error || !downloaded.data) {
      throw new Error(
        `Fichier de staging introuvable : le dépôt n'a peut-être pas abouti (${
          downloaded.error?.message ?? "réponse vide"
        }).`,
      );
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());

    // La taille annoncée à l'émission du billet et la taille RÉELLE de l'objet déposé
    // doivent coïncider : une déclaration n'est pas une mesure, et c'est la seconde qui
    // décide de ce qui est analysable et de ce qui est archivable.
    const declared = finiteNumber(ticket.byte_size, "import_upload_tickets.byte_size");
    if (bytes.byteLength !== declared) {
      throw new Error(
        `Le fichier déposé pèse ${bytes.byteLength} octets, ${declared} avaient été annoncés. Redéposez-le.`,
      );
    }
    if (bytes.byteLength > MAX_FEC_FILE_BYTES) {
      throw new Error(`Fichier supérieur à ${MAX_FEC_FILE_BYTES / (1024 * 1024)} Mo.`);
    }

    return { storagePath, fileName: str(ticket.file_name) || "fec.txt", bytes };
  }

  /** Supprime un objet de staging. Un échec ne remet en cause aucun fait écrit. */
  async function dropStagedFile(storagePath: string): Promise<void> {
    await db.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  }

  async function analyze(request: FecAnalyzeRequest): Promise<FecPreview> {
    const business = await businessOf(request.businessId);
    const staged = await claimStagedFile(request.uploadTicketId);
    const file: ImportFileInput = {
      name: staged.fileName,
      contentType: FEC_CONTENT_TYPE,
      size: staged.bytes.byteLength,
      bytes: staged.bytes,
    };
    // L'empreinte est calculée par le SERVEUR sur le contenu réellement déposé. Une
    // empreinte fournie par le client ne prouverait rien de ce que le stockage contient.
    const fileHash = createHash("sha256").update(file.bytes).digest("hex");
    const coverage: FecCoverage = request.coverageDeclared ? "DECLARED_COMPLETE" : "OBSERVED_ONLY";

    // Lecture PURE du fichier : aucun accès base, aucune horloge.
    const analysis = analyzeFec({
      bytes: file.bytes,
      currency: request.currency,
      coverage,
      fiscalYear:
        request.fiscalYearStart && request.fiscalYearEnd
          ? { start: request.fiscalYearStart, end: request.fiscalYearEnd }
          : null,
      maxLines: MAX_FEC_LINES,
    });

    const sessionId = unwrap(
      await db.rpc("lfo_open_fec_session", {
        p_user_id: user,
        p_payload: {
          source: {
            kind: "FILE_CSV",
            provider: PROVIDER,
            label: `FEC — ${business.name}`,
            target_business_id: business.id,
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
            conventions: analysis.fieldPositions,
            declared_currency: request.currency,
            observation_date: observationDate(),
            retain_file_requested: request.retainFile,
            fiscal_year_start: request.fiscalYearStart,
            fiscal_year_end: request.fiscalYearEnd,
            coverage_declared: request.coverageDeclared,
            staging_storage_path: staged.storagePath,
            upload_ticket_id: request.uploadTicketId,
            declared_period_start: request.fiscalYearStart,
            declared_period_end: request.fiscalYearEnd,
            issues: analysis.issues,
          },
        },
      }),
      "ouverture de session comptable",
    ) as string;

    // Réception par lots. Le brut et son écriture lue voyagent ensemble : c'est ce
    // rattachement qui rend la provenance traçable jusqu'à la cellule.
    const linesByRow = new Map(analysis.lines.map((line) => [line.rowNumber, line]));
    for (let offset = 0; offset < analysis.rawRows.length; offset += APPEND_CHUNK) {
      const slice = analysis.rawRows.slice(offset, offset + APPEND_CHUNK);
      unwrap(
        await db.rpc("lfo_append_fec_lines", {
          p_user_id: user,
          p_payload: {
            session_id: sessionId,
            rows: slice.map((row) => {
              const line = linesByRow.get(row.rowNumber);
              return {
                row_number: row.rowNumber,
                raw_line: row.rawLine,
                cells: row.cells,
                line: line ? linePayload(line) : null,
              };
            }),
          },
        }),
        "réception des écritures",
      );
    }

    unwrap(
      await db.rpc("lfo_finalize_fec_session", {
        p_user_id: user,
        p_payload: {
          session_id: sessionId,
          issues: analysis.issues,
          entry_count: analysis.counts.entries,
          unbalanced_entry_count: analysis.counts.unbalancedEntries,
        },
      }),
      "clôture de la réception",
    );

    const sessionRows = unwrap(
      await db.from("import_sessions").select("source_id").eq("user_id", user).eq("id", sessionId),
      "lecture de la session comptable",
    ) as Row[];

    // Le brut et les écritures sont persistés : l'objet de staging n'a plus de raison
    // d'exister quand l'utilisateur n'a pas demandé la conservation. Le supprimer ici plutôt
    // que « plus tard » évite un coffre qui accumule des copies dont personne ne veut.
    if (!request.retainFile) {
      await dropStagedFile(staged.storagePath);
      unwrap(
        await db.rpc("lfo_clear_import_staging_path", {
          p_user_id: user,
          p_session_id: sessionId,
        }),
        "oubli du chemin de staging",
      );
    }

    const lines = await getSessionLines(sessionId);
    const candidate = toBusinessFinancialCandidate(analysis.statement);

    return {
      sessionId,
      sourceId: sessionRows[0] ? str(sessionRows[0].source_id) : "",
      businessId: business.id,
      businessName: business.name,
      fileName: file.name,
      fileHash,
      encoding: analysis.encoding,
      delimiter: analysis.delimiter,
      headers: analysis.headers,
      unknownHeaders: analysis.unknownHeaders,
      signature: analysis.signature,
      currency: request.currency,
      coverage,
      counts: analysis.counts,
      issues: analysis.issues,
      observedPeriod: analysis.observedPeriod,
      currencies: analysis.currencies,
      statement: analysis.statement,
      candidate,
      lines: lines.slice(0, PREVIEW_LINE_LIMIT),
      linesTruncated: lines.length > PREVIEW_LINE_LIMIT,
    };
  }

  /**
   * Reconstruit l'état financier depuis les écritures PERSISTÉES.
   *
   * C'est délibérément une seconde lecture, et non la réutilisation du candidat calculé à
   * l'analyse : le fait canonique doit dériver de ce que la base contient, pas d'une charge
   * fournie par le client. Sans cela, une requête forgée pourrait écrire un chiffre
   * d'affaires qu'aucune écriture ne porte.
   */
  async function rebuildStatement(sessionId: string): Promise<FecStatementCandidate> {
    const sessionRows = unwrap(
      await db
        .from("import_sessions")
        .select(
          "coverage_declared, declared_currency, fiscal_year_start, fiscal_year_end, observed_period_start, observed_period_end",
        )
        .eq("user_id", user)
        .eq("id", sessionId),
      "lecture de la session comptable",
    ) as Row[];
    const session = sessionRows[0];
    if (!session) throw new Error("Session d'import introuvable");

    const currency = nullableStr(session.declared_currency);
    if (!currency) throw new Error("Session comptable sans devise de tenue déclarée");

    const rows = unwrap(
      await readAllPages<Row, PostgrestError>(
        `écritures persistées de la session ${sessionId}`,
        async (from, to) => {
          const result = await db
            .from("fec_entry_lines")
            .select(
              "status, pcg_group, debit, credit, account_num, currency_code, journal_code, entry_num, entry_date",
            )
            .eq("user_id", user)
            .eq("session_id", sessionId)
            .order("id", { ascending: true })
            .range(from, to);
          return { data: (result.data ?? null) as Row[] | null, error: result.error };
        },
      ),
      "lecture des écritures persistées",
    );

    const fiscalYearStart = nullableStr(session.fiscal_year_start);
    const fiscalYearEnd = nullableStr(session.fiscal_year_end);
    const currencies = new Set<string>();

    // Partie double et écritures hors période sont RE-DÉRIVÉES des lignes persistées, et
    // non relues sur les décomptes de la session. Ces colonnes restent un fait d'audit
    // utile à l'affichage, mais elles sont modifiables : un fait canonique ne doit pas en
    // dépendre. La base pose le même contrôle de son côté, dans `lfo_commit_fec_session`.
    const balanceByEntry = new Map<string, number>();
    let outOfFiscalYear = 0;

    const lines: FecBalanceLine[] = rows.map((row) => {
      const code = nullableStr(row.currency_code);
      if (code) currencies.add(code);
      const status = str(row.status) as ImportRowStatus;
      const debit = nullableFiniteNumber(row.debit, "fec_entry_lines.debit");
      const credit = nullableFiniteNumber(row.credit, "fec_entry_lines.credit");
      const entryDate = nullableStr(row.entry_date);

      if (status !== "BLOCKED" && status !== "IGNORED") {
        const key = `${str(row.journal_code)}|${str(row.entry_num)}`;
        balanceByEntry.set(key, (balanceByEntry.get(key) ?? 0) + (debit ?? 0) - (credit ?? 0));
        if (
          entryDate !== null &&
          fiscalYearStart !== null &&
          fiscalYearEnd !== null &&
          (entryDate < fiscalYearStart || entryDate > fiscalYearEnd)
        ) {
          outOfFiscalYear += 1;
        }
      }

      return {
        status,
        pcgGroup: str(row.pcg_group) as PcgGroup,
        debit,
        credit,
        accountNumber: nullableStr(row.account_num),
      };
    });

    const unbalancedEntries = [...balanceByEntry.values()].filter(
      (imbalance) => Math.abs(imbalance) > BALANCE_TOLERANCE,
    ).length;

    return buildStatementCandidate({
      lines,
      coverage: session.coverage_declared === true ? "DECLARED_COMPLETE" : "OBSERVED_ONLY",
      currency,
      periodStart: fiscalYearStart ?? nullableStr(session.observed_period_start),
      periodEnd: fiscalYearEnd ?? nullableStr(session.observed_period_end),
      unbalancedEntries,
      outOfFiscalYear,
      currencies: [...currencies],
    });
  }

  /**
   * Conservation du fichier, APRÈS l'écriture du fait. Chemin content-addressed identique à
   * celui de l'import bancaire : le chemin dérive du contenu, donc un même fichier ne peut
   * pas produire deux objets.
   */
  async function retainSessionFile(
    sessionId: string,
    fileHash: string,
    file: ImportFileInput,
  ): Promise<void> {
    const storagePath = `${user}/imports/${fileHash}`;
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
          category: "accounting",
          storage_path: storagePath,
          size_bytes: file.size,
          status: "INBOX",
        })
        .select("id");
      if (inserted.error) {
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

  async function commit(sessionId: string): Promise<FecCommitResult> {
    const statement = await rebuildStatement(sessionId);
    const candidate = toBusinessFinancialCandidate(statement);
    if (!candidate) {
      throw new Error(
        "Aucune période de clôture connue : la reconstruction ne peut pas devenir un fait Business.",
      );
    }
    if (candidate.blockers.length > 0) {
      throw new Error(candidate.blockers.map((entry: ImportIssue) => entry.message).join(" "));
    }

    unwrap(
      await db.rpc("lfo_commit_fec_session", {
        p_user_id: user,
        p_payload: {
          session_id: sessionId,
          financials: financialsPayload(candidate, sessionId),
        },
      }),
      "validation d'import comptable",
    );

    // ── À partir d'ici, LE FAIT EST ÉCRIT. ────────────────────────────────────────────
    //
    // Plus aucune défaillance ne doit se présenter comme un échec de validation. Un dépôt
    // d'archive qui échoue après coup laisserait sinon l'utilisateur devant un message
    // d'erreur alors que son instantané financier existe : il réimporterait, ou saisirait à
    // la main, et croirait à un doublon. Le fait et sa copie sont deux statuts distincts.
    const warnings: string[] = [];
    let documentStatus: FecDocumentStatus = "NOT_REQUESTED";

    const rows = unwrap(
      await db
        .from("import_sessions")
        .select(
          "committed_count, retain_file_requested, document_id, file_hash, file_name, staging_storage_path",
        )
        .eq("user_id", user)
        .eq("id", sessionId),
      "lecture du résultat d'import comptable",
    ) as Row[];
    const session = rows[0];

    if (session && session.retain_file_requested === true) {
      documentStatus = session.document_id === null ? "FAILED" : "STORED";
      const stagingPath = nullableStr(session.staging_storage_path);
      const fileHash = nullableStr(session.file_hash);
      if (session.document_id === null && stagingPath && fileHash) {
        try {
          // Le fichier est REPRIS du staging privé : il ne retransite pas par la requête,
          // et une validation n'a donc aucune raison de dépasser la limite de corps entrant.
          const downloaded = await db.storage.from(DOCUMENTS_BUCKET).download(stagingPath);
          if (downloaded.error || !downloaded.data) {
            throw new Error(downloaded.error?.message ?? "objet de staging introuvable");
          }
          const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
          await retainSessionFile(sessionId, fileHash, {
            name: nullableStr(session.file_name) ?? "fec.txt",
            contentType: FEC_CONTENT_TYPE,
            size: bytes.byteLength,
            bytes,
          });
          documentStatus = "STORED";
        } catch (error) {
          documentStatus = "FAILED";
          warnings.push(
            `L'instantané financier est bien écrit, mais la conservation du fichier a échoué : ${
              error instanceof Error ? error.message : String(error)
            }. Le fait canonique n'est pas remis en cause ; seule la copie d'archive manque.`,
          );
        }
      } else if (session.document_id === null) {
        warnings.push(
          "L'instantané financier est bien écrit, mais aucun objet de staging n'était disponible : aucune copie n'a été conservée.",
        );
      }
    }

    // Le staging a fait son office, quel que soit le sort de l'archive : il n'a plus de
    // raison d'exister. Son échec de suppression n'est pas remonté comme une erreur — le
    // fait est écrit, et un objet résiduel n'altère aucune vérité.
    const stagingPath = session ? nullableStr(session.staging_storage_path) : null;
    if (stagingPath) {
      await dropStagedFile(stagingPath);
      await db
        .rpc("lfo_clear_import_staging_path", { p_user_id: user, p_session_id: sessionId })
        .then(() => undefined);
    }

    const links = unwrap(
      await db
        .from("import_record_links")
        .select("business_financials_id")
        .eq("user_id", user)
        .eq("session_id", sessionId)
        .eq("target_domain", "BUSINESS_ACCOUNTING"),
      "lecture de la provenance comptable",
    ) as Row[];

    return {
      sessionId,
      // Le fait est écrit et gelé. Ce statut n'est jamais conditionné par la conservation.
      commitStatus: "COMMITTED",
      committedCount: session
        ? finiteNumber(session.committed_count, "import_sessions.committed_count")
        : 0,
      businessFinancialsId: links[0] ? str(links[0].business_financials_id) : "",
      periodEnd: candidate.periodEnd,
      documentStatus,
      warnings,
    };
  }

  async function discard(sessionId: string): Promise<string> {
    // Le staging est libéré AVANT l'abandon : une analyse abandonnée ne doit laisser ni
    // ligne de staging, ni objet dans le coffre. Même doctrine que la conservation, qui
    // n'a lieu qu'à la validation.
    const rows = unwrap(
      await db
        .from("import_sessions")
        .select("staging_storage_path")
        .eq("user_id", user)
        .eq("id", sessionId),
      "lecture du chemin de staging",
    ) as Row[];
    const stagingPath = rows[0] ? nullableStr(rows[0].staging_storage_path) : null;
    if (stagingPath) await dropStagedFile(stagingPath);

    unwrap(
      await db.rpc("lfo_discard_import_session", { p_user_id: user, p_session_id: sessionId }),
      "abandon d'import comptable",
    );
    return sessionId;
  }

  /**
   * Écritures d'une session, triées par numéro de ligne du fichier : c'est le numéro que
   * l'utilisateur lit dans son tableur.
   */
  async function getSessionLines(sessionId: string): Promise<FecPreviewLine[]> {
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>(
        `écritures de la session ${sessionId}`,
        async (from, to) => {
          const result = await db
            .from("fec_entry_lines")
            .select(
              "id, journal_code, entry_num, entry_date, account_num, account_lib, entry_label, debit, credit, pcg_group, status, issues, import_raw_records!inner(row_number)",
            )
            .eq("user_id", user)
            .eq("session_id", sessionId)
            .order("id", { ascending: true })
            .range(from, to);
          return { data: (result.data ?? null) as Row[] | null, error: result.error };
        },
      ),
      "lecture des écritures d'une session",
    );

    const mapped = rows.map((row) => {
      const nested = row.import_raw_records as Row | Row[] | null;
      const raw = Array.isArray(nested) ? nested[0] : nested;
      return {
        id: str(row.id),
        rowNumber: raw ? finiteNumber(raw.row_number, "import_raw_records.row_number") : 0,
        journalCode: str(row.journal_code),
        entryNumber: str(row.entry_num),
        entryDate: nullableStr(row.entry_date),
        accountNumber: str(row.account_num),
        accountLabel: nullableStr(row.account_lib),
        entryLabel: nullableStr(row.entry_label),
        debit: nullableFiniteNumber(row.debit, "fec_entry_lines.debit"),
        credit: nullableFiniteNumber(row.credit, "fec_entry_lines.credit"),
        pcgGroup: str(row.pcg_group),
        status: str(row.status) as ImportRowStatus,
        issues: Array.isArray(row.issues) ? (row.issues as ImportIssue[]) : [],
      };
    });
    return mapped.sort((left, right) => left.rowNumber - right.rowNumber);
  }

  return { adapter: "supabase", issueUploadTicket, analyze, commit, discard, getSessionLines };
}

let cached: FecRepository | undefined;

export function getFecRepository(): FecRepository {
  if (!cached) cached = createFecRepository();
  return cached;
}
