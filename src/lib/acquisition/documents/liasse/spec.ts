/**
 * REGISTRE DE SPÉCIFICATIONS DE LA LIASSE FISCALE
 *
 * ── CE QUE CE FICHIER NE CONTIENT PAS, ET POURQUOI ───────────────────────────────────────
 *
 * Il ne contient AUCUNE table de numéros de case. Pas une seule.
 *
 * Ce n'est pas un manque : c'est la conséquence directe d'une contrainte assumée. La
 * nomenclature officielle des cases des formulaires 2033-A à G et 2050 à 2059-G n'est pas
 * dans ce dépôt, et l'environnement de développement ne peut pas la télécharger — la
 * politique de sortie réseau de l'organisation refuse `impots.gouv.fr`. Écrire ici trois
 * cents codes de mémoire produirait exactement ce que la doctrine interdit : des chiffres
 * sans source rattachable, faux là où la mémoire se trompe, et impossibles à auditer.
 *
 * L'extraction ne se contente donc pas de fonctionner sans ces codes : elle est CONÇUE pour
 * les lire dans le document. Le code d'une case est imprimé à côté de sa valeur, et c'est de
 * là qu'il vient. Conséquence heureuse : un formulaire dont le millésime change de
 * numérotation reste lu, et un formulaire jamais rencontré l'est aussi.
 *
 * ── CE QU'IL CONTIENT ────────────────────────────────────────────────────────────────────
 *
 * Deux sortes d'ANCRES, et rien d'autre :
 *
 *   1. des ancres de DÉTECTION : les chaînes qu'un formulaire imprime sur lui-même pour se
 *      nommer (« 2050-SD », « N° 2033-A »). Elles servent à savoir de quel formulaire on
 *      parle, et la preuve du rapprochement est conservée.
 *
 *   2. des ancres de LIGNE : les libellés comptables qu'un état financier imprime en clair
 *      (« TOTAL GÉNÉRAL », « RÉSULTAT DE L'EXERCICE »). Elles servent à retrouver, DANS le
 *      document, le code de la case qui porte un total — et donc à construire les contrôles.
 *
 * Ces libellés sont des ancres DÉCLARÉES, à confronter aux formulaires officiels. Leur
 * incertitude est sans danger, et c'est le point important : une ancre qui ne s'apparie pas
 * rend le contrôle `NOT_COMPUTABLE`, jamais `PASSED`. Le mode de défaillance est donc « je ne
 * sais pas », jamais « c'est bon ».
 */

import type { CheckSeverity } from "../types";

/** Régimes de déclaration. Deux formulaires-mères, deux numérotations de cases. */
export const LIASSE_REGIMES = ["LIASSE_2050", "LIASSE_2033", "LIASSE_MIXED"] as const;
export type LiasseRegime = (typeof LIASSE_REGIMES)[number];

/**
 * Reconnaissance d'un formulaire par ce qu'il imprime sur lui-même.
 *
 * Le nom du FICHIER n'est jamais utilisé : « liasse.pdf » ne dit rien, et « 2050.pdf » peut
 * contenir autre chose. La détection est fondée sur le CONTENU, comme l'exige la doctrine.
 */
export interface FormAnchor {
  /** Code de formulaire retenu, tel qu'il sera persisté. */
  formCode: string;
  regime: LiasseRegime;
  label: string;
  /** Motifs cherchés dans le texte de la page, libellé normalisé. */
  patterns: RegExp[];
}

/**
 * Formulaires du régime NORMAL (2050 à 2059) et du régime SIMPLIFIÉ (2033-A à G).
 *
 * Les motifs acceptent la présence ou l'absence du suffixe `-SD`, l'espace ou le tiret entre
 * le numéro et sa lettre, et le préfixe `N°`. Un formulaire administratif imprime son numéro
 * de plusieurs façons selon le millésime et l'éditeur du logiciel qui l'a produit.
 */
