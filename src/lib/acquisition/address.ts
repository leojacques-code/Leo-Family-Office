/**
 * NORMALISATION ET RAPPROCHEMENT D'ADRESSES FRANÇAISES
 *
 * Fonctions pures. Aucun réseau, aucune base, aucun géocodage : ce module ne sait rien du
 * monde, il compare deux écritures.
 *
 * Ce qu'il produit n'est JAMAIS un booléen « c'est le même bien ». Une adresse désigne au
 * mieux un IMMEUBLE : au 12 rue des Lilas il y a douze appartements, chacun avec son DPE et
 * son prix. Une égalité d'adresse est donc une RESSEMBLANCE FORTE, pas une identité, et le
 * module rend un score décomposé en critères nommés pour que la décision humaine porte sur
 * des éléments lisibles plutôt que sur un chiffre opaque.
 *
 * ADRESSE ÉGALE ≠ BIEN IDENTIQUE. C'est la même doctrine que RESSEMBLANCE ≠ DOUBLON.
 */

/** Abréviations de type de voie. Une carte fermée, jamais une heuristique. */
const STREET_TYPES: ReadonlyMap<string, string> = new Map([
  ["AV", "AVENUE"],
  ["AVE", "AVENUE"],
  ["BD", "BOULEVARD"],
  ["BVD", "BOULEVARD"],
  ["BLVD", "BOULEVARD"],
  ["R", "RUE"],
  ["PL", "PLACE"],
  ["IMP", "IMPASSE"],
  ["CHE", "CHEMIN"],
  ["CH", "CHEMIN"],
  ["ALL", "ALLEE"],
  ["SQ", "SQUARE"],
  ["RTE", "ROUTE"],
  ["QU", "QUAI"],
  ["PAS", "PASSAGE"],
  ["CRS", "COURS"],
  ["RES", "RESIDENCE"],
  ["LOT", "LOTISSEMENT"],
  ["ZA", "ZONE ARTISANALE"],
  ["ZI", "ZONE INDUSTRIELLE"],
  ["ST", "SAINT"],
  ["STE", "SAINTE"],
]);

/**
 * Mots que la comparaison de voie ignore. Ce sont des liaisons : les garder ferait dépendre
 * le score d'une graphie (« rue des Lilas » contre « rue Lilas ») sans rapport avec
 * l'identité de la voie.
 */
const STOP_WORDS: ReadonlySet<string> = new Set(["DE", "DU", "DES", "LA", "LE", "LES", "L", "D"]);

/** Indices de répétition d'un numéro : ils DISTINGUENT deux entrées d'une même voie. */
const REPEAT_INDICES: ReadonlySet<string> = new Set(["BIS", "TER", "QUATER", "QUINQUIES"]);

/** Adresse décomposée. Chaque terme absent reste `null` : il n'est jamais complété. */
export interface NormalizedAddress {
  /** Numéro de voie, quand il est lisible. */
  number: number | null;
  /** BIS, TER… quand présent. Deux entrées d'un même numéro ne sont pas la même adresse. */
  repeatIndex: string | null;
  /** Type de voie développé (RUE, AVENUE…). `null` si aucun type reconnu. */
  streetType: string | null;
  /** Nom de la voie, replié, mots de liaison retirés. */
  streetName: string | null;
  /** Code postal à cinq chiffres, quand il est lisible. */
  postalCode: string | null;
  /** Commune repliée. */
  city: string | null;
  /** Ce qui n'a pas pu être attribué. Conservé pour que rien ne se perde en silence. */
  residue: string[];
  /** Texte d'origine, intact. */
  source: string;
}

/**
 * Replie une chaîne : majuscules, accents retirés, apostrophes unifiées, ponctuation en
 * espaces, espaces compactés. Le repli est un outil de COMPARAISON, jamais un remplacement
 * de la valeur d'origine, qui reste conservée.
 */
