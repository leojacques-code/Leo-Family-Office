/**
 * FOURNISSEUR DE FIXTURES
 *
 * Il sert deux usages, et un seul but : que la verticale entière soit exécutable et
 * vérifiable sans le moindre appel réseau.
 *
 *   * les tests unitaires et le smoke transactionnel ;
 *   * le mode hors ligne, quand aucun accès réel n'est disponible — ce qui est le cas dans
 *     cet environnement de développement, dont la politique de sortie refuse les hôtes de
 *     données publiques françaises.
 *
 * Les fixtures ne contiennent AUCUNE donnée personnelle et AUCUNE société réelle. Les SIREN
 * utilisés sont synthétiques, choisis dans une plage volontairement improbable, et leur clé
 * de contrôle a été CALCULÉE pour être valide — pas recopiée depuis un registre.
 *
 * Le fournisseur déclare l'union des capacités des deux fournisseurs réels : c'est ce qui
 * permet de tester le chemin « capacité servie » ET le chemin « capacité non servie » en
 * changeant la déclaration, sans toucher au moteur de comparaison.
 */

import { checkProfileCoherence, emptyProfile } from "./normalize";
import { systemRegistryClock, type RegistryClock } from "./transport";
import type {
  CompanyRegistryProfileCandidate,
  RegistryCapability,
  RegistryEntityReading,
  RegistryEstablishmentCandidate,
  RegistryOfficerCandidate,
  RegistryProviderAdapter,
  RegistryRawResponse,
  RegistrySearchQuery,
  RegistrySearchReading,
} from "./types";

export const FIXTURE_SCHEMA_VERSION = "fixture/2026-08-31";

export const FIXTURE_CAPABILITIES: readonly RegistryCapability[] = [
  "legal_name",
  "trade_name",
  "acronym",
  "legal_form_code",
  "legal_form_label",
  "naf_code",
  "naf_label",
  "share_capital",
  "employee_range",
  "enterprise_category",
  "created_on",
  "registry_status",
  "head_office",
  "address",
  "country",
  "establishments",
  "officers",
  "documents",
  "greffe",
];

/** SIREN synthétiques à clé de contrôle calculée. Aucune société réelle. */
export const FIXTURE_SIREN_COMPLETE = "900000001";
export const FIXTURE_SIREN_SPARSE = "900000019";
/** SIREN dont la clé de contrôle échoue : sert à prouver que l'échec est un AVERTISSEMENT. */
export const FIXTURE_SIREN_CHECKSUM_KO = "900000002";

interface FixtureEntity {
  profile: CompanyRegistryProfileCandidate;
  officers: RegistryOfficerCandidate[];
  establishments: RegistryEstablishmentCandidate[];
  documents: RegistryEntityReading["documents"];
}

