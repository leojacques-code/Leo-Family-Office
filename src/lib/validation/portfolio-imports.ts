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
/**
 * REPRÉSENTATION DÉCIMALE EXACTE, telle que PostgreSQL l'ÉMET : chiffres, point décimal
 * optionnel, signe optionnel.
 *
 * Le même motif est appliqué en base. `NaN`, `Infinity` et la notation exponentielle sont
 * refusés — `numeric` les accepterait, mais aucun n'est une quantité ni un montant. Une
 * chaîne vide ou blanche est refusée aussi : ce n'est ni un nombre, ni une absence.
 */
const EXACT_DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

/**
 * Un montant attendu : chaîne décimale exacte, ou `null` EXPLICITE.
 *
 * `.nullable()` et NON `.nullish()` / `.optional()`, et c'est tout le finding : les trois
 * situations ci-dessous étaient aplaties sur un même `NULL` SQL par un `coalesce`/`nullif`,
 * alors qu'elles ne disent pas la même chose.
 *
 *   clé ABSENTE     → invalide. Le client n'a rien dit de ce champ, et l'interpréter comme
 *                     « valeur absente » ferait passer un OUBLI pour une déclaration. Un
 *                     état attendu bâti sur un oubli se trouve « d'accord » avec une
 *                     observation dont l'appelant ne sait rien : le conflit de concurrence
 *                     ne se déclenche pas, et un fait est remplacé sans que rien ne
 *                     l'annonce ;
 *   JSON `null`     → valide. C'est une absence DÉCLARÉE, et elle se compare ;
 *   `""` ou `"  "`  → invalide. Illisible, donc ni un nombre ni une absence ;
 *   `"0"`           → VALIDE, et vaut zéro. NULL ≠ ZERO ;
 *   `"10.50"`       → valide, et égal à `"10.5"` : la base compare en `numeric`, jamais en
 *                     texte, donc une différence de forme ne fabrique pas de conflit.
 *
 * Le type reste une CHAÎNE et jamais un nombre : un `numeric(30,10)` ne traverse pas un
 * flottant double sans risque de perte, et une perte de précision fabriquerait un conflit —
 * ou, plus grave, en masquerait un.
 */
const expectedAmountSchema = z
  .string()
  .max(60)
  .regex(EXACT_DECIMAL, {
    message:
      "Montant attendu : chaîne décimale exacte (ex. « 1810.000000 », « 0 », « -5.25 ») ou `null` explicite. Une chaîne vide n'est ni un nombre ni une absence",
  })
  .nullable();

/**
 * Les CINQ clés sont exigées. Aucune n'est optionnelle, et aucune autre n'est acceptée : sans
 * `strict()`, `marketvalue` au lieu de `marketValue` serait lu comme une clé absente, et le
 * message désignerait un oubli là où il y a une faute de frappe.
 */
const portfolioObservedValuesSchema = z
  .object({
    snapshotId: z.uuid(),
    quantity: expectedAmountSchema,
    costBasis: expectedAmountSchema,
    marketValue: expectedAmountSchema,
    // La devise n'est JAMAIS absente : `position_snapshots.currency` est `char(3) not null`.
    // FX ABSENT ≠ FX ÉGAL À 1, et comparer une devise contre rien n'a pas de sens.
    currency: z.string().regex(/^[A-Za-z]{3}$/, {
      message: "Devise attendue : code de TROIS lettres",
    }),
  })
  .strict();

/**
 * DÉCISION de remplacer une observation de position déjà persistée.
 *
 * `reason` est obligatoire et non vide APRÈS `trim` : « » et «    » sont le même vide, et un
 * motif blanc laisserait la piste d'audit sans réponse à « pourquoi cette valeur ».
 */
const portfolioCorrectionDecisionSchema = z
  .object({
    recordId: z.uuid(),
    reason: z.string().trim().min(1).max(2000),
    expected: portfolioObservedValuesSchema,
  })
  // `strict()` REFUSE toute clé d'acteur. `decidedBy` était une identité déclarée librement
  // par le navigateur, présentée dans la piste d'audit à côté d'un rôle constaté : une piste
  // dont le champ « qui » est déclaratif ne répond pas à « qui a décidé », elle répond à
  // « qui l'appelant a bien voulu nommer ». L'acteur est désormais l'identité que le SERVEUR
  // établit, et le client n'a aucun moyen de la fournir. La base refuse ces clés aussi :
  // ignorer laisserait un appelant croire qu'il a nommé quelqu'un.
  .strict();

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
