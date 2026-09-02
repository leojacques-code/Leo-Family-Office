/**
 * ADAPTATEUR DPE — DIAGNOSTIC DE PERFORMANCE ÉNERGÉTIQUE
 *
 * Un DPE est un fait imprimé sur un document opposable : une étiquette, une consommation,
 * une émission, une date. L'adaptateur les LIT et s'arrête là.
 *
 * Ce qu'il ne fait pas, et chaque refus est une décision :
 *
 *   * AUCUNE VALIDITÉ N'EST CALCULÉE. La durée de validité d'un DPE dépend de règles
 *     réglementaires datées, et de régimes transitoires, que ce dépôt ne contient pas. Si la
 *     source déclare une fin de validité, elle est lue ; sinon elle reste `null`. Déduire une
 *     date d'une règle non fournie produirait une date sans source, et un bien serait
 *     annoncé « conforme » ou « périmé » sur la foi d'une invention.
 *
 *   * AUCUNE ÉTIQUETTE N'EST DÉDUITE D'UNE CONSOMMATION. Le passage d'un kWh/m²/an à une
 *     lettre suppose une grille et une zone climatique. Sans elles, une consommation lue
 *     n'est pas une étiquette. ÉTIQUETTE ABSENTE ≠ ÉTIQUETTE G.
 *
 *   * AUCUN DPE N'EST RATTACHÉ À UN BIEN. Un immeuble porte autant de DPE que de lots :
 *     l'adresse en désigne le bâtiment, jamais l'appartement. Le rattachement est une
 *     décision humaine, prise ailleurs.
 *
 *   * DEUX MÉTHODES NE SONT PAS COMPARABLES TERME À TERME. La version de méthode est lue et
 *     transportée pour que la comparaison de deux DPE reste consciente de ce qu'elle compare.
 */

import { fetchJson, TokenBucket, type TransportOptions } from "@/lib/acquisition/transport";

import {
  readArea,
  readCode,
  readEnergyLabel,
  readInteger,
  readIsoDate,
  readNumber,
  readRecordArray,
  readText,
  type Row,
} from "./read";
import {
  publicDataIssue,
  type AdapterDescriptor,
  type EnergyCertificateCandidate,
  type PublicDataFetch,
  type PublicDataIssue,
  type PublicDataProvider,
  type PublicDataQuery,
} from "./types";

export const DPE_BASE_URL_ENV = "DPE_API_BASE_URL";

const RECORD_KEYS = ["results", "records", "data"] as const;

const FIELDS = {
  certificateRef: ["numero_dpe", "n_dpe", "numero"],
  issuedOn: ["date_etablissement_dpe", "date_realisation", "date_visite_diagnostiqueur"],
  validUntil: ["date_fin_validite_dpe", "date_fin_validite"],
  methodVersion: ["version_dpe", "methode_application_dpe", "modele_dpe"],
  energyLabel: ["etiquette_dpe", "classe_consommation_energie", "etiquette_energie"],
  energyValue: ["consommation_energie_primaire", "consommation_energie", "ep_conso_5_usages_m2"],
  ghgLabel: ["etiquette_ges", "classe_estimation_ges"],
  ghgValue: ["emission_ges", "estimation_ges", "emission_ges_5_usages_m2"],
  livingArea: ["surface_habitable_logement", "surface_habitable", "surface_thermique_lot"],
  buildingKind: ["type_batiment", "typologie_logement"],
  constructionYear: ["annee_construction", "periode_construction"],
  addressLabel: ["adresse_ban", "adresse_brut", "geo_adresse", "adresse"],
  postalCode: ["code_postal_ban", "code_postal_brut", "code_postal"],
  communeCode: ["code_insee_ban", "code_insee_commune_actualise", "code_commune"],
} as const;

/**
 * Unités DÉCLARÉES par l'adaptateur, pas devinées d'un nom de champ.
 *
 * Une valeur sans unité n'est pas interprétable, et la base le refuse. Les déclarer ici est
 * le seul moyen honnête de les porter : la source les documente hors du corps de réponse, et
 * les inférer d'un intitulé de colonne les rendrait dépendantes d'une graphie.
 */
export const DPE_ENERGY_UNIT = "kWh/m2/an";
export const DPE_GHG_UNIT = "kgCO2/m2/an";

