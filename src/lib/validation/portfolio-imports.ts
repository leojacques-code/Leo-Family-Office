/**
 * Validation des entrées de l'import de portefeuille.
 *
 * Dans son propre module, comme `imports.ts`, `fec-imports.ts` et `public-data.ts` : les
 * verticales partagent la fondation, pas leurs paramètres.
 *
 * Ce que le client N'A PAS le droit de fournir :
 *
 *   * un chemin de stockage. Il est CALCULÉ en base à partir du propriétaire et du billet ;
 *     une API qui croit un chemin fourni par son appelant laisse lire, ou écraser, le fichier
 *     d'un autre ;
 *   * un statut de ligne, un verdict de déduplication ou une clé d'identité. Ils sont
 *     dérivés de la lecture, côté serveur ;
 *   * un instrument créé à la volée. Le rattachement désigne un instrument EXISTANT.
 */

import { z } from "zod";

import { LEDGER_TARGET_FIELDS, POSITION_TARGET_FIELDS } from "@/lib/acquisition/portfolio/types";
import { MAX_PORTFOLIO_ROWS } from "@/lib/acquisition/portfolio/analyze";
import { MAX_XLSX_BYTES } from "@/lib/acquisition/xlsx/workbook";

/**
 * 16 Mio pour l'ANALYSE : c'est le plafond du lecteur de classeur, et l'aligner évite qu'un
 * fichier accepté au dépôt soit refusé à la lecture — un échec après dépôt laisserait un
 * objet orphelin au stockage.
 */
export const MAX_PORTFOLIO_FILE_BYTES = MAX_XLSX_BYTES;

/** Extensions acceptées. Le contenu décide ensuite : une extension ne prouve rien. */
export const ACCEPTED_PORTFOLIO_EXTENSIONS = [".csv", ".tsv", ".txt", ".xlsx"] as const;

/**
 * Types MIME acceptés au dépôt. `.xlsm` est ABSENT volontairement : un classeur porteur de
 * macros est refusé, et le refuser au dépôt évite de stocker un fichier qu'on ne lira pas.
 */
export const ACCEPTED_PORTFOLIO_CONTENT_TYPES = [
  "text/csv",
  "text/plain",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
] as const;

const targetField = z.enum([...LEDGER_TARGET_FIELDS, ...POSITION_TARGET_FIELDS]);

const mappingSchema = z.record(targetField, z.number().int().min(0).max(4096));

export const portfolioTicketSchema = z.object({
  action: z.literal("ticket"),
  fileName: z
    .string()
    .min(1)
    .max(240)
    .refine(
      (value) =>
        ACCEPTED_PORTFOLIO_EXTENSIONS.some((extension) => value.toLowerCase().endsWith(extension)),
      `Extension attendue parmi ${ACCEPTED_PORTFOLIO_EXTENSIONS.join(", ")}. Un classeur à macros (.xlsm) est refusé : aucune macro n'est exécutée`,
    ),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(
      MAX_PORTFOLIO_FILE_BYTES,
      `Fichier trop volumineux : le plafond est de ${MAX_PORTFOLIO_FILE_BYTES} octets. Il est refusé, jamais tronqué`,
    ),
  contentType: z.enum(ACCEPTED_PORTFOLIO_CONTENT_TYPES),
  retainFile: z.boolean().default(true),
});

export const portfolioAnalyzeSchema = z.object({
  action: z.literal("analyze"),
  ticketId: z.uuid(),
  kind: z.enum(["PORTFOLIO_LEDGER", "PORTFOLIO_POSITION"]),
  accountId: z.uuid("Enveloppe cible attendue"),
  /** Devise DÉCLARÉE de l'enveloppe, servant de repli SIGNALÉ. */
  declaredCurrency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase())
    .nullable()
    .default(null),
  mapping: mappingSchema.nullable().default(null),
  sheetName: z.string().trim().min(1).max(120).nullable().default(null),
  /**
   * Déclaration de stabilité de la référence d'opération. Fausse par défaut, et ce défaut
   * est le bon : prendre une référence de courtier répétée pour une identité ferait
   * disparaître des opérations réelles.
   */
  stableReferenceDeclared: z.boolean().default(false),
  rememberMapping: z.boolean().default(true),
});

export const portfolioResolveSchema = z
  .object({
    action: z.literal("resolve-instrument"),
    resolutionId: z.uuid(),
    decision: z.enum(["RESOLVE", "REJECT"]),
    /** Instrument EXISTANT du référentiel. Aucun n'est créé par cette route. */
    securityId: z.uuid().nullable().default(null),
    reason: z.string().trim().min(1).max(2000).nullable().default(null),
  })
  .refine((value) => value.decision !== "RESOLVE" || value.securityId !== null, {
    message: "Rattacher un instrument exige de désigner lequel",
  })
  .refine((value) => value.decision !== "REJECT" || value.reason !== null, {
    message:
      "Écarter un instrument exige un motif : les lignes qui le citent ne seront pas écrites",
  });