export const FORM_ANCHORS: readonly FormAnchor[] = [
  // ── Régime normal ────────────────────────────────────────────────────────────────────
  { formCode: "2050", regime: "LIASSE_2050", label: "Bilan — actif", patterns: [/\b2050\b/] },
  { formCode: "2051", regime: "LIASSE_2050", label: "Bilan — passif", patterns: [/\b2051\b/] },
  {
    formCode: "2052",
    regime: "LIASSE_2050",
    label: "Compte de résultat (1re partie)",
    patterns: [/\b2052\b/],
  },
  {
    formCode: "2053",
    regime: "LIASSE_2050",
    label: "Compte de résultat (2e partie)",
    patterns: [/\b2053\b/],
  },
  {
    formCode: "2054",
    regime: "LIASSE_2050",
    label: "Immobilisations",
    patterns: [/\b2054\b/],
  },
  {
    formCode: "2055",
    regime: "LIASSE_2050",
    label: "Amortissements",
    patterns: [/\b2055\b/],
  },
  {
    formCode: "2056",
    regime: "LIASSE_2050",
    label: "Provisions",
    patterns: [/\b2056\b/],
  },
  {
    formCode: "2057",
    regime: "LIASSE_2050",
    label: "État des échéances des créances et des dettes",
    patterns: [/\b2057\b/],
  },
  {
    formCode: "2058-A",
    regime: "LIASSE_2050",
    label: "Détermination du résultat fiscal",
    patterns: [/\b2058\s*-?\s*A\b/],
  },
  {
    formCode: "2058-B",
    regime: "LIASSE_2050",
    label: "Déficits, provisions non déductibles",
    patterns: [/\b2058\s*-?\s*B\b/],
  },
  {
    formCode: "2058-C",
    regime: "LIASSE_2050",
    label: "Affectation du résultat",
    patterns: [/\b2058\s*-?\s*C\b/],
  },
  {
    formCode: "2059-A",
    regime: "LIASSE_2050",
    label: "Plus et moins-values",
    patterns: [/\b2059\s*-?\s*A\b/],
  },
  {
    formCode: "2059-B",
    regime: "LIASSE_2050",
    label: "Plus-values en report",
    patterns: [/\b2059\s*-?\s*B\b/],
  },
  {
    formCode: "2059-C",
    regime: "LIASSE_2050",
    label: "Suivi des moins-values",
    patterns: [/\b2059\s*-?\s*C\b/],
  },
  {
    formCode: "2059-D",
    regime: "LIASSE_2050",
    label: "Réserve spéciale",
    patterns: [/\b2059\s*-?\s*D\b/],
  },
  {
    formCode: "2059-E",
    regime: "LIASSE_2050",
    label: "Détermination de la valeur ajoutée",
    patterns: [/\b2059\s*-?\s*E\b/],
  },
  {
    formCode: "2059-F",
    regime: "LIASSE_2050",
    label: "Composition du capital social",
    patterns: [/\b2059\s*-?\s*F\b/],
  },
  {
    formCode: "2059-G",
    regime: "LIASSE_2050",
    label: "Filiales et participations",
    patterns: [/\b2059\s*-?\s*G\b/],
  },
  // ── Régime simplifié ─────────────────────────────────────────────────────────────────
  {
    formCode: "2033-A",
    regime: "LIASSE_2033",
    label: "Bilan simplifié",
    patterns: [/\b2033\s*-?\s*A\b/],
  },
  {
    formCode: "2033-B",
    regime: "LIASSE_2033",
    label: "Compte de résultat simplifié",
    patterns: [/\b2033\s*-?\s*B\b/],
  },
  {
    formCode: "2033-C",
    regime: "LIASSE_2033",
    label: "Immobilisations et amortissements",
    patterns: [/\b2033\s*-?\s*C\b/],
  },
  {
    formCode: "2033-D",
    regime: "LIASSE_2033",
    label: "Provisions et déficits reportables",
    patterns: [/\b2033\s*-?\s*D\b/],
  },
  {
    formCode: "2033-E",
    regime: "LIASSE_2033",
    label: "Détermination des effectifs et de la valeur ajoutée",
    patterns: [/\b2033\s*-?\s*E\b/],
  },
  {
    formCode: "2033-F",
    regime: "LIASSE_2033",
    label: "Composition du capital social",
    patterns: [/\b2033\s*-?\s*F\b/],
  },
  {
    formCode: "2033-G",
    regime: "LIASSE_2033",
    label: "Filiales et participations",
    patterns: [/\b2033\s*-?\s*G\b/],
  },
];

