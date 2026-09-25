import { z } from "zod";
import { isRealCalendarDate } from "@/lib/presentation/input-parse";

/** Contexte déclaré ; aucune règle fiscale ou date de valorisation n’en découle. */
export const FIRST_INTENTS = ["BUDGET", "WEALTH", "PROJECT", "INVESTMENTS"] as const;
export const INTENT_ACTIONS = {
  BUDGET: {
    label: "Suivre mon budget",
    href: "/cash-flow",
    action: "Ouvrir mes transactions et mon budget",
  },
  WEALTH: {
    label: "Comprendre mon patrimoine",
    href: "/net-worth",
    action: "Ouvrir mon patrimoine",
  },
  PROJECT: { label: "Préparer un projet", href: "/goals", action: "Ouvrir mes objectifs" },
  INVESTMENTS: {
    label: "Approfondir mes placements",
    href: "/investments",
    action: "Ouvrir mes comptes et placements",
  },
} as const;
export const personalSetupSchema = z
  .object({
    displayName: z.string().trim().min(1, "Donnez un nom à votre espace.").max(80),
    firstIntent: z.enum(FIRST_INTENTS).nullable(),
    reportingCurrency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "Devise attendue sur trois lettres majuscules.")
      .nullable(),
    residenceCountry: z.string().trim().min(1).max(80).nullable(),
    contextDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (value) => value >= "0001-01-01" && isRealCalendarDate(value),
        "Cette date n’existe pas.",
      )
      .nullable(),
  })
  .strict();
// La devise existante est lue, jamais modifiée par cette commande.
export const personalSetupInputSchema = personalSetupSchema.omit({ reportingCurrency: true });
export type PersonalSetupInput = z.infer<typeof personalSetupInputSchema>;
export type PersonalSetup = z.infer<typeof personalSetupSchema>;
