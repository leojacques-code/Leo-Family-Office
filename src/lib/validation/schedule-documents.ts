import { z } from "zod";

/**
 * Validation des commandes de revue d'un échéancier (B19). La base revalide tout : ce schéma
 * sert à refuser tôt, avec un message lisible, ce qu'elle refuserait de toute façon.
 */

/** Plafond d'un dépôt d'échéancier par la route : sous la limite de corps d'une fonction. */
export const MAX_SCHEDULE_UPLOAD_BYTES = 4 * 1024 * 1024;
export const ACCEPTED_SCHEDULE_EXTENSIONS = [".csv", ".xlsx"] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ attendue")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Cette date n’existe pas au calendrier");

/** Montant en texte décimal : ni NaN, ni Infinity, ni notation exponentielle. */
const decimalText = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Montant décimal attendu (ex. 1234,56)")
  .transform((value) => value.replace(",", "."));

export const scheduleUploadOptionsSchema = z
  .object({
    liabilityId: z.string().uuid(),
    declaredCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Devise en code ISO à trois lettres")
      .nullable(),
  })
  .strict();

const decisionBase = z
  .object({
    fieldId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    reason: z.string().trim().max(500).nullish(),
  })
  .strict();

export const scheduleCommandSchema = z.discriminatedUnion("action", [
  decisionBase
    .extend({
      action: z.literal("correct"),
      userValue: decimalText.optional(),
      userDate: isoDate.optional(),
    })
    .refine(
      (value) => (value.userValue === undefined) !== (value.userDate === undefined),
      "Une correction porte UNE valeur : un montant ou une date. Pour écarter une lecture, utilisez le rejet.",
    ),
  decisionBase.extend({ action: z.literal("reject") }),
  decisionBase.extend({ action: z.literal("review") }),
  z.object({ action: z.literal("validate"), runId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("reject-run"),
      runId: z.string().uuid(),
      reason: z.string().trim().max(500).nullish(),
    })
    .strict(),
]);

export type ScheduleCommand = z.infer<typeof scheduleCommandSchema>;
