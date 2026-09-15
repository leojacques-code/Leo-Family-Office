import { z } from "zod";

/** Préférences de présentation uniquement ; aucune hypothèse financière n'en découle. */
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
  })
  .strict();
export type PersonalSetup = z.infer<typeof personalSetupSchema>;
