/**
 * COMPARAISON CANONIQUE ↔ REGISTRE
 *
 * Fonction pure. Elle ne décide rien : elle PROPOSE, champ par champ, et explique aussi ce
 * qu'elle ne propose pas.
 *
 * Trois règles gouvernent le résultat, et chacune existe pour éviter une perte de données
 * observée dans les produits qui ne les appliquent pas :
 *
 *   1. UNE ABSENCE NE PROPOSE RIEN. Si le registre ne publie pas la forme juridique, il n'y
 *      a pas de proposition. Un « accepter tout » ne doit jamais effacer une saisie de
 *      l'utilisateur au motif que la source est muette. C'est doublé par une contrainte de
 *      base : une décision acceptée porte obligatoirement une valeur.
 *
 *   2. UNE CAPACITÉ NON SERVIE N'EST PAS UNE ABSENCE. « Ce fournisseur ne publie pas ce
 *      champ » et « ce fournisseur le publie mais la case est vide » sont deux informations
 *      différentes, et l'écran doit pouvoir les distinguer.
 *
 *   3. UN ÉCART DE FORME N'EST PAS UN CONFLIT. « SOCIETE FICTIVE ALPHA » et « Société
 *      Fictive Alpha » désignent la même dénomination ; « 70.22Z » et « 7022Z » le même code
 *      d'activité. Présenter ces écarts comme des conflits apprendrait à l'utilisateur à
 *      valider sans lire, et c'est ainsi qu'un vrai conflit passe inaperçu.
 *
 * Le cinquième état, `STALE`, est DÉRIVÉ ici et nulle part ailleurs : il dépend de l'heure
 * qu'il est, et un état qui dépend de l'heure ne se persiste pas.
 */

import {
  registryIssue,
  type BusinessCanonicalIdentity,
  type CompanyRegistryProfileCandidate,
  type EnrichableField,
  type RegistryCapability,
  type RegistryEnrichmentDiff,
  type RegistryFieldProposal,
  type RegistryFieldSkip,
  type RegistryIssue,
} from "./types";

/** Ce que chaque champ enrichissable exige, lit et affiche. */
interface FieldBinding {
  field: EnrichableField;
  label: string;
  /** Capacité SANS laquelle le champ ne peut pas être proposé. */
  capability: RegistryCapability;
  candidate: (profile: CompanyRegistryProfileCandidate) => string | null;
  canonical: (identity: BusinessCanonicalIdentity) => string | null;
  /** Comparaison d'ÉQUIVALENCE : deux écritures de la même information. */
  equivalent: (candidate: string, canonical: string) => boolean;
}

/** Casse et accents ignorés, espaces normalisés. Deux écritures d'un même nom. */
export function sameIdentityText(left: string, right: string): boolean {
  return foldText(left) === foldText(right);
}

function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** `70.22Z` et `7022Z` sont le même code d'activité écrit deux fois. */
export function sameNafCode(left: string, right: string): boolean {
  const fold = (value: string) => value.replace(/[.\s]/g, "").toUpperCase();
  return fold(left) === fold(right);
}

/**
 * Un code pays se compare en majuscules. Un libellé (« France ») n'est PAS traduit en code :
 * traduire supposerait une table de correspondance que ce module n'a pas à inventer.
 */
