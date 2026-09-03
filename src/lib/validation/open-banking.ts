/**
 * Validation des entrées Open Banking (AIS), lecture seule.
 *
 * Deux principes portés ici, et pas ailleurs :
 *
 *   * le client ne DÉCRIT jamais une observation. Il choisit un scénario sandbox par son
 *     NOM ; laisser passer des opérations saisies ferait de l'écran une porte d'injection
 *     de faits « bancaires » ;
 *   * aucun champ de SECRET n'existe dans ces schémas. Un jeton, un secret client ou une
 *     clé de signature n'a aucun chemin pour entrer par cette route.
 */

import { z } from "zod";

import { BANK_CONSENT_SCOPES, BANK_RECONCILIATION_DECISIONS } from "@/lib/acquisition/banking";
import { SANDBOX_SCENARIO_NAMES } from "@/lib/data/open-banking-scenarios";

const scenarioName = z.enum(SANDBOX_SCENARIO_NAMES as [string, ...string[]]);

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Horodatage illisible");

export const openBankingCommandSchema = z.discriminatedUnion("action", [
  /** Enregistre l'adaptateur sandbox et ses capacités déclarées. */
  z.object({ action: z.literal("register-sandbox") }).strict(),

  z
    .object({
      action: z.literal("open-consent"),
      providerId: z.uuid(),
      consentReference: z.string().min(1).max(200),
      scopes: z.array(z.enum(BANK_CONSENT_SCOPES)).min(1),
      /**
       * `null` = le fournisseur ne DÉCLARE aucune expiration. Ce n'est pas « sans
       * expiration » : la base enregistre l'absence de déclaration comme telle.
       */
      expiresAt: isoDateTime.nullable(),
    })
    .strict(),

  z
    .object({
      action: z.literal("revoke-consent"),
      consentId: z.uuid(),
      // Une révocation se MOTIVE : sans motif elle serait irrelisible dans six mois.
      reason: z.string().min(1).max(500),
    })
    .strict(),

  z
    .object({
      action: z.literal("discover-accounts"),
      consentId: z.uuid(),
      scenario: scenarioName,
    })
    .strict(),

  z
    .object({
      action: z.literal("map-account"),
      providerAccountId: z.uuid(),
      // `null` = détachement. Les observations demeurent, l'alimentation cesse.
      accountId: z.uuid().nullable(),
      reason: z.string().min(1).max(500).nullable(),
    })
    .strict(),

  z
    .object({
      action: z.literal("synchronize"),
      providerAccountId: z.uuid(),
      trigger: z.enum(["MANUAL", "WEBHOOK", "SCHEDULED"]),
      scenario: scenarioName,
    })
    .strict(),

  z
    .object({
      action: z.literal("decide"),
      observationId: z.uuid(),
      decision: z.enum(BANK_RECONCILIATION_DECISIONS),
      linkedTransactionId: z.uuid().nullable(),
      reason: z.string().min(1).max(500).nullable(),
      sessionId: z.uuid().nullable(),
    })
    .strict()
    .refine((value) => value.decision !== "LINK_EXISTING" || value.linkedTransactionId !== null, {
      message: "Un rattachement doit DÉSIGNER une transaction",
    })
    .refine((value) => value.decision !== "REFUSE" || value.reason !== null, {
      message: "Un refus doit être MOTIVÉ",
    })
    .refine((value) => value.decision !== "ACCEPT_NEW" || value.linkedTransactionId === null, {
      message: "Une acceptation ne désigne aucune transaction existante",
    }),

  z
    .object({
      action: z.literal("commit"),
      sessionId: z.uuid(),
      /**
       * Lignes SIGNALÉES incluses nommément. Les lignes prêtes sont écrites sans figurer
       * ici ; une ligne bloquée, doublon ou ignorée ne peut jamais l'être, même nommée.
       */
      includeRecordIds: z.array(z.uuid()).max(5000),
    })
    .strict(),

  z
    .object({
      action: z.literal("record-event"),
      providerId: z.uuid(),
      consentId: z.uuid().nullable(),
      providerEventId: z.string().min(1).max(200),
      eventType: z.string().min(1).max(100),
      payload: z.record(z.string(), z.unknown()),
      /**
       * La signature a-t-elle été VÉRIFIÉE côté serveur ? Un événement non vérifié est
       * conservé et ne déclenche rien : la base refuse de lui rattacher une exécution.
       */
      signatureVerified: z.boolean(),
    })
    .strict(),
]);

export type OpenBankingCommand = z.infer<typeof openBankingCommandSchema>;
