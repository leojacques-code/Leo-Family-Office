/**
 * ADAPTATEUR DVF — DEMANDES DE VALEURS FONCIÈRES
 *
 * DVF publie des MUTATIONS RÉELLES enregistrées par l'administration fiscale. Ce sont les
 * ventes d'AUTRUI : aucune ligne lue ici ne valorise un bien détenu, et l'adaptateur ne
 * produit donc aucune valeur, seulement des faits.
 *
 * Trois honnêtetés portées par ce fichier :
 *
 *   1. LA COUVERTURE EST DÉCLARÉE, PAS DEVINÉE. Le jeu ne couvre pas l'intégralité du
 *      territoire : les départements que le publieur exclut sont nommés dans le descripteur,
 *      et une requête qui les vise rend `DECLARED_NOT_COVERED` — un vide y est muet, pas
 *      négatif. Hors de ces cas, la couverture reste `COVERAGE_UNKNOWN` : l'adaptateur ne
 *      certifie pas ce que le publieur ne certifie pas.
 *
 *   2. UNE MUTATION MULTI-LOTS N'A PAS DE PRIX AU MÈTRE CARRÉ. Un prix global pour trois
 *      lots divisé par la surface de l'un d'eux ne veut rien dire. Le nombre de lots est LU
 *      et transporté ; c'est le moteur qui exclut ces mutations en le disant.
 *
 *   3. AUCUN PRIX UNITAIRE N'EST CALCULÉ ICI. L'acquisition ne calcule pas de finance.
 *
 * L'URL et la forme des paramètres sont configurables par descripteur : la validation en
 * vraie vie est BLOQUÉE dans cet environnement (sortie réseau refusée), et coder en dur la
 * forme d'une API qu'on n'a pas pu appeler produirait une certitude sans preuve.
 */

// Transport UNIQUE de la couche d'acquisition. Cette verticale avait sa propre
// implémentation ; elles sont fusionnées, et celle-ci gagne au passage la lecture de
// corps protégée et le quota par connexion avec plafond d'attente.
import {
  callJson,
  DEFAULT_TRANSPORT,
  RateLimiter,
  type TransportConfig,
} from "@/lib/acquisition/transport";

import {
  readArea,
  readCode,
  readInteger,
  readIsoDate,
  readNumber,
  readText,
  readRecordArray,
  type Row,
} from "./read";
import {
  publicDataIssue,
  type AdapterDescriptor,
  type ComparableSaleCandidate,
  type CoverageState,
  type PublicDataFetch,
  type PublicDataIssue,
  type PublicDataProvider,
  type PublicDataQuery,
} from "./types";

/**
 * Départements que le publieur DVF documente comme NON couverts, faute de publication des
 * mutations par ce canal. Ils sont ici pour une seule raison : sans eux, un résultat vide
 * sur ces territoires serait lu comme « aucune vente », ce qui est faux.
 *
 * Cette liste est une DÉCLARATION DE COUVERTURE, pas une règle métier. Elle ne modifie aucun
 * calcul : elle change le statut de couverture d'un instantané, donc l'interprétation d'un
 * vide.
 */
export const DVF_EXCLUDED_DEPARTMENTS: readonly string[] = ["57", "67", "68", "976"];

/**
 * Cette liste est une DÉCLARATION, à confronter à la documentation du publieur avant mise en
 * production : elle n'a pas pu être vérifiée à la source depuis cet environnement, dont la
 * sortie réseau vers les hôtes de données publiques est refusée. Elle est donc surchargeable
 * par descripteur, et son SEUL effet est le statut de couverture d'un instantané, donc
 * l'interprétation d'un vide. Elle n'entre dans aucun calcul, et une liste erronée ne peut
 * pas produire un chiffre faux : au pire elle rend un vide plus prudent qu'il n'aurait dû.
 */

export const DVF_BASE_URL_ENV = "DVF_API_BASE_URL";

/** Clés sous lesquelles la réponse peut porter le tableau d'enregistrements. */
const RECORD_KEYS = ["results", "records", "data", "features"] as const;

