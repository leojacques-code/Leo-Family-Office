import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import { requireActor } from "@/lib/auth";
import {
  MAX_SCHEDULE_COLUMNS,
  MAX_SCHEDULE_LINES,
  readScheduleDocument,
} from "@/lib/acquisition/documents/schedule";
import type {
  DocumentIssue,
  ExtractionFieldStatus,
  ExtractionRunStatus,
} from "@/lib/acquisition/documents/types";
import { MutationRejectedError } from "@/lib/data/mutation-errors";
import { finiteNumber, nullableFiniteNumber } from "@/lib/data/row-validation";
import { DOCUMENTS_BUCKET, supabaseAdmin } from "@/lib/data/supabase-client";
import { SupabaseOperationError } from "@/lib/data/supabase-errors";
import type {
  ScheduleCheckView,
  ScheduleDecisionInput,
  ScheduleDecisionView,
  ScheduleFieldUnit,
  ScheduleFieldView,
  ScheduleReview,
  ScheduleRunSummary,
  ScheduleUploadInput,
  ScheduleUploadRefusal,
} from "@/lib/data/schedule-document-contracts";

/**
 * Revue d'un échéancier de dette (B19) : dépôt, lecture en candidats, décisions, validation.
 *
 * Aucune finance ici : la lecture vient de `src/lib/acquisition/documents/schedule`, les
 * contrôles sont calculés en base sur les cases persistées, et rien n'écrit `loan_schedules`
 * (le rattachement au prêt est B20).
 */

type Row = Record<string, unknown>;

/** Le coffre privé accepte 8 Mio ; une pièce de dette y est TOUJOURS conservée. */
const MAX_RETAINED_SCHEDULE_BYTES = 8 * 1024 * 1024;
/** Lot de cases par appel : la sémantique est inchangée, seul le volume est découpé. */
const FIELD_BATCH = 500;
/** Lecture paginée des cases : une page PostgREST ne porte pas tout un échéancier. */
const READ_PAGE = 1000;
/** Borne de relecture : celle du lecteur, qui REFUSE au-delà. Rien n'est donc tronqué. */
const MAX_FIELDS = MAX_SCHEDULE_LINES * MAX_SCHEDULE_COLUMNS;

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new SupabaseOperationError(context, result.error);
  if (result.data === null) throw new Error(`Supabase ${context} : aucune donnée`);
  return result.data;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireText(value: unknown, context: string): string {
  const read = text(value);
  if (read === null) throw new Error(`Colonne ${context} absente ou vide`);
  return read;
}

const RUN_STATUSES: ExtractionRunStatus[] = [
  "EXTRACTED",
  "OCR_REQUIRED",
  "FAILED",
  "REVIEWED",
  "VALIDATED",
  "LINKED",
  "REJECTED",
];
const FIELD_STATUSES: ExtractionFieldStatus[] = [
  "EXTRACTED",
  "REVIEWED",
  "CORRECTED",
  "REJECTED",
  "BLOCKED",
  "UNKNOWN_BOX",
];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], context: string): T {
  const found = allowed.find((entry) => entry === value);
  if (found === undefined) throw new Error(`${context} inconnu : ${String(value)}`);
  return found;
}

