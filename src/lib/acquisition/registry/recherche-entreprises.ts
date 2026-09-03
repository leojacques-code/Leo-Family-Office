/**
 * FOURNISSEUR — API Recherche d'Entreprises (annuaire ouvert des entreprises)
 *
 * À ne pas confondre avec l'API Entreprise, dont l'accès est réservé aux administrations et
 * aux organismes habilités : les deux ne servent pas les mêmes champs et n'ont pas le même
 * régime d'accès. Cet adaptateur n'appelle QUE l'annuaire ouvert.
 *
 * ── AVERTISSEMENT DE PROVENANCE, à lire avant de faire confiance à ce fichier ────────────
 *
 * La correspondance des champs ci-dessous est écrite d'après le contrat PUBLIÉ de l'API.
 * Elle n'a PAS pu être confrontée à une réponse réelle : la politique de sortie réseau de
 * l'environnement de développement refuse `recherche-entreprises.api.gouv.fr` (403 au
 * CONNECT). La validation en ligne de ce mapping est donc un point BLOQUÉ, documenté dans
 * `docs/COMPANY_REGISTRY_ACQUISITION.md`.
 *
 * Ce que cette incertitude ne peut PAS produire, par construction : une valeur fausse. Les
 * lecteurs de `normalize.ts` rendent `null` accompagné d'une anomalie dès qu'un chemin est
 * absent ou d'un type inattendu. Un nom de champ erroné se traduit donc par « inconnu et
 * signalé », jamais par un chiffre inventé. C'est le seul mode de défaillance acceptable.
 *
 * ── CE QUE CE FOURNISSEUR NE SERT PAS ────────────────────────────────────────────────────
 *
 * Le capital social, le libellé de forme juridique, le libellé NAF, le greffe, le numéro
 * RCS et les actes déposés ne sont pas publiés par cet annuaire. Ils sont donc ABSENTS de
 * `capabilities`, et l'écran de comparaison écrira « non servi par ce fournisseur » au lieu
 * d'un vide indistinguable d'une donnée manquante.
 *
 * Le cas de la forme juridique mérite d'être explicite : l'annuaire publie un CODE de
 * catégorie juridique (« 5710 »), sans son libellé. Écrire ce code dans
 * `businesses.legal_form`, là où l'utilisateur a saisi « SAS », dégraderait une information
 * lisible. Et traduire le code demanderait la nomenclature officielle des catégories
 * juridiques, que ce dépôt ne possède pas : la reconstituer de mémoire serait exactement la
 * convention inventée que la doctrine interdit. Le code est donc CONSERVÉ comme observation
 * et n'alimente aucune proposition.
 */

import {
  asArray,
  asObject,
  checkProfileCoherence,
  emptyProfile,
  pick,
  pickPath,
  readInteger,
  readIsoDate,
  readSirenField,
  readSiretField,
  readText,
} from "./normalize";
import {
  callRegistry,
  DEFAULT_TRANSPORT,
  RegistryRateLimiter,
  type RegistryTransportConfig,
} from "./transport";
import {
  registryIssue,
  type CompanyRegistryProfileCandidate,
  type RegistryCapability,
  type RegistryEntityReading,
  type RegistryEstablishmentCandidate,
  type RegistryIssue,
  type RegistryOfficerCandidate,
  type RegistryProviderAdapter,
  type RegistryRawResponse,
  type RegistrySearchHit,
  type RegistrySearchQuery,
  type RegistrySearchReading,
} from "./types";

export const RECHERCHE_ENTREPRISES_BASE_URL = "https://recherche-entreprises.api.gouv.fr";

/**
 * Version du CONTRAT DE LECTURE. Elle change dès qu'un champ est interprété autrement, et
 * les instantanés déjà écrits restent lisibles avec leur version d'origine.
 */
export const RECHERCHE_ENTREPRISES_SCHEMA_VERSION = "recherche-entreprises/2026-08-31";

export const RECHERCHE_ENTREPRISES_CAPABILITIES: readonly RegistryCapability[] = [
  "legal_name",
  "trade_name",
  "acronym",
  "legal_form_code",
  "naf_code",
  "employee_range",
  "enterprise_category",
  "created_on",
  "registry_status",
  "head_office",
  "address",
  "establishments",
  "officers",
];

/**
 * Quota déclaré par le fournisseur pour l'usage non authentifié. Le respecter est une
 * obligation d'usage, pas une optimisation.
 */
