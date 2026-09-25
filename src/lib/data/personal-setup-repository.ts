import "server-only";
import { requireActor } from "@/lib/auth";
import { supabaseAdmin } from "./supabase-client";
import {
  personalSetupSchema,
  personalSetupInputSchema,
  type PersonalSetupInput,
  type PersonalSetup,
} from "@/lib/personal-setup";

function map(row: {
  display_name: string;
  first_intent: string | null;
  reporting_currency: string;
  residence_country: string | null;
  context_date: string | null;
}): PersonalSetup {
  return personalSetupSchema.parse({
    displayName: row.display_name,
    firstIntent: row.first_intent,
    reportingCurrency: row.reporting_currency,
    residenceCountry: row.residence_country,
    contextDate: row.context_date,
  });
}
export async function getPersonalSetupRepository() {
  const { userId } = await requireActor();
  const db = supabaseAdmin();
  return {
    async read(): Promise<PersonalSetup> {
      const { data, error } = await db
        .from("profiles")
        .select("display_name,first_intent,reporting_currency,residence_country,context_date")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("PERSONAL_SETUP_READ_FAILED");
      return data
        ? map(data)
        : {
            displayName: "Espace personnel",
            firstIntent: null,
            reportingCurrency: null,
            residenceCountry: null,
            contextDate: null,
          };
    },
    async save(input: PersonalSetupInput): Promise<PersonalSetup> {
      const value = personalSetupInputSchema.parse(input);
      // Préférences du seul acteur vérifié ; aucun seed ou autre fait modifié.
      const { data, error } = await db
        .from("profiles")
        .upsert(
          {
            user_id: userId,
            display_name: value.displayName,
            first_intent: value.firstIntent,
            residence_country: value.residenceCountry,
            context_date: value.contextDate,
          },
          { onConflict: "user_id" },
        )
        .select("display_name,first_intent,reporting_currency,residence_country,context_date")
        .single();
      if (error || !data) throw new Error("PERSONAL_SETUP_SAVE_FAILED");
      return map(data);
    },
  };
}