function completeEntity(): FixtureEntity {
  const profile: CompanyRegistryProfileCandidate = {
    ...emptyProfile(FIXTURE_SIREN_COMPLETE),
    legalName: "SOCIÉTÉ FICTIVE ALPHA",
    tradeName: "ALPHA CONSEIL",
    acronym: "SFA",
    legalFormCode: "5710",
    legalFormLabel: "Société par actions simplifiée",
    nafCode: "70.22Z",
    nafLabel: "Conseil pour les affaires et autres conseils de gestion",
    nafNomenclature: "NAFRev2",
    shareCapital: 50_000,
    shareCapitalCurrency: "EUR",
    employeeRangeCode: "11",
    employeeRangeLabel: "10 à 19 salariés",
    employeeRangeYear: 2025,
    enterpriseCategory: "PME",
    createdOn: "2019-04-15",
    ceasedOn: null,
    registryStatus: "ACTIVE",
    headOfficeSiret: `${FIXTURE_SIREN_COMPLETE}00009`,
    addressLine: "12 RUE DE L'EXEMPLE",
    postalCode: "75002",
    city: "PARIS 2E ARRONDISSEMENT",
    cityCode: "75102",
    country: "FR",
    establishmentCount: 2,
    greffe: "PARIS",
    rcsNumber: null,
    issues: [],
  };

  return {
    profile: checkProfileCoherence(profile, 2),
    officers: [
      {
        officerKind: "PERSON",
        lastName: "DUPONT-FICTIF",
        firstNames: "CAMILLE",
        birthYear: 1978,
        nationality: "Française",
        roleLabel: "Président",
        roleCode: null,
        companySiren: null,
        companyName: null,
        sinceOn: null,
      },
      {
        officerKind: "COMPANY",
        lastName: null,
        firstNames: null,
        birthYear: null,
        nationality: null,
        roleLabel: "Directeur général",
        roleCode: null,
        companySiren: FIXTURE_SIREN_SPARSE,
        companyName: "HOLDING FICTIVE BETA",
        sinceOn: "2021-01-04",
      },
    ],
    establishments: [
      {
        siret: `${FIXTURE_SIREN_COMPLETE}00009`,
        isHeadOffice: true,
        establishmentStatus: "ACTIVE",
        addressLine: "12 RUE DE L'EXEMPLE",
        postalCode: "75002",
        city: "PARIS 2E ARRONDISSEMENT",
        cityCode: "75102",
        country: "FR",
        nafCode: "70.22Z",
        nafLabel: "Conseil pour les affaires et autres conseils de gestion",
        employeeRangeCode: "11",
        createdOn: "2019-04-15",
        closedOn: null,
      },
      {
        siret: `${FIXTURE_SIREN_COMPLETE}00017`,
        isHeadOffice: false,
        establishmentStatus: "ACTIVE",
        addressLine: "3 AVENUE DU TEST",
        postalCode: "69003",
        city: "LYON 3E ARRONDISSEMENT",
        cityCode: "69383",
        country: "FR",
        nafCode: "70.22Z",
        nafLabel: null,
        employeeRangeCode: null,
        createdOn: "2022-09-01",
        closedOn: null,
      },
    ],
    documents: [
      {
        documentKind: "ANNUAL_ACCOUNTS",
        providerDocumentId: "fixture-comptes-2025",
        fiscalYearEnd: "2025-12-31",
        filingDate: "2026-06-30",
        confidentiality: "PUBLIC",
        downloadAvailable: true,
      },
      {
        documentKind: "ANNUAL_ACCOUNTS",
        providerDocumentId: "fixture-comptes-2024",
        fiscalYearEnd: "2024-12-31",
        filingDate: "2025-07-02",
        confidentiality: "CONFIDENTIAL",
        downloadAvailable: false,
      },
    ],
  };
}

/**
 * Fiche PAUVRE : l'entité existe, mais le registre ne publie presque rien. Elle prouve que
 * l'absence produit des `null` signalés, et jamais un zéro ni une valeur plausible.
 */
function sparseEntity(): FixtureEntity {
  const profile: CompanyRegistryProfileCandidate = {
    ...emptyProfile(FIXTURE_SIREN_SPARSE),
    legalName: "HOLDING FICTIVE BETA",
    legalFormCode: "5499",
    createdOn: "2016-11-02",
    registryStatus: "ACTIVE",
    issues: [],
  };
  return {
    profile: checkProfileCoherence(profile, 0),
    officers: [],
    establishments: [],
    documents: [],
  };
}

const ENTITIES: Record<string, () => FixtureEntity> = {
  [FIXTURE_SIREN_COMPLETE]: completeEntity,
  [FIXTURE_SIREN_SPARSE]: sparseEntity,
};

export interface FixtureAdapterOptions {
  clock?: RegistryClock;
  /** Capacités à DÉCLARER. Restreindre la liste teste le chemin « non servi ». */
  capabilities?: readonly RegistryCapability[];
  /** Fraîcheur déclarée. `0` produit un instantané immédiatement périmé, pour les tests. */
  snapshotTtlMinutes?: number | null;
  /** Force un échec, pour éprouver la persistance d'un échec de fournisseur. */
  failWith?: RegistryRawResponse["errorCode"];
}

