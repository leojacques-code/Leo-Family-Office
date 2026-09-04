/**
 * FOURNISSEUR — INPI / Registre National des Entreprises (RNE)
 *
 * Le RNE sert ce que l'annuaire ouvert ne sert pas : libellé de forme juridique, capital
 * social, greffe, actes et comptes annuels déposés. C'est pour ces champs qu'il existe ici.
 *
 * ── PORTÉE DÉLIBÉRÉMENT RESTREINTE, ET POURQUOI ──────────────────────────────────────────
 *
 * 1. L'ÉCHANGE IDENTIFIANTS → JETON N'EST PAS IMPLÉMENTÉ. Le RNE délivre un jeton contre
 *    des identifiants, par un appel dont le contrat exact ne peut pas être vérifié depuis
 *    cet environnement : la sortie réseau vers les hôtes de données publiques françaises est
 *    refusée par la politique de l'organisation. Implémenter à l'aveugle une poignée de main
 *    d'authentification produirait du code qui a l'air fini et qui échouerait au premier
 *    appel réel, en donnant la fausse impression que l'intégration est prête.
 *
 *    L'adaptateur consomme donc un JETON fourni par la configuration serveur
 *    (`INPI_RNE_TOKEN`). Sans lui, il rend `CREDENTIALS_MISSING` SANS appel réseau : une
 *    connexion sans secret n'a rien à demander.
 *
 * 2. LA CORRESPONDANCE DES CHAMPS N'EST PAS VÉRIFIÉE EN LIGNE, pour la même raison. Elle
 *    suit la structure publiée `formality.content` et reste volontairement courte : chaque
 *    chemin non trouvé rend `null` avec son anomalie, jamais une valeur inventée. Une
 *    correspondance incomplète produit une fiche partielle honnête ; une correspondance
 *    devinée produirait un chiffre faux.
 *
 * Les deux points sont déclarés `BLOCKED_EXTERNAL` dans
 * `docs/COMPANY_REGISTRY_ACQUISITION.md`. Ils ne bloquent aucun autre chantier.
 */

import {
  asArray,
  asObject,
  checkProfileCoherence,
  emptyProfile,
  pick,
  pickPath,
  readCurrency,
  readDecimal,
  readInteger,
  readIsoDate,
  readSirenField,
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
  type RegistryDocumentCandidate,
  type RegistryEntityReading,
  type RegistryIssue,
  type RegistryOfficerCandidate,
  type RegistryProviderAdapter,
  type RegistryRawResponse,
  type RegistryCallOptions,
  type RegistrySearchQuery,
  type RegistrySearchReading,
} from "./types";

export const INPI_RNE_BASE_URL = "https://registre-national-entreprises.inpi.fr";
export const INPI_RNE_SCHEMA_VERSION = "inpi-rne/2026-08-31";
export const INPI_RNE_CREDENTIAL_ENV_VAR = "INPI_RNE_TOKEN";

export const INPI_RNE_CAPABILITIES: readonly RegistryCapability[] = [
  "legal_name",
  "acronym",
  "legal_form_code",
  "legal_form_label",
  "naf_code",
  "share_capital",
  "created_on",
  "ceased_on",
  "registry_status",
  "head_office",
  "address",
  "country",
  "officers",
  "documents",
  "greffe",
];

/** Quota prudent : le RNE n'annonce pas de limite publique, et le dépasser fait révoquer. */
export const INPI_RNE_RATE_LIMIT_PER_MINUTE = 30;

/**
 * Un dépôt au RNE est un fait durable : une immatriculation ne change pas d'un jour à
 * l'autre. Sept jours est la fraîcheur DÉCLARÉE par ce produit, pas un engagement de l'INPI.
 */
export const INPI_RNE_TTL_MINUTES = 7 * 24 * 60;

function nowIso(clock: RegistryTransportConfig["clock"]): string {
  return new Date(clock.now()).toISOString();
}

/**
 * `formality.content` distingue personne morale et personne physique. Les deux branches sont
 * lues ; celle qui est absente ne produit rien, et surtout pas un profil vide présenté comme
 * une fiche.
 */
function contentRoot(payload: unknown): unknown {
  const direct = pickPath(payload, "formality", "content");
  if (direct !== undefined) return direct;
  return pick(payload, "content");
}