function firstReadable<T>(
  row: Row,
  names: readonly string[],
  index: number,
  issues: PublicDataIssue[],
  reader: (row: Row, field: string, index: number, issues: PublicDataIssue[]) => T | null,
): T | null {
  const attempts: PublicDataIssue[] = [];
  let anyPresent = false;
  for (const name of names) {
    if (!(name in row)) continue;
    anyPresent = true;
    const local: PublicDataIssue[] = [];
    const value = reader(row, name, index, local);
    if (value !== null) return value;
    attempts.push(...local);
  }
  if (anyPresent) issues.push(...attempts);
  return null;
}

export function dpeDescriptor(options?: {
  baseUrl?: string;
  datasetVersion?: string | null;
}): AdapterDescriptor {
  return {
    provider: "DPE_OPEN_DATA",
    dataset: "DPE",
    adapterVersion: "1",
    datasetVersion: options?.datasetVersion ?? null,
    baseUrl: options?.baseUrl ?? "",
    licence: "Licence ouverte / Open Licence",
    capabilities: {
      fields: [
        "certificateRef",
        "issuedOn",
        "validUntil",
        "methodVersion",
        "energyLabel",
        "energyValue",
        "ghgLabel",
        "ghgValue",
        "livingAreaSqm",
        "buildingKind",
        "constructionYear",
        "addressLabel",
        "postalCode",
        "communeCode",
      ],
      // L'adaptateur ne sait pas déclarer la couverture d'une adresse : un DPE peut
      // simplement ne pas avoir été réalisé. Un vide reste donc muet, et c'est déclaré ici
      // plutôt que présumé par l'appelant.
      declaresCoverage: false,
      // Le numéro de DPE est un identifiant réglementaire, mais sa stabilité entre deux
      // extractions du jeu n'est pas déclarée par le publieur. Le tenir pour stable
      // autoriserait un rejet automatique, et un diagnostic réel disparaîtrait.
      stableRecordId: false,
    },
    declaredCoverage: {
      note: "L'absence de DPE à une adresse ne dit pas que le logement n'en a pas : il peut ne pas être publié, ou l'adresse peut être écrite autrement. Un vide est muet.",
      excludedDepartments: [],
    },
    snapshotTtlMinutes: 60 * 24 * 30,
    rateLimitPerMinute: 30,
    credentialEnvVar: null,
  };
}

export function readDpeRow(row: Row, index: number): EnergyCertificateCandidate {
  const issues: PublicDataIssue[] = [];

  const energyValue = firstReadable(row, FIELDS.energyValue, index, issues, readNumber);
  const ghgValue = firstReadable(row, FIELDS.ghgValue, index, issues, readNumber);
  const issuedOn = firstReadable(row, FIELDS.issuedOn, index, issues, readIsoDate);
  const validUntil = firstReadable(row, FIELDS.validUntil, index, issues, readIsoDate);
  const energyLabel = firstReadable(row, FIELDS.energyLabel, index, issues, readEnergyLabel);

  if (validUntil === null) {
    issues.push(
      publicDataIssue(
        "FIELD_MISSING",
        "INFO",
        index,
        "date_fin_validite_dpe",
        "Fin de validité non déclarée par la source : elle reste inconnue. Elle n'est pas déduite d'une règle, et le diagnostic n'est donc annoncé ni valide ni périmé",
      ),
    );
  }
  if (energyLabel === null && energyValue !== null) {
    issues.push(
      publicDataIssue(
        "CAPABILITY_NOT_SERVED",
        "WARNING",
        index,
        "etiquette_dpe",
        "Consommation lue sans étiquette : convertir l'une en l'autre suppose une grille et une zone climatique absentes de ce dépôt. L'étiquette reste inconnue, et non pas G",
      ),
    );
  }
  if (validUntil !== null && issuedOn !== null && validUntil <= issuedOn) {
    issues.push(
      publicDataIssue(
        "FIELD_UNREADABLE",
        "WARNING",
        index,
        "date_fin_validite_dpe",
        `Fin de validité (${validUntil}) antérieure ou égale à la date d'établissement (${issuedOn}) : l'enregistrement sera refusé par la base plutôt que corrigé`,
      ),
    );
  }

  return {
    rowIndex: index,
    certificateRef: firstReadable(row, FIELDS.certificateRef, index, issues, readText),
    issuedOn,
    validUntil,
    methodVersion: firstReadable(row, FIELDS.methodVersion, index, issues, readText),
    energyLabel,
    energyValue,
    // L'unité n'accompagne une valeur que si la valeur existe : une unité seule décrirait un
    // terme qui n'a pas été lu.
    energyUnit: energyValue === null ? null : DPE_ENERGY_UNIT,
    ghgLabel: firstReadable(row, FIELDS.ghgLabel, index, issues, readEnergyLabel),
    ghgValue,
    ghgUnit: ghgValue === null ? null : DPE_GHG_UNIT,
    livingAreaSqm: firstReadable(row, FIELDS.livingArea, index, issues, readArea),
    buildingKind: firstReadable(row, FIELDS.buildingKind, index, issues, readText),
    constructionYear: firstReadable(row, FIELDS.constructionYear, index, issues, readInteger),
    addressLabel: firstReadable(row, FIELDS.addressLabel, index, issues, readText),
    postalCode: firstReadable(row, FIELDS.postalCode, index, issues, (r, f, i, is) =>
      readCode(r, f, 5, i, is),
    ),
    communeCode: firstReadable(row, FIELDS.communeCode, index, issues, (r, f, i, is) =>
      readCode(r, f, 5, i, is),
    ),
    raw: row,
    issues,
  };
}

