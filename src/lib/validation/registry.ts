/**
 * Validation des entrées de l'acquisition du registre d'entreprises.
 *
 * Deux exigences propres à cette verticale :
 *
 *   * un SIREN est validé sur sa FORME, jamais sur sa clé de contrôle. Des identifiants
 *     réellement attribués échouent au calcul de clé, et refuser ici bloquerait une société
 *     qui existe. La clé est vérifiée plus loin, et son échec est un avertissement porté par
 *     la lecture ;
 *   * aucun schéma n'accepte de secret. Un jeton de fournisseur ne transite jamais par une
 *     requête du navigateur : il est lu côté serveur dans la variable d'environnement que la
 *     connexion DÉCLARE.
 */

import { z } from "zod";

import { ENRICHABLE_FIELDS, REGISTRY_PROVIDERS } from "@/lib/acquisition/registry/types";

const provider = z.enum(REGISTRY_PROVIDERS);

/** Forme seule : neuf chiffres. Les séparateurs de saisie sont retirés en amont. */
const siren = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D+/g, ""))
  .refine((value) => /^\d{9}$/.test(value), "Un SIREN comporte neuf chiffres");

const siret = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D+/g, ""))
  .refine((value) => /^\d{14}$/.test(value), "Un SIRET comporte quatorze chiffres");

export const registrySearchSchema = z
  .object({
    provider,
    text: z.string().trim().min(2).max(200).optional(),
    siren: siren.optional(),
    officerName: z.string().trim().min(2).max(200).optional(),
    page: z.number().int().min(1).max(50).optional(),
    perPage: z.number().int().min(1).max(25).optional(),
  })
  // Une recherche sans critère renverrait le registre entier page par page : ce n'est pas
  // une recherche, c'est une consommation de quota.
  .refine(
    (value) =>
      value.text !== undefined || value.siren !== undefined || value.officerName !== undefined,
    "Précisez au moins une raison sociale, un SIREN ou un nom de dirigeant",
  );

export const registryLookupSchema = z.object({
  provider,
  siren,
  /** `true` force un appel neuf : l'utilisateur assume la consommation de quota. */
  refresh: z.boolean().optional(),
});

export const registryLinkSchema = z.object({
  businessId: z.string().uuid(),
  provider,
  siren,
  siret: siret.nullish(),
  snapshotId: z.string().uuid().nullish(),
  notes: z.string().trim().max(500).nullish(),
});

export const registryUnlinkSchema = z.object({
  businessId: z.string().uuid(),
  provider,
});

export const registryProposeSchema = z.object({
  businessId: z.string().uuid(),
  snapshotId: z.string().uuid(),
});

export const registryDecisionSchema = z.object({
  businessId: z.string().uuid(),
  reason: z.string().trim().max(500).nullish(),
  decisions: z
    .array(
      z.object({
        decisionId: z.string().uuid(),
        action: z.enum(["accept", "reject"]),
      }),
    )
    .min(1)
    .max(ENRICHABLE_FIELDS.length),
});

export const registryStateSchema = z.object({
  businessId: z.string().uuid(),
});

/**
 * Commandes d'écriture, discriminées par leur action.
 *
 * Chaque variante est un objet COMPLET plutôt qu'une intersection : une union discriminée se
 * construit sur des objets, et une intersection ferait perdre au parseur le discriminant
 * qu'il doit lire pour choisir la branche.
 */
export const registryCommandSchema = z.discriminatedUnion("action", [
  registryLinkSchema.extend({ action: z.literal("link") }),
  registryUnlinkSchema.extend({ action: z.literal("unlink") }),
  registryProposeSchema.extend({ action: z.literal("propose") }),
  registryDecisionSchema.extend({ action: z.literal("decide") }),
]);

export type RegistryCommand = z.infer<typeof registryCommandSchema>;