/**
 * Noms de champ tentés, dans l'ordre. Plusieurs graphies circulent selon le point d'accès :
 * les essayer tour à tour ne devine rien, puisque chaque tentative reste une lecture exacte
 * d'un champ nommé, et qu'un échec de tous les noms produit `null` et une anomalie.
 */
const FIELDS = {
  mutationRef: ["id_mutation", "idmutation", "mutation_id"],
  mutatedOn: ["date_mutation", "datemut", "date"],
  price: ["valeur_fonciere", "valeurfonc", "prix"],
  propertyKind: ["type_local", "typelocal", "libtyploc"],
  builtArea: ["surface_reelle_bati", "surface_bati", "sbati"],
  landArea: ["surface_terrain", "sterr"],
  roomCount: ["nombre_pieces_principales", "nbpprinc"],
  lotCount: ["nombre_lots", "nblot"],
  communeCode: ["code_commune", "coddep_comm", "insee_com"],
  postalCode: ["code_postal", "codepostal"],
  streetLabel: ["adresse_nom_voie", "voie", "libvoie"],
  streetNumber: ["adresse_numero", "novoie"],
  cadastralSection: ["section_prefixe", "section", "id_parcelle"],
} as const;

function firstReadable<T>(
  row: Row,
  names: readonly string[],
  index: number,
  issues: PublicDataIssue[],
  reader: (row: Row, field: string, index: number, issues: PublicDataIssue[]) => T | null,
): T | null {
  // Toutes les graphies présentes sont tentées : un champ présent mais illisible ne doit pas
  // masquer un synonyme lisible. Les anomalies ne sont remontées QUE si aucune graphie n'a
  // abouti — signaler « `datemut` est illisible » alors que `date_mutation` a été lu
  // correctement serait du bruit, et le bruit finit par cacher les vraies anomalies.
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

export function dvfDescriptor(options?: {
  baseUrl?: string;
  datasetVersion?: string | null;
}): AdapterDescriptor {
  return {
    provider: "DVF_OPEN_DATA",
    dataset: "DVF",
    adapterVersion: "1",
    // Le millésime n'est jamais présumé : il est déclaré par l'appelant ou reste inconnu.
    datasetVersion: options?.datasetVersion ?? null,
    baseUrl: options?.baseUrl ?? "",
    licence: "Licence ouverte / Open Licence",
    capabilities: {
      fields: [
        "mutationRef",
        "mutatedOn",
        "price",
        "propertyKind",
        "builtAreaSqm",
        "landAreaSqm",
        "roomCount",
        "lotCount",
        "communeCode",
        "postalCode",
        "streetLabel",
        "cadastralSection",
      ],
      declaresCoverage: true,
      // L'identifiant de mutation existe, mais sa STABILITÉ inter-millésimes n'est pas
      // déclarée par le publieur. Le déclarer stable autoriserait un rejet automatique de
      // doublon, et une mutation réelle disparaîtrait sans laisser de trace.
      stableRecordId: false,
    },
    declaredCoverage: {
      note: "DVF publie les mutations enregistrées par l'administration fiscale. Certains départements ne sont pas publiés par ce canal ; un résultat vide y est muet, pas négatif.",
      excludedDepartments: DVF_EXCLUDED_DEPARTMENTS,
    },
    snapshotTtlMinutes: 60 * 24 * 7,
    rateLimitPerMinute: 30,
    credentialEnvVar: null,
  };
}

/**
 * Statut de couverture d'une requête. Trois cas seulement, et le troisième est le défaut :
 * ne pas savoir est un état légitime, et le plus fréquent.
 */
export function dvfCoverage(
  query: PublicDataQuery,
  descriptor: AdapterDescriptor,
): { state: CoverageState; note: string | null } {
  const geo = query.communeCode ?? query.postalCode ?? null;
  if (geo === null) {
    return {
      state: "COVERAGE_UNKNOWN",
      note: "Aucun repère géographique dans la requête : la couverture ne peut pas être déclarée",
    };
  }
  // Les codes d'outre-mer tiennent sur trois caractères, la métropole sur deux.
  const department =
    geo.startsWith("97") || geo.startsWith("98") ? geo.slice(0, 3) : geo.slice(0, 2);
  if (descriptor.declaredCoverage.excludedDepartments.includes(department)) {
    return {
      state: "DECLARED_NOT_COVERED",
      note: `Département ${department} déclaré non couvert par ce jeu : un résultat vide n'y signifie pas « aucune vente »`,
    };
  }
  return {
    state: "DECLARED_COVERED",
    note: `Département ${department} dans le périmètre déclaré du jeu`,
  };
}

/** Lit une ligne DVF. Ne lève jamais : une ligne incomplète est rendue ou écartée, nommément. */
export function readDvfRow(row: Row, index: number): ComparableSaleCandidate | null {
  const issues: PublicDataIssue[] = [];

  const mutatedOn = firstReadable(row, FIELDS.mutatedOn, index, issues, readIsoDate);
  const price = firstReadable(row, FIELDS.price, index, issues, readNumber);

  // Sans date ni prix, il n'y a pas de mutation : l'écarter est la seule lecture honnête, et
  // c'est dit plutôt que fait en silence.
  if (mutatedOn === null || price === null) {
    return null;
  }
  if (price <= 0) {
    // Une mutation à zéro existe dans le jeu (donation, échange) : ce n'est pas une vente
    // comparable, et la garder tirerait toute médiane vers le bas.
    return null;
  }

  const streetNumber = firstReadable(row, FIELDS.streetNumber, index, issues, readText);
  const streetName = firstReadable(row, FIELDS.streetLabel, index, issues, readText);
  const streetLabel =
    streetNumber !== null && streetName !== null
      ? `${streetNumber} ${streetName}`
      : (streetName ?? null);

  const lotCount = firstReadable(row, FIELDS.lotCount, index, issues, readInteger);
  if (lotCount !== null && lotCount > 1) {
    issues.push(
      publicDataIssue(
        "AMOUNT_NOT_COMPARABLE",
        "INFO",
        index,
        "nombre_lots",
        `Mutation portant ${lotCount} lots pour un prix global : elle n'a pas de prix au mètre carré, et sera exclue du calcul unitaire`,
      ),
    );
  }

  return {
    rowIndex: index,
    mutationRef: firstReadable(row, FIELDS.mutationRef, index, issues, readText),
    mutatedOn,
    price,
    // DVF publie des montants en euros. La devise est DÉCLARÉE par l'adaptateur, jamais
    // devinée d'un symbole, et elle voyage avec le montant.
    currency: "EUR",
    propertyKind: firstReadable(row, FIELDS.propertyKind, index, issues, readText),
    builtAreaSqm: firstReadable(row, FIELDS.builtArea, index, issues, readArea),
    landAreaSqm: firstReadable(row, FIELDS.landArea, index, issues, readArea),
    roomCount: firstReadable(row, FIELDS.roomCount, index, issues, readInteger),
    lotCount,
    communeCode: firstReadable(row, FIELDS.communeCode, index, issues, (r, f, i, is) =>
      readCode(r, f, 5, i, is),
    ),
    postalCode: firstReadable(row, FIELDS.postalCode, index, issues, (r, f, i, is) =>
      readCode(r, f, 5, i, is),
    ),
    streetLabel,
    cadastralSection: firstReadable(row, FIELDS.cadastralSection, index, issues, readText),
    raw: row,
    issues,
  };
}

function queryString(query: PublicDataQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.communeCode) params.code_commune = query.communeCode;
  if (query.postalCode) params.code_postal = query.postalCode;
  if (query.mutatedFrom) params.date_min = query.mutatedFrom;
  if (query.mutatedTo) params.date_max = query.mutatedTo;
  params.limit = String(Math.min(Math.max(query.limit ?? 200, 1), 1000));
  return params;
}

