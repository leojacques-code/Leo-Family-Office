/**
 * Refus MÉTIER d'une écriture, distingués d'une panne. Leur message est FIXE et rédigé ici :
 * il ne reprend jamais le texte renvoyé par la base, qui peut citer des valeurs persistées.
 *
 *   * `MutationConflictError` : l'état que l'utilisateur voyait a changé depuis (seconde
 *     décision sur un état périmé). La décision n'est pas appliquée, rien n'est écrasé.
 *   * `MutationRejectedError` : la demande est lisible mais refusée (aucun changement, objet
 *     hors du périmètre de la commande).
 */
export class MutationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationConflictError";
  }
}

export class MutationRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MutationRejectedError";
  }
}

/**
 * L'objet visé n'existe plus (supprimé ailleurs). Sous-classe d'un refus : tout appelant qui
 * traite les refus le traite, et une route qui sait mieux faire peut le distinguer.
 */
export class MutationNotFoundError extends MutationRejectedError {
  constructor(message: string) {
    super(message);
    this.name = "MutationNotFoundError";
  }
}