export const RECHERCHE_ENTREPRISES_RATE_LIMIT_PER_MINUTE = 7;

/**
 * Fraîcheur DÉCLARÉE d'un instantané, en minutes. L'annuaire se rafraîchit quotidiennement
 * depuis les bases INSEE : une observation de la veille reste utilisable, et une observation
 * d'il y a un mois doit être SIGNALÉE. Vingt-quatre heures est donc la borne retenue, et
 * c'est une DÉCLARATION de ce produit, pas un engagement du fournisseur.
 */
export const RECHERCHE_ENTREPRISES_TTL_MINUTES = 24 * 60;

function nowIso(clock: RegistryTransportConfig["clock"]): string {
  return new Date(clock.now()).toISOString();
}

/** `etat_administratif` : `A` actif, `C` cessé. Toute autre valeur reste inconnue. */
function readAdministrativeState(
  value: unknown,
  field: string,
  issues: RegistryIssue[],
): "ACTIVE" | "CEASED" | "UNKNOWN" | null {
  const text = readText(value, field, issues);
  if (text === null) return null;
  if (text === "A") return "ACTIVE";
  if (text === "C") return "CEASED";
  issues.push(
    registryIssue(
      "FIELD_UNEXPECTED_TYPE",
      "WARNING",
      field,
      value,
      `Champ ${field} : état administratif « ${text} » non reconnu, statut laissé inconnu`,
    ),
  );
  return "UNKNOWN";
}

/**
 * Même codage `A`/`C`, autre vocabulaire : un ÉTABLISSEMENT est fermé, une ENTITÉ est
 * cessée. Réutiliser un seul mot pour les deux mélangerait la fin d'un point de vente et la
 * fin d'une personne morale.
 */
function readEstablishmentState(
  value: unknown,
  field: string,
  issues: RegistryIssue[],
): "ACTIVE" | "CLOSED" | "UNKNOWN" | null {
  const state = readAdministrativeState(value, field, issues);
  if (state === null) return null;
  if (state === "ACTIVE") return "ACTIVE";
  if (state === "CEASED") return "CLOSED";
  return "UNKNOWN";
}

/** Une adresse déjà composée par le fournisseur est reprise telle quelle, jamais recomposée. */
function readHeadOffice(
  siege: unknown,
  siren: string,
  issues: RegistryIssue[],
): Pick<
  CompanyRegistryProfileCandidate,
  "headOfficeSiret" | "addressLine" | "postalCode" | "city" | "cityCode"
> {
  return {
    headOfficeSiret: readSiretField(pick(siege, "siret"), "siege.siret", issues, siren),
    addressLine: readText(pick(siege, "adresse"), "siege.adresse", issues),
    postalCode: readText(pick(siege, "code_postal"), "siege.code_postal", issues),
    city: readText(pick(siege, "libelle_commune"), "siege.libelle_commune", issues),
    cityCode: readText(pick(siege, "commune"), "siege.commune", issues),
  };
}

function readOfficers(value: unknown, issues: RegistryIssue[]): RegistryOfficerCandidate[] {
  const rows = asArray(value);
  if (rows === null) {
    if (value !== undefined && value !== null) {
      issues.push(
        registryIssue(
          "PAYLOAD_SHAPE_UNEXPECTED",
          "WARNING",
          "dirigeants",
          value,
          "Champ dirigeants : liste attendue, aucun dirigeant repris",
        ),
      );
    }
    return [];
  }
  return rows.map((row) => {
    const kindText = readText(pick(row, "type_dirigeant"), "dirigeants.type_dirigeant", issues);
    const officerKind: RegistryOfficerCandidate["officerKind"] =
      kindText === null
        ? "UNKNOWN"
        : kindText.toLowerCase().startsWith("personne physique")
          ? "PERSON"
          : kindText.toLowerCase().startsWith("personne morale")
            ? "COMPANY"
            : "UNKNOWN";
    return {
      officerKind,
      lastName: readText(pick(row, "nom"), "dirigeants.nom", issues),
      firstNames: readText(pick(row, "prenoms"), "dirigeants.prenoms", issues),
      birthYear: readInteger(
        pick(row, "annee_de_naissance"),
        "dirigeants.annee_de_naissance",
        issues,
      ),
      nationality: readText(pick(row, "nationalite"), "dirigeants.nationalite", issues),
      roleLabel: readText(pick(row, "qualite"), "dirigeants.qualite", issues),
      roleCode: null,
      companySiren: readSirenField(pick(row, "siren"), "dirigeants.siren", issues),
      companyName: readText(pick(row, "denomination"), "dirigeants.denomination", issues),
      // L'annuaire ne publie pas de date de prise de fonction : la laisser à `null` est la
      // seule lecture honnête.
      sinceOn: null,
    };
  });
}

