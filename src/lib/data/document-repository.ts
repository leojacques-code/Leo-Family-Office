import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  buildFinancialCandidate,
  resolveAnchor,
  ROW_ANCHORS,
} from "@/lib/acquisition/documents/liasse";
import { readLiasse } from "@/lib/acquisition/documents/liasse";
import { extractPdfTextLayer } from "@/lib/acquisition/documents/pdf-extract";
import type {
  DocumentIssue,
  ExtractedField,
  ExtractionFieldStatus,
  ExtractionMethod,
  ExtractionRunStatus,
  ExtractionUnit,
  PdfKind,
} from "@/lib/acquisition/documents/types";
import type {
  DocumentAnalyzeRequest,
  DocumentCheckView,
  DocumentCorrectionRequest,
  DocumentExtractionPreview,
  DocumentExtractionSummary,
  DocumentFieldView,
  DocumentFinancialProposal,
  DocumentLinkRequest,
  DocumentLinkResult,
  DocumentTicketRequest,
  DocumentUploadTicket,
} from "@/lib/data/document-contracts";
import { finiteNumber, nullableFiniteNumber } from "@/lib/data/row-validation";
import {
  DOCUMENTS_BUCKET,
  IMPORT_STAGING_BUCKET,
  ownerId,
  supabaseAdmin,
} from "@/lib/data/supabase-client";
import {
  MAX_DOCUMENT_FILE_BYTES,
  MAX_RETAINED_DOCUMENT_FILE_BYTES,
} from "@/lib/validation/documents";

/**
 * DOCUMENT INTELLIGENCE — PERSISTANCE
 *
 * Frontière unique entre un PDF déposé et la base. Cinq règles, toutes vérifiées par le smoke
 * transactionnel :
 *
 *   1. LE FICHIER NE TRAVERSE PAS LA ROUTE. Il va du navigateur au stockage privé ; la route
 *      ne reçoit qu'un billet, émis par le serveur, à chemin calculé en base.
 *
 *   2. DÉPOSER ≠ LIRE ≠ ÉCRIRE UN FAIT. Trois actes explicites. L'analyse n'écrit AUCUNE
 *      donnée canonique ; seule la liaison en écrit une.
 *
 *   3. L'ARITHMÉTIQUE DES CONTRÔLES EST FAITE EN BASE, sur les cases persistées. L'extracteur
 *      dit QUELLES cases comparer ; il ne dit pas si elles s'équilibrent.
 *
 *   4. LE FAIT ÉCRIT EST RECONSTRUIT DEPUIS LA BASE, jamais repris du preview reçu par le
 *      client. Une charge forgée ne peut donc pas écrire un chiffre qu'aucune case ne porte.
 *
 *   5. UN ÉCHEC DE NETTOYAGE EST DIT. Un objet de staging qui résiste à sa suppression garde
 *      sa référence : l'effacer laisserait une liasse fiscale au stockage sans que rien ne
 *      sache où.
 */

type Row = Record<string, unknown>;

const EXTRACTOR_DOMAIN = "DOCUMENT_EXTRACTION";
const PDF_CONTENT_TYPE = "application/pdf";

/** Durée de vie d'un billet. Assez longue pour un dépôt sur connexion médiocre. */
const UPLOAD_TICKET_TTL_MINUTES = 30;

/** Taille d'un lot de cases. Une liasse complète en porte plusieurs centaines. */
const FIELD_CHUNK = 400;

/** Plafond d'AFFICHAGE des cases. Le staging en contient toujours l'intégralité. */
export const PREVIEW_FIELD_LIMIT = 500;

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
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

function readStatus(value: unknown): ExtractionRunStatus {
  const statuses: ExtractionRunStatus[] = [
    "EXTRACTED",
    "OCR_REQUIRED",
    "FAILED",
    "REVIEWED",
    "VALIDATED",
    "LINKED",
    "REJECTED",
  ];
  const found = statuses.find((status) => status === value);
  if (found === undefined) throw new Error(`Statut de lecture inconnu : ${String(value)}`);
  return found;
}

function readFieldStatus(value: unknown): ExtractionFieldStatus {
  const statuses: ExtractionFieldStatus[] = [
    "EXTRACTED",
    "REVIEWED",
    "CORRECTED",
    "REJECTED",
    "BLOCKED",
    "UNKNOWN_BOX",
  ];
  return statuses.find((status) => status === value) ?? "EXTRACTED";
}

