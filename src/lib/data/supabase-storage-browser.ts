"use client";

import { createClient } from "@supabase/supabase-js";

/**
 * CLIENT NAVIGATEUR — STOCKAGE UNIQUEMENT.
 *
 * Ce module existe pour une seule raison, et elle est structurelle : un FEC d'exercice
 * dépasse la taille de corps de requête qu'une fonction serverless accepte. Le fichier doit
 * donc aller du navigateur AU STOCKAGE, sans passer par une route d'API — sans quoi la
 * lecture à 150 000 lignes n'existe pas en production.
 *
 * Ce qu'il fait, et RIEN d'autre : `uploadToSignedUrl`, avec un jeton émis par le serveur,
 * vers un chemin calculé par le serveur, dans un bucket privé sans aucune policy.
 *
 *   * la clé employée est la clé PUBLIABLE (anon). Elle est conçue pour être publique, et
 *     ne donne accès à rien : les tables sont sous RLS sans policy pour `anon`, et le
 *     bucket de staging n'a AUCUNE policy — le jeton signé est la seule autorisation ;
 *   * la clé de service ne franchit JAMAIS cette frontière. Elle reste dans
 *     `supabase-client.ts`, marqué "server-only" ;
 *   * aucune lecture de table, aucune écriture de table, aucun appel RPC ne passe par ici.
 *
 * L'implémentation officielle est utilisée telle quelle, et ce n'est pas un réflexe : pour
 * un `File`, elle construit un corps `multipart/form-data` que le service attend. Un PUT
 * artisanal envoyant le fichier brut n'est PAS équivalent, et déposerait au mieux un objet
 * dont le contenu diffère de ce que l'utilisateur a choisi.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Configuration de dépôt incomplète : ${name} est absente. Le fichier ne peut pas être déposé au stockage privé, et il ne sera PAS envoyé au serveur d'application à la place — sa taille y serait refusée.`,
    );
  }
  return value;
}

/** Dépose un fichier au stockage privé, par URL signée. Aucun autre usage n'est exposé. */
export async function uploadToSignedStoragePath(input: {
  bucket: string;
  path: string;
  token: string;
  file: File;
  contentType: string;
}): Promise<void> {
  const url = required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await client.storage
    .from(input.bucket)
    .uploadToSignedUrl(input.path, input.token, input.file, { contentType: input.contentType });

  if (error) throw new Error(`Dépôt au stockage privé refusé : ${error.message}`);
}