export function createFixtureAdapter(options: FixtureAdapterOptions = {}): RegistryProviderAdapter {
  const clock = options.clock ?? systemRegistryClock;
  const capabilities = options.capabilities ?? FIXTURE_CAPABILITIES;

  function response(
    endpoint: RegistryRawResponse["endpoint"],
    query: Record<string, unknown>,
    payload: unknown,
  ): RegistryRawResponse {
    if (options.failWith) {
      return {
        endpoint,
        query,
        httpStatus: options.failWith === "RATE_LIMITED" ? 429 : null,
        payload: null,
        payloadBytes: null,
        observedAt: new Date(clock.now()).toISOString(),
        providerUpdatedAt: null,
        errorCode: options.failWith,
        errorMessage: `Échec simulé : ${options.failWith}`,
      };
    }
    const serialized = JSON.stringify(payload);
    return {
      endpoint,
      query,
      httpStatus: 200,
      payload,
      payloadBytes: serialized.length,
      observedAt: new Date(clock.now()).toISOString(),
      providerUpdatedAt: null,
      errorCode: null,
      errorMessage: null,
    };
  }

  /**
   * Le payload de fixture est la LECTURE elle-même, sérialisée. C'est assumé : l'objet de
   * ce fournisseur n'est pas d'éprouver un mapping de champs — les fournisseurs réels le
   * font, avec leurs propres fixtures de payload — mais d'éprouver tout ce qui vient APRÈS
   * la lecture : persistance, comparaison, décision, atomicité.
   */
  return {
    provider: "FIXTURE",
    label: "Registre de fixtures (hors ligne)",
    schemaVersion: FIXTURE_SCHEMA_VERSION,
    adapterVersion: "fixture/1",
    authMode: "NONE",
    credentialEnvVar: null,
    capabilities,
    baseUrl: null,
    snapshotTtlMinutes:
      options.snapshotTtlMinutes === undefined ? 24 * 60 : options.snapshotTtlMinutes,
    rateLimitPerMinute: null,

    async search(query: RegistrySearchQuery): Promise<RegistryRawResponse> {
      const needle = (query.siren ?? query.text ?? query.officerName ?? "").toLowerCase();
      const hits = Object.values(ENTITIES)
        .map((build) => build())
        .filter((entity) => {
          if (needle.length === 0) return true;
          return (
            entity.profile.siren.includes(needle) ||
            (entity.profile.legalName ?? "").toLowerCase().includes(needle) ||
            entity.officers.some((officer) =>
              [officer.lastName, officer.firstNames, officer.companyName]
                .filter((part): part is string => part !== null)
                .some((part) => part.toLowerCase().includes(needle)),
            )
          );
        });
      return response("SEARCH", { ...query }, { entities: hits });
    },

    async entity(siren: string): Promise<RegistryRawResponse> {
      const build = ENTITIES[siren];
      if (!build) {
        return {
          endpoint: "ENTITY",
          query: { siren },
          httpStatus: 404,
          payload: null,
          payloadBytes: null,
          observedAt: new Date(clock.now()).toISOString(),
          providerUpdatedAt: null,
          errorCode: "NOT_FOUND",
          errorMessage: `Aucune entité de fixture pour le SIREN ${siren}`,
        };
      }
      return response("ENTITY", { siren }, { entities: [build()] });
    },

    readSearch(response): RegistrySearchReading {
      const entities = readEntities(response.payload);
      return {
        hits: entities.map((entity) => ({
          siren: entity.profile.siren,
          legalName: entity.profile.legalName,
          tradeName: entity.profile.tradeName,
          legalFormLabel: entity.profile.legalFormLabel,
          nafCode: entity.profile.nafCode,
          city: entity.profile.city,
          postalCode: entity.profile.postalCode,
          registryStatus: entity.profile.registryStatus,
          createdOn: entity.profile.createdOn,
          officerNames: entity.officers
            .map((officer) =>
              officer.officerKind === "COMPANY"
                ? (officer.companyName ?? "")
                : [officer.firstNames, officer.lastName].filter(Boolean).join(" "),
            )
            .filter((name) => name.length > 0),
        })),
        totalResults: entities.length,
        page: 1,
        perPage: entities.length,
        issues: [],
      };
    },

    readEntity(response): RegistryEntityReading {
      const entities = readEntities(response.payload);
      const entity = entities[0];
      if (!entity) {
        return { profile: null, officers: [], establishments: [], documents: [], issues: [] };
      }
      return {
        profile: entity.profile,
        officers: entity.officers,
        establishments: entity.establishments,
        documents: entity.documents,
        issues: entity.profile.issues,
      };
    },
  };
}

function readEntities(payload: unknown): FixtureEntity[] {
  if (payload === null || typeof payload !== "object") return [];
  const entities = (payload as { entities?: unknown }).entities;
  return Array.isArray(entities) ? (entities as FixtureEntity[]) : [];
}
