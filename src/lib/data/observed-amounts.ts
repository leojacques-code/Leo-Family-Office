/**
 * COMPARAISON D'UN MONTANT OBSERVÉ, EN TEXTE
 *
 * Utilitaire PUR, sans React ni accès base. Il répond à une seule question : « cette valeur
 * remplacerait-elle celle déjà persistée ? » — et cette question décide si l'écran présente
 * une ligne comme une correction, donc si un motif est exigé.
 *
 * POURQUOI DU TEXTE, ET NON DES NOMBRES
 *
 * Les montants d'une observation de position sont des `numeric(30,10)` et `numeric(20,6)`.
 * Ils sont lus avec un `::text` explicite, et comparés ici sous cette forme : les faire
 * passer par un nombre JavaScript perdrait de la précision au-delà de quinze chiffres
 * significatifs. Cette perte ne serait pas visible — elle fabriquerait un conflit de
 * concurrence, ou, plus grave, en masquerait un.
 *
 * POURQUOI PAS UNE ÉGALITÉ DE TEXTE NON PLUS
 *
 * `1810.000000` et `1810` sont le MÊME nombre. Les déclarer différents présenterait un rejeu
 * comme une correction, exigerait un motif pour un remplacement qui n'a pas lieu, et
 * gonflerait la piste d'audit de décisions vides. La comparaison est donc NUMÉRIQUE dès que
 * les deux côtés sont des nombres lisibles, et retombe sur le texte normalisé sinon — plutôt
 * que d'inventer une égalité entre deux valeurs qu'elle n'a pas comprises.
 *
 * La base reste l'autorité : elle compare en `numeric`, sous verrou, et c'est elle qui
 * refuse. Cette fonction sert la PRÉVISUALISATION, et une prévisualisation légèrement
 * périmée fait échouer la validation, elle ne fait pas perdre un fait.
 */

/**
 * Lit un montant, ou rend `null` quand le texte n'en décrit pas un.
 *
 * Le garde sur le BLANC est indispensable : `Number("")` et `Number("  ")` valent ZÉRO en
 * JavaScript, pas `NaN`. Sans lui, une chaîne vide serait déclarée égale à `"0"`, et
 * l'apparition d'un zéro déclaré passerait pour un non-événement — alors que « rien » et
 * « zéro » sont précisément ce que ce produit refuse de confondre.
 */
function readable(text: string): number | null {
  if (text.trim().length === 0) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `null` d'un côté et une valeur de l'autre est un CHANGEMENT.
 *
 * Une quantité absente remplacée par 12 en est un, et `null` n'est pas zéro : les confondre
 * ferait passer l'apparition d'une valeur pour un non-événement.
 */
export function observedAmountChanged(before: string | null, after: string | null): boolean {
  if (before === null || after === null) return before !== after;
  const a = readable(before);
  const b = readable(after);
  if (a !== null && b !== null) return a !== b;
  // Au moins un côté n'est pas un nombre lisible : la seule comparaison honnête restante est
  // celle du texte, espaces de bord retirés.
  return before.trim() !== after.trim();
}

/** Champs d'une observation comparés pour décider d'un remplacement. */
export interface ObservedSnapshotValues {
  quantity: string | null;
  costBasis: string | null;
  marketValue: string | null;
  currency: string | null;
}

/**
 * Champs qui CHANGERAIENT, dans un ordre stable — celui des colonnes de la base, pour que le
 * message de l'écran et celui de la RPC se lisent de la même façon.
 *
 * La devise est comparée en TEXTE, jamais en nombre, et sa casse est normalisée : `eur` et
 * `EUR` sont la même devise, et l'écrire autrement n'est pas un changement de devise.
 */
export function changedObservedFields(
  before: ObservedSnapshotValues,
  after: ObservedSnapshotValues,
): string[] {
  const changed: string[] = [];
  if (observedAmountChanged(before.quantity, after.quantity)) changed.push("quantity");
  if (observedAmountChanged(before.costBasis, after.costBasis)) changed.push("cost_basis");
  if (observedAmountChanged(before.marketValue, after.marketValue)) changed.push("market_value");
  if (
    (before.currency ?? "").trim().toUpperCase() !== (after.currency ?? "").trim().toUpperCase()
  ) {
    changed.push("currency");
  }
  return changed;
}