function readOfficers(value: unknown, issues: RegistryIssue[]): RegistryOfficerCandidate[] {
  const rows = asArray(value);
  if (rows === null) return [];
  const officers: RegistryOfficerCandidate[] = [];
  for (const row of rows) {
    const individual = pickPath(row, "individu", "descriptionPersonne");
    const entity = pick(row, "entreprise");
    const roleLabel = readText(pick(row, "roleEntreprise"), "pouvoirs.roleEntreprise", issues);

    if (individual !== undefined) {
      officers.push({
        officerKind: "PERSON",
        lastName: readText(pick(individual, "nom"), "pouvoirs.individu.nom", issues),
        firstNames: (() => {
          const names = asArray(pick(individual, "prenoms"));
          if (names === null)
            return readText(pick(individual, "prenoms"), "pouvoirs.individu.prenoms", issues);
          const readable = names
            .map((name) => readText(name, "pouvoirs.individu.prenoms", issues))
            .filter((name): name is string => name !== null);
          return readable.length > 0 ? readable.join(" ") : null;
        })(),
        // Le RNE publie une date de naissance partielle `AAAA-MM`. Seule l'ANNÉE est
        // conservée : stocker davantage que ce qui sert à distinguer deux homonymes serait
        // une aggravation gratuite du risque.
        birthYear: (() => {
          const raw = readText(
            pick(individual, "dateDeNaissance"),
            "pouvoirs.individu.dateDeNaissance",
            issues,
          );
          if (raw === null) return null;
          const match = /^(\d{4})/.exec(raw);
          return match ? readInteger(match[1], "pouvoirs.individu.dateDeNaissance", issues) : null;
        })(),
        nationality: readText(
          pick(individual, "nationalite"),
          "pouvoirs.individu.nationalite",
          issues,
        ),
        roleLabel,
        roleCode: null,
        companySiren: null,
        companyName: null,
        sinceOn: null,
      });
      continue;
    }

    if (entity !== undefined) {
      officers.push({
        officerKind: "COMPANY",
        lastName: null,
        firstNames: null,
        birthYear: null,
        nationality: null,
        roleLabel,
        roleCode: null,
        companySiren: readSirenField(pick(entity, "siren"), "pouvoirs.entreprise.siren", issues),
        companyName: readText(
          pick(entity, "denomination"),
          "pouvoirs.entreprise.denomination",
          issues,
        ),
        sinceOn: null,
      });
    }
  }
  return officers;
}

function readDocuments(value: unknown, issues: RegistryIssue[]): RegistryDocumentCandidate[] {
  const rows = asArray(value);
  if (rows === null) return [];
  return rows.map((row) => ({
    documentKind: "ANNUAL_ACCOUNTS" as const,
    providerDocumentId: readText(pick(row, "id"), "comptesAnnuels.id", issues),
    fiscalYearEnd: readIsoDate(pick(row, "dateCloture"), "comptesAnnuels.dateCloture", issues),
    filingDate: readIsoDate(pick(row, "dateDepot"), "comptesAnnuels.dateDepot", issues),
    confidentiality: (() => {
      const confidential = pick(row, "confidentiel");
      if (confidential === true) return "CONFIDENTIAL" as const;
      if (confidential === false) return "PUBLIC" as const;
      return "UNKNOWN" as const;
    })(),
    // Le fournisseur n'annonce pas la récupérabilité du contenu dans cette liste : ne rien
    // affirmer est la seule lecture honnête.
    downloadAvailable: null,
  }));
}

export interface InpiRneOptions {
  transport?: Partial<RegistryTransportConfig>;
  fetchImpl?: typeof fetch;
  /** Jeton lu par l'appelant SERVEUR. Il ne traverse jamais le navigateur. */
  token?: string | null;
}