/**
 * Colonnes d'un tableau de bilan. Leurs en-têtes sont IMPRIMÉS : c'est en les trouvant qu'on
 * sait laquelle des trois cases d'une ligne porte le montant net.
 *
 * Sans les en-têtes, il faudrait supposer que la troisième case est le net. Cette supposition
 * est probablement vraie, et c'est précisément pourquoi il ne faut pas la faire : elle serait
 * invisible le jour où elle est fausse. En leur absence, la colonne reste `null` et les
 * contrôles qui en dépendent deviennent `NOT_COMPUTABLE`.
 */
export const COLUMN_ANCHORS: readonly { part: string; patterns: RegExp[] }[] = [
  { part: "GROSS", patterns: [/^BRUT$/, /^MONTANT BRUT$/] },
  {
    part: "DEPRECIATION",
    patterns: [
      /^AMORTISSEMENTS?$/,
      /^AMORTISSEMENTS? ET DEPRECIATIONS?$/,
      /^AMORTISSEMENTS?, PROVISIONS/,
      /^PROVISIONS$/,
    ],
  },
  { part: "NET", patterns: [/^NET$/, /^MONTANT NET$/, /^NET \(?\d?\)?$/] },
];

/** Ancre de LIGNE : un libellé comptable imprimé en clair, et la colonne visée. */
export interface RowAnchor {
  id: string;
  label: string;
  /** Motifs appliqués au libellé NORMALISÉ de la ligne (accents retirés, majuscules). */
  patterns: RegExp[];
  /** Formulaires où chercher. Vide = tous. */
  forms: readonly string[];
  /** Colonne visée quand la ligne porte plusieurs cases. `SINGLE` = ligne à une seule case. */
  column: "GROSS" | "DEPRECIATION" | "NET" | "SINGLE";
}