function readMatchingEstablishments(
  value: unknown,
  siren: string,
  issues: RegistryIssue[],
): RegistryEstablishmentCandidate[] {
  const rows = asArray(value);
  if (rows === null) return [];
  const establishments: RegistryEstablishmentCandidate[] = [];
  for (const row of rows) {
    const siret = readSiretField(
      pick(row, "siret"),
      "matching_etablissements.siret",
      issues,
      siren,
    );
    if (siret === null) continue;
    establishments.push({
      siret,
      isHeadOffice: null,
      establishmentStatus: readEstablishmentState(
        pick(row, "etat_administratif"),
        "matching_etablissements.etat_administratif",
        issues,
      ),
      addressLine: readText(pick(row, "adresse"), "matching_etablissements.adresse", issues),
      postalCode: readText(pick(row, "code_postal"), "matching_etablissements.code_postal", issues),
      city: readText(
        pick(row, "libelle_commune"),
        "matching_etablissements.libelle_commune",
        issues,
      ),
      cityCode: readText(pick(row, "commune"), "matching_etablissements.commune", issues),
      country: null,
      nafCode: readText(
        pick(row, "activite_principale"),
        "matching_etablissements.activite_principale",
        issues,
      ),
      nafLabel: null,
      employeeRangeCode: null,
      createdOn: null,
      closedOn: null,
    });
  }
  return establishments;
}

/** Lit UN élément de `results` en profil. Le SIREN gouverne : sans lui, pas de profil. */
function readResult(row: unknown, issues: RegistryIssue[]): CompanyRegistryProfileCandidate | null {
  const siren = readSirenField(pick(row, "siren"), "siren", issues);
  if (siren === null) {
    issues.push(
      registryIssue(
        "SIREN_MISSING",
        "ERROR",
        "siren",
        pick(row, "siren"),
        "Résultat sans SIREN exploitable : aucun profil n'est produit, l'instantané conserve la réponse",
      ),
    );
    return null;
  }

  const siege = pick(row, "siege");
  const establishments = readMatchingEstablishments(
    pick(row, "matching_etablissements"),
    siren,
    issues,
  );

  const profile: CompanyRegistryProfileCandidate = {
    ...emptyProfile(siren),
    // `nom_raison_sociale` est la dénomination LÉGALE ; `nom_complet` peut y ajouter une
    // enseigne ou un sigle. La dénomination légale est donc préférée, et le nom complet
    // conservé comme nom commercial quand il diffère.
    legalName:
      readText(pick(row, "nom_raison_sociale"), "nom_raison_sociale", issues) ??
      readText(pick(row, "nom_complet"), "nom_complet", issues),
    tradeName: readText(pick(row, "nom_complet"), "nom_complet", issues),
    acronym: readText(pick(row, "sigle"), "sigle", issues),
    legalFormCode: readText(pick(row, "nature_juridique"), "nature_juridique", issues),
    // Libellé NON servi par ce fournisseur : il reste `null`, et la capacité absente le dit.
    legalFormLabel: null,
    nafCode: readText(pick(row, "activite_principale"), "activite_principale", issues),
    nafLabel: null,
    nafNomenclature: null,
    employeeRangeCode: readText(
      pick(row, "tranche_effectif_salarie"),
      "tranche_effectif_salarie",
      issues,
    ),
    employeeRangeLabel: null,
    employeeRangeYear: readInteger(
      pick(row, "annee_tranche_effectif_salarie"),
      "annee_tranche_effectif_salarie",
      issues,
    ),
    enterpriseCategory: readText(pick(row, "categorie_entreprise"), "categorie_entreprise", issues),
    createdOn: readIsoDate(pick(row, "date_creation"), "date_creation", issues),
    // L'annuaire publie l'état administratif, pas une date de cessation : la déduire de
    // l'état serait inventer une date.
    ceasedOn: null,
    registryStatus: readAdministrativeState(
      pick(row, "etat_administratif"),
      "etat_administratif",
      issues,
    ),
    establishmentCount: readInteger(
      pick(row, "nombre_etablissements"),
      "nombre_etablissements",
      issues,
    ),
    ...readHeadOffice(siege, siren, issues),
    issues: [],
  };

  return checkProfileCoherence({ ...profile, issues }, establishments.length);
}

