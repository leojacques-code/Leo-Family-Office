import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Contrôle de contenu des surfaces principales.
 *
 * Règle de la section 11 : « règle de contenu qui interdit fingerprint/UUID/code dans les
 * pages non techniques ». Le constat 5.4 la motive : l'utilisateur lisait des empreintes, des
 * codes d'union et, à un endroit, un UUID entier dans le texte visible.
 *
 * CE QUI EST RENDU ≠ CE QUI EST PASSÉ EN ATTRIBUT, et c'est toute la difficulté du contrôle.
 * `key={item.id}` et `value={entity.id}` sont parfaitement légitimes : rien ne s'affiche.
 * `<dd>{run.baselineFingerprint}</dd>` ne l'est pas : c'est du texte. Une recherche naïve de
 * `.id` ou de `fingerprint` confondrait les deux et rendrait le gate inutilisable, donc
 * ignoré. Le contrôle regarde donc le caractère qui PRÉCÈDE l'accolade : un `=` en fait un
 * attribut, tout le reste en fait un enfant JSX.
 *
 * LIMITE ASSUMÉE : ce contrôle est lexical, pas syntaxique. Il ne suit pas une variable
 * intermédiaire (`const f = run.fingerprint;` puis `{f}`), et il ne lit pas le rendu réel. Un
 * contrôle exact demanderait de monter les pages avec un état complet, ce qui est le travail
 * de la recette de la section 41. Ce gate attrape la régression la plus probable, celle du
 * copier-coller, et il le dit plutôt que de laisser croire à une preuve.
 */

/**
 * Chemins EXEMPTÉS, avec leur motif.
 *
 * Le plan parle des « pages non techniques » : un volet dont la raison d'être est de montrer
 * des identifiants n'est pas une infraction, c'est la solution. L'exemption est nominative et
 * motivée, jamais un motif générique.
 */
export const EXEMPT_SURFACES: Readonly<Record<string, string>> = {
  "src/components/primitives/technical-details.tsx":
    "le volet de détail technique EST l’endroit prévu par le constat 5.4 pour ces valeurs",
};

/** Segments de chemin de propriété qui désignent une valeur technique, jamais lisible. */
const TECHNICAL_SEGMENTS = [
  "fingerprint",
  "checksum",
  "digest",
  "uuid",
  "hash",
  "rawpayload",
  "searchpath",
] as const;

/** Un UUID écrit en clair dans le source, quelle que soit sa position. */
const UUID_LITERAL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Une empreinte hexadécimale longue écrite en clair. */
const HEX_FINGERPRINT_LITERAL = /\b[0-9a-f]{32,}\b/i;

export interface SurfaceFinding {
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
  readonly reason: string;
}

function tsxFilesIn(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...tsxFilesIn(path));
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) found.push(path);
  }
  return found;
}

/** Une accolade qui ouvre un littéral d'objet : `{ label: …, value: … }`. */
const OBJECT_LITERAL_BODY = /^\s*[\w"']+\s*:/;
/**
 * Caractères après lesquels une accolade n'est PAS une interpolation rendue.
 *
 * Le deux-points en a été RETIRÉ : il y figurait pour écarter les littéraux d'objet, mais il
 * écartait aussi `<p>Empreinte : {manifest.financialFingerprint}</p>`, c'est-à-dire le motif
 * exact que la page Rapports portait avant cette phase. Le littéral d'objet se reconnaît à
 * son CORPS (`OBJECT_LITERAL_BODY`), pas au caractère qui le précède, et c'est le seul
 * discriminant qui ne crée pas d'angle mort.
 */
const NON_CHILD_PREFIXES = ["=", "(", ",", "{", "["];

/**
 * Extrait les expressions rendues comme ENFANT JSX, c'est-à-dire ce que l'utilisateur lit.
 *
 * L'accolade précédée d'un `=`, d'un `[`, d'une virgule ou d'un deux-points est une valeur
 * passée, pas un texte rendu.
 */
function renderedExpressions(line: string): string[] {
  const rendered: string[] = [];
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "{") continue;
    const previous = line.slice(0, index).trimEnd();
    if (NON_CHILD_PREFIXES.some((prefix) => previous.endsWith(prefix))) continue;
    let depth = 1;
    let end = index + 1;
    while (end < line.length && depth > 0) {
      if (line[end] === "{") depth += 1;
      if (line[end] === "}") depth -= 1;
      end += 1;
    }
    const body = line.slice(index + 1, end - 1);
    // Un littéral d'objet passé en propriété n'est pas rendu, même quand il occupe sa propre
    // ligne à l'intérieur d'un attribut multi-lignes : `entries={[` puis `{ label: … }`.
    // Sans cette exception, le volet de détail technique déclencherait le gate qu'il sert à
    // satisfaire, et l'exemption devrait alors couvrir toutes ses pages appelantes.
    if (OBJECT_LITERAL_BODY.test(body)) continue;
    rendered.push(body);
  }
  return rendered;
}

/**
 * Cherche, dans les composants, ce qui rendrait une valeur technique à l'écran.
 *
 * `root` est le dossier racine du dépôt.
 */
/**
 * Analyse UNE source. Extraite pour être testable sans système de fichiers : un gate qui ne
 * trouve rien peut être vert parce qu'il est correct, ou vert parce qu'il ne cherche pas.
 * Seul un cas construit exprès distingue les deux.
 */
export function findTechnicalContentInSource(file: string, source: string): SurfaceFinding[] {
  const findings: SurfaceFinding[] = [];
  source.split("\n").forEach((line, index) => {
    const location = { file, line: index + 1, excerpt: line.trim().slice(0, 120) };
    // Un commentaire n'est pas rendu. Le contrôle ne les lit pas, faute de quoi expliquer la
    // règle dans un commentaire la violerait.
    const code = line.replace(/\/\/.*$/, "").replace(/\/\*[^*]*\*\//g, "");
    if (UUID_LITERAL.test(code)) {
      findings.push({ ...location, reason: "un UUID est écrit en clair" });
    }
    if (HEX_FINGERPRINT_LITERAL.test(code)) {
      findings.push({ ...location, reason: "une empreinte hexadécimale est écrite en clair" });
    }
    for (const expression of renderedExpressions(code)) {
      const lowered = expression.toLowerCase();
      const segment = TECHNICAL_SEGMENTS.find((candidate) => lowered.includes(candidate));
      if (segment) {
        findings.push({
          ...location,
          reason: `« ${segment} » est rendu comme texte : il appartient au volet technique`,
        });
      }
    }
  });
  return findings;
}

export function findTechnicalContentInSurfaces(root: string): SurfaceFinding[] {
  const findings: SurfaceFinding[] = [];
  // `join` normalise, mais `root` peut déjà finir par un séparateur : découper à
  // `root.length + 1` mangerait alors le premier caractère du chemin relatif, et le message
  // d'échec nommerait un fichier qui n'existe pas.
  const base = root.endsWith(sep) ? root.length : root.length + 1;
  for (const path of tsxFilesIn(join(root, "src", "components"))) {
    const file = path.slice(base).split(sep).join("/");
    if (file in EXEMPT_SURFACES) continue;
    findings.push(...findTechnicalContentInSource(file, readFileSync(path, "utf8")));
  }
  return findings;
}
