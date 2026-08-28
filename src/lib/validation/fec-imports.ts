/**
 * Validation des entrées de l'acquisition comptable.
 *
 * Dans son propre module, comme `imports.ts` : l'import bancaire et l'import comptable
 * partagent la fondation, pas leurs paramètres.
 */

import { z } from "zod";

import { MAX_FEC_LINES } from "@/lib/acquisition/fec";

/**
 * 24 Mo pour l'ANALYSE. Un FEC d'exercice complet est un fichier texte long : 150 000 lignes
 * de dix-huit champs pèsent bien plus qu'un relevé bancaire.
 */
export const MAX_FEC_FILE_BYTES = 24 * 1024 * 1024;

/**
 * 8 Mo pour la CONSERVATION : c'est la capacité réelle du coffre privé.
 *
 * Les deux plafonds diffèrent, et les confondre serait pire que les séparer. Un FEC de
 * 15 Mo est parfaitement analysable ; il n'est simplement pas archivable ici. La demande de
 * conservation est donc refusée EN AMONT, avant toute écriture canonique, plutôt que de
 * laisser un dépôt échouer après que les faits ont été écrits.
 */
export const MAX_RETAINED_FEC_FILE_BYTES = 8 * 1024 * 1024;

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

/**
 * Demande d'un billet d'upload. Le client déclare la TAILLE et le NOM du fichier ; il ne
 * choisit ni le chemin de stockage, ni l'identifiant du billet — les deux sont calculés
 * côté serveur. Une API qui croit un chemin fourni par son appelant laisse lire, ou
 * écraser, le fichier d'un autre.
 */
export const fecUploadTicketSchema = z
  .object({
    // L'extension est contrôlée ICI : le fichier ne traverse plus la route, donc c'est le
    // seul moment où le serveur voit son nom avant qu'un objet soit déposé.
    fileName: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (value) =>
          ACCEPTED_FEC_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension)),
        `Extension non acceptée. Formats lus : ${ACCEPTED_FEC_EXTENSIONS.join(", ")}.`,
      ),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(MAX_FEC_FILE_BYTES, `Fichier supérieur à ${MAX_FEC_FILE_BYTES / (1024 * 1024)} Mo.`),
    /**
     * L'utilisateur demandera-t-il la conservation du fichier ? Déclaré ici pour que le
     * refus tombe AVANT le dépôt, et non après l'écriture des faits.
     */
    retainFile: z.boolean(),
  })
  .strict()
  .refine((value) => value.retainFile === false || value.byteSize <= MAX_RETAINED_FEC_FILE_BYTES, {
    message: `Ce fichier peut être analysé mais pas conservé : le coffre privé est limité à ${MAX_RETAINED_FEC_FILE_BYTES / (1024 * 1024)} Mo. Décochez la conservation du fichier.`,
  });

export const fecAnalyzeSchema = z
  .object({
    // Le fichier est DÉJÀ au stockage privé : cette requête n'en porte qu'une référence
    // émise par le serveur. Aucun chemin, aucun contenu, aucune taille ne vient du client.
    uploadTicketId: z.uuid(),
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