function issuesOf(value: unknown): DocumentIssue[] {
  return Array.isArray(value) ? (value as DocumentIssue[]) : [];
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toRunSummary(row: Row): ScheduleRunSummary {
  const completeness = text(row.completeness);
  const currencySource = text(row.currency_source);
  return {
    runId: requireText(row.id, "document_extraction_runs.id"),
    liabilityId: requireText(row.liability_id, "liability_id"),
    status: oneOf(row.status, RUN_STATUSES, "Statut de lecture"),
    fileName: text(row.file_name),
    sourceFormat: oneOf(row.source_format, ["CSV", "XLSX"] as const, "Format d'échéancier"),
    sheetName: text(row.sheet_name),
    extractedAt: requireText(row.extracted_at, "extracted_at"),
    extractorVersion: requireText(row.extractor_version, "extractor_version"),
    schemaVersion: requireText(row.schema_version, "schema_version"),
    lineCount: nullableFiniteNumber(row.line_count, "line_count"),
    firstDueDate: text(row.first_due_date),
    lastDueDate: text(row.last_due_date),
    completeness:
      completeness === null
        ? null
        : oneOf(completeness, ["COMPLETE", "PARTIAL"] as const, "Complétude"),
    completenessReasons: stringsOf(row.completeness_reasons),
    currency: text(row.currency),
    currencySource:
      currencySource === null
        ? null
        : oneOf(
            currencySource,
            ["COLUMN", "HEADER", "CELL", "DECLARED"] as const,
            "Origine de devise",
          ),
    failedCheckCount: finiteNumber(row.failed_check_count, "failed_check_count"),
    notComputableCheckCount: finiteNumber(
      row.not_computable_check_count,
      "not_computable_check_count",
    ),
    blockedFieldCount: finiteNumber(row.blocked_field_count, "blocked_field_count"),
    correctedFieldCount: finiteNumber(row.corrected_field_count, "corrected_field_count"),
    supersedesRunId: text(row.supersedes_run_id),
    documentId: text(row.document_id),
    issues: issuesOf(row.issues),
  };
}

function lineOf(boxCode: string): number {
  const match = /^L(\d+)\./.exec(boxCode);
  if (!match) throw new Error(`Code de case tabulaire inattendu : ${boxCode}`);
  return Number(match[1]);
}

function toFieldView(row: Row): ScheduleFieldView {
  const boxCode = requireText(row.box_code, "box_code");
  const normalizedValue = nullableFiniteNumber(row.normalized_value, "normalized_value");
  const userValue = nullableFiniteNumber(row.user_value, "user_value");
  const normalizedDate = text(row.normalized_date);
  const userDate = text(row.user_date);
  const unit = oneOf(
    row.unit,
    ["MONEY", "DATE", "TEXT"] as const,
    "Unité de case",
  ) as ScheduleFieldUnit;
  return {
    fieldId: requireText(row.id, "document_extraction_fields.id"),
    boxCode,
    lineNumber: lineOf(boxCode),
    rowNumber: finiteNumber(row.row_number, "row_number"),
    sheetName: text(row.sheet_name),
    columnKey: requireText(row.column_key, "column_key"),
    columnLabel: text(row.column_label),
    cellRef: text(row.cell_ref),
    rawValue: text(row.raw_value),
    normalizedValue,
    normalizedDate,
    userValue,
    userDate,
    effectiveValue: userValue ?? normalizedValue,
    effectiveDate: userDate ?? normalizedDate,
    unit,
    validationStatus: oneOf(row.validation_status, FIELD_STATUSES, "Statut de case"),
    decisionRevision: finiteNumber(row.decision_revision, "decision_revision"),
    userReason: text(row.user_reason),
    issues: issuesOf(row.issues),
  };
}

function toCheckView(row: Row): ScheduleCheckView {
  const operands = (row.operands ?? {}) as Row;
  return {
    checkCode: requireText(row.check_code, "check_code"),
    label: text(row.label),
    severity: oneOf(row.severity, ["BLOCKING", "WARNING", "INFO"] as const, "Sévérité"),
    status: oneOf(
      row.status,
      ["PASSED", "FAILED", "NOT_COMPUTABLE"] as const,
      "Statut de contrôle",
    ),
    expectedValue: nullableFiniteNumber(row.expected_value, "expected_value"),
    actualValue: nullableFiniteNumber(row.actual_value, "actual_value"),
    difference: nullableFiniteNumber(row.difference, "difference"),
    left: stringsOf(operands.left),
    right: stringsOf(operands.right),
    message: text(row.message),
  };
}

function toDecisionView(row: Row): ScheduleDecisionView {
  return {
    fieldId: requireText(row.field_id, "field_id"),
    rank: finiteNumber(row.decision_rank, "decision_rank"),
    action: oneOf(row.action, ["REVIEW", "CORRECT", "REJECT"] as const, "Action de décision"),
    beforeStatus: oneOf(row.before_status, FIELD_STATUSES, "Statut avant décision"),
    beforeValue: nullableFiniteNumber(row.before_value, "before_value"),
    beforeDate: text(row.before_date),
    afterStatus: oneOf(row.after_status, FIELD_STATUSES, "Statut après décision"),
    afterValue: nullableFiniteNumber(row.after_value, "after_value"),
    afterDate: text(row.after_date),
    reason: text(row.reason),
    decidedAt: requireText(row.decided_at, "decided_at"),
  };
}

export interface ScheduleDocumentRepository {
  listRuns(liabilityId: string): Promise<ScheduleRunSummary[]>;
  getReview(runId: string): Promise<ScheduleReview>;
  upload(input: ScheduleUploadInput): Promise<ScheduleReview | ScheduleUploadRefusal>;
  decide(input: ScheduleDecisionInput): Promise<ScheduleReview>;
  validate(runId: string): Promise<ScheduleReview>;
  reject(runId: string, reason: string | null): Promise<ScheduleReview>;
  /** Lien de téléchargement de la pièce conservée, valable une minute. */
  pieceUrl(runId: string): Promise<{ url: string }>;
}

class SupabaseScheduleDocumentRepository implements ScheduleDocumentRepository {
  constructor(private readonly user: string) {}

  private client() {
    return supabaseAdmin();
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client().rpc(name, { p_user_id: this.user, ...args });
    if (result.error) throw new SupabaseOperationError(name, result.error);
    return result.data;
  }

  private async readRun(runId: string): Promise<Row> {
    const rows = unwrap(
      await this.client()
        .from("document_extraction_runs")
        .select("*")
        .eq("id", runId)
        .eq("user_id", this.user)
        .eq("document_family", "AMORTIZATION_SCHEDULE"),
      "document_extraction_runs",
    ) as Row[];
    if (!rows[0]) throw new MutationRejectedError("Lecture d’échéancier introuvable.");
    return rows[0];
  }

  async listRuns(liabilityId: string): Promise<ScheduleRunSummary[]> {
    const rows = unwrap(
      await this.client()
        .from("document_extraction_runs")
        .select("*")
        .eq("user_id", this.user)
        .eq("liability_id", liabilityId)
        .eq("document_family", "AMORTIZATION_SCHEDULE")
        .order("extracted_at", { ascending: false })
        .limit(50),
      "document_extraction_runs",
    ) as Row[];
    return rows.map(toRunSummary);
  }

  async getReview(runId: string): Promise<ScheduleReview> {
    const run = toRunSummary(await this.readRun(runId));
    const fields: ScheduleFieldView[] = [];
    for (let offset = 0; offset < MAX_FIELDS; offset += READ_PAGE) {
      const page = unwrap(
        await this.client()
          .from("document_extraction_fields")
          .select("*")
          .eq("user_id", this.user)
          .eq("run_id", runId)
          .order("row_number", { ascending: true })
          .order("box_code", { ascending: true })
          .range(offset, offset + READ_PAGE - 1),
        "document_extraction_fields",
      ) as Row[];
      fields.push(...page.map(toFieldView));
      if (page.length < READ_PAGE) break;
    }
    const checks: ScheduleCheckView[] = [];
    for (let offset = 0; offset < MAX_FIELDS; offset += READ_PAGE) {
      const page = unwrap(
        await this.client()
          .from("document_extraction_checks")
          .select("*")
          .eq("user_id", this.user)
          .eq("run_id", runId)
          .order("check_code", { ascending: true })
          .range(offset, offset + READ_PAGE - 1),
        "document_extraction_checks",
      ) as Row[];
      checks.push(...page.map(toCheckView));
      if (page.length < READ_PAGE) break;
    }
    // Le journal n'a pas de borne : il est relu page par page, jamais coupé.
    const decisions: ScheduleDecisionView[] = [];
    for (let offset = 0; ; offset += READ_PAGE) {
      const page = unwrap(
        await this.client()
          .from("document_field_decisions")
          .select("*")
          .eq("user_id", this.user)
          .eq("run_id", runId)
          .order("decided_at", { ascending: true })
          .order("decision_rank", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + READ_PAGE - 1),
        "document_field_decisions",
      ) as Row[];
      decisions.push(...page.map(toDecisionView));
      if (page.length < READ_PAGE) break;
    }
    return { run, fields, checks, decisions };
  }

  async upload(input: ScheduleUploadInput): Promise<ScheduleReview | ScheduleUploadRefusal> {
    const liabilities = unwrap(
      await this.client()
        .from("liabilities")
        .select("id, principal, terms_status, archived")
        .eq("id", input.liabilityId)
        .eq("user_id", this.user),
      "liabilities",
    ) as Row[];
    const liability = liabilities[0];
    if (!liability || liability.archived === true) {
      throw new MutationRejectedError("Dette introuvable ou archivée : aucun échéancier n’est lu.");
    }
    if (input.file.size > MAX_RETAINED_SCHEDULE_BYTES) {
      throw new MutationRejectedError(
        "Fichier supérieur à 8 Mo : la pièce d’une dette est toujours conservée au coffre, qui ne l’accepte pas.",
      );
    }

    // Le capital du contrat n'est une référence que s'il est DÉCLARÉ (contrat) : l'encours
    // d'une dette connue par son seul encours n'est pas un capital initial.
    const contractPrincipal =
      text(liability.terms_status) === "CONTRACT"
        ? nullableFiniteNumber(liability.principal, "liabilities.principal")
        : null;
    const extraction = readScheduleDocument({
      bytes: input.file.bytes,
      fileName: input.file.name,
      // Seule une devise DÉCLARÉE au dépôt en est une : `liabilities.currency` porte un défaut
      // de schéma (« EUR ») que la saisie du contrat n'écrit pas, et le reprendre ici
      // persisterait « déclarée » une devise que personne n'a choisie.
      declaredCurrency: input.declaredCurrency,
      contractPrincipal,
    });
    if (extraction.sourceFormat === null) {
      // Format non annoncé ou extension mensongère : rien n'est lu, rien n'est conservé.
      return { refused: true, issues: extraction.issues };
    }

    const fileHash = createHash("sha256").update(input.file.bytes).digest("hex");
    const contentType = extraction.sourceFormat === "XLSX" ? XLSX_CONTENT_TYPE : "text/csv";
    const documentId = await this.retain(
      fileHash,
      extraction.sourceFormat,
      contentType,
      input.file,
    );

    const runId = requireText(
      await this.rpc("lfo_open_schedule_extraction", {
        p_payload: {
          liability_id: input.liabilityId,
          status: extraction.status,
          source_format: extraction.sourceFormat,
          sheet_name: extraction.sheetName,
          file_name: input.file.name.slice(0, 240),
          file_hash: fileHash,
          file_size_bytes: input.file.size,
          content_type: contentType,
          document_id: documentId,
          extractor: extraction.extractor,
          extractor_version: extraction.extractorVersion,
          schema_version: extraction.schemaVersion,
          currency: extraction.currency,
          currency_source: extraction.currencySource,
          line_count: extraction.status === "EXTRACTED" ? extraction.lineCount : null,
          first_due_date: extraction.firstDueDate,
          last_due_date: extraction.lastDueDate,
          completeness: extraction.status === "EXTRACTED" ? extraction.completeness : null,
          completeness_reasons:
            extraction.status === "EXTRACTED" ? extraction.completenessReasons : [],
          issues: extraction.issues,
          error:
            extraction.status === "FAILED"
              ? "Lecture d’échéancier en échec : voir les anomalies."
              : null,
        },
      }),
      "document_extraction_runs.id",
    );

    if (extraction.status === "EXTRACTED") {
      try {
        for (let index = 0; index < extraction.fields.length; index += FIELD_BATCH) {
          await this.rpc("lfo_append_document_extraction_fields", {
            p_payload: {
              run_id: runId,
              fields: extraction.fields.slice(index, index + FIELD_BATCH).map((field) => ({
                box_code: field.boxCode,
                row_number: field.rowNumber,
                sheet_name: field.sheetName,
                column_key: field.columnKey,
                column_label: field.columnLabel,
                cell_ref: field.cellRef,
                raw_value: field.rawValue,
                normalized_value:
                  field.normalizedValue === null ? null : String(field.normalizedValue),
                normalized_date: field.normalizedDate,
                unit: field.unit,
                extraction_method: "TABULAR_CELL",
                confidence: field.validationStatus === "BLOCKED" ? "LOW" : "HIGH",
                validation_status: field.validationStatus,
                issues: field.issues,
              })),
            },
          });
        }
        await this.rpc("lfo_evaluate_document_extraction_checks", {
          p_payload: {
            run_id: runId,
            checks: extraction.checks.map((check) => ({
              check_code: check.checkCode,
              label: check.label,
              severity: check.severity,
              tolerance: check.tolerance,
              left: check.left,
              right: check.right,
              message: check.message,
            })),
          },
        });
      } catch (error) {
        // Dépôt interrompu après l'ouverture : la lecture amputée est refusée, au mieux, pour
        // que le même fichier puisse être redéposé. La validation la refuserait de toute façon.
        await this.rpc("lfo_reject_document_extraction", {
          p_run_id: runId,
          p_reason: "Dépôt interrompu : lecture incomplète.",
        }).catch(() => undefined);
        throw error;
      }
    }
    return this.getReview(runId);
  }

  /** Conserve la pièce au coffre privé, chemin dérivé de l'empreinte du contenu. */
  private async retain(
    fileHash: string,
    format: "CSV" | "XLSX",
    contentType: string,
    file: ScheduleUploadInput["file"],
  ): Promise<string> {
    const db = this.client();
    const storagePath = `${this.user}/debt/${fileHash}.${format.toLowerCase()}`;
    // `upsert: true` est sûr : le chemin dérive de l'empreinte, réécrire ce chemin ne peut
    // réécrire que des octets identiques (même doctrine que l'import bancaire).
    const uploaded = await db.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, file.bytes, { contentType, upsert: true });
    if (uploaded.error) throw new Error(`Supabase stockage : ${uploaded.error.message}`);
    const existing = unwrap(
      await db
        .from("documents")
        .select("id")
        .eq("user_id", this.user)
        .eq("storage_path", storagePath),
      "recherche du document conservé",
    ) as Row[];
    if (existing[0]) return requireText(existing[0].id, "documents.id");
    const inserted = await db
      .from("documents")
      .insert({
        user_id: this.user,
        name: file.name.slice(0, 180),
        // Vocabulaire du coffre (`/api/documents`) : une pièce de prêt y est rangée sous « loan ».
        category: "loan",
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
          .eq("user_id", this.user)
          .eq("storage_path", storagePath),
        "relecture du document conservé",
      ) as Row[];
      if (!raced[0]) throw new SupabaseOperationError("enregistrement de document", inserted.error);
      return requireText(raced[0].id, "documents.id");
    }
    return requireText((inserted.data as Row[])[0]?.id, "documents.id");
  }

  async decide(input: ScheduleDecisionInput): Promise<ScheduleReview> {
    const fieldRows = unwrap(
      await this.client()
        .from("document_extraction_fields")
        .select("run_id")
        .eq("id", input.fieldId)
        .eq("user_id", this.user),
      "document_extraction_fields",
    ) as Row[];
    const runId = text(fieldRows[0]?.run_id);
    if (runId === null) throw new MutationRejectedError("Case introuvable.");
    // La lecture visée doit être un échéancier : cette route ne décide pas sur une liasse.
    await this.readRun(runId);
    await this.rpc("lfo_correct_document_extraction_field", {
      p_payload: {
        field_id: input.fieldId,
        action: input.action,
        expected_revision: input.expectedRevision,
        ...(input.action === "correct" && input.userValue != null
          ? { user_value: input.userValue }
          : {}),
        ...(input.action === "correct" && input.userDate != null
          ? { user_date: input.userDate }
          : {}),
        reason: input.reason ?? null,
      },
    });
    return this.getReview(runId);
  }

  async validate(runId: string): Promise<ScheduleReview> {
    await this.readRun(runId);
    await this.rpc("lfo_validate_document_extraction", { p_run_id: runId });
    return this.getReview(runId);
  }

  async reject(runId: string, reason: string | null): Promise<ScheduleReview> {
    await this.readRun(runId);
    await this.rpc("lfo_reject_document_extraction", { p_run_id: runId, p_reason: reason });
    return this.getReview(runId);
  }

  async pieceUrl(runId: string): Promise<{ url: string }> {
    const documentId = text((await this.readRun(runId)).document_id);
    if (documentId === null) {
      throw new MutationRejectedError("Aucune pièce n’est conservée pour cette lecture.");
    }
    const documents = unwrap(
      await this.client()
        .from("documents")
        .select("storage_path, name")
        .eq("id", documentId)
        .eq("user_id", this.user),
      "documents",
    ) as Row[];
    const storagePath = text(documents[0]?.storage_path);
    if (storagePath === null) throw new MutationRejectedError("Pièce introuvable au coffre.");
    const signed = await this.client()
      .storage.from(DOCUMENTS_BUCKET)
      .createSignedUrl(storagePath, 60, { download: text(documents[0]?.name) ?? true });
    if (signed.error || !signed.data) {
      throw new SupabaseOperationError("lien de la pièce", {
        message: signed.error?.message ?? "lien absent",
      });
    }
    return { url: signed.data.signedUrl };
  }
}

export async function getScheduleDocumentRepository(): Promise<ScheduleDocumentRepository> {
  const actor = await requireActor();
  return new SupabaseScheduleDocumentRepository(actor.userId);
}
