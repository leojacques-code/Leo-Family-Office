import "server-only";
import { supabaseAdmin } from "@/lib/data/supabase-client";

/**
 * Un seul profil vide par acteur vérifié. Aucune donnée du compte de démonstration, aucun
 * seed financier ; un profil existant n'est jamais réécrit (`ignoreDuplicates`).
 */
export async function initializePersonalProfile(userId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from("profiles")
    .upsert(
      { user_id: userId, display_name: "Espace personnel", reporting_currency: "EUR" },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (error) throw new Error("PROFILE_INITIALIZATION_FAILED");
}