export function createInpiRneAdapter(options: InpiRneOptions = {}): RegistryProviderAdapter {
  const config: RegistryTransportConfig = {
    ...DEFAULT_TRANSPORT,
    fetchImpl: options.fetchImpl ?? fetch,
    rateLimitPerMinute: INPI_RNE_RATE_LIMIT_PER_MINUTE,
    ...options.transport,
  };
  const limiter = new RegistryRateLimiter(config.rateLimitPerMinute, config.clock);
  const token = options.token ?? null;

  function missingCredential(
    endpoint: RegistryRawResponse["endpoint"],
    query: Record<string, unknown>,
  ): RegistryRawResponse {
    return {
      endpoint,
      query,
      httpStatus: null,
      payload: null,
      payloadBytes: null,
      observedAt: nowIso(config.clock),
      providerUpdatedAt: null,
      errorCode: "CREDENTIALS_MISSING",
      errorMessage: `Jeton absent : renseignez ${INPI_RNE_CREDENTIAL_ENV_VAR} côté serveur. Aucun appel n'a été tenté`,
    };
  }

  return {
    provider: "INPI_RNE",
    label: "INPI — Registre National des Entreprises",
    schemaVersion: INPI_RNE_SCHEMA_VERSION,
    adapterVersion: "inpi-rne/1",
    authMode: "BEARER_TOKEN",
    credentialEnvVar: INPI_RNE_CREDENTIAL_ENV_VAR,
    capabilities: INPI_RNE_CAPABILITIES,
    baseUrl: INPI_RNE_BASE_URL,
    snapshotTtlMinutes: INPI_RNE_TTL_MINUTES,
    rateLimitPerMinute: INPI_RNE_RATE_LIMIT_PER_MINUTE,

    /**
     * Le RNE n'est pas un moteur de recherche grand public : il s'interroge par identifiant.
     * Une recherche par raison sociale appartient à l'annuaire ouvert, et prétendre le
     * contraire ferait chercher l'utilisateur au mauvais endroit.
     */
    async search(
      query: RegistrySearchQuery,
      options?: RegistryCallOptions,
    ): Promise<RegistryRawResponse> {
      if (!query.siren) {
        return {
          endpoint: "SEARCH",
          query: { ...query },
          httpStatus: null,
          payload: null,
          payloadBytes: null,
          observedAt: nowIso(config.clock),
          providerUpdatedAt: null,
          errorCode: "INVALID_RESPONSE",
          errorMessage:
            "Le RNE s'interroge par SIREN. Utilisez l'annuaire ouvert pour une recherche par raison sociale ou par dirigeant",
        };
      }
      return this.entity(query.siren, options);
    },

    async entity(siren: string, options?: RegistryCallOptions): Promise<RegistryRawResponse> {
      const query = { siren };
      if (token === null || token.trim().length === 0) return missingCredential("ENTITY", query);

      const url = new URL(
        `/api/companies/${encodeURIComponent(siren)}`,
        INPI_RNE_BASE_URL,
      ).toString();
      const result = await callRegistry(
        // Le signal du DEMANDEUR est transmis tel quel : le transport le compose avec son
        // propre délai, il ne le remplace pas.
        { url, headers: { authorization: `Bearer ${token}` }, signal: options?.signal },
        config,
        limiter,
      );
      return {
        endpoint: "ENTITY",
        query: { ...query, url },
        httpStatus: result.httpStatus,
        payload: result.payload,
        payloadBytes: result.payloadBytes,
        observedAt: nowIso(config.clock),
        providerUpdatedAt: result.providerUpdatedAt,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      };
    },

    readSearch(response): RegistrySearchReading {
      const reading = this.readEntity(response);
      if (reading.profile === null) {
        return { hits: [], totalResults: 0, page: 1, perPage: 1, issues: reading.issues };
      }
      return {
        hits: [
          {
            siren: reading.profile.siren,
            legalName: reading.profile.legalName,
            tradeName: reading.profile.tradeName,
            legalFormLabel: reading.profile.legalFormLabel,
            nafCode: reading.profile.nafCode,
            city: reading.profile.city,
            postalCode: reading.profile.postalCode,
            registryStatus: reading.profile.registryStatus,
            createdOn: reading.profile.createdOn,
            officerNames: reading.officers
              .map((officer) =>
                officer.officerKind === "COMPANY"
                  ? (officer.companyName ?? "")
                  : [officer.firstNames, officer.lastName].filter(Boolean).join(" "),
              )
              .filter((name) => name.length > 0),
          },
        ],
        totalResults: 1,
        page: 1,
        perPage: 1,
        issues: reading.issues,
      };
    },

    readEntity(response): RegistryEntityReading {
      const issues: RegistryIssue[] = [];
      const root = asObject(response.payload);
      if (root === null) {
        issues.push(
          registryIssue(
            "PAYLOAD_SHAPE_UNEXPECTED",
            "ERROR",
            null,
            response.payload,
            "Réponse RNE : objet attendu à la racine",
          ),
        );
        return { profile: null, officers: [], establishments: [], documents: [], issues };
      }

      const siren = readSirenField(pick(root, "siren"), "siren", issues);
      if (siren === null) {
        issues.push(
          registryIssue(
            "SIREN_MISSING",
            "ERROR",
            "siren",
            pick(root, "siren"),
            "Réponse RNE sans SIREN exploitable : aucun profil n'est produit",
          ),
        );
        return { profile: null, officers: [], establishments: [], documents: [], issues };
      }

      const content = contentRoot(root);
      const legalEntity = pick(content, "personneMorale");
      const identity = pick(legalEntity, "identite");
      const description = pick(identity, "description");
      const entityBlock = pick(identity, "entreprise");
      const address = pickPath(legalEntity, "adresseEntreprise", "adresse");

      const profile: CompanyRegistryProfileCandidate = {
        ...emptyProfile(siren),
        legalName: readText(
          pick(entityBlock, "denomination"),
          "identite.entreprise.denomination",
          issues,
        ),
        acronym: readText(pick(entityBlock, "sigle"), "identite.entreprise.sigle", issues),
        legalFormCode: readText(
          pick(entityBlock, "formeJuridique"),
          "identite.entreprise.formeJuridique",
          issues,
        ),
        legalFormLabel: readText(
          pick(description, "libelleFormeJuridique") ?? pick(entityBlock, "libelleFormeJuridique"),
          "identite.libelleFormeJuridique",
          issues,
        ),
        nafCode: readText(
          pick(entityBlock, "codeApe") ?? pick(description, "codeApe"),
          "identite.codeApe",
          issues,
        ),
        shareCapital: readDecimal(
          pick(description, "montantCapital"),
          "identite.description.montantCapital",
          issues,
        ),
        shareCapitalCurrency: readCurrency(
          pick(description, "deviseCapital") ?? pick(description, "devise"),
          "identite.description.deviseCapital",
          issues,
        ),
        createdOn: readIsoDate(
          pick(entityBlock, "dateImmat") ?? pick(entityBlock, "dateImmatriculation"),
          "identite.entreprise.dateImmatriculation",
          issues,
        ),
        ceasedOn: readIsoDate(
          pick(entityBlock, "dateRadiation"),
          "identite.entreprise.dateRadiation",
          issues,
        ),
        registryStatus: (() => {
          const radiated = readIsoDate(
            pick(entityBlock, "dateRadiation"),
            "identite.entreprise.dateRadiation",
            [],
          );
          if (radiated !== null) return "CEASED" as const;
          // Une absence de radiation n'est pas une preuve d'activité : le statut reste
          // inconnu plutôt qu'affirmé actif.
          return null;
        })(),
        addressLine: (() => {
          const parts = [
            readText(pick(address, "numVoie"), "adresse.numVoie", issues),
            readText(pick(address, "typeVoie"), "adresse.typeVoie", issues),
            readText(pick(address, "voie"), "adresse.voie", issues),
          ].filter((part): part is string => part !== null);
          return parts.length > 0 ? parts.join(" ") : null;
        })(),
        postalCode: readText(pick(address, "codePostal"), "adresse.codePostal", issues),
        city: readText(pick(address, "commune"), "adresse.commune", issues),
        cityCode: readText(pick(address, "codeInseeCommune"), "adresse.codeInseeCommune", issues),
        country: (() => {
          const code = readText(pick(address, "codePays"), "adresse.codePays", issues);
          if (code === null) return null;
          const upper = code.toUpperCase();
          return /^[A-Z]{2}$/.test(upper) ? upper : null;
        })(),
        greffe: readText(pick(root, "greffe") ?? pick(entityBlock, "greffe"), "greffe", issues),
        issues: [],
      };

      const officers = readOfficers(
        pick(legalEntity, "composition")
          ? pickPath(legalEntity, "composition", "pouvoirs")
          : pick(legalEntity, "pouvoirs"),
        issues,
      );
      const documents = readDocuments(pick(root, "comptesAnnuels"), issues);

      return {
        profile: checkProfileCoherence({ ...profile, issues }, 0),
        officers,
        // Le RNE n'expose pas la liste des établissements sur cette route : ne rien rendre
        // est exact, rendre une liste vide présentée comme exhaustive ne le serait pas.
        establishments: [],
        documents,
        issues,
      };
    },
  };
}
