import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  createDpeProvider,
  createDvfProvider,
  createFixtureProvider,
  DPE_BASE_URL_ENV,
  DVF_BASE_URL_ENV,
  proposeCertificateMatch,
  proposeComparableSetMatch,
  type AdapterDescriptor,
  type PublicDataFetch,
  type PublicDataIssue,
  type PublicDataProvider,
  type PublicDataQuery,
  type PublicDataset,
} from "@/lib/acquisition/realestate";
import {
  derivationOf,
  estimateMarketValue,
  type ComparableSaleFact,
  type MarketEstimate,
} from "@/lib/engine/real-estate-market";
import type {
  ComparableSaleView,
  EnergyCertificateView,
  MatchSummary,
  PropertyPublicDataView,
  PublicDataCommand,
  PublicDataReadResult,
  PublicDataSourceSummary,
  SnapshotSummary,
} from "@/lib/data/public-data-contracts";
import { LEDGER_PAGE_SIZE, readAllPages, pagesFor } from "@/lib/data/pagination";
import { nullableFiniteNumber } from "@/lib/data/row-validation";
import { ownerId, supabaseAdmin } from "@/lib/data/supabase-client";

type Row = Record<string, unknown>;

/**
 * Plafond d'enregistrements par instantané. Il n'est pas décoratif : au-delà, une lecture
 * serait tronquée par la pagination PostgREST, et une médiane calculée sur un échantillon
 * amputé serait fausse sans que rien ne le dise.
 */
const MAX_RECORDS_PER_SNAPSHOT = 1000;
/** Lignes envoyées par appel de RPC. */
const RECORD_CHUNK = 400;

const str = (value: unknown): string => String(value ?? "");
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${context} : réponse vide`);
  return result.data;
}

/**
 * JSON canonique : clés triées récursivement. Deux requêtes équivalentes écrites dans un
 * ordre différent doivent produire la MÊME empreinte, sans quoi l'identité d'une requête
 * dépendrait de l'ordre d'insertion d'un objet.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Row)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
}

function hashPayload(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * URL de base d'un adaptateur, lue côté SERVEUR uniquement.
 *
 * Elle n'est jamais renvoyée au client : un point d'accès configuré n'est pas un secret, mais
 * il n'a aucune raison d'atteindre le navigateur, et une URL exposée finit par recevoir un
 * jeton en paramètre.
 */
function baseUrlFor(dataset: PublicDataset): string {
  const raw = dataset === "DVF" ? process.env[DVF_BASE_URL_ENV] : process.env[DPE_BASE_URL_ENV];
  return (raw ?? "").trim();
}

function providerFor(dataset: PublicDataset, useFixture: boolean): PublicDataProvider {
  if (useFixture) return createFixtureProvider(dataset);
  const baseUrl = baseUrlFor(dataset);
  return dataset === "DVF" ? createDvfProvider({ baseUrl }) : createDpeProvider({ baseUrl });
}

/**
 * Prix au mètre carré d'une mutation, DÉRIVÉ à la lecture, avec son motif d'absence.
 *
 * Il n'est pas persisté, et ce n'est pas une économie de place : un prix unitaire stocké
 * deviendrait faux dès qu'une surface serait corrigée, et deux vérités coexisteraient.
 */
function unitPriceOf(row: Row): { unitPrice: number | null; exclusionReason: string | null } {
  const price = nullableFiniteNumber(row.price, "real_estate_comparable_sales.price");
  const area = nullableFiniteNumber(
    row.built_area_sqm,
    "real_estate_comparable_sales.built_area_sqm",
  );
  const lots = nullableFiniteNumber(row.lot_count, "real_estate_comparable_sales.lot_count");

  if (price === null || price <= 0) {
    return {
      unitPrice: null,
      exclusionReason: "Prix nul ou absent : ce n'est pas une vente comparable",
    };
  }
  if (area === null) {
    return {
      unitPrice: null,
      exclusionReason:
        "Surface bâtie non renseignée : le prix au mètre carré n'existe pas. Une surface absente ne vaut pas zéro",
    };
  }
  if ((lots ?? 1) > 1) {
    return {
      unitPrice: null,
      exclusionReason: `Mutation portant ${lots} lots pour un prix global : elle n'a pas de prix unitaire`,
    };
  }
  return { unitPrice: price / area, exclusionReason: null };
}

