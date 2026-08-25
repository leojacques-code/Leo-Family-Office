/**
 * Comparaisons d'inventaires du schéma. Extraites du verifier pour être testables sans
 * base : la vérité de schéma est trop structurante pour reposer sur une logique de
 * comparaison jamais exécutée par les tests.
 */

/** Éléments attendus par le code et absents de la base. */
export function missingFrom(expected: readonly string[], actual: Iterable<string>): string[] {
  const found = new Set(actual);
  return expected.filter((item) => !found.has(item));
}

/**
 * Éléments présents dans la base et inconnus du code. Ne s'applique qu'aux inventaires
 * dont le repo est la source exhaustive, l'historique de migrations en premier lieu :
 * une version appliquée hors du repo signifie que le code ne reproduit plus la base.
 */
export function unexpectedIn(expected: readonly string[], actual: Iterable<string>): string[] {
  const allowed = new Set(expected);
  return [...new Set(actual)].filter((item) => !allowed.has(item)).sort();
}

/**
 * Égalité stricte des deux inventaires, dans les deux sens. Retourne les libellés d'échec
 * prêts à agréger ; un tableau vide signifie que la base et le repo décrivent la même
 * histoire.
 */
export function diffExactInventory(
  label: string,
  expected: readonly string[],
  actual: Iterable<string>,
): string[] {
  const materialized = [...actual];
  const failures: string[] = [];
  const missing = missingFrom(expected, materialized);
  if (missing.length > 0) failures.push(`${label} manquant(s) : ${missing.join(", ")}`);
  const unexpected = unexpectedIn(expected, materialized);
  if (unexpected.length > 0) failures.push(`${label} inattendu(s) : ${unexpected.join(", ")}`);
  return failures;
}
