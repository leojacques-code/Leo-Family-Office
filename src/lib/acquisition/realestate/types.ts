/**
 * CONTRAT D'ADAPTATEUR DE DONNÉE PUBLIQUE IMMOBILIÈRE
 *
 * Un adaptateur DÉCLARE ce qu'il sait rendre, et ce qu'il ne rend pas reste nommé. Trois
 * états qu'on ne confond jamais :
 *
 *   CAPACITÉ NON SERVIE : l'adaptateur ne sait pas lire ce terme. Rien n'est su du fond.
 *   DONNÉE ABSENTE      : la source a répondu, et le terme n'y est pas.
 *   ZÉRO                : la source a répondu, et le terme vaut zéro.
 *
 * Le contrat est provider-neutre : DVF et DPE le remplissent, un fournisseur commercial le
 * remplirait aussi, et aucun code aval ne connaît le nom d'un fournisseur.
 */

/** Anomalie de lecture. Elle est toujours NOMMÉE, jamais réduite à un `null` muet. */
export interface PublicDataIssue {
  code:
    | "TRANSPORT_FAILURE"
    | "CAPABILITY_NOT_SERVED"
    | "FIELD_UNREADABLE"
    | "FIELD_MISSING"
    | "SHAPE_UNEXPECTED"
    | "COVERAGE_NOT_DECLARED"
    | "COVERAGE_EXCLUDED"
    | "RECORD_SKIPPED"
    | "AMOUNT_NOT_COMPARABLE";
  severity: "INFO" | "WARNING" | "ERROR";
  /** Index de l'enregistrement concerné, quand l'anomalie est locale. */
  recordIndex: number | null;
  /** Champ concerné, tel que la source le nomme. */
  field: string | null;
  message: string;
}

export function publicDataIssue(
  code: PublicDataIssue["code"],
  severity: PublicDataIssue["severity"],
  recordIndex: number | null,
  field: string | null,
  message: string,
): PublicDataIssue {
  return { code, severity, recordIndex, field, message };
}

/** Jeux pris en charge. Un jeu inconnu est refusé, jamais lu « au mieux ». */
export type PublicDataset = "DVF" | "DPE";

/**
 * Couverture d'une zone par le jeu de données.
 *
 * `COVERAGE_UNKNOWN` est le défaut, et c'est volontaire : présumer la couverture ferait
 * lire un résultat vide comme « aucune vente », alors qu'il peut signifier « zone non
 * publiée ». Un vide n'est interprétable qu'avec une couverture déclarée.
 */
export type CoverageState = "DECLARED_COVERED" | "DECLARED_NOT_COVERED" | "COVERAGE_UNKNOWN";

/** Ce qu'un adaptateur déclare savoir rendre. Absent d'ici = non servi. */
export interface AdapterCapabilities {
  /** Termes que l'adaptateur sait lire pour ce jeu. */
  fields: readonly string[];
  /** Vrai si l'adaptateur sait déclarer la couverture géographique d'une requête. */
  declaresCoverage: boolean;
  /** Vrai si la source expose un identifiant d'enregistrement dont la stabilité est déclarée. */
  stableRecordId: boolean;
}

export interface AdapterDescriptor {
  provider: string;
  dataset: PublicDataset;
  adapterVersion: string;
  /** Millésime, quand la source en publie un. `null` = inconnu, jamais « le dernier ». */
  datasetVersion: string | null;
  baseUrl: string;
  licence: string | null;
  capabilities: AdapterCapabilities;
  /** Couverture DÉCLARÉE du jeu, telle que le publieur la documente. */
  declaredCoverage: {
    /** Description en clair, destinée à l'utilisateur. */
    note: string;
    /** Codes de département explicitement NON couverts, quand le publieur les nomme. */
    excludedDepartments: readonly string[];
  };
  /** Fraîcheur au-delà de laquelle un instantané est signalé périmé. */
  snapshotTtlMinutes: number;
  /** Limite de débit à respecter. */
  rateLimitPerMinute: number;
  /**
   * Variable d'environnement portant le jeton, quand la source en exige un. Le NOM seul est
   * transporté : la valeur ne quitte jamais le serveur, et rien de tout cela n'atteint le
   * navigateur.
   */
  credentialEnvVar: string | null;
}

/** Une mutation lue. Tous les termes optionnels restent `null` s'ils sont absents. */
export interface ComparableSaleCandidate {
  rowIndex: number;
  mutationRef: string | null;
  mutatedOn: string;
  price: number;
  currency: string;
  propertyKind: string | null;
  builtAreaSqm: number | null;
  landAreaSqm: number | null;
  roomCount: number | null;
  lotCount: number | null;
  communeCode: string | null;
  postalCode: string | null;
  streetLabel: string | null;
  cadastralSection: string | null;
  raw: Record<string, unknown>;
  issues: PublicDataIssue[];
}

/** Un DPE lu. La validité est LUE ; elle n'est jamais déduite d'une règle. */
export interface EnergyCertificateCandidate {
  rowIndex: number;
  certificateRef: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  methodVersion: string | null;
  energyLabel: string | null;
  energyValue: number | null;
  energyUnit: string | null;
  ghgLabel: string | null;
  ghgValue: number | null;
  ghgUnit: string | null;
  livingAreaSqm: number | null;
  buildingKind: string | null;
  constructionYear: number | null;
  addressLabel: string | null;
  postalCode: string | null;
  communeCode: string | null;
  raw: Record<string, unknown>;
  issues: PublicDataIssue[];
}

/** Statut d'une lecture. Chacun est un fait distinct, et aucun n'en implique un autre. */
export type FetchStatus = "RETRIEVED" | "EMPTY" | "FAILED" | "NOT_SERVED";

export interface PublicDataFetch {
  descriptor: AdapterDescriptor;
  /** Paramètres RÉELLEMENT envoyés. */
  query: Record<string, unknown>;
  status: FetchStatus;
  httpStatus: number | null;
  coverageState: CoverageState;
  coverageNote: string | null;
  /** Corps brut, pour l'empreinte de contenu. Chaîne vide si rien n'a été reçu. */
  rawText: string;
  sales: ComparableSaleCandidate[];
  certificates: EnergyCertificateCandidate[];
  errorCode: string | null;
  errorMessage: string | null;
  issues: PublicDataIssue[];
}

export interface PublicDataQuery {
  dataset: PublicDataset;
  /** Code commune INSEE, quand il est connu. */
  communeCode?: string | null;
  postalCode?: string | null;
  /** Adresse libre, pour un DPE. */
  address?: string | null;
  /** Bornes de date de mutation, pour DVF. */
  mutatedFrom?: string | null;
  mutatedTo?: string | null;
  /** Plafond d'enregistrements demandés. */
  limit?: number;
}

/** Un adaptateur. Il ne lève jamais : un échec est un `PublicDataFetch` en échec. */
export interface PublicDataProvider {
  descriptor: AdapterDescriptor;
  fetch(query: PublicDataQuery, options?: { token?: string | null }): Promise<PublicDataFetch>;
}