function saleView(row: Row): ComparableSaleView {
  const derived = unitPriceOf(row);
  return {
    id: str(row.id),
    rowIndex: Number(row.row_index ?? 0),
    mutationRef: nullableStr(row.mutation_ref),
    mutatedOn: str(row.mutated_on),
    price: nullableFiniteNumber(row.price, "real_estate_comparable_sales.price") ?? 0,
    currency: str(row.currency),
    propertyKind: nullableStr(row.property_kind),
    builtAreaSqm: nullableFiniteNumber(row.built_area_sqm, "sales.built_area_sqm"),
    landAreaSqm: nullableFiniteNumber(row.land_area_sqm, "sales.land_area_sqm"),
    roomCount: nullableFiniteNumber(row.room_count, "sales.room_count"),
    lotCount: nullableFiniteNumber(row.lot_count, "sales.lot_count"),
    communeCode: nullableStr(row.commune_code),
    postalCode: nullableStr(row.postal_code),
    streetLabel: nullableStr(row.street_label),
    unitPrice: derived.unitPrice,
    exclusionReason: derived.exclusionReason,
  };
}

function certificateView(row: Row): EnergyCertificateView {
  return {
    id: str(row.id),
    rowIndex: Number(row.row_index ?? 0),
    certificateRef: nullableStr(row.certificate_ref),
    issuedOn: nullableStr(row.issued_on),
    validUntil: nullableStr(row.valid_until),
    methodVersion: nullableStr(row.method_version),
    energyLabel: nullableStr(row.energy_label),
    energyValue: nullableFiniteNumber(row.energy_value, "certificates.energy_value"),
    energyUnit: nullableStr(row.energy_unit),
    ghgLabel: nullableStr(row.ghg_label),
    ghgValue: nullableFiniteNumber(row.ghg_value, "certificates.ghg_value"),
    ghgUnit: nullableStr(row.ghg_unit),
    livingAreaSqm: nullableFiniteNumber(row.living_area_sqm, "certificates.living_area_sqm"),
    buildingKind: nullableStr(row.building_kind),
    constructionYear: nullableFiniteNumber(row.construction_year, "certificates.construction_year"),
    addressLabel: nullableStr(row.address_label),
    postalCode: nullableStr(row.postal_code),
    communeCode: nullableStr(row.commune_code),
  };
}

function snapshotSummary(row: Row, provider: string): SnapshotSummary {
  const staleAfter = str(row.stale_after);
  return {
    id: str(row.id),
    dataset: str(row.dataset) as PublicDataset,
    datasetVersion: nullableStr(row.dataset_version),
    provider,
    retrievedAt: str(row.retrieved_at),
    staleAfter,
    // DÉRIVÉ à la lecture. Persister « périmé » figerait un état qui dépend de l'heure.
    stale: new Date(staleAfter).getTime() <= Date.now(),
    recordCount: Number(row.record_count ?? 0),
    status: str(row.status) as SnapshotSummary["status"],
    coverageState: str(row.coverage_state) as SnapshotSummary["coverageState"],
    coverageNote: nullableStr(row.coverage_note),
    errorCode: nullableStr(row.error_code),
    errorMessage: nullableStr(row.error_message),
    query: (row.query ?? {}) as Record<string, unknown>,
  };
}

