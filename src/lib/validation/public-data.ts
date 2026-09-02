/**
 * Validation des entrées de la verticale « données publiques immobilières ».
 *
 * Dans son propre module, comme `imports.ts` et `fec-imports.ts` : les verticales partagent
 * la fondation, pas leurs paramètres.
 *
 * Ce que le client N'A PAS le droit de fournir, et c'est le point du fichier :
 *
 *   * la VALEUR d'une estimation. Elle est recalculée côté serveur depuis les comparables
 *     persistés, puis encadrée en base. Un client qui pourrait poser la valeur pourrait
 *     écrire n'importe quel patrimoine ;
 *   * un score ou une confiance de rapprochement. Ils sont dérivés de la comparaison
 *     d'adresses, côté serveur ;
 *   * une URL de source, un jeton, un chemin de stockage.
 */

import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date inexistante au calendrier");

/** Code INSEE : cinq caractères, lettre admise pour la Corse (2A, 2B). */
const communeCode = z
  .string()
  .regex(/^[0-9][0-9A-Z][0-9]{3}$/, "Code commune INSEE attendu sur cinq caractères");

const postalCode = z.string().regex(/^\d{5}$/, "Code postal attendu sur cinq chiffres");

const fetchCommand = z
  .object({
    action: z.literal("fetch"),
    propertyId: z.uuid("Identifiant de bien attendu"),
    dataset: z.enum(["DVF", "DPE"]),
    /**
     * Lecture par fixture locale. Explicite et jamais implicite : une donnée de démonstration
     * qui se substituerait en silence à une source réelle laisserait un chiffre de fixture
     * rattaché à un bien sans que rien ne le dise. La provenance est persistée avec
     * l'instantané, et le provider s'appelle `FIXTURE_*`.
     */
    useFixture: z.boolean().default(false),
    communeCode: communeCode.nullable().default(null),
    postalCode: postalCode.nullable().default(null),
    address: z.string().trim().min(3).max(300).nullable().default(null),
    mutatedFrom: isoDate.nullable().default(null),
    mutatedTo: isoDate.nullable().default(null),
  })
  .refine(
    (value) => value.communeCode !== null || value.postalCode !== null || value.address !== null,
    {
      message:
        "Un repère est requis : code commune, code postal ou adresse. Une requête sans repère ne décrit aucune zone, et son résultat ne serait interprétable pour aucun bien",
    },
  )
  .refine(
    (value) =>
      value.mutatedFrom === null ||
      value.mutatedTo === null ||
      value.mutatedTo >= value.mutatedFrom,
    { message: "La borne de fin ne peut pas précéder la borne de début" },
  )
  .refine(
    (value) => value.dataset !== "DPE" || value.address !== null || value.postalCode !== null,
    {
      message: "Un diagnostic se cherche par adresse ou par code postal",
    },
  );

const decideCommand = z
  .object({
    action: z.literal("decide"),
    matchId: z.uuid(),
    decision: z.enum(["ACCEPT", "REJECT"]),
    /**
     * Motif. Obligatoire pour ACCEPTER, et ce n'est pas de la bureaucratie : accepter un
     * rapprochement d'adresse rattache à un bien détenu une donnée qui peut appartenir au
     * voisin. Le motif est la trace de la décision, et la base la réclame aussi pour une
     * confiance faible.
     */
    reason: z.string().trim().min(1).max(2000).nullable().default(null),
  })
  .refine((value) => value.decision !== "ACCEPT" || value.reason !== null, {
    message:
      "Accepter un rapprochement exige un motif : une adresse désigne un immeuble, pas un lot, et la décision doit rester relisible",
  });

const promoteCommand = z.object({
  action: z.literal("promote"),
  matchId: z.uuid(),
  /**
   * Date d'estimation. C'est la date à laquelle l'utilisateur ARRÊTE l'estimation, pas la
   * date de lecture de la source : les deux peuvent différer, et la valorisation est une
   * observation datée.
   */
  valuedAt: isoDate,
  notes: z.string().trim().max(2000).nullable().default(null),
  // Aucune `value` ici. Volontairement.
});

export const publicDataCommandSchema = z.discriminatedUnion("action", [
  fetchCommand,
  decideCommand,
  promoteCommand,
]);

export type PublicDataCommandInput = z.infer<typeof publicDataCommandSchema>;