function searchUrl(query: RegistrySearchQuery): string {
  const url = new URL("/search", RECHERCHE_ENTREPRISES_BASE_URL);
  const text = query.siren ?? query.siret ?? query.text ?? query.officerName ?? "";
  url.searchParams.set("q", text);
  // Le nom de dirigeant est un CRITÈRE distinct du texte libre quand le fournisseur
  // l'expose : le confondre avec `q` chercherait une raison sociale.
  if (query.officerName && !query.text && !query.siren && !query.siret) {
    url.searchParams.set("dirigeant", query.officerName);
  }
  url.searchParams.set("page", String(Math.max(1, query.page ?? 1)));
  url.searchParams.set("per_page", String(Math.min(25, Math.max(1, query.perPage ?? 10))));
  return url.toString();
}

export interface RechercheEntreprisesOptions {
  transport?: Partial<RegistryTransportConfig>;
  fetchImpl?: typeof fetch;
}

export function createRechercheEntreprisesAdapter(
  options: RechercheEntreprisesOptions = {},
): RegistryProviderAdapter {
  const config: RegistryTransportConfig = {
    ...DEFAULT_TRANSPORT,
    fetchImpl: options.fetchImpl ?? fetch,
    rateLimitPerMinute: RECHERCHE_ENTREPRISES_RATE_LIMIT_PER_MINUTE,
    ...options.transport,
  };
  // Le limiteur est porté par l'ADAPTATEUR : il garde l'état du quota entre deux appels du
  // même processus, et deux fournisseurs ne partagent pas un quota qui ne leur est pas commun.
  const limiter = new RegistryRateLimiter(config.rateLimitPerMinute, config.clock);

  async function call(
    endpoint: "SEARCH" | "ENTITY",
    query: RegistrySearchQuery,
  ): Promise<RegistryRawResponse> {
    const url = searchUrl(query);
    const result = await callRegistry({ url }, config, limiter);
    return {
      endpoint,
      query: { ...query, url },
      httpStatus: result.httpStatus,
      payload: result.payload,
      payloadBytes: result.payloadBytes,
      observedAt: nowIso(config.clock),
      providerUpdatedAt: result.providerUpdatedAt,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
    };
  }

  return {
    provider: "RECHERCHE_ENTREPRISES",
    label: "API Recherche d'Entreprises",
    schemaVersion: RECHERCHE_ENTREPRISES_SCHEMA_VERSION,
    adapterVersion: "recherche-entreprises/1",
    authMode: "NONE",
    credentialEnvVar: null,
    capabilities: RECHERCHE_ENTREPRISES_CAPABILITIES,
    baseUrl: RECHERCHE_ENTREPRISES_BASE_URL,
    snapshotTtlMinutes: RECHERCHE_ENTREPRISES_TTL_MINUTES,
    rateLimitPerMinute: RECHERCHE_ENTREPRISES_RATE_LIMIT_PER_MINUTE,

    search: (query) => call("SEARCH", query),

    /**
     * L'annuaire ouvert n'expose PAS de point d'entrée par SIREN : la fiche s'obtient en
     * cherchant le SIREN. Le dire ici plutôt que d'inventer une route est ce qui permet au
     * lecteur de comprendre pourquoi `endpoint` vaut `ENTITY` sur une URL de recherche.
     */
    entity: (siren) => call("ENTITY", { siren, perPage: 1, page: 1 }),

    readSearch(response): RegistrySearchReading {
      const issues: RegistryIssue[] = [];
      const root = asObject(response.payload);
      if (root === null) {
        issues.push(
          registryIssue(
            "PAYLOAD_SHAPE_UNEXPECTED",
            "ERROR",
            null,
            response.payload,
            "Réponse de recherche : objet attendu à la racine",
          ),
        );
        return { hits: [], totalResults: null, page: null, perPage: null, issues };
      }
      const rows = asArray(pick(root, "results"));
      if (rows === null) {
        issues.push(
          registryIssue(
            "PAYLOAD_SHAPE_UNEXPECTED",
            "ERROR",
            "results",
            pick(root, "results"),
            "Réponse de recherche : liste `results` attendue",
          ),
        );
        return { hits: [], totalResults: null, page: null, perPage: null, issues };
      }

      const hits: RegistrySearchHit[] = [];
      for (const row of rows) {
        const siren = readSirenField(pick(row, "siren"), "results.siren", issues);
        if (siren === null) continue;
        const officers = readOfficers(pick(row, "dirigeants"), issues);
        hits.push({
          siren,
          legalName:
            readText(pick(row, "nom_raison_sociale"), "results.nom_raison_sociale", issues) ??
            readText(pick(row, "nom_complet"), "results.nom_complet", issues),
          tradeName: readText(pick(row, "nom_complet"), "results.nom_complet", issues),
          legalFormLabel: null,
          nafCode: readText(
            pick(row, "activite_principale"),
            "results.activite_principale",
            issues,
          ),
          city: readText(
            pickPath(row, "siege", "libelle_commune"),
            "results.siege.libelle_commune",
            issues,
          ),
          postalCode: readText(
            pickPath(row, "siege", "code_postal"),
            "results.siege.code_postal",
            issues,
          ),
          registryStatus: readAdministrativeState(
            pick(row, "etat_administratif"),
            "results.etat_administratif",
            issues,
          ),
          createdOn: readIsoDate(pick(row, "date_creation"), "results.date_creation", issues),
          officerNames: officers
            .map((officer) =>
              officer.officerKind === "COMPANY"
                ? (officer.companyName ?? "")
                : [officer.firstNames, officer.lastName].filter(Boolean).join(" "),
            )
            .filter((name) => name.length > 0),
        });
      }

      const totalResults = readInteger(pick(root, "total_results"), "total_results", issues);
      if (hits.length === 0) {
        issues.push(
          registryIssue(
            "RESULT_SET_EMPTY",
            "INFO",
            null,
            null,
            "Aucun résultat exploitable : la recherche a répondu, elle n'a rien trouvé",
          ),
        );
      }
      if (totalResults !== null && totalResults > hits.length) {
        issues.push(
          registryIssue(
            "RESULT_SET_TRUNCATED",
            "INFO",
            null,
            totalResults,
            `${totalResults} résultats annoncés, ${hits.length} repris sur cette page : affinez la recherche plutôt que de choisir au hasard`,
          ),
        );
      }

      return {
        hits,
        totalResults,
        page: readInteger(pick(root, "page"), "page", issues),
        perPage: readInteger(pick(root, "per_page"), "per_page", issues),
        issues,
      };
    },

    readEntity(response): RegistryEntityReading {
      const issues: RegistryIssue[] = [];
      const root = asObject(response.payload);
      const rows = root ? asArray(pick(root, "results")) : null;
      if (rows === null) {
        issues.push(
          registryIssue(
            "PAYLOAD_SHAPE_UNEXPECTED",
            "ERROR",
            "results",
            response.payload,
            "Réponse d'entité : liste `results` attendue",
          ),
        );
        return { profile: null, officers: [], establishments: [], documents: [], issues };
      }

      const requestedSiren = typeof response.query.siren === "string" ? response.query.siren : null;

      // La fiche est obtenue par une RECHERCHE : rien ne garantit que le premier résultat
      // soit l'entité demandée. Un résultat portant un autre SIREN n'est pas « le plus
      // proche », c'est une autre société.
      const row = rows.find(
        (candidate) =>
          requestedSiren === null ||
          readSirenField(pick(candidate, "siren"), "siren", []) === requestedSiren,
      );

      if (row === undefined) {
        issues.push(
          registryIssue(
            "RESULT_SET_EMPTY",
            "ERROR",
            "siren",
            requestedSiren,
            `Aucun résultat ne porte le SIREN demandé${requestedSiren ? ` (${requestedSiren})` : ""} : aucune fiche n'est retenue`,
          ),
        );
        return { profile: null, officers: [], establishments: [], documents: [], issues };
      }

      const profile = readResult(row, issues);
      const officers = readOfficers(pick(row, "dirigeants"), issues);
      const establishments =
        profile === null
          ? []
          : readMatchingEstablishments(pick(row, "matching_etablissements"), profile.siren, issues);

      return {
        profile,
        officers,
        establishments,
        // Actes et comptes annuels ne sont pas publiés par cet annuaire.
        documents: [],
        issues,
      };
    },
  };
}