function matchSummary(row: Row): MatchSummary {
  return {
    id: str(row.id),
    propertyId: str(row.property_id),
    target: str(row.target) as MatchSummary["target"],
    snapshotId: str(row.snapshot_id),
    certificateId: nullableStr(row.certificate_id),
    matchScore: nullableFiniteNumber(row.match_score, "matches.match_score"),
    matchConfidence: str(row.match_confidence) as MatchSummary["matchConfidence"],
    state: str(row.state) as MatchSummary["state"],
    decidedAt: nullableStr(row.decided_at),
    decidedReason: nullableStr(row.decided_reason),
    supersededBy: nullableStr(row.superseded_by),
    basis: (row.match_basis ?? {}) as Record<string, unknown>,
    createdAt: str(row.created_at),
  };
}

export interface PublicDataRepository {
  adapter: "supabase";
  listSources(): Promise<PublicDataSourceSummary[]>;
  /**
   * `options.signal` vient de la REQUÊTE HTTP entrante. Quand le navigateur abandonne, la
   * lecture du jeu de données public s'arrête au lieu de consommer un quota pour une
   * réponse que plus personne ne lira. Facultatif : un appelant hors requête HTTP n'a rien
   * à propager, et le transport garde de toute façon son délai interne.
   */
  fetchAndStage(
    command: Extract<PublicDataCommand, { action: "fetch" }>,
    options?: { signal?: AbortSignal },
  ): Promise<PublicDataReadResult>;
  decide(command: Extract<PublicDataCommand, { action: "decide" }>): Promise<MatchSummary[]>;
  promote(
    command: Extract<PublicDataCommand, { action: "promote" }>,
  ): Promise<{ valuationId: string }>;
  getPropertyView(propertyId: string): Promise<PropertyPublicDataView>;
}

