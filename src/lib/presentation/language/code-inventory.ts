import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Inventaire des codes de réserve que les moteurs peuvent émettre.
 *
 * Sert de GATE : le registre de traduction doit couvrir cet inventaire, faute de quoi un code
 * ajouté par un moteur atteindrait la surface sans traduction et l'utilisateur lirait à
 * nouveau du `SCREAMING_SNAKE_CASE`.
 *
 * L'inventaire est lu dans la SOURCE, et il ne se fabrique pas par proximité de mots-clés.
 * Une première version cherchait tout littéral majuscule à moins de 200 caractères du mot
 * `blockers` : elle rendait 284 candidats dont la moitié étaient des membres d'unions de
 * domaine (`RENT_RECEIPT`, `REVENUE_MULTIPLE`, `MODEL_ASSUMPTION`). Traduire ceux-là comme
 * des réserves aurait fait passer une valeur parfaitement normale pour un problème.
 *
 * La source autoritative est la DÉCLARATION : les moteurs nomment leurs unions de codes
 * (`LoanFlagCode`, `MarketFlagCode`, `RealEstateFlagCode`, `GOAL_BLOCKER_CODES`,
 * `SCENARIO_BLOCKER_CODES`, `REGISTRY_SKIP_REASONS`), et ce sont ces noms qui sont lus.
 *
 * LIMITE CONNUE, écrite ici plutôt que découverte plus tard : tous les moteurs ne déclarent
 * pas leur union. Le bilan canonique, les analytiques de portefeuille, le cash-flow, la
 * carrière et le modèle mensuel poussent leurs codes en littéraux, sans type nommé. Ceux-là
 * échappent à ce gate. Deux choses les couvrent malgré tout :
 *
 *   - `translateIssues` traite tout code inconnu comme un INCIDENT à l'exécution, donc il
 *     n'atteint jamais la surface même sans traduction ;
 *   - le gate inverse (`literalCodesInLib`) interdit les traductions mortes, ce qui garde le
 *     registre honnête dans l'autre sens.
 *
 * Faire déclarer leur union aux moteurs concernés fermerait la brèche, mais cela revient à
 * modifier `src/lib/engine/`, ce que le périmètre de la phase 0 interdit. C'est une
 * recommandation pour les phases de domaine, pas un oubli.
 */

/** Unions de types dont les membres sont des codes de réserve. */
const RESERVE_TYPE_PATTERN = /export type (\w*(?:Blocker|Flag|Reason)\w*) =\s*((?:[^;])*);/g;
/** Tableaux `as const` dont les membres sont des codes de réserve. */
const RESERVE_CONST_PATTERN =
  /(?:export )?const (\w*(?:BLOCKER|FLAG|REASON)\w*) = \[((?:[^\]])*)\] as const/g;
const CODE_LITERAL = /"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g;

/**
 * Unions volontairement EXCLUES de l'inventaire, avec leur motif.
 *
 * L'exclusion est écrite ici plutôt que cachée dans une expression régulière : une exclusion
 * qu'on ne peut pas lire est une exclusion qu'on ne peut pas contester.
 */
export const EXCLUDED_RESERVE_UNIONS: Readonly<Record<string, string>> = {
  // Motifs de refus d'une SAISIE, traduits par la primitive du champ concerné, au plus près
  // de l'utilisateur. Les dupliquer dans le registre des réserves créerait une seconde
  // vérité sur le même texte.
  NumberParseReason: "traduit par les primitives de saisie (money-input, date-input)",
  DateParseReason: "traduit par les primitives de saisie (money-input, date-input)",
  // Business Equity portait DÉJÀ son traducteur français avant cette phase, dans
  // `src/lib/engine/business-equity-explain.ts`, et il fait mieux que ce registre : il
  // résout un identifiant de société en NOM et date le motif. Son en-tête le dit lui-même,
  // « le seul endroit du produit où un code technique devient une phrase ». Le dupliquer ici
  // aurait produit deux libellés concurrents pour le même code, et rien n'aurait dit lequel
  // fait foi. Leur consolidation, si elle a lieu, appartient à la phase Business Equity.
  BusinessBlockerCode: "traduit par src/lib/engine/business-equity-explain.ts",
  BusinessFlagCode: "traduit par src/lib/engine/business-equity-explain.ts",
};

export interface InventoriedCode {
  readonly code: string;
  /** Où le code est déclaré, sous la forme `fichier:Union`. Sert au message d'échec. */
  readonly sources: readonly string[];
}

function typescriptFilesIn(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...typescriptFilesIn(path));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(path);
  }
  return found;
}

/**
 * Codes qui apparaissent comme LITTÉRAL quelque part dans `src/lib`, hors registre lui-même.
 *
 * Sert au gate inverse : une traduction qui ne correspond à aucun code du produit est une
 * traduction MORTE, vestige d'un code renommé ou supprimé. La laisser donne l'illusion d'une
 * couverture, et elle masquerait le jour où un code proche réapparaîtrait sous un autre nom.
 */
export function literalCodesInLib(root: string): Set<string> {
  const found = new Set<string>();
  for (const path of typescriptFilesIn(join(root, "src", "lib"))) {
    if (path.includes(join("presentation", "language"))) continue;
    const source = readFileSync(path, "utf8");
    // Le souligné n'est PAS exigé : `DISPOSED` est un code de `RealEstateFlagCode` en un
    // seul mot, et l'exiger l'avait fait passer pour une traduction morte. Cette recherche
    // ne sert qu'à détecter les traductions mortes : un faux positif y est inoffensif,
    // là où un faux négatif accuserait une traduction valide.
    for (const match of source.matchAll(/["`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+|[A-Z][A-Z0-9]{3,})/g)) {
      found.add(match[1]);
    }
  }
  return found;
}

/** Lit l'inventaire depuis `src/lib`. `root` est le dossier racine du dépôt. */
export function inventoryReserveCodes(root: string): InventoriedCode[] {
  const byCode = new Map<string, Set<string>>();
  for (const path of typescriptFilesIn(join(root, "src", "lib"))) {
    const source = readFileSync(path, "utf8");
    const file = path.slice(root.length + 1);
    for (const pattern of [RESERVE_TYPE_PATTERN, RESERVE_CONST_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const [, name, body] = match;
        if (name in EXCLUDED_RESERVE_UNIONS) continue;
        for (const literal of body.matchAll(CODE_LITERAL)) {
          const set = byCode.get(literal[1]) ?? new Set<string>();
          set.add(`${file}:${name}`);
          byCode.set(literal[1], set);
        }
      }
    }
  }
  return [...byCode.entries()]
    .map(([code, sources]) => ({ code, sources: [...sources].sort() }))
    .sort((left, right) => left.code.localeCompare(right.code));
}