export const ROW_ANCHORS: readonly RowAnchor[] = [
  {
    id: "TOTAL_ACTIF_NET",
    label: "Total général de l'actif (net)",
    // « TOTAL GÉNÉRAL » sur le bilan actif ; certains éditeurs impriment « TOTAL DE L'ACTIF ».
    patterns: [/^TOTAL GENERAL/, /^TOTAL DE L'ACTIF/, /^TOTAL ACTIF/],
    forms: ["2050", "2033-A"],
    column: "NET",
  },
  {
    id: "TOTAL_ACTIF_BRUT",
    label: "Total général de l'actif (brut)",
    patterns: [/^TOTAL GENERAL/, /^TOTAL DE L'ACTIF/, /^TOTAL ACTIF/],
    forms: ["2050", "2033-A"],
    column: "GROSS",
  },
  {
    id: "TOTAL_ACTIF_AMORTISSEMENTS",
    label: "Total général de l'actif (amortissements et dépréciations)",
    patterns: [/^TOTAL GENERAL/, /^TOTAL DE L'ACTIF/, /^TOTAL ACTIF/],
    forms: ["2050", "2033-A"],
    column: "DEPRECIATION",
  },
  {
    id: "TOTAL_PASSIF",
    label: "Total général du passif",
    patterns: [/^TOTAL GENERAL/, /^TOTAL DU PASSIF/, /^TOTAL PASSIF/],
    forms: ["2051", "2033-A"],
    column: "SINGLE",
  },
  {
    id: "RESULTAT_PASSIF",
    label: "Résultat de l'exercice (capitaux propres)",
    patterns: [/^RESULTAT DE L'EXERCICE/],
    forms: ["2051", "2033-A"],
    column: "SINGLE",
  },
  {
    id: "RESULTAT_COMPTE_DE_RESULTAT",
    label: "Résultat de l'exercice (compte de résultat)",
    patterns: [/^RESULTAT DE L'EXERCICE/, /^BENEFICE OU PERTE/, /^RESULTAT COMPTABLE/],
    forms: ["2053", "2033-B"],
    column: "SINGLE",
  },
  {
    id: "CHIFFRE_AFFAIRES_NET",
    label: "Chiffre d'affaires net",
    patterns: [/^CHIFFRES? D'AFFAIRES? NETS?/, /^TOTAL DES PRODUITS D'EXPLOITATION/],
    forms: ["2052", "2033-B"],
    column: "SINGLE",
  },
];

/**
 * Tolérance d'un contrôle d'égalité entre deux totaux IMPRIMÉS, en euros.
 *
 * Un euro, et pas zéro : les formulaires sont renseignés en euros entiers, et deux totaux
 * arrondis peuvent différer d'une unité sans qu'aucun des deux soit faux. Au-delà, l'écart
 * n'est plus un arrondi.
 *
 * Un euro, et pas dix : accepter dix euros d'écart sur un bilan laisserait passer une case
 * mal lue de faible montant, exactement ce que le contrôle existe pour attraper.
 */
export const PRINTED_TOTAL_TOLERANCE = 1;

/** Modèle de contrôle, exprimé sur des ancres de ligne et non sur des codes. */
export interface CheckTemplate {
  checkCode: string;
  label: string;
  severity: CheckSeverity;
  tolerance: number;
  left: readonly string[];
  right: readonly string[];
  message: string;
}

export const CHECK_TEMPLATES: readonly CheckTemplate[] = [
  {
    checkCode: "BALANCE_SHEET_EQUALITY",
    label: "Total actif = total passif",
    // BLOQUANT : un bilan déséquilibré n'est pas un bilan. En tirer un fait patrimonial
    // ferait entrer un chiffre que le document lui-même contredit.
    severity: "BLOCKING",
    tolerance: PRINTED_TOTAL_TOLERANCE,
    left: ["TOTAL_ACTIF_NET"],
    right: ["TOTAL_PASSIF"],
    message:
      "Le total de l'actif net et le total du passif doivent être égaux. Un écart signale une case mal lue, ou un document incomplet.",
  },
  {
    checkCode: "ACTIF_COLUMNS_CONSISTENCY",
    label: "Brut − amortissements = net",
    severity: "BLOCKING",
    tolerance: PRINTED_TOTAL_TOLERANCE,
    left: ["TOTAL_ACTIF_BRUT"],
    // Le net additionné des amortissements doit redonner le brut : écrire le contrôle dans ce
    // sens évite d'avoir à représenter une soustraction dans la définition.
    right: ["TOTAL_ACTIF_NET", "TOTAL_ACTIF_AMORTISSEMENTS"],
    message:
      "Sur la ligne de total, le montant brut doit être égal au net augmenté des amortissements et dépréciations.",
  },
  {
    checkCode: "RESULT_CONSISTENCY",
    label: "Résultat du compte de résultat = résultat au passif",
    severity: "BLOCKING",
    tolerance: PRINTED_TOTAL_TOLERANCE,
    left: ["RESULTAT_COMPTE_DE_RESULTAT"],
    right: ["RESULTAT_PASSIF"],
    message:
      "Le résultat de l'exercice doit être identique au compte de résultat et dans les capitaux propres du passif.",
  },
];

/**
 * Motif d'un code de case du régime NORMAL : deux ou trois lettres capitales.
 *
 * Le motif seul ne suffit PAS à distinguer un code d'un mot de libellé en capitales : c'est la
 * COLONNE qui tranche, dans `extract.ts`. Un motif employé sans contrainte de colonne lirait
 * « ET » comme une case.
 */
export const LETTER_CODE_PATTERN = /^[A-Z]{2,3}$/;

/** Motif d'un code de case du régime SIMPLIFIÉ : trois chiffres. */
export const NUMERIC_CODE_PATTERN = /^\d{3}$/;