function readIssues(value: unknown): DocumentIssue[] {
  return Array.isArray(value) ? (value as DocumentIssue[]) : [];
}

/**
 * Champs qu'une liasse ne contient PAS, et pourquoi.
 *
 * Cette liste est exposée à l'écran pour une raison : sans elle, l'utilisateur verrait un
 * EBITDA vide et conclurait à un échec de lecture. Ce n'est pas un échec — c'est un poste que
 * le document ne porte pas, et dont la reconstruction est un jugement humain.
 */
const UNAVAILABLE_FINANCIAL_FIELDS: Array<{ field: string; reason: string }> = [
  {
    field: "ebitda",
    reason:
      "Un EBITDA est une CONVENTION : quelles charges retraiter, quelles reprises neutraliser. Le choix appartient au ledger de Quality of Earnings, sur décision humaine documentée.",
  },
  {
    field: "ebit",
    reason: "Même raison que l'EBITDA : le périmètre des retraitements est un jugement.",
  },
  {
    field: "capex",
    reason:
      "Une liasse imprime des dotations aux amortissements, pas des investissements décaissés. D&A ≠ CAPEX CASH.",
  },
  {
    field: "free_cash_flow",
    reason: "Il se dérive d'un EBITDA et d'un capex, donc de deux conventions.",
  },
  {
    field: "working_capital",
    reason:
      "Son périmètre — exploitation seule ou besoin global — est une convention d'analyse, pas une ligne de formulaire.",
  },
  {
    field: "gross_margin",
    reason:
      "La marge dépend de la convention retenue : marge commerciale sur marchandises, ou marge sur coûts variables. Le formulaire n'en imprime aucune.",
  },
];

export interface DocumentRepository {
  issueUploadTicket(input: DocumentTicketRequest): Promise<DocumentUploadTicket>;
  analyze(input: DocumentAnalyzeRequest): Promise<DocumentExtractionPreview>;
  getPreview(runId: string): Promise<DocumentExtractionPreview>;
  listRuns(businessId?: string): Promise<DocumentExtractionSummary[]>;
  correct(input: DocumentCorrectionRequest): Promise<DocumentExtractionPreview>;
  validate(runId: string): Promise<DocumentExtractionPreview>;
  link(input: DocumentLinkRequest): Promise<DocumentLinkResult>;
  reject(runId: string, reason: string | null): Promise<DocumentLinkResult>;
}

class SupabaseDocumentRepository implements DocumentRepository {
  private readonly user = ownerId();

  private client() {
    return supabaseAdmin();
  }

