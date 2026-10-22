import "server-only";

import { EXTRACTION_FIELD_STATUSES } from "@/lib/acquisition/documents/types";
import type { DocumentFieldDecisionView } from "./document-contracts";
import { finiteNumber, nullableFiniteNumber } from "./row-validation";
import type { supabaseAdmin } from "./supabase-client";
import { SupabaseOperationError } from "./supabase-errors";

const PAGE_SIZE = 1000;
const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
function requiredText(value: unknown): string {
  const result = text(value);
  if (result === null) throw new Error("Journal documentaire incomplet");
  return result;
}
function member<T extends string>(value: unknown, choices: readonly T[]): T {
  const result = choices.find((choice) => choice === value);
  if (result === undefined) throw new Error("Statut du journal documentaire inconnu");
  return result;
}

/** Une seule lecture du journal immuable, bornée par propriétaire et lecture, sans troncature. */
export async function readDocumentFieldDecisions(
  client: ReturnType<typeof supabaseAdmin>,
  userId: string,
  runId: string,
): Promise<DocumentFieldDecisionView[]> {
  const decisions: DocumentFieldDecisionView[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await client
      .from("document_field_decisions")
      .select("*")
      .eq("user_id", userId)
      .eq("run_id", runId)
      .order("decided_at", { ascending: true })
      .order("decision_rank", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw new SupabaseOperationError("document_field_decisions", result.error);
    if (result.data === null) throw new Error("Journal documentaire indisponible");
    const page = result.data as Record<string, unknown>[];
    decisions.push(
      ...page.map((row): DocumentFieldDecisionView => ({
        fieldId: requiredText(row.field_id),
        rank: finiteNumber(row.decision_rank, "decision_rank"),
        action: member(row.action, ["REVIEW", "CORRECT", "REJECT"] as const),
        beforeStatus: member(row.before_status, EXTRACTION_FIELD_STATUSES),
        beforeValue: nullableFiniteNumber(row.before_value, "before_value"),
        beforeDate: text(row.before_date),
        afterStatus: member(row.after_status, EXTRACTION_FIELD_STATUSES),
        afterValue: nullableFiniteNumber(row.after_value, "after_value"),
        afterDate: text(row.after_date),
        reason: text(row.reason),
        decidedAt: requiredText(row.decided_at),
        actor:
          text(row.actor_user_id) === null
            ? null
            : row.actor_user_id === userId
              ? "CURRENT_USER"
              : "OTHER",
      })),
    );
    if (page.length < PAGE_SIZE) break;
  }
  return decisions;
}