/** Champs corrigibles. Le statut, le verdict et l'identité n'en font PAS partie. */
const CORRECTABLE_FIELDS = [
  "factDate",
  "eventType",
  "quantity",
  "unitPrice",
  "grossAmount",
  "feeAmount",
  "taxAmount",
  "envelopeCashAmount",
  "marketValue",
  "costBasis",
  "currency",
  "label",
] as const;

export const portfolioCorrectSchema = z.object({
  action: z.literal("correct"),
  recordId: z.uuid(),
  values: z
    .record(z.enum(CORRECTABLE_FIELDS), z.string().trim().max(200).nullable())
    .refine((value) => Object.keys(value).length > 0, {
      message: "Une correction dit QUEL champ change et par quoi",
    }),
  reason: z.string().trim().min(1).max(2000),
});

/**
 * Valeurs comparées d'une observation, telles que la base les a rendues.
 *
 * Les montants sont des CHAÎNES, et volontairement : PostgreSQL les rend en texte via un
 * `::text` explicite dans la lecture, et les faire passer par un nombre JavaScript perdrait
 * de la précision sur un `numeric(30,10)`. Un écart de précision fabriquerait un conflit de
 * concurrence imaginaire — ou, plus grave, en masquerait un vrai.
 *
 * Le format n'est PAS contraint à une forme canonique : `10.50` et `10.5` sont le même
 * nombre, et c'est la base qui les compare en `numeric`, jamais en texte.
 */
const portfolioObservedValuesSchema = z.object({
  snapshotId: z.uuid(),
  quantity: z.string().trim().max(60).nullable(),
  costBasis: z.string().trim().max(60).nullable(),
  marketValue: z.string().trim().max(60).nullable(),
  currency: z.string().trim().length(3),
});

/**
 * DÉCISION de remplacer une observation de position déjà persistée.
 *
 * `reason` est obligatoire et non vide APRÈS `trim` : « » et «    » sont le même vide, et un
 * motif blanc laisserait la piste d'audit sans réponse à « pourquoi cette valeur ».
 */
const portfolioCorrectionDecisionSchema = z.object({
  recordId: z.uuid(),
  reason: z.string().trim().min(1).max(2000),
  /**
   * Identité DÉCLARÉE. Facultative : la base retombe alors sur le rôle PostgreSQL constaté
   * plutôt que sur une personne inventée.
   */
  decidedBy: z.string().trim().min(1).max(200).optional(),
  expected: portfolioObservedValuesSchema,
});

export const portfolioCommitSchema = z.object({
  action: z.literal("commit"),
  sessionId: z.uuid(),
  /**
   * Lignes RETENUES par l'utilisateur. Une ligne signalée n'est écrite que si elle est
   * cochée ; une ligne bloquée, doublon ou ignorée est refusée par la base.
   */
  recordIds: z.array(z.uuid()).max(MAX_PORTFOLIO_ROWS),
  /**
   * DÉCISIONS de correction d'observations déjà persistées.
   *
   * Vide par défaut, et c'est le point : une observation persistée est un fait, et un second
   * fichier portant la même date ne suffit pas à autoriser son remplacement. Sans décision,
   * la validation REFUSE et nomme ce qui change.
   *
   * Le contrat précédent n'exigeait qu'un tableau d'identifiants. Il est refusé ici et par
   * la base : un identifiant seul ne dit ni pourquoi, ni par qui, ni sur la foi de quel état
   * courant, et il ne conservait rien de la valeur remplacée.
   */
  corrections: z
    .array(portfolioCorrectionDecisionSchema)
    .max(MAX_PORTFOLIO_ROWS)
    .default([])
    // Deux décisions pour la même ligne rendraient le motif conservé INDÉTERMINÉ. La base
    // le refuse aussi : ce contrôle-ci rend seulement le message lisible côté client.
    .refine((decisions) => new Set(decisions.map((d) => d.recordId)).size === decisions.length, {
      message: "Deux décisions pour la même ligne : le motif conservé serait indéterminé",
    }),
});

export const portfolioDiscardSchema = z.object({
  action: z.literal("discard"),
  sessionId: z.uuid(),
});

export const portfolioImportCommandSchema = z.discriminatedUnion("action", [
  portfolioTicketSchema,
  portfolioAnalyzeSchema,
  portfolioResolveSchema,
  portfolioCorrectSchema,
  portfolioCommitSchema,
  portfolioDiscardSchema,
]);

export type PortfolioImportCommandInput = z.infer<typeof portfolioImportCommandSchema>;