export function createDvfProvider(options: {
  baseUrl: string;
  datasetVersion?: string | null;
  transport?: Partial<TransportConfig>;
}): PublicDataProvider {
  const descriptor = dvfDescriptor({
    baseUrl: options.baseUrl,
    datasetVersion: options.datasetVersion ?? null,
  });
  const transport: TransportConfig = {
    ...DEFAULT_TRANSPORT,
    fetchImpl: fetch,
    rateLimitPerMinute: descriptor.rateLimitPerMinute,
    ...(options.transport ?? {}),
  };
  const limiter = new RateLimiter(transport.rateLimitPerMinute, transport.clock);

  return {
    descriptor,
    async fetch(query) {
      const issues: PublicDataIssue[] = [];
      const params = queryString(query);
      const coverage = dvfCoverage(query, descriptor);

      if (descriptor.baseUrl.length === 0) {
        // CAPACITÉ NON SERVIE : l'adaptateur n'est pas configuré. Ce n'est ni un échec de la
        // source, ni une absence de mutations.
        return {
          descriptor,
          query: params,
          status: "NOT_SERVED",
          httpStatus: null,
          coverageState: coverage.state,
          coverageNote: coverage.note,
          rawText: "",
          sales: [],
          certificates: [],
          errorCode: "ADAPTER_NOT_CONFIGURED",
          errorMessage: `Aucune URL de base configurée (${DVF_BASE_URL_ENV}) : aucune lecture n'a été tentée, et rien n'en est déduit`,
          issues: [
            publicDataIssue(
              "CAPABILITY_NOT_SERVED",
              "ERROR",
              null,
              null,
              `Adaptateur DVF non configuré : renseignez ${DVF_BASE_URL_ENV}. Une capacité non servie n'est pas une donnée absente`,
            ),
          ],
        } satisfies PublicDataFetch;
      }

      const url = `${descriptor.baseUrl}?${new URLSearchParams(params).toString()}`;
      const result = await callJson({ url }, transport, limiter);

      if (result.errorCode !== null) {
        return {
          descriptor,
          query: params,
          status: "FAILED",
          httpStatus: result.httpStatus,
          coverageState: coverage.state,
          coverageNote: coverage.note,
          rawText: "",
          sales: [],
          certificates: [],
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          issues: [
            publicDataIssue(
              "TRANSPORT_FAILURE",
              "ERROR",
              null,
              null,
              `Lecture DVF impossible (${result.errorCode}) : ${result.errorMessage}. Ce n'est pas une absence de mutations`,
            ),
          ],
        } satisfies PublicDataFetch;
      }

      const rows = readRecordArray(result.payload, RECORD_KEYS, issues);
      if (rows === null) {
        return {
          descriptor,
          query: params,
          status: "FAILED",
          httpStatus: result.httpStatus,
          coverageState: coverage.state,
          coverageNote: coverage.note,
          rawText: result.rawText,
          sales: [],
          certificates: [],
          errorCode: "MALFORMED_RESPONSE",
          errorMessage: "La réponse ne porte aucun tableau d'enregistrements reconnaissable",
          issues,
        } satisfies PublicDataFetch;
      }

      const sales: ComparableSaleCandidate[] = [];
      let skipped = 0;
      rows.forEach((row, index) => {
        const candidate = readDvfRow(row, sales.length);
        if (candidate === null) {
          skipped += 1;
          issues.push(
            publicDataIssue(
              "RECORD_SKIPPED",
              "INFO",
              index,
              null,
              "Enregistrement écarté : sans date ni prix strictement positif, ce n'est pas une vente comparable",
            ),
          );
          return;
        }
        sales.push(candidate);
        issues.push(...candidate.issues);
      });

      if (skipped > 0) {
        issues.push(
          publicDataIssue(
            "RECORD_SKIPPED",
            "WARNING",
            null,
            null,
            `${skipped} enregistrement(s) sur ${rows.length} écartés : le décompte est visible, il n'est pas absorbé`,
          ),
        );
      }

      return {
        descriptor,
        query: params,
        // RÉSULTAT VIDE ≠ ÉCHEC ≠ ABSENCE DE MARCHÉ. Trois statuts, trois faits.
        status: sales.length > 0 ? "RETRIEVED" : "EMPTY",
        httpStatus: result.httpStatus,
        coverageState: coverage.state,
        coverageNote: coverage.note,
        rawText: result.rawText,
        sales,
        certificates: [],
        errorCode: null,
        errorMessage: null,
        issues,
      } satisfies PublicDataFetch;
    },
  };
}
