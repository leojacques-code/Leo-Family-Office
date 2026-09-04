/**
 * GARDE-FOU : AUCUN MARQUEUR DE CONFLIT DANS UN FICHIER SUIVI
 *
 * Une intégration de cinq branches se résout à la main. Un marqueur laissé derrière ne casse
 * ni le build ni les tests : `.env.example` n'est lu par aucun module, et un fichier de
 * documentation encore moins. Il se propage donc jusqu'au poste du lecteur suivant, qui
 * copie une variable d'environnement inexistante ou perd celle que l'autre branche
 * déclarait. Ce contrôle est là pour que cet oubli soit une ERREUR MÉCANIQUE, pas une
 * relecture humaine.
 *
 * `git diff --check` couvre le même besoin mais seulement pour ce qu'un diff donné modifie :
 * un marqueur introduit par un commit antérieur au diff examiné y échappe. Le balayage porte
 * donc sur l'ARBRE SUIVI, indépendamment de tout diff.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MARQUEUR NON AMBIGU ≠ SÉPARATEUR AMBIGU
 *
 * `<<<<<<<`, `|||||||` et `>>>>>>>` en début de ligne n'ont aucun usage légitime : ils sont
 * refusés partout, sans condition.
 *
 * `=======` seul n'est PAS dans le même cas : c'est aussi un soulignement de titre en
 * Markdown et un filet de bandeau de commentaire. Le refuser partout produirait des faux
 * positifs, et un garde-fou qui crie à tort finit désactivé. Il n'est donc retenu que dans un
 * fichier portant DÉJÀ un marqueur non ambigu — ce qui est toujours le cas d'un vrai
 * conflit, un séparateur n'existant jamais sans ses bornes.
 *
 * Les motifs sont CONSTRUITS par répétition, jamais écrits en littéral : ce fichier et son
 * test contiendraient sinon eux-mêmes ce qu'ils interdisent, et le contrôle se signalerait.
 */

/** Longueur exacte d'un marqueur de conflit git. */
const MARKER_LENGTH = 7;

const OURS = "<".repeat(MARKER_LENGTH);
const BASE = "|".repeat(MARKER_LENGTH);
const THEIRS = ">".repeat(MARKER_LENGTH);
const SEPARATOR = "=".repeat(MARKER_LENGTH);

/** Les trois marqueurs sans usage légitime, refusés sans condition. */
const UNAMBIGUOUS = [OURS, BASE, THEIRS] as const;

export interface ConflictMarkerHit {
  /** Chemin du fichier, tel que git le nomme. */
  file: string;
  /** Numéro de ligne, à partir de 1 : celui que le lecteur voit dans son éditeur. */
  line: number;
  /** Le marqueur reconnu, sans le reste de la ligne. */
  marker: string;
}

/**
 * Une ligne porte-t-elle un marqueur non ambigu ? Le marqueur doit être en DÉBUT de ligne et
 * suivi d'une fin de ligne ou d'une espace : `<<<<<<<<` (huit chevrons) n'est pas un marqueur
 * git, et une ligne de code qui décale de sept chevrons n'existe pas.
 */
function unambiguousMarkerOn(line: string): string | null {
  for (const marker of UNAMBIGUOUS) {
    if (!line.startsWith(marker)) continue;
    const next = line.charAt(MARKER_LENGTH);
    if (next === "" || next === " " || next === "\t" || next === "\r") return marker;
  }
  return null;
}

/** La ligne est-elle EXACTEMENT le séparateur, hors espaces de fin ? */
function separatorOn(line: string): boolean {
  return line.replace(/[\r\t ]+$/, "") === SEPARATOR;
}

/**
 * Balaie le CONTENU d'un fichier. Fonction pure : aucun accès disque, aucun appel git — c'est
 * ce qui la rend testable sans écrire nulle part un fichier contenant de vrais marqueurs.
 */
export function findConflictMarkers(file: string, content: string): ConflictMarkerHit[] {
  const lines = content.split("\n");
  const hits: ConflictMarkerHit[] = [];
  let sawUnambiguous = false;

  lines.forEach((line, index) => {
    const marker = unambiguousMarkerOn(line);
    if (marker !== null) {
      sawUnambiguous = true;
      hits.push({ file, line: index + 1, marker });
    }
  });

  // Le séparateur n'est retenu qu'une fois une borne établie. Deuxième passe, et non un test
  // au fil de la première : dans `<<<<<<< / ======= / >>>>>>>`, la borne fermante arrive
  // APRÈS le séparateur, et un fichier ne portant que `>>>>>>>` doit tout de même faire
  // remonter ses séparateurs.
  if (sawUnambiguous) {
    lines.forEach((line, index) => {
      if (separatorOn(line)) hits.push({ file, line: index + 1, marker: SEPARATOR });
    });
  }

  return hits.sort((a, b) => a.line - b.line);
}

/**
 * Rend le rapport lisible : un marqueur se corrige en ouvrant le fichier à la ligne dite, et
 * le message doit donc porter le chemin ET la ligne.
 */
export function formatConflictMarkerReport(hits: readonly ConflictMarkerHit[]): string {
  if (hits.length === 0) return "Aucun marqueur de conflit dans les fichiers suivis.";
  const detail = hits.map((hit) => `  ${hit.file}:${hit.line} : ${hit.marker}`).join("\n");
  return `${hits.length} marqueur(s) de conflit dans des fichiers suivis :\n${detail}`;
}
