/**
 * Validation des entrées de Document Intelligence.
 *
 * Dans son propre module, comme `imports.ts` et `fec-imports.ts` : les trois verticales
 * partagent la fondation, pas leurs paramètres.
 */

import { z } from "zod";

/**
 * 12 Mo pour l'ANALYSE d'un PDF.
 *
 * Une liasse fiscale complète, générée par un logiciel comptable, pèse couramment moins d'un
 * mégaoctet ; une liasse numérisée en 300 points par pouce en pèse dix. Le plafond couvre donc
 * le cas scanné — qui sera refusé pour une autre raison, l'absence de couche texte — plutôt
 * que de le rejeter sur la taille et de laisser croire à un problème de poids.
 */
export const MAX_DOCUMENT_FILE_BYTES = 12 * 1024 * 1024;

/**
 * 8 Mo pour la CONSERVATION : c'est la capacité réelle du coffre privé.
 *
 * Les deux plafonds diffèrent, et les confondre serait pire que les séparer. Un PDF de 10 Mo
 * est parfaitement analysable ; il n'est simplement pas archivable ici. La demande de
 * conservation est donc refusée EN AMONT, avant toute écriture, plutôt que de laisser un dépôt
 * échouer après la lecture.
 */
export const MAX_RETAINED_DOCUMENT_FILE_BYTES = 8 * 1024 * 1024;

/** Un PDF, et rien d'autre. L'OCR n'existe pas : une image ne serait pas lisible. */
export const ACCEPTED_DOCUMENT_EXTENSIONS = [".pdf"] as const;

export const documentTicketSchema = z.object({
  // L'extension est contrôlée ICI : le fichier ne traverse plus la route, c'est donc le seul
  // moment où le serveur voit son nom avant qu'un objet soit déposé.
  fileName: z
    .string()
    .min(1)
    .max(240)
    .refine(
      (value) =>
        ACCEPTED_DOCUMENT_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension)),
      `Extension non acceptée. Format lu : ${ACCEPTED_DOCUMENT_EXTENSIONS.join(", ")}.`,
    ),
  byteSize: z.number().int().positive().max(MAX_DOCUMENT_FILE_BYTES),
  retainFile: z.boolean(),
});

export const documentAnalyzeSchema = z.object({
  ticketId: z.string().uuid(),
  businessId: z.string().uuid(),
  retainFile: z.boolean(),
});

const documentCorrectionBase = z.object({
  fieldId: z.string().uuid(),
  userValue: z.number().finite().nullish(),
  reason: z.string().trim().max(500).nullish(),
});

/**
 * Corriger vers rien n'est pas une correction, c'est un rejet — et le rejet a sa propre
 * action. Sans cette règle, un champ passerait en `CORRECTED` sans valeur, ce que la base
 * refuse de toute façon : autant le dire ici, avec un message lisible.
 */
const correctionCarriesValue = (value: { userValue?: number | null }) =>
  value.userValue !== null && value.userValue !== undefined;

export const documentCorrectionSchema = documentCorrectionBase
  .extend({ action: z.enum(["correct", "reject", "review"]) })
  .refine(
    (value) => value.action !== "correct" || correctionCarriesValue(value),
    "Une correction porte une valeur. Pour écarter une lecture, utilisez le rejet.",
  );

export const documentLinkSchema = z.object({
  runId: z.string().uuid(),
  // Une liasse française n'imprime pas son code devise : il est DÉCLARÉ, jamais deviné.
  // FX ABSENT ≠ FX ÉGAL À 1, et un montant sans devise n'est pas un montant.
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), "Code devise ISO 4217 attendu"),
});

export const documentRejectSchema = z.object({
  runId: z.string().uuid(),
  reason: z.string().trim().max(500).nullish(),
});

export const documentValidateSchema = z.object({
  runId: z.string().uuid(),
});

/** Commandes d'écriture, discriminées par leur action. */
export const documentCommandSchema = z
  .discriminatedUnion("action", [
    documentCorrectionBase.extend({ action: z.literal("correct") }),
    documentCorrectionBase.extend({ action: z.literal("reject") }),
    documentCorrectionBase.extend({ action: z.literal("review") }),
    documentValidateSchema.extend({ action: z.literal("validate") }),
    documentLinkSchema.extend({ action: z.literal("link") }),
    documentRejectSchema.extend({ action: z.literal("reject-run") }),
  ])
  .refine(
    (value) => value.action !== "correct" || correctionCarriesValue(value),
    "Une correction porte une valeur. Pour écarter une lecture, utilisez le rejet.",
  );

export type DocumentCommand = z.infer<typeof documentCommandSchema>;