export function foldAddressText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[’ʼ`']/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EMPTY: Omit<NormalizedAddress, "source"> = {
  number: null,
  repeatIndex: null,
  streetType: null,
  streetName: null,
  postalCode: null,
  city: null,
  residue: [],
};

/**
 * Décompose une adresse écrite librement.
 *
 * Rien n'est deviné. Un numéro absent reste `null` — et non 1 ; un code postal absent reste
 * `null` — et non celui de la commune la plus probable. Ce qui n'entre dans aucune case
 * atterrit dans `residue`, visible, plutôt que d'être jeté.
 */
export function normalizeAddress(raw: string | null | undefined): NormalizedAddress {
  const source = raw ?? "";
  const folded = foldAddressText(source);
  if (folded.length === 0) return { ...EMPTY, source };

  const tokens = folded.split(" ");
  let number: number | null = null;
  let repeatIndex: string | null = null;
  let postalCode: string | null = null;
  let streetType: string | null = null;
  const nameTokens: string[] = [];
  const cityTokens: string[] = [];
  const residue: string[] = [];

  // Le code postal est repéré d'abord : il coupe l'adresse en « voie » puis « commune ».
  let postalAt = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    if (/^\d{5}$/.test(tokens[index])) {
      postalCode = tokens[index];
      postalAt = index;
      break;
    }
  }

  const streetPart = postalAt >= 0 ? tokens.slice(0, postalAt) : tokens;
  const cityPart = postalAt >= 0 ? tokens.slice(postalAt + 1) : [];

  for (let index = 0; index < streetPart.length; index += 1) {
    const token = streetPart[index];

    // Un numéro n'est reconnu qu'en TÊTE d'adresse. Un « 1945 » au milieu d'un nom de voie
    // (« rue du 8 mai 1945 ») n'est pas un numéro de rue, et le prendre pour tel décalerait
    // toute la lecture.
    if (number === null && index === 0 && /^\d{1,4}$/.test(token)) {
      number = Number(token);
      continue;
    }
    if (number !== null && repeatIndex === null && REPEAT_INDICES.has(token)) {
      repeatIndex = token;
      continue;
    }
    if (streetType === null) {
      const expanded = STREET_TYPES.get(token);
      if (expanded !== undefined) {
        streetType = expanded;
        continue;
      }
      if (
        token === "RUE" ||
        token === "AVENUE" ||
        token === "BOULEVARD" ||
        token === "PLACE" ||
        token === "IMPASSE" ||
        token === "CHEMIN" ||
        token === "ALLEE" ||
        token === "ROUTE" ||
        token === "QUAI" ||
        token === "SQUARE" ||
        token === "COURS" ||
        token === "PASSAGE" ||
        token === "RESIDENCE"
      ) {
        streetType = token;
        continue;
      }
    }
    if (STOP_WORDS.has(token)) continue;
    if (/^\d+$/.test(token) && number !== null) {
      // Un nombre dans le nom de la voie en fait partie : « 8 MAI 1945 ».
      nameTokens.push(token);
      continue;
    }
    nameTokens.push(token);
  }

  for (const token of cityPart) {
    if (STOP_WORDS.has(token)) continue;
    const expanded = STREET_TYPES.get(token);
    cityTokens.push(expanded === "SAINT" || expanded === "SAINTE" ? expanded : token);
  }

  if (nameTokens.length === 0 && cityTokens.length === 0 && postalCode === null) {
    residue.push(...tokens);
  }

  return {
    number,
    repeatIndex,
    streetType,
    streetName: nameTokens.length > 0 ? nameTokens.join(" ") : null,
    postalCode,
    city: cityTokens.length > 0 ? cityTokens.join(" ") : null,
    residue,
    source,
  };
}

/** Verdict d'un critère. `UNKNOWN` n'est ni un accord ni un désaccord. */
export type CriterionVerdict = "MATCH" | "MISMATCH" | "UNKNOWN";

export interface AddressCriterion {
  /** Nom du critère, tel qu'il sera affiché et persisté dans `match_basis`. */
  name: "postalCode" | "city" | "streetType" | "streetName" | "number" | "repeatIndex";
  verdict: CriterionVerdict;
  /** Poids du critère dans le score, quand il est connu. */
  weight: number;
  detail: string;
}

export interface AddressComparison {
  criteria: AddressCriterion[];
  /**
   * Score sur les critères CONNUS uniquement, entre 0 et 1. `null` quand aucun critère
   * n'est connu : un score de 0 dirait « ça ne correspond pas », ce qui est faux — on ne
   * sait pas.
   */
  score: number | null;
  /** Nombre de critères réellement évalués. Un score sur un seul critère ne vaut rien. */
  knownCount: number;
  /** Vrai si au moins un critère est en désaccord franc. */
  hasMismatch: boolean;
}

const WEIGHTS: Record<AddressCriterion["name"], number> = {
  postalCode: 0.2,
  city: 0.15,
  streetType: 0.05,
  streetName: 0.3,
  number: 0.25,
  repeatIndex: 0.05,
};

function compareStrings(
  name: AddressCriterion["name"],
  left: string | null,
  right: string | null,
  label: string,
): AddressCriterion {
  if (left === null || right === null) {
    return {
      name,
      verdict: "UNKNOWN",
      weight: WEIGHTS[name],
      detail: `${label} non renseigné de part et d'autre : ni accord ni désaccord`,
    };
  }
  return left === right
    ? { name, verdict: "MATCH", weight: WEIGHTS[name], detail: `${label} identique (${left})` }
    : {
        name,
        verdict: "MISMATCH",
        weight: WEIGHTS[name],
        detail: `${label} différent : « ${left} » contre « ${right} »`,
      };
}