function queryString(query: PublicDataQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.address) params.q = query.address;
  if (query.postalCode) params.code_postal = query.postalCode;
  if (query.communeCode) params.code_insee = query.communeCode;
  params.size = String(Math.min(Math.max(query.limit ?? 50, 1), 500));
  return params;
}

export function createDpeProvider(options: {
  baseUrl: string;
  datasetVersion?: string | null;
  transport?: TransportOptions;
}): PublicDataProvider {
  const descriptor = dpeDescriptor({
    baseUrl: options.baseUrl,
    datasetVersion: options.datasetVersion ?? null,
  });
  const limiter = new TokenBucket(descriptor.rateLimitPerMinute);

  return {
    descriptor,
    async fetch(query) {
      const issues: PublicDataIssue[] = [];
      const params = queryString(query);
      // L'adaptateur ne déclare pas la couverture d'une adresse : un vide y est muet, et le
      // dire est plus utile que de prétendre le contraire.
      const coverageNote = descriptor.declaredCoverage.note;

      if (descriptor.baseUrl.length === 0) {
        return {
          descriptor,
          query: params,
          status: "NOT_SERVED",
          httpStatus: null,
          coverageState: "COVERAGE_UNKNOWN",
          coverageNote,
          rawText: "",
          sales: [],
          certificates: [],
          errorCode: "ADAPTER_NOT_CONFIGURED",
          errorMessage: `Aucune URL de base configurée (${DPE_BASE_URL_ENV}) : aucune lecture n'a été tentée`,
          issues: [
            publicDataIssue(
              "CAPABILITY_NOT_SERVED",
              "ERROR",
              null,
              null,
              `Adaptateur DPE non configuré : renseignez ${DPE_BASE_URL_ENV}. Une capacité non servie n'est pas une absence de diagnostic`,
            ),
          ],
        } satisfies PublicDataFetch;
      }

      const url = `${descriptor.baseUrl}?${new URLSearchParams(params).toString()}`;
      const result = await fetchJson(url, { limiter, ...(options.transport ?? {}) });

      if (!result.ok) {
        return {
          descriptor,
          query: params,
          status: "FAILED",
          httpStatus: result.httpStatus,
          coverageState: "COVERAGE_UNKNOWN",
          coverageNote,
          rawText: "",
          sales: [],
          certificates: [],
          errorCode: result.code,
          errorMessage: result.message,
          issues: [
            publicDataIssue(
              "TRANSPORT_FAILURE",
              "ERROR",
              null,
              null,
              `Lecture DPE impossible (${result.code}) : ${result.message}. Ce n'est pas une absence de diagnostic`,
            ),
          ],
        } satisfies PublicDataFetch;
      }

      const rows = readRecordArray(result.body, RECORD_KEYS, issues);
      if (rows === null) {
        return {
          descriptor,
          query: params,
          status: "FAILED",
          httpStatus: result.httpStatus,
          coverageState: "COVERAGE_UNKNOWN",
          coverageNote,
          rawText: result.rawText,
          sales: [],
          certificates: [],
          errorCode: "MALFORMED_RESPONSE",
          errorMessage: "La réponse ne porte aucun tableau d'enregistrements reconnaissable",
          issues,
        } satisfies PublicDataFetch;
      }

      const certificates = rows.map((row, index) => readDpeRow(row, index));
      for (const certificate of certificates) issues.push(...certificate.issues);

      return {
        descriptor,
        query: params,
        status: certificates.length > 0 ? "RETRIEVED" : "EMPTY",
        httpStatus: result.httpStatus,
        coverageState: "COVERAGE_UNKNOWN",
        coverageNote,
        rawText: result.rawText,
        sales: [],
        certificates,
        errorCode: null,
        errorMessage: null,
        issues,
      } satisfies PublicDataFetch;
    },
  };
}