  private async rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client().rpc(name, { p_user_id: this.user, ...args });
    if (result.error) throw new Error(`Supabase ${name} : ${result.error.message}`);
    return result.data;
  }

  async issueUploadTicket(input: DocumentTicketRequest): Promise<DocumentUploadTicket> {
    const ticketId = requireText(
      await this.rpc("lfo_issue_import_upload_ticket", {
        p_payload: {
          domain: EXTRACTOR_DOMAIN,
          file_name: input.fileName.slice(0, 240),
          content_type: PDF_CONTENT_TYPE,
          byte_size: input.byteSize,
          ttl_minutes: UPLOAD_TICKET_TTL_MINUTES,
        },
      }),
      "import_upload_tickets.id",
    );

    const rows = unwrap(
      await this.client()
        .from("import_upload_tickets")
        .select("storage_path, expires_at")
        .eq("user_id", this.user)
        .eq("id", ticketId),
      "import_upload_tickets",
    ) as Row[];
    const ticket = rows[0];
    if (!ticket) throw new Error("Billet d'upload introuvable après émission");
    const storagePath = requireText(ticket.storage_path, "storage_path");

    // La zone de STAGING, pas le coffre : un PDF de liasse n'a de raison d'exister au
    // stockage que le temps de l'analyse, et le coffre garde sa vocation d'archive.
    const signed = await this.client()
      .storage.from(IMPORT_STAGING_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (signed.error || !signed.data) {
      throw new Error(`Supabase URL de dépôt : ${signed.error?.message ?? "réponse vide"}`);
    }

    return {
      ticketId,
      bucket: IMPORT_STAGING_BUCKET,
      storagePath,
      token: signed.data.token,
      contentType: PDF_CONTENT_TYPE,
      expiresAt: requireText(ticket.expires_at, "expires_at"),
      retainable: input.byteSize <= MAX_RETAINED_DOCUMENT_FILE_BYTES,
    };
  }

  /**
   * Reprend l'objet de staging désigné par un billet.
   *
   * Le chemin vient de la BASE, jamais de la requête. Le billet est consommé d'abord, à usage
   * unique et sous verrou de ligne, de sorte que deux analyses simultanées du même dépôt ne
   * puissent pas conclure toutes les deux qu'il est libre.
   */
  private async claimStagedFile(
    ticketId: string,
  ): Promise<{ storagePath: string; fileName: string; bytes: Uint8Array }> {
    await this.rpc("lfo_consume_import_upload_ticket", { p_ticket_id: ticketId });

    const rows = unwrap(
      await this.client()
        .from("import_upload_tickets")
        .select("storage_path, file_name, byte_size")
        .eq("user_id", this.user)
        .eq("id", ticketId),
      "import_upload_tickets",
    ) as Row[];
    const ticket = rows[0];
    if (!ticket) throw new Error("Billet d'upload introuvable");

    const storagePath = requireText(ticket.storage_path, "storage_path");
    const downloaded = await this.client()
      .storage.from(IMPORT_STAGING_BUCKET)
      .download(storagePath);
    if (downloaded.error || !downloaded.data) {
      throw new Error(
        `Fichier de staging introuvable : le dépôt n'a peut-être pas abouti (${
          downloaded.error?.message ?? "réponse vide"
        }).`,
      );
    }
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());

    // La taille ANNONCÉE et la taille RÉELLE doivent coïncider : une déclaration n'est pas
    // une mesure, et c'est la seconde qui décide de ce qui est analysable.
    const declared = finiteNumber(ticket.byte_size, "import_upload_tickets.byte_size");
    if (bytes.byteLength !== declared) {
      throw new Error(
        `Le fichier déposé pèse ${bytes.byteLength} octets, ${declared} avaient été annoncés. Redéposez-le.`,
      );
    }
    if (bytes.byteLength > MAX_DOCUMENT_FILE_BYTES) {
      throw new Error(
        `Fichier supérieur à ${Math.round(MAX_DOCUMENT_FILE_BYTES / (1024 * 1024))} Mo.`,
      );
    }

    return {
      storagePath,
      fileName: text(ticket.file_name) ?? "document.pdf",
      bytes,
    };
  }

  /** Supprime un objet de staging, et DIT si elle a réussi. */
  private async dropStagedFile(runId: string, storagePath: string): Promise<boolean> {
    const removed = await this.client().storage.from(IMPORT_STAGING_BUCKET).remove([storagePath]);
    const success = !removed.error;
    await this.rpc("lfo_record_document_staging_cleanup", {
      p_run_id: runId,
      p_removed: success,
    });
    return success;
  }

  /**
   * Archive le PDF au coffre privé, quand l'utilisateur l'a demandé.
   *
   * ANALYSER ≠ ARCHIVER : un échec d'archivage ne transforme jamais une lecture réussie en
   * échec. Il est signalé, et la lecture reste ce qu'elle est.
   */
  private async retainDocument(
    runId: string,
    fileName: string,
    bytes: Uint8Array,
    fileHash: string,
  ): Promise<string | null> {
    if (bytes.byteLength > MAX_RETAINED_DOCUMENT_FILE_BYTES) return null;
    const storagePath = `${this.user}/documents/${fileHash}`;
    const uploaded = await this.client()
      .storage.from(DOCUMENTS_BUCKET)
      .upload(storagePath, bytes, { contentType: PDF_CONTENT_TYPE, upsert: true });
    if (uploaded.error) return null;

    const inserted = await this.client()
      .from("documents")
      .upsert(
        {
          user_id: this.user,
          storage_path: storagePath,
          file_name: fileName,
          content_type: PDF_CONTENT_TYPE,
          byte_size: bytes.byteLength,
        },
        { onConflict: "user_id,storage_path" },
      )
      .select("id");
    if (inserted.error) return null;
    const documentId = text((inserted.data as Row[] | null)?.[0]?.id);
    if (documentId === null) return null;

    await this.client()
      .from("document_extraction_runs")
      .update({ document_id: documentId })
      .eq("id", runId)
      .eq("user_id", this.user);
    return documentId;
  }

  async analyze(input: DocumentAnalyzeRequest): Promise<DocumentExtractionPreview> {
    const staged = await this.claimStagedFile(input.ticketId);
    const fileHash = createHash("sha256").update(staged.bytes).digest("hex");

    const extraction = await extractPdfTextLayer(staged.bytes);
    const reading = readLiasse({
      layer: extraction.layer,
      pdfKind: extraction.pdfKind,
      pageCount: extraction.pageCount,
      issues: extraction.issues,
    });

    const runId = requireText(
      await this.rpc("lfo_open_document_extraction", {
        p_payload: {
          business_id: input.businessId,
          document_family: reading.family,
          detected_kind: reading.detectedKind,
          detected_variant: reading.detectedVariant,
          detection_basis: reading.detectionBasis,
          extractor: reading.extractor,
          extractor_version: reading.extractorVersion,
          schema_version: reading.schemaVersion,
          pdf_kind: reading.pdfKind,
          page_count: reading.pageCount,
          text_char_count: reading.textCharCount,
          file_name: staged.fileName,
          file_hash: fileHash,
          file_size_bytes: staged.bytes.byteLength,
          content_type: PDF_CONTENT_TYPE,
          staging_storage_path: staged.storagePath,
          siren: reading.siren,
          fiscal_year_start: reading.fiscalYearStart,
          fiscal_year_end: reading.fiscalYearEnd,
          status: reading.status,
          issues: reading.issues,
        },
      }),
      "document_extraction_runs.id",
    );

    for (let index = 0; index < reading.fields.length; index += FIELD_CHUNK) {
      const chunk = reading.fields.slice(index, index + FIELD_CHUNK);
      await this.rpc("lfo_append_document_extraction_fields", {
        p_payload: {
          run_id: runId,
          fields: chunk.map((field) => ({
            page_number: field.pageNumber,
            form_code: field.formCode,
            form_part: field.formPart,
            box_code: field.boxCode,
            occurrence: field.occurrence,
            label: field.label,
            bbox_x: field.bbox?.x ?? null,
            bbox_y: field.bbox?.y ?? null,
            bbox_width: field.bbox?.width ?? null,
            bbox_height: field.bbox?.height ?? null,
            raw_value: field.rawValue,
            normalized_value: field.normalizedValue,
            unit: field.unit,
            extraction_method: field.extractionMethod,
            confidence: field.confidence,
            confidence_score: field.confidenceScore,
            validation_status: field.validationStatus,
            issues: field.issues,
          })),
        },
      });
    }

    // Les contrôles sont ÉVALUÉS en base, sur les cases qui viennent d'être écrites. Le
    // client n'a fourni que la liste des cases à comparer.
    await this.rpc("lfo_evaluate_document_extraction_checks", {
      p_payload: {
        run_id: runId,
        checks: reading.checks.map((check) => ({
          check_code: check.checkCode,
          label: check.label,
          severity: check.severity,
          tolerance: check.tolerance,
          // Un contrôle dont un opérande n'a pas été résolu part avec une liste vide : la
          // base le rendra NOT_COMPUTABLE, ce qui est exactement l'état de la connaissance.
          left: check.unresolved.length > 0 ? [] : check.left,
          right: check.unresolved.length > 0 ? [] : check.right,
          message: check.message,
        })),
      },
    });

    if (input.retainFile) {
      await this.retainDocument(runId, staged.fileName, staged.bytes, fileHash);
    }
    await this.dropStagedFile(runId, staged.storagePath);

    return this.getPreview(runId);
  }

  private async readRun(runId: string): Promise<Row> {
    return unwrap(
      await this.client()
        .from("document_extraction_runs")
        .select("*")
        .eq("id", runId)
        .eq("user_id", this.user)
        .maybeSingle(),
      "document_extraction_runs",
    ) as Row;
  }

  private async readFields(runId: string): Promise<Row[]> {
    return unwrap(
      await this.client()
        .from("document_extraction_fields")
        .select("*")
        .eq("user_id", this.user)
        .eq("run_id", runId)
        .order("page_number", { ascending: true })
        .order("box_code", { ascending: true })
        .order("occurrence", { ascending: true })
        .limit(PREVIEW_FIELD_LIMIT + 1),
      "document_extraction_fields",
    ) as Row[];
  }

  private toFieldView(row: Row): DocumentFieldView {
    const normalized = nullableFiniteNumber(row.normalized_value, "normalized_value");
    const userValue = nullableFiniteNumber(row.user_value, "user_value");
    const x = nullableFiniteNumber(row.bbox_x, "bbox_x");
    const y = nullableFiniteNumber(row.bbox_y, "bbox_y");
    const width = nullableFiniteNumber(row.bbox_width, "bbox_width");
    const height = nullableFiniteNumber(row.bbox_height, "bbox_height");
    return {
      fieldId: requireText(row.id, "document_extraction_fields.id"),
      pageNumber: finiteNumber(row.page_number, "page_number"),
      formCode: text(row.form_code),
      formPart: text(row.form_part),
      boxCode: requireText(row.box_code, "box_code"),
      occurrence: finiteNumber(row.occurrence, "occurrence"),
      label: text(row.label),
      bbox:
        x === null || y === null || width === null || height === null
          ? null
          : { x, y, width, height },
      rawValue: text(row.raw_value),
      normalizedValue: normalized,
      userValue,
      userReason: text(row.user_reason),
      // La valeur RETENUE est la correction quand elle existe : c'est celle sur laquelle
      // l'utilisateur décide, et celle que les contrôles ont utilisée.
      effectiveValue: userValue ?? normalized,
      unit: (text(row.unit) ?? "EUR") as ExtractionUnit,
      extractionMethod: (text(row.extraction_method) ?? "NATIVE_TEXT_LAYOUT") as ExtractionMethod,
      confidence:
        row.confidence === "HIGH" || row.confidence === "LOW"
          ? row.confidence
          : ("MEDIUM" as const),
      validationStatus: readFieldStatus(row.validation_status),
      issues: readIssues(row.issues),
    };
  }

  private async readChecks(runId: string): Promise<DocumentCheckView[]> {
    const rows = unwrap(
      await this.client()
        .from("document_extraction_checks")
        .select("*")
        .eq("user_id", this.user)
        .eq("run_id", runId)
        .order("severity", { ascending: true })
        .order("check_code", { ascending: true }),
      "document_extraction_checks",
    ) as Row[];

    return rows.map((row) => {
      const operands = (row.operands ?? {}) as { left?: unknown; right?: unknown };
      return {
        checkCode: requireText(row.check_code, "check_code"),
        label: text(row.label),
        severity: row.severity === "BLOCKING" || row.severity === "INFO" ? row.severity : "WARNING",
        status: row.status === "PASSED" || row.status === "FAILED" ? row.status : "NOT_COMPUTABLE",
        expectedValue: nullableFiniteNumber(row.expected_value, "expected_value"),
        actualValue: nullableFiniteNumber(row.actual_value, "actual_value"),
        difference: nullableFiniteNumber(row.difference, "difference"),
        tolerance: finiteNumber(row.tolerance, "tolerance"),
        leftCodes: Array.isArray(operands.left) ? (operands.left as string[]) : [],
        rightCodes: Array.isArray(operands.right) ? (operands.right as string[]) : [],
        message: text(row.message),
      };
    });
  }

  /**
   * Reconstruit les cases lues sous la forme que le moteur d'ancres attend.
   *
   * C'est ce qui permet de rebâtir la proposition financière DEPUIS LA BASE, avec les
   * corrections utilisateur prises en compte, sans faire confiance au preview reçu du client.
   */
  private fieldsForAnchors(rows: readonly Row[]): ExtractedField[] {
    return rows.map((row) => {
      const view = this.toFieldView(row);
      return {
        pageNumber: view.pageNumber,
        formCode: view.formCode,
        formPart: view.formPart,
        boxCode: view.boxCode,
        occurrence: view.occurrence,
        label: view.label,
        bbox: view.bbox,
        rawValue: view.rawValue,
        // La valeur EFFECTIVE : une correction acceptée doit changer le fait écrit.
        normalizedValue: view.effectiveValue,
        unit: view.unit,
        extractionMethod: view.extractionMethod,
        confidence: view.confidence,
        confidenceScore: null,
        validationStatus: view.validationStatus,
        issues: view.issues,
      };
    });
  }

  private buildFinancialProposal(
    rows: readonly Row[],
    run: Row,
    currency: string | null,
  ): DocumentFinancialProposal {
    const candidate = buildFinancialCandidate(this.fieldsForAnchors(rows));
    return {
      periodEnd: text(run.fiscal_year_end),
      currency,
      revenue: candidate.revenue,
      netIncome: candidate.netIncome,
      unavailableFields: UNAVAILABLE_FINANCIAL_FIELDS,
    };
  }

  async getPreview(runId: string): Promise<DocumentExtractionPreview> {
    const run = await this.readRun(runId);
    const businessId = requireText(run.business_id, "business_id");
    const business = unwrap(
      await this.client()
        .from("businesses")
        .select("name, functional_currency")
        .eq("id", businessId)
        .eq("user_id", this.user)
        .maybeSingle(),
      "businesses",
    ) as Row;

    const fieldRows = await this.readFields(runId);
    const truncated = fieldRows.length > PREVIEW_FIELD_LIMIT;
    const visible = truncated ? fieldRows.slice(0, PREVIEW_FIELD_LIMIT) : fieldRows;

    return {
      runId,
      businessId,
      businessName: requireText(business.name, "businesses.name"),
      status: readStatus(run.status),
      pdfKind: (text(run.pdf_kind) ?? "UNREADABLE") as PdfKind,
      pageCount: nullableFiniteNumber(run.page_count, "page_count"),
      detectedKind: text(run.detected_kind),
      detectedVariant: text(run.detected_variant),
      detectionBasis: Array.isArray(run.detection_basis)
        ? (run.detection_basis as DocumentExtractionPreview["detectionBasis"])
        : [],
      siren: text(run.siren),
      fiscalYearStart: text(run.fiscal_year_start),
      fiscalYearEnd: text(run.fiscal_year_end),
      fileName: text(run.file_name),
      fileHash: text(run.file_hash),
      extractedAt: requireText(run.extracted_at, "extracted_at"),
      counts: {
        fields: finiteNumber(run.field_count, "field_count"),
        unknownBoxes: finiteNumber(run.unknown_box_count, "unknown_box_count"),
        blocked: finiteNumber(run.blocked_field_count, "blocked_field_count"),
        corrected: finiteNumber(run.corrected_field_count, "corrected_field_count"),
        failedChecks: finiteNumber(run.failed_check_count, "failed_check_count"),
        notComputableChecks: finiteNumber(
          run.not_computable_check_count,
          "not_computable_check_count",
        ),
      },
      fields: visible.map((row) => this.toFieldView(row)),
      fieldsTruncated: truncated,
      checks: await this.readChecks(runId),
      financials: this.buildFinancialProposal(fieldRows, run, text(business.functional_currency)),
      issues: readIssues(run.issues),
      documentId: text(run.document_id),
      stagingCleanupFailed: text(run.staging_cleanup_failed_at) !== null,
      supersedesRunId: text(run.supersedes_run_id),
    };
  }

  async listRuns(businessId?: string): Promise<DocumentExtractionSummary[]> {
    let query = this.client()
      .from("document_extraction_runs")
      .select(
        "id, business_id, status, detected_kind, detected_variant, fiscal_year_end, file_name, extracted_at, field_count, failed_check_count, not_computable_check_count",
      )
      .eq("user_id", this.user)
      .order("extracted_at", { ascending: false })
      .limit(50);
    if (businessId !== undefined) query = query.eq("business_id", businessId);

    const rows = unwrap(await query, "document_extraction_runs") as Row[];
    if (rows.length === 0) return [];

    const businessIds = [
      ...new Set(rows.map((row) => requireText(row.business_id, "business_id"))),
    ];
    const businesses = unwrap(
      await this.client()
        .from("businesses")
        .select("id, name")
        .eq("user_id", this.user)
        .in("id", businessIds),
      "businesses",
    ) as Row[];
    const names = new Map(
      businesses.map((row) => [requireText(row.id, "id"), requireText(row.name, "name")]),
    );

    return rows.map((row) => ({
      runId: requireText(row.id, "id"),
      businessId: requireText(row.business_id, "business_id"),
      businessName: names.get(requireText(row.business_id, "business_id")) ?? "Société inconnue",
      status: readStatus(row.status),
      detectedKind: text(row.detected_kind),
      detectedVariant: text(row.detected_variant),
      fiscalYearEnd: text(row.fiscal_year_end),
      fileName: text(row.file_name),
      extractedAt: requireText(row.extracted_at, "extracted_at"),
      fieldCount: finiteNumber(row.field_count, "field_count"),
      failedCheckCount: finiteNumber(row.failed_check_count, "failed_check_count"),
      notComputableCheckCount: finiteNumber(
        row.not_computable_check_count,
        "not_computable_check_count",
      ),
    }));
  }

  async correct(input: DocumentCorrectionRequest): Promise<DocumentExtractionPreview> {
    const runId = requireText(
      await this.rpc("lfo_correct_document_extraction_field", {
        p_payload: {
          field_id: input.fieldId,
          action: input.action,
          user_value: input.userValue ?? null,
          reason: input.reason ?? null,
        },
      }),
      "document_extraction_fields.id",
    );
    const field = unwrap(
      await this.client()
        .from("document_extraction_fields")
        .select("run_id")
        .eq("id", runId)
        .eq("user_id", this.user)
        .maybeSingle(),
      "document_extraction_fields",
    ) as Row;
    return this.getPreview(requireText(field.run_id, "run_id"));
  }

  async validate(runId: string): Promise<DocumentExtractionPreview> {
    await this.rpc("lfo_validate_document_extraction", { p_run_id: runId });
    return this.getPreview(runId);
  }

  async link(input: DocumentLinkRequest): Promise<DocumentLinkResult> {
    const run = await this.readRun(input.runId);
    const fieldRows = unwrap(
      await this.client()
        .from("document_extraction_fields")
        .select("*")
        .eq("user_id", this.user)
        .eq("run_id", input.runId),
      "document_extraction_fields",
    ) as Row[];

    // Le fait écrit est RECONSTRUIT depuis les cases persistées, corrections comprises. Le
    // preview reçu par le client n'entre pas dans cette décision.
    const proposal = this.buildFinancialProposal(fieldRows, run, input.currency);
    if (proposal.periodEnd === null) {
      throw new Error(
        "Exercice non lu dans le document : aucun instantané financier n'est écrit sans date de clôture démontrée",
      );
    }
    if (proposal.revenue === null && proposal.netIncome === null) {
      throw new Error(
        "Ni chiffre d'affaires ni résultat n'ont été retrouvés : un instantané financier vide n'apporte rien",
      );
    }

    await this.rpc("lfo_link_document_extraction_financials", {
      p_payload: {
        run_id: input.runId,
        financials: {
          period_end: proposal.periodEnd,
          // Les DEUX bornes de l'exercice quand le document les imprime. Perdre l'ouverture
          // ferait ressembler un exercice de dix-huit mois à une année normale. La RPC
          // Business Equity V2.1 accepte déjà ces clés : rien n'a eu besoin d'être modifié.
          period_start: text(run.fiscal_year_start),
          period_kind: "ANNUAL",
          currency: input.currency,
          revenue: proposal.revenue?.value ?? null,
          net_income: proposal.netIncome?.value ?? null,
          // ACTUAL : ce sont des chiffres déclarés par la société à l'administration, pas
          // des hypothèses. La confiance reste HIGH pour la même raison.
          data_kind: "ACTUAL",
          confidence: "HIGH",
          source: `Liasse fiscale — lecture ${input.runId}`,
        },
      },
    });

    const updated = await this.readRun(input.runId);
    return { runId: input.runId, status: readStatus(updated.status) };
  }

  async reject(runId: string, reason: string | null): Promise<DocumentLinkResult> {
    await this.rpc("lfo_reject_document_extraction", {
      p_run_id: runId,
      p_reason: reason,
    });
    const run = await this.readRun(runId);
    return { runId, status: readStatus(run.status) };
  }
}

let repository: DocumentRepository | undefined;

export function getDocumentRepository(): DocumentRepository {
  repository ??= new SupabaseDocumentRepository();
  return repository;
}

/** Réexporté pour les tests : la liste des ancres est un contrat, pas un détail. */
export { ROW_ANCHORS, resolveAnchor };