/**
 * Compare deux adresses normalisées.
 *
 * Deux règles gouvernent la lecture du résultat, et elles sont dans le type, pas dans un
 * commentaire d'appelant :
 *
 *   * un critère INCONNU ne compte ni pour ni contre. Il réduit `knownCount`, ce qui doit
 *     faire baisser la confiance de l'appelant ;
 *   * `score = 1` ne dit PAS « même bien ». Il dit « même adresse postale », ce qui, dans un
 *     immeuble collectif, reste vrai pour tous les lots.
 */
export function compareAddresses(
  left: NormalizedAddress,
  right: NormalizedAddress,
): AddressComparison {
  const criteria: AddressCriterion[] = [
    compareStrings("postalCode", left.postalCode, right.postalCode, "Code postal"),
    compareStrings("city", left.city, right.city, "Commune"),
    compareStrings("streetType", left.streetType, right.streetType, "Type de voie"),
    compareStrings("streetName", left.streetName, right.streetName, "Nom de voie"),
    compareStrings(
      "number",
      left.number === null ? null : String(left.number),
      right.number === null ? null : String(right.number),
      "Numéro",
    ),
    // Un BIS n'est pas un « détail » : c'est une autre entrée. Mais son absence des deux
    // côtés n'est pas une information, d'où le traitement en critère connu seulement si au
    // moins l'un des deux le porte.
    left.repeatIndex === null && right.repeatIndex === null
      ? {
          name: "repeatIndex" as const,
          verdict: "UNKNOWN" as const,
          weight: WEIGHTS.repeatIndex,
          detail: "Aucun indice de répétition de part et d'autre",
        }
      : {
          name: "repeatIndex" as const,
          verdict:
            (left.repeatIndex ?? "") === (right.repeatIndex ?? "")
              ? ("MATCH" as const)
              : ("MISMATCH" as const),
          weight: WEIGHTS.repeatIndex,
          detail: `Indice de répétition : « ${left.repeatIndex ?? "aucun"} » contre « ${right.repeatIndex ?? "aucun"} »`,
        },
  ];

  const known = criteria.filter((criterion) => criterion.verdict !== "UNKNOWN");
  const knownWeight = known.reduce((total, criterion) => total + criterion.weight, 0);
  const matchedWeight = known
    .filter((criterion) => criterion.verdict === "MATCH")
    .reduce((total, criterion) => total + criterion.weight, 0);

  return {
    criteria,
    score: knownWeight === 0 ? null : Number((matchedWeight / knownWeight).toFixed(4)),
    knownCount: known.length,
    hasMismatch: known.some((criterion) => criterion.verdict === "MISMATCH"),
  };
}
