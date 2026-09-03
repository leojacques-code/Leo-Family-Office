/**
 * FOURNISSEUR DE FIXTURES
 *
 * Il rend un `PublicDataFetch` sans réseau, avec la MÊME forme qu'un adaptateur réel. Deux
 * usages, et un seul est légitime en production :
 *
 *   * les tests, qui doivent pouvoir décrire une panne, un vide, une forme inattendue ;
 *   * la démonstration d'un parcours, quand la sortie réseau est refusée par
 *     l'environnement — comme c'est le cas ici.
 *
 * Il porte son propre nom de provider, `FIXTURE`, et ce n'est pas cosmétique : la provenance
 * est persistée avec chaque instantané. Une donnée de fixture rattachée à un bien restera
 * pour toujours identifiable comme telle, et ne pourra jamais passer pour une lecture de
 * source publique.
 */

import type {
  AdapterDescriptor,
  ComparableSaleCandidate,
  CoverageState,
  EnergyCertificateCandidate,
  FetchStatus,
  PublicDataFetch,
  PublicDataIssue,
  PublicDataProvider,
  PublicDataQuery,
  PublicDataset,
} from "./types";
import { publicDataIssue } from "./types";

export interface FixtureScript {
  status?: FetchStatus;
  coverageState?: CoverageState;
  coverageNote?: string | null;
  sales?: ComparableSaleCandidate[];
  certificates?: EnergyCertificateCandidate[];
  errorCode?: string | null;
  errorMessage?: string | null;
  issues?: PublicDataIssue[];
  rawText?: string;
}

export function fixtureDescriptor(dataset: PublicDataset): AdapterDescriptor {
  return {
    provider: `FIXTURE_${dataset}`,
    dataset,
    adapterVersion: "fixture/1",
    datasetVersion: null,
    baseUrl: "fixture://local",
    licence: null,
    capabilities: {
      fields: [],
      declaresCoverage: false,
      stableRecordId: false,
    },
    declaredCoverage: {
      note: "Fixture locale : aucune couverture réelle n'est déclarée, et aucune conclusion de marché ne peut en être tirée.",
      excludedDepartments: [],
    },
    snapshotTtlMinutes: 60,
    rateLimitPerMinute: 1000,
    credentialEnvVar: null,
  };
}

export function createFixtureProvider(
  dataset: PublicDataset,
  script: FixtureScript = {},
): PublicDataProvider {
  const descriptor = fixtureDescriptor(dataset);
  return {
    descriptor,
    fetch(query: PublicDataQuery) {
      const sales = script.sales ?? [];
      const certificates = script.certificates ?? [];
      const populated = dataset === "DVF" ? sales.length > 0 : certificates.length > 0;
      const status: FetchStatus = script.status ?? (populated ? "RETRIEVED" : "EMPTY");

      return Promise.resolve({
        descriptor,
        query: { ...query } as Record<string, unknown>,
        status,
        httpStatus: status === "FAILED" || status === "NOT_SERVED" ? null : 200,
        coverageState: script.coverageState ?? "COVERAGE_UNKNOWN",
        coverageNote: script.coverageNote ?? descriptor.declaredCoverage.note,
        rawText:
          script.rawText ?? JSON.stringify({ results: dataset === "DVF" ? sales : certificates }),
        sales: dataset === "DVF" ? sales : [],
        certificates: dataset === "DPE" ? certificates : [],
        errorCode: script.errorCode ?? (status === "FAILED" ? "FIXTURE_FAILURE" : null),
        errorMessage: script.errorMessage ?? (status === "FAILED" ? "Échec scripté" : null),
        issues: [
          publicDataIssue(
            "COVERAGE_NOT_DECLARED",
            "WARNING",
            null,
            null,
            "Lecture issue d'une FIXTURE locale : la provenance est persistée, et aucune conclusion de marché réel ne doit en être tirée",
          ),
          ...(script.issues ?? []),
        ],
      } satisfies PublicDataFetch);
    },
  };
}
