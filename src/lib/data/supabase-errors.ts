/**
 * Échec d'une opération Supabase, avec le code SQLSTATE que PostgREST renvoie.
 *
 * Le message reste `Supabase <contexte> : <texte>` pour les journaux serveur. Le code permet à
 * une route de distinguer un REFUS RÉDIGÉ dans une RPC `lfo_*` (`raise exception` sans code,
 * soit `P0001`, ou avec un code `LF4xx` du produit), informatif pour l'utilisateur, d'une
 * erreur TECHNIQUE (contrainte, droit, réseau) dont le texte ne doit jamais atteindre le
 * navigateur : il peut citer des noms de tables, de contraintes ou des valeurs persistées.
 */
export class SupabaseOperationError extends Error {
  readonly code: string | null;
  readonly operation: string;
  readonly databaseMessage: string;

  constructor(operation: string, failure: { message: string; code?: string | null }) {
    super(`Supabase ${operation} : ${failure.message}`);
    this.name = "SupabaseOperationError";
    this.operation = operation;
    this.code = failure.code ?? null;
    this.databaseMessage = failure.message;
  }

  /** Refus rédigé par une RPC du produit, et non texte technique de la base. */
  get authoredRefusal(): boolean {
    return this.code === "P0001" || (this.code !== null && /^LF4\d{2}$/.test(this.code));
  }
}
