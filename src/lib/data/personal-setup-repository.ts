import "server-only";
import { requireActor } from "@/lib/auth";
import { supabaseAdmin } from "./supabase-client";
import { personalSetupSchema, type PersonalSetup } from "@/lib/personal-setup";

function map(row: { display_name: string; first_intent: string | null }): PersonalSetup {
  return personalSetupSchema.parse({
    displayName: row.display_name,
    firstIntent: row.first_intent,
  });
}
export async function getPersonalSetupRepository() {
  const { userId } = await requireActor();
  const db = supabaseAdmin();
  return {
    async read(): Promise<PersonalSetup> {
      const { data, error } = await db
        .from("profiles")
        .select("display_name,first_intent")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error("PERSONAL_SETUP_READ_FAILED");
      return data ? map(data) : { displayName: "Espace personnel", firstIntent: null };
    },
    async save(input: PersonalSetup): Promise<PersonalSetup> {
      const value = personalSetupSchema.parse(input);
      // Seuls ces deux champs changent. Ni seed, ni devise, ni contexte financier implicite.
      const { data, error } = await db
        .from("profiles")
        .upsert(
          { user_id: userId, display_name: value.displayName, first_intent: value.firstIntent },
          { onConflict: "user_id" },
        )
        .select("display_name,first_intent")
        .single();
      if (error || !data) throw new Error("PERSONAL_SETUP_SAVE_FAILED");
      return map(data);
    },
  };
}
