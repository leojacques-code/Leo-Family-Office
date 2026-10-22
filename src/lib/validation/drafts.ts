import { z } from "zod";
import { FORM_DRAFT_KINDS } from "@/lib/presentation/drafts/contracts";

/** Plafond applicatif, sous celui de la base (64 Kio) : un brouillon n'est pas un document. */
export const MAX_DRAFT_CONTENT_CHARACTERS = 60_000;

export const formDraftSaveSchema = z
  .object({
    draftId: z.uuid().nullable(),
    expectedVersion: z.number().int().positive().nullable(),
    kind: z.enum(FORM_DRAFT_KINDS),
    subjectId: z.uuid().nullable(),
    title: z.string().trim().min(1).max(160),
    content: z
      .record(z.string(), z.unknown())
      .refine(
        (content) => JSON.stringify(content).length <= MAX_DRAFT_CONTENT_CHARACTERS,
        "Brouillon trop volumineux",
      ),
    schemaVersion: z.number().int().min(1).max(1000),
  })
  .strict()
  .refine((input) => (input.draftId === null) === (input.expectedVersion === null), {
    message: "Une version attendue accompagne toujours un brouillon existant",
    path: ["expectedVersion"],
  })
  .refine((input) => (input.kind === "DEBT_CONTRACT_NEW") === (input.subjectId === null), {
    message: "Seule une dette nouvelle n'a pas de dette visée",
    path: ["subjectId"],
  });

export const formDraftDeleteSchema = z
  .object({ draftId: z.uuid(), expectedVersion: z.number().int().positive() })
  .strict();