function sameCountry(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

/** Une date ISO se compare caractère par caractère : il n'y a rien à normaliser. */
function sameDate(left: string, right: string): boolean {
  return left === right;
}

const BINDINGS: readonly FieldBinding[] = [
  {
    field: "name",
    label: "Dénomination",
    capability: "legal_name",
    candidate: (profile) => profile.legalName,
    canonical: (identity) => identity.name,
    equivalent: sameIdentityText,
  },
  {
    field: "legal_form",
    label: "Forme juridique",
    // Le LIBELLÉ, pas le code. Un fournisseur qui ne publie que « 5710 » ne permet pas
    // d'écrire une forme juridique lisible, et traduire le code demanderait la nomenclature
    // officielle des catégories juridiques, absente de ce dépôt.
    capability: "legal_form_label",
    candidate: (profile) => profile.legalFormLabel,
    canonical: (identity) => identity.legalForm,
    equivalent: sameIdentityText,
  },
  {
    field: "sector",
    label: "Secteur d'activité",
    capability: "naf_label",
    candidate: (profile) => profile.nafLabel,
    canonical: (identity) => identity.sector,
    equivalent: sameIdentityText,
  },
  {
    field: "naf_code",
    label: "Code NAF",
    capability: "naf_code",
    candidate: (profile) => profile.nafCode,
    canonical: (identity) => identity.nafCode,
    equivalent: sameNafCode,
  },
  {
    field: "country",
    label: "Pays",
    capability: "country",
    candidate: (profile) => profile.country,
    canonical: (identity) => identity.country,
    equivalent: sameCountry,
  },
  {
    field: "founded_on",
    label: "Date de création",
    capability: "created_on",
    candidate: (profile) => profile.createdOn,
    canonical: (identity) => identity.foundedOn,
    equivalent: sameDate,
  },
];

export interface RegistryDiffInput {
  identity: BusinessCanonicalIdentity;
  profile: CompanyRegistryProfileCandidate;
  capabilities: readonly RegistryCapability[];
  /** Péremption DÉCLARÉE de l'instantané. `null` = aucune fraîcheur déclarée. */
  staleAfter: string | null;
  /** Instant de la comparaison, injecté : une péremption ne se calcule pas sur `Date.now()`. */
  now: string;
}

/**
 * Une chaîne canonique vide ou blanche n'est PAS une valeur : la traiter comme telle
 * produirait un conflit contre du vide, là où il s'agit d'un remplissage.
 */
function presentValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function buildEnrichmentDiff(input: RegistryDiffInput): RegistryEnrichmentDiff {
  const proposals: RegistryFieldProposal[] = [];
  const skipped: RegistryFieldSkip[] = [];
  const issues: RegistryIssue[] = [];

  const stale = input.staleAfter !== null && input.staleAfter <= input.now;
  if (stale) {
    issues.push(
      registryIssue(
        "SNAPSHOT_STALE",
        "WARNING",
        null,
        input.staleAfter,
        `Instantané périmé depuis le ${input.staleAfter} : les propositions restent lisibles et signalées, aucune n'est corrigée. Réinterrogez le registre avant de décider`,
      ),
    );
  }
  if (input.staleAfter === null) {
    issues.push(
      registryIssue(
        "PROVIDER_FRESHNESS_UNDECLARED",
        "INFO",
        null,
        null,
        "Aucune fraîcheur déclarée pour ce fournisseur : l'âge de l'observation ne peut pas être qualifié. Ce n'est pas « toujours frais »",
      ),
    );
  }

  for (const binding of BINDINGS) {
    const canonicalValue = presentValue(binding.canonical(input.identity));

    if (!input.capabilities.includes(binding.capability)) {
      skipped.push({
        field: binding.field,
        label: binding.label,
        reason: "CAPABILITY_NOT_SERVED",
        canonicalValueBefore: canonicalValue,
      });
      continue;
    }

    const candidateValue = presentValue(binding.candidate(input.profile));
    if (candidateValue === null) {
      skipped.push({
        field: binding.field,
        label: binding.label,
        reason: "CANDIDATE_MISSING",
        canonicalValueBefore: canonicalValue,
      });
      continue;
    }

    if (canonicalValue !== null && binding.equivalent(candidateValue, canonicalValue)) {
      skipped.push({
        field: binding.field,
        label: binding.label,
        reason: "ALREADY_ALIGNED",
        canonicalValueBefore: canonicalValue,
      });
      continue;
    }

    // Remplir un vide n'est pas trancher un désaccord : `CANDIDATE` quand LFO ne portait
    // rien, `CONFLICT` quand deux valeurs différentes coexistent et que seul l'utilisateur
    // peut dire laquelle est la bonne.
    const state = canonicalValue === null ? "CANDIDATE" : "CONFLICT";
    proposals.push({
      field: binding.field,
      label: binding.label,
      candidateValue,
      canonicalValueBefore: canonicalValue,
      state,
      displayState: stale ? "STALE" : state,
      stale,
    });
  }

  return { proposals, skipped, stale, issues };
}

/**
 * Liste des champs enrichissables, avec leur libellé et la capacité requise. Utile à
 * l'interface pour expliquer ce qu'un fournisseur peut ou ne peut pas alimenter, AVANT le
 * moindre appel.
 */
export function enrichableFieldCatalog(): Array<{
  field: EnrichableField;
  label: string;
  capability: RegistryCapability;
}> {
  return BINDINGS.map(({ field, label, capability }) => ({ field, label, capability }));
}
