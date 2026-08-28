/**
 * Validation des entrées de l'acquisition comptable.
 *
 * Dans son propre module, comme `imports.ts` : l'import bancaire et l'import comptable
 * partagent la fondation, pas leurs paramètres.
 */

import { z } from "zod";

import { MAX_FEC_LINES } from "@/lib/acquisition/fec";

/**
 * 24 Mo. Un FEC d'exercice complet est un fichier texte long — 200 000 lignes de dix-huit
 * champs pèsent bien plus qu'un relevé bancaire. Le plafond du coffre privé reste à 8 Mo,
 * donc au-delà la conservation du fichier échouera : l'analyse, elle, reste possible.
 */
export const MAX_FEC_FILE_BYTES = 24 * 1024 * 1024;

/** Au-delà, le fichier est refusé plutôt que tronqué. Un exercice amputé produirait des
 * états faux et d'apparence complète. */
export const MAX_FEC_ROWS = MAX_FEC_LINES;

/** Extensions acceptées. Le format réglementaire prévoit un fichier texte à plat. */
export const ACCEPTED_FEC_EXTENSIONS = [".txt", ".csv", ".tsv"] as const;

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date inexistante au calendrier");

export const fecAnalyzeSchema = z
  .object({
    businessId: z.uuid(),
    /**
     * Devise de TENUE, déclarée. Le FEC n'en porte pas : la supposer serait un taux de
     * change implicite égal à 1.
     */
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase()),
    fiscalYearStart: date.nullable(),
    fiscalYearEnd: date.nullable(),
    /**
     * Déclaration explicite de couverture. Jamais déduite des dates du fichier : des bornes
     * observées ne prouvent pas qu'un exercice est complet.
     */
    coverageDeclared: z.boolean(),
    retainFile: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.fiscalYearStart === null ||
      value.fiscalYearEnd === null ||
      value.fiscalYearEnd > value.fiscalYearStart,
    { message: "L'exercice déclaré se termine avant de commencer" },
  )
  .refine(
    (value) =>
      value.coverageDeclared === false ||
      (value.fiscalYearStart !== null && value.fiscalYearEnd !== null),
    {
      message:
        "Déclarer la couverture d'un exercice suppose d'en donner les bornes : sans elles, il n'y a pas d'exercice à couvrir.",
    },
  );

export const fecCommandSchema = z.discriminatedUnion("action", [
  // Aucune liste de lignes à inclure : un état financier est un agrégat, il ne se valide
  // pas ligne à ligne. Toute écriture lisible de la session entre dans la reconstruction.
  z.object({ action: z.literal("commit"), sessionId: z.uuid() }).strict(),
  z.object({ action: z.literal("discard"), sessionId: z.uuid() }).strict(),
]);

export type FecAnalyzeInput = z.infer<typeof fecAnalyzeSchema>;
export type FecCommand = z.infer<typeof fecCommandSchema>;
