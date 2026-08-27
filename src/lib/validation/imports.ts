/**
 * Validation des entrées de la couche d'acquisition.
 *
 * Volontairement dans son propre module : `src/lib/validation/mutations.ts` porte les
 * mutations des domaines financiers, et cette PR n'a aucune raison d'y toucher.
 */

import { z } from "zod";

import { BANK_TARGET_FIELDS } from "@/lib/acquisition/types";
import { MAX_ROWS_PER_SESSION } from "@/lib/acquisition/bank-csv";

/** 8 Mo : la limite du bucket Storage privé, donc la limite réelle d'un fichier conservé. */
export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;

/** Extensions acceptées. Le type MIME envoyé par les navigateurs n'est pas fiable pour un CSV. */
export const ACCEPTED_IMPORT_EXTENSIONS = [".csv", ".tsv", ".txt"] as const;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date inexistante au calendrier");

/**
 * Mapping imposé : un index de colonne par champ cible. Un champ inconnu est REFUSÉ plutôt
 * qu'ignoré — accepter en silence une clé inconnue laisserait croire qu'elle a servi.
 */
const mappingSchema = z
  .object(
    Object.fromEntries(
      BANK_TARGET_FIELDS.map((field) => [field, z.number().int().min(0).max(512).optional()]),
    ) as Record<(typeof BANK_TARGET_FIELDS)[number], z.ZodOptional<z.ZodNumber>>,
  )
  .strict();

export const importAnalyzeSchema = z
  .object({
    accountId: z.uuid(),
    // `null` est une valeur : « aucune devise déclarée ». Les lignes sans devise seront
    // bloquées, jamais complétées d'office.
    declaredCurrency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase())
      .nullable(),
    declaredPeriodStart: date.nullable(),
    declaredPeriodEnd: date.nullable(),
    mapping: mappingSchema.nullable(),
    /**
     * Déclaration explicite de stabilité de l'identifiant. Elle n'est jamais déduite d'un
     * nom de colonne : c'est ce qui empêche une simple référence bancaire de faire
     * disparaître une opération réelle.
     */
    stableTransactionIdDeclared: z.boolean(),
    rememberMapping: z.boolean(),
    retainFile: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.declaredPeriodStart === null ||
      value.declaredPeriodEnd === null ||
      value.declaredPeriodEnd >= value.declaredPeriodStart,
    { message: "La période déclarée se termine avant de commencer" },
  );

export const importCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("commit"),
      sessionId: z.uuid(),
      /**
       * Lignes SIGNALÉES que l'utilisateur inclut nommément. Les lignes prêtes sont
       * écrites sans figurer ici ; une ligne bloquée, ignorée ou doublon ne peut jamais
       * l'être, même en la nommant.
       */
      includeRecordIds: z.array(z.uuid()).max(MAX_ROWS_PER_SESSION),
    })
    .strict(),
  z.object({ action: z.literal("discard"), sessionId: z.uuid() }).strict(),
]);

export type ImportAnalyzeInput = z.infer<typeof importAnalyzeSchema>;
export type ImportCommand = z.infer<typeof importCommandSchema>;