function createPublicDataRepository(): PublicDataRepository {
  const db = supabaseAdmin();
  const user = ownerId();

  /** Enregistre l'adaptateur en base et rend son identifiant. Aucun secret n'y entre. */
  async function ensureSource(descriptor: AdapterDescriptor): Promise<string> {
    return unwrap(
      await db.rpc("lfo_upsert_public_data_source", {
        p_user_id: user,
        p_payload: {
          provider: descriptor.provider,
          domain: "REAL_ESTATE_PUBLIC_DATA",
          label: `${descriptor.dataset} — ${descriptor.provider}`,
          source_type: "PUBLIC_DATA",
          adapter_version: descriptor.adapterVersion,
          dataset_version: descriptor.datasetVersion,
          capabilities: descriptor.capabilities,
          declared_coverage: descriptor.declaredCoverage,
          licence: descriptor.licence,
          // L'URL de base est persistée pour la traçabilité de l'adaptateur, jamais rendue
          // au client : `listSources` ne l'expose pas.
          base_url: descriptor.baseUrl,
          snapshot_ttl_minutes: descriptor.snapshotTtlMinutes,
          status: descriptor.baseUrl.length > 0 ? "ACTIVE" : "DISCONNECTED",
        },
      }),
      "enregistrement de l'adaptateur de donnée publique",
    ) as string;
  }

  async function listSources(): Promise<PublicDataSourceSummary[]> {
    const rows = unwrap(
      await db
        .from("external_sources")
        .select(
          "id, provider, domain, name, adapter_version, dataset_version, licence, snapshot_ttl_minutes, declared_coverage, last_success_at, last_error",
        )
        .eq("user_id", user)
        .eq("domain", "REAL_ESTATE_PUBLIC_DATA")
        .order("provider", { ascending: true }),
      "lecture des adaptateurs de donnée publique",
    ) as Row[];

    return rows.map((row) => {
      const provider = str(row.provider);
      const dataset: PublicDataset | null = provider.includes("DVF")
        ? "DVF"
        : provider.includes("DPE")
          ? "DPE"
          : null;
      const coverage = (row.declared_coverage ?? {}) as Row;
      return {
        id: str(row.id),
        provider,
        dataset,
        label: str(row.name),
        adapterVersion: nullableStr(row.adapter_version),
        datasetVersion: nullableStr(row.dataset_version),
        licence: nullableStr(row.licence),
        snapshotTtlMinutes: nullableFiniteNumber(
          row.snapshot_ttl_minutes,
          "external_sources.snapshot_ttl_minutes",
        ),
        coverageNote: nullableStr(coverage.note),
        lastSuccessAt: nullableStr(row.last_success_at),
        lastError: nullableStr(row.last_error),
        // Dérivé de l'environnement SERVEUR. Le client apprend « configuré ou non », pas où.
        configured: dataset === null ? false : baseUrlFor(dataset).length > 0,
      } satisfies PublicDataSourceSummary;
    });
  }

  /** Charge la ligne du bien. Elle porte l'adresse et la surface DÉCLARÉES, ou leur absence. */
  async function loadProperty(propertyId: string): Promise<Row> {
    const rows = unwrap(
      await db
        .from("properties")
        .select("id, name, location, surface_sqm")
        .eq("user_id", user)
        .eq("id", propertyId)
        .limit(1),
      "lecture du bien immobilier",
    ) as Row[];
    if (rows.length === 0) throw new Error("Bien immobilier introuvable");
    return rows[0];
  }

  async function fetchAndStage(
    command: Extract<PublicDataCommand, { action: "fetch" }>,
    options?: { signal?: AbortSignal },
  ): Promise<PublicDataReadResult> {
    const property = await loadProperty(command.propertyId);
    const provider = providerFor(command.dataset, command.useFixture);
    const sourceId = await ensureSource(provider.descriptor);

    const query: PublicDataQuery = {
      dataset: command.dataset,
      communeCode: command.communeCode,
      postalCode: command.postalCode,
      address: command.address,
      mutatedFrom: command.mutatedFrom,
      mutatedTo: command.mutatedTo,
      limit: MAX_RECORDS_PER_SNAPSHOT,
    };

    const fetched: PublicDataFetch = await provider.fetch(query, { signal: options?.signal });

    // Le plafond est appliqué AVANT écriture, et le dire est le point : une lecture
    // silencieusement tronquée produirait une médiane sur un échantillon amputé.
    const issues: PublicDataIssue[] = [...fetched.issues];
    const sales = fetched.sales.slice(0, MAX_RECORDS_PER_SNAPSHOT);
    const certificates = fetched.certificates.slice(0, MAX_RECORDS_PER_SNAPSHOT);
    if (
      fetched.sales.length > MAX_RECORDS_PER_SNAPSHOT ||
      fetched.certificates.length > MAX_RECORDS_PER_SNAPSHOT
    ) {
      issues.push({
        code: "RECORD_SKIPPED",
        severity: "WARNING",
        recordIndex: null,
        field: null,
        message: `La source a rendu plus de ${MAX_RECORDS_PER_SNAPSHOT} enregistrements : l'instantané est borné, et ce plafond est visible. Resserrez la requête plutôt que de conclure sur un échantillon tronqué`,
      });
    }

    const canonicalQuery = canonicalJson(fetched.query);
    const snapshotId = unwrap(
      await db.rpc("lfo_record_real_estate_snapshot", {
        p_user_id: user,
        p_payload: {
          source_id: sourceId,
          dataset: command.dataset,
          dataset_version: provider.descriptor.datasetVersion,
          query: fetched.query,
          query_hash: hashPayload(canonicalQuery),
          // L'empreinte porte sur le corps RÉELLEMENT reçu. Sur un échec, il n'y a pas de
          // corps : l'empreinte du vide est l'empreinte du vide, pas celle d'un résultat.
          payload_hash: hashPayload(fetched.rawText),
          retrieved_at: new Date().toISOString(),
          http_status: fetched.httpStatus,
          coverage_state: fetched.coverageState,
          coverage_note: fetched.coverageNote,
          status: fetched.status,
          error_code: fetched.errorCode,
          error_message: fetched.errorMessage,
          source: provider.descriptor.provider,
          sales: command.dataset === "DVF" ? sales.slice(0, RECORD_CHUNK).map(salePayload) : [],
          certificates:
            command.dataset === "DPE"
              ? certificates.slice(0, RECORD_CHUNK).map(certificatePayload)
              : [],
        },
      }),
      "écriture de l'instantané de donnée publique",
    ) as string;

    // Les lignes au-delà du premier lot sont écrites par appels successifs, dans la même
    // logique que l'append du FEC. Le décompte reste DÉRIVÉ en base à chaque appel.
    for (let offset = RECORD_CHUNK; offset < sales.length; offset += RECORD_CHUNK) {
      await appendRows(snapshotId, sales.slice(offset, offset + RECORD_CHUNK), [], offset);
    }
    for (let offset = RECORD_CHUNK; offset < certificates.length; offset += RECORD_CHUNK) {
      await appendRows(snapshotId, [], certificates.slice(offset, offset + RECORD_CHUNK), offset);
    }

    const stored = await loadSnapshot(snapshotId);
    const storedSales = await loadSales(snapshotId);
    const storedCertificates = await loadCertificates(snapshotId);

    const matches = await proposeMatches({
      property,
      snapshot: stored,
      sales: storedSales,
      certificates: storedCertificates,
      query: fetched.query,
      issues,
    });

    return {
      snapshot: stored,
      sales: storedSales,
      certificates: storedCertificates,
      matches,
      issues,
    };
  }

  /**
   * Écrit un lot supplémentaire de lignes. La RPC d'instantané est réutilisée en mode
   * « append » via son propre chemin : elle recalcule le décompte à chaque appel.
   */
  async function appendRows(
    snapshotId: string,
    sales: PublicDataFetch["sales"],
    certificates: PublicDataFetch["certificates"],
    offset: number,
  ): Promise<void> {
    unwrap(
      await db.rpc("lfo_append_real_estate_snapshot_rows", {
        p_user_id: user,
        p_payload: {
          snapshot_id: snapshotId,
          row_offset: offset,
          sales: sales.map(salePayload),
          certificates: certificates.map(certificatePayload),
        },
      }),
      "écriture des lignes complémentaires de l'instantané",
    );
  }

  function salePayload(sale: PublicDataFetch["sales"][number]): Record<string, unknown> {
    return {
      mutation_ref: sale.mutationRef,
      mutated_on: sale.mutatedOn,
      price: sale.price,
      currency: sale.currency,
      property_kind: sale.propertyKind,
      built_area_sqm: sale.builtAreaSqm,
      land_area_sqm: sale.landAreaSqm,
      room_count: sale.roomCount,
      lot_count: sale.lotCount,
      commune_code: sale.communeCode,
      postal_code: sale.postalCode,
      street_label: sale.streetLabel,
      cadastral_section: sale.cadastralSection,
      raw: sale.raw,
    };
  }

  function certificatePayload(
    certificate: PublicDataFetch["certificates"][number],
  ): Record<string, unknown> {
    return {
      certificate_ref: certificate.certificateRef,
      issued_on: certificate.issuedOn,
      valid_until: certificate.validUntil,
      method_version: certificate.methodVersion,
      energy_label: certificate.energyLabel,
      energy_value: certificate.energyValue,
      energy_unit: certificate.energyUnit,
      ghg_label: certificate.ghgLabel,
      ghg_value: certificate.ghgValue,
      ghg_unit: certificate.ghgUnit,
      living_area_sqm: certificate.livingAreaSqm,
      building_kind: certificate.buildingKind,
      construction_year: certificate.constructionYear,
      address_label: certificate.addressLabel,
      postal_code: certificate.postalCode,
      commune_code: certificate.communeCode,
      raw: certificate.raw,
    };
  }

  async function loadSnapshot(snapshotId: string): Promise<SnapshotSummary> {
    const rows = unwrap(
      await db
        .from("real_estate_data_snapshots")
        .select("*")
        .eq("user_id", user)
        .eq("id", snapshotId)
        .limit(1),
      "lecture de l'instantané",
    ) as Row[];
    if (rows.length === 0) throw new Error("Instantané introuvable");
    return snapshotSummary(rows[0], str(rows[0].source));
  }

  async function loadSales(snapshotId: string): Promise<ComparableSaleView[]> {
    // Lecture INTÉGRALE ou refus : une médiane calculée sur un échantillon tronqué par la
    // pagination serait fausse sans que rien ne le dise. `readAllPages` lève plutôt que de
    // rendre une lecture amputée.
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>(
        "mutations comparables",
        async (from, to) => {
          const result = await db
            .from("real_estate_comparable_sales")
            .select("*")
            .eq("user_id", user)
            .eq("snapshot_id", snapshotId)
            .order("row_index", { ascending: true })
            .range(from, to);
          return { data: result.data as Row[] | null, error: result.error };
        },
        { pageSize: LEDGER_PAGE_SIZE, maxPages: pagesFor(MAX_RECORDS_PER_SNAPSHOT) },
      ),
      "lecture des mutations comparables",
    );
    return rows.map(saleView);
  }

  async function loadCertificates(snapshotId: string): Promise<EnergyCertificateView[]> {
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>(
        "diagnostics de performance énergétique",
        async (from, to) => {
          const result = await db
            .from("real_estate_energy_certificates")
            .select("*")
            .eq("user_id", user)
            .eq("snapshot_id", snapshotId)
            .order("row_index", { ascending: true })
            .range(from, to);
          return { data: result.data as Row[] | null, error: result.error };
        },
        { pageSize: LEDGER_PAGE_SIZE, maxPages: pagesFor(MAX_RECORDS_PER_SNAPSHOT) },
      ),
      "lecture des diagnostics",
    );
    return rows.map(certificateView);
  }

  /**
   * Crée les propositions de rapprochement, toutes à l'état CANDIDAT.
   *
   * Aucune n'est acceptée ici, quel que soit le score : l'acceptation est un acte humain, et
   * l'automatiser rattacherait le DPE du voisin à un bien détenu sans laisser de trace.
   */
  async function proposeMatches(input: {
    property: Row;
    snapshot: SnapshotSummary;
    sales: ComparableSaleView[];
    certificates: EnergyCertificateView[];
    query: Record<string, unknown>;
    issues: PublicDataIssue[];
  }): Promise<MatchSummary[]> {
    // Un instantané vide, en échec ou hors couverture ne se rapproche de rien. La RPC le
    // refuse ; ne pas même le proposer évite un message d'erreur inutile à l'utilisateur.
    if (
      input.snapshot.status !== "RETRIEVED" ||
      input.snapshot.coverageState === "DECLARED_NOT_COVERED"
    ) {
      return [];
    }

    const location = nullableStr(input.property.location);
    const surface = nullableFiniteNumber(input.property.surface_sqm, "properties.surface_sqm");
    const created: string[] = [];

    if (input.snapshot.dataset === "DVF") {
      const usable = input.sales.filter((sale) => sale.unitPrice !== null).length;
      const proposal = proposeComparableSetMatch({
        propertyLocation: location,
        propertySurfaceSqm: surface,
        queriedCommuneCode: nullableStr(input.query.code_commune),
        queriedPostalCode: nullableStr(input.query.code_postal),
        saleCount: input.sales.length,
        usableSaleCount: usable,
      });
      input.issues.push(...proposal.issues);
      // Une zone franchement hors du bien n'est pas proposée : proposer un rapprochement
      // qu'on sait faux ferait porter à l'utilisateur un arbitrage qui n'existe pas.
      if (proposal.score !== 0) {
        created.push(
          unwrap(
            await db.rpc("lfo_propose_property_public_data_match", {
              p_user_id: user,
              p_payload: {
                property_id: str(input.property.id),
                target: "COMPARABLE_SET",
                snapshot_id: input.snapshot.id,
                match_basis: proposal.basis,
                match_score: proposal.score,
                match_confidence: proposal.confidence,
              },
            }),
            "proposition de rapprochement du jeu de comparables",
          ) as string,
        );
      }
    } else {
      for (const certificate of input.certificates) {
        const proposal = proposeCertificateMatch({
          propertyLocation: location,
          propertySurfaceSqm: surface,
          certificate: {
            rowIndex: certificate.rowIndex,
            certificateRef: certificate.certificateRef,
            issuedOn: certificate.issuedOn,
            validUntil: certificate.validUntil,
            methodVersion: certificate.methodVersion,
            energyLabel: certificate.energyLabel,
            energyValue: certificate.energyValue,
            energyUnit: certificate.energyUnit,
            ghgLabel: certificate.ghgLabel,
            ghgValue: certificate.ghgValue,
            ghgUnit: certificate.ghgUnit,
            livingAreaSqm: certificate.livingAreaSqm,
            buildingKind: certificate.buildingKind,
            constructionYear: certificate.constructionYear,
            addressLabel: certificate.addressLabel,
            postalCode: certificate.postalCode,
            communeCode: certificate.communeCode,
            raw: {},
            issues: [],
          },
        });
        input.issues.push(...proposal.issues);
        // Un score nul ou inconnu n'est pas proposé : il n'y a rien à trancher.
        if (proposal.score === null || proposal.score === 0) continue;
        created.push(
          unwrap(
            await db.rpc("lfo_propose_property_public_data_match", {
              p_user_id: user,
              p_payload: {
                property_id: str(input.property.id),
                target: "ENERGY_CERTIFICATE",
                snapshot_id: input.snapshot.id,
                certificate_id: certificate.id,
                match_basis: proposal.basis,
                match_score: proposal.score,
                match_confidence: proposal.confidence,
              },
            }),
            "proposition de rapprochement du diagnostic",
          ) as string,
        );
      }
    }

    if (created.length === 0) return [];
    const rows = unwrap(
      await db
        .from("property_public_data_matches")
        .select("*")
        .eq("user_id", user)
        .in("id", created),
      "relecture des rapprochements proposés",
    ) as Row[];
    return rows.map(matchSummary);
  }

  async function decide(
    command: Extract<PublicDataCommand, { action: "decide" }>,
  ): Promise<MatchSummary[]> {
    unwrap(
      await db.rpc("lfo_decide_property_public_data_match", {
        p_user_id: user,
        p_payload: {
          match_id: command.matchId,
          decision: command.decision,
          reason: command.reason,
        },
      }),
      "décision de rapprochement",
    );

    const rows = unwrap(
      await db
        .from("property_public_data_matches")
        .select("*")
        .eq("user_id", user)
        .eq("id", command.matchId)
        .limit(1),
      "relecture du rapprochement",
    ) as Row[];
    return rows.map(matchSummary);
  }

  /**
   * Promeut l'estimation en valorisation canonique.
   *
   * La valeur est recalculée ICI, depuis les comparables PERSISTÉS : le chiffre affiché au
   * client n'entre pas dans la décision, exactement comme le fait canonique d'une liasse est
   * reconstruit depuis les cases persistées. Le nombre transmis à la RPC est ensuite encadré
   * en base par l'intervalle des prix unitaires réels.
   */
  async function promote(
    command: Extract<PublicDataCommand, { action: "promote" }>,
  ): Promise<{ valuationId: string }> {
    const matchRows = unwrap(
      await db
        .from("property_public_data_matches")
        .select("*")
        .eq("user_id", user)
        .eq("id", command.matchId)
        .limit(1),
      "lecture du rapprochement à promouvoir",
    ) as Row[];
    if (matchRows.length === 0) throw new Error("Rapprochement introuvable");
    const match = matchSummary(matchRows[0]);

    const property = await loadProperty(match.propertyId);
    const snapshot = await loadSnapshot(match.snapshotId);
    const sales = await loadSales(match.snapshotId);

    const estimate = computeEstimate({ property, snapshot, sales });
    if (estimate.status !== "COMPUTED" || estimate.value === null || estimate.currency === null) {
      throw new Error(
        `Estimation non calculable : ${estimate.flags
          .filter((flag) => flag.severity === "ERROR")
          .map((flag) => flag.message)
          .join(" ; ")}`,
      );
    }

    const valuationId = unwrap(
      await db.rpc("lfo_promote_real_estate_market_estimate", {
        p_user_id: user,
        p_payload: {
          match_id: command.matchId,
          value: estimate.value,
          currency: estimate.currency,
          valued_at: command.valuedAt,
          confidence: estimate.confidence,
          source: snapshot.provider,
          notes: command.notes,
          derivation: derivationOf(estimate),
        },
      }),
      "promotion de l'estimation de marché",
    ) as string;

    return { valuationId };
  }

  function computeEstimate(input: {
    property: Row;
    snapshot: SnapshotSummary;
    sales: ComparableSaleView[];
  }): MarketEstimate {
    const facts: ComparableSaleFact[] = input.sales.map((sale) => ({
      price: sale.price,
      currency: sale.currency,
      builtAreaSqm: sale.builtAreaSqm,
      lotCount: sale.lotCount,
      mutatedOn: sale.mutatedOn,
      propertyKind: sale.propertyKind,
    }));
    return estimateMarketValue({
      sales: facts,
      surfaceSqm: nullableFiniteNumber(input.property.surface_sqm, "properties.surface_sqm"),
      coverageState: input.snapshot.coverageState,
      stale: input.snapshot.stale,
    });
  }

  async function getPropertyView(propertyId: string): Promise<PropertyPublicDataView> {
    const property = await loadProperty(propertyId);

    const matchRows = unwrap(
      await db
        .from("property_public_data_matches")
        .select("*")
        .eq("user_id", user)
        .eq("property_id", propertyId)
        .order("created_at", { ascending: false })
        .limit(200),
      "lecture des rapprochements du bien",
    ) as Row[];
    const matches = matchRows.map(matchSummary);

    const snapshotIds = [...new Set(matches.map((match) => match.snapshotId))];
    const snapshotRows =
      snapshotIds.length === 0
        ? []
        : (unwrap(
            await db
              .from("real_estate_data_snapshots")
              .select("*")
              .eq("user_id", user)
              .in("id", snapshotIds)
              .order("retrieved_at", { ascending: false }),
            "lecture des instantanés du bien",
          ) as Row[]);
    const snapshots = snapshotRows.map((row) => snapshotSummary(row, str(row.source)));

    const currentCertificateMatch = matches.find(
      (match) =>
        match.target === "ENERGY_CERTIFICATE" &&
        match.state === "ACCEPTED" &&
        match.supersededBy === null,
    );
    let currentCertificate: EnergyCertificateView | null = null;
    if (currentCertificateMatch?.certificateId) {
      const rows = unwrap(
        await db
          .from("real_estate_energy_certificates")
          .select("*")
          .eq("user_id", user)
          .eq("id", currentCertificateMatch.certificateId)
          .limit(1),
        "lecture du diagnostic accepté",
      ) as Row[];
      currentCertificate = rows.length > 0 ? certificateView(rows[0]) : null;
    }

    const currentComparableMatch = matches.find(
      (match) =>
        match.target === "COMPARABLE_SET" &&
        match.state === "ACCEPTED" &&
        match.supersededBy === null,
    );
    let estimate: MarketEstimate | null = null;
    let comparables: ComparableSaleView[] = [];
    if (currentComparableMatch) {
      const snapshot = snapshots.find((entry) => entry.id === currentComparableMatch.snapshotId);
      if (snapshot) {
        comparables = await loadSales(snapshot.id);
        estimate = computeEstimate({ property, snapshot, sales: comparables });
      }
    }

    return {
      propertyId,
      propertyName: str(property.name),
      location: nullableStr(property.location),
      surfaceSqm: nullableFiniteNumber(property.surface_sqm, "properties.surface_sqm"),
      matches,
      snapshots,
      currentCertificate,
      estimate,
      comparables,
    };
  }

  return { adapter: "supabase", listSources, fetchAndStage, decide, promote, getPropertyView };
}

let cached: PublicDataRepository | undefined;

export function getPublicDataRepository(): PublicDataRepository {
  if (!cached) cached = createPublicDataRepository();
  return cached;
}
