import "server-only";

import { createHash } from "node:crypto";

import type { PostgrestError } from "@supabase/supabase-js";

import { buildEnrichmentDiff, enrichableFieldCatalog } from "@/lib/acquisition/registry/diff";
import { createRegistryAdapter } from "@/lib/acquisition/registry";
import type {
  BusinessCanonicalIdentity,
  CompanyRegistryProfileCandidate,
  EnrichableField,
  RegistryCallOptions,
  RegistryCapability,
  RegistryDocumentCandidate,
  RegistryEntityReading,
  RegistryErrorCode,
  RegistryEstablishmentCandidate,
  RegistryIssue,
  RegistryOfficerCandidate,
  RegistryProvider,
  RegistryProviderAdapter,
  RegistryRawResponse,
} from "@/lib/acquisition/registry/types";
import { REGISTRY_PROVIDERS } from "@/lib/acquisition/registry/types";
import type {
  BusinessRegistryState,
  RegistryConnectionSummary,
  RegistryDecisionHistoryRow,
  RegistryDecisionRequest,
  RegistryDecisionResult,
  RegistryEnrichmentPreview,
  RegistryEntityProfileView,
  RegistryEntityResponse,
  RegistryLinkRequest,
  RegistryLinkSummary,
  RegistryLookupRequest,
  RegistryProposalRow,
  RegistryProposeRequest,
  RegistrySearchRequest,
  RegistrySearchResponse,
} from "@/lib/data/registry-contracts";
import { nullableFiniteNumber } from "@/lib/data/row-validation";
import { ownerId, supabaseAdmin } from "@/lib/data/supabase-client";

/**
 * ACQUISITION DU REGISTRE — PERSISTANCE
 *
 * Ce module est la SEULE frontière entre un fournisseur externe et la base. Il applique
 * quatre règles, et chacune est vérifiée par le smoke transactionnel :
 *
 *   1. TOUT APPEL PRODUIT UN INSTANTANÉ, succès comme échec. « Le registre n'a pas répondu
 *      le 31 août » est un fait daté : le perdre ferait croire à une absence de donnée.
 *
 *   2. LE CACHE EST LA BASE. Un instantané dont la péremption déclarée n'est pas atteinte
 *      est RÉUTILISÉ au lieu d'un nouvel appel. Un instantané SANS péremption déclarée n'est
 *      jamais réutilisé : sans fraîcheur déclarée, on ne peut pas affirmer qu'il est frais.
 *
 *   3. AUCUN SECRET NE SORT. Seule la PRÉSENCE d'un jeton est exposée, avec le NOM de la
 *      variable attendue.
 *
 *   4. AUCUNE ÉCRITURE DANS `businesses` HORS DÉCISION. La seule porte est
 *      `lfo_decide_business_enrichment`, et elle refuse un vide, un champ hors liste blanche
 *      et une valeur canonique qui a bougé depuis la proposition.
 */

type Row = Record<string, unknown>;

const DOMAIN = "COMPANY_REGISTRY";

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${context} : aucune donnée`);
  return result.data;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireText(value: unknown, context: string): string {
  const read = text(value);
  if (read === null) throw new Error(`Colonne ${context} absente ou vide`);
  return read;
}

function isProvider(value: unknown): value is RegistryProvider {
  return typeof value === "string" && (REGISTRY_PROVIDERS as readonly string[]).includes(value);
}

function readProvider(value: unknown, context: string): RegistryProvider {
  if (!isProvider(value))
    throw new Error(`Fournisseur inconnu en base (${context}) : ${String(value)}`);
  return value;
}

/**
 * JSON CANONIQUE : clés triées, à toute profondeur. Deux réponses identiques dont le
 * fournisseur a permuté les clés donnent la MÊME empreinte, et deux réponses réellement
 * différentes en donnent deux. Sans ce tri, l'empreinte dirait « contenu différent » à
 * chaque appel et ne servirait à rien.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** Lecture du secret d'un fournisseur. La valeur ne quitte JAMAIS le serveur. */
function credentialFor(adapter: RegistryProviderAdapter): string | null {
  if (adapter.credentialEnvVar === null) return null;
  const value = process.env[adapter.credentialEnvVar];
  return value && value.trim().length > 0 ? value : null;
}

function adapterFor(provider: RegistryProvider): RegistryProviderAdapter {
  // Le jeton est injecté ICI, côté serveur, à la construction de l'adaptateur. Aucune autre
  // couche n'y a accès.
  const probe = createRegistryAdapter(provider);
  return createRegistryAdapter(provider, { token: credentialFor(probe) });
}

/** Statut à déclarer pour une connexion, avant tout appel. */
function initialStatus(adapter: RegistryProviderAdapter, credentialPresent: boolean): string {
  if (adapter.provider === "FIXTURE") return "FIXTURE";
  if (adapter.authMode !== "NONE" && !credentialPresent) return "CREDENTIALS_MISSING";
  return "ACTIVE";
}

export interface RegistryRepository {
  describeConnections(): Promise<RegistryConnectionSummary[]>;
  /**
   * `options.signal` vient de la REQUÊTE HTTP entrante. Quand le navigateur abandonne, la
   * lecture distante s'arrête au lieu de consommer un quota de registre pour une réponse
   * que plus personne ne lira. Facultatif : un appelant hors requête HTTP n'a rien à
   * propager, et le transport garde de toute façon son délai interne.
   */
  search(
    request: RegistrySearchRequest,
    options?: RegistryCallOptions,
  ): Promise<RegistrySearchResponse>;
  lookupEntity(
    request: RegistryLookupRequest,
    options?: RegistryCallOptions,
  ): Promise<RegistryEntityResponse>;
  linkBusiness(request: RegistryLinkRequest): Promise<RegistryLinkSummary>;
  unlinkBusiness(businessId: string, provider: RegistryProvider): Promise<string>;
  proposeEnrichment(request: RegistryProposeRequest): Promise<RegistryEnrichmentPreview>;
  decide(request: RegistryDecisionRequest): Promise<RegistryDecisionResult>;
  getBusinessRegistryState(businessId: string): Promise<BusinessRegistryState>;
}

class SupabaseRegistryRepository implements RegistryRepository {
  private readonly user = ownerId();

  private client() {
    return supabaseAdmin();
  }

  private async rpc(name: string, payload: unknown): Promise<unknown> {
    const result = await this.client().rpc(name, {
      p_user_id: this.user,
      p_payload: payload,
    });
    if (result.error) throw new Error(`Supabase ${name} : ${result.error.message}`);
    return result.data;
  }

  /**
   * Déclare la connexion d'un fournisseur, et la met à jour à chaque passage. La déclaration
   * est IDEMPOTENTE par (domaine, fournisseur) : elle n'accumule pas de doublons, et l'état
   * du quota comme l'historique d'erreur restent uniques.
   */
  private async ensureConnection(adapter: RegistryProviderAdapter): Promise<string> {
    const credentialPresent = credentialFor(adapter) !== null;
    const id = await this.rpc("lfo_upsert_external_source", {
      domain: DOMAIN,
      provider: adapter.provider,
      name: adapter.label,
      source_type: "API",
      url: adapter.baseUrl,
      status: initialStatus(adapter, credentialPresent),
      adapter_version: adapter.adapterVersion,
      capabilities: adapter.capabilities,
      auth_mode: adapter.authMode,
      credential_env_var: adapter.credentialEnvVar,
      rate_limit_per_minute: adapter.rateLimitPerMinute,
      snapshot_ttl_minutes: adapter.snapshotTtlMinutes,
    });
    return requireText(id, "external_sources.id");
  }

  async describeConnections(): Promise<RegistryConnectionSummary[]> {
    const catalog = enrichableFieldCatalog();
    const summaries: RegistryConnectionSummary[] = [];

    for (const provider of REGISTRY_PROVIDERS) {
      const adapter = adapterFor(provider);
      const sourceId = await this.ensureConnection(adapter);
      const row = unwrap(
        await this.client()
          .from("external_sources")
          .select("status, last_checked_at, last_success_at, last_error")
          .eq("id", sourceId)
          .eq("user_id", this.user)
          .maybeSingle(),
        "external_sources",
      ) as Row;

      const capabilities = [...adapter.capabilities];
      summaries.push({
        provider: adapter.provider,
        label: adapter.label,
        status: requireText(row.status, "external_sources.status"),
        authMode: adapter.authMode,
        credentialEnvVar: adapter.credentialEnvVar,
        credentialPresent: credentialFor(adapter) !== null,
        capabilities,
        // Dit AVANT tout appel ce que ce fournisseur ne pourra pas alimenter. Un écran qui
        // ne le dit pas laisse croire à une donnée manquante là où la source est muette.
        unservedFields: catalog
          .filter((entry) => !capabilities.includes(entry.capability))
          .map(({ field, label }) => ({ field, label })),
        baseUrl: adapter.baseUrl,
        snapshotTtlMinutes: adapter.snapshotTtlMinutes,
        rateLimitPerMinute: adapter.rateLimitPerMinute,
        lastCheckedAt: text(row.last_checked_at),
        lastSuccessAt: text(row.last_success_at),
        lastError: text(row.last_error),
      });
    }

    return summaries;
  }

  /** Persiste un instantané et sa lecture. Un échec passe par la même porte. */
  private async persistSnapshot(
    adapter: RegistryProviderAdapter,
    sourceId: string,
    response: RegistryRawResponse,
    reading: RegistryEntityReading | null,
  ): Promise<{ snapshotId: string; observedAt: string; staleAfter: string | null }> {
    const profile = reading?.profile ?? null;
    const snapshotId = requireText(
      await this.rpc("lfo_record_registry_snapshot", {
        snapshot: {
          external_source_id: sourceId,
          endpoint: response.endpoint,
          query: response.query,
          siren:
            profile?.siren ??
            (typeof response.query.siren === "string" ? response.query.siren : null),
          siret: null,
          http_status: response.httpStatus,
          payload: response.payload ?? null,
          payload_hash: response.payload === null ? null : hashPayload(response.payload),
          payload_bytes: response.payloadBytes,
          schema_version: adapter.schemaVersion,
          observed_at: response.observedAt,
          provider_updated_at: response.providerUpdatedAt,
          error_code: response.errorCode,
          error_message: response.errorMessage,
          // Une donnée externe est EXTERNAL_DATA, et sa confiance ne dépasse pas MEDIUM :
          // elle est publiée par un tiers, à une date qui n'est pas la nôtre.
          confidence: "MEDIUM",
          source: adapter.label,
        },
        profile: profile === null ? null : profileToPayload(profile),
        officers: reading?.officers.map(officerToPayload) ?? [],
        establishments: reading?.establishments.map(establishmentToPayload) ?? [],
        documents: reading?.documents.map(documentToPayload) ?? [],
      }),
      "company_registry_snapshots.id",
    );

    const row = unwrap(
      await this.client()
        .from("company_registry_snapshots")
        .select("observed_at, stale_after")
        .eq("id", snapshotId)
        .eq("user_id", this.user)
        .maybeSingle(),
      "company_registry_snapshots",
    ) as Row;

    return {
      snapshotId,
      observedAt: requireText(row.observed_at, "company_registry_snapshots.observed_at"),
      staleAfter: text(row.stale_after),
    };
  }

  async search(
    request: RegistrySearchRequest,
    options?: RegistryCallOptions,
  ): Promise<RegistrySearchResponse> {
    const adapter = adapterFor(request.provider);
    const sourceId = await this.ensureConnection(adapter);
    const response = await adapter.search(
      {
        text: request.text,
        siren: request.siren,
        officerName: request.officerName,
        page: request.page,
        perPage: request.perPage,
      },
      options,
    );

    const reading =
      response.errorCode === null
        ? adapter.readSearch(response)
        : { hits: [], totalResults: null, page: null, perPage: null, issues: [] };

    // Une recherche ne produit PAS de profil : plusieurs entités peuvent répondre, et
    // n'en normaliser qu'une reviendrait à choisir pour l'utilisateur.
    const persisted = await this.persistSnapshot(adapter, sourceId, response, null);

    return {
      provider: adapter.provider,
      snapshotId: persisted.snapshotId,
      observedAt: persisted.observedAt,
      hits: reading.hits,
      totalResults: reading.totalResults,
      page: reading.page,
      perPage: reading.perPage,
      issues: reading.issues,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage,
    };
  }

  /**
   * Cherche un instantané d'entité RÉUTILISABLE : même fournisseur, même SIREN, réussi, et
   * dont la péremption DÉCLARÉE n'est pas atteinte.
   *
   * Un instantané sans péremption déclarée n'est jamais réutilisé. C'est délibéré : sans
   * fraîcheur déclarée, rien ne permet d'affirmer qu'il est encore valable, et le réutiliser
   * serait présenter une observation d'âge inconnu comme actuelle.
   */
  private async findFreshSnapshot(provider: RegistryProvider, siren: string): Promise<Row | null> {
    const rows = unwrap(
      await this.client()
        .from("company_registry_snapshots")
        .select("id, observed_at, stale_after, error_code")
        .eq("user_id", this.user)
        .eq("provider", provider)
        .eq("endpoint", "ENTITY")
        .eq("siren", siren)
        .is("error_code", null)
        .not("stale_after", "is", null)
        .gt("stale_after", new Date().toISOString())
        .order("observed_at", { ascending: false })
        .limit(1),
      "company_registry_snapshots (fraîcheur)",
    ) as Row[];
    return rows[0] ?? null;
  }

  /** Relit une lecture déjà persistée : c'est ce qui rend le cache utilisable. */
  private async readPersistedReading(snapshotId: string): Promise<{
    profile: CompanyRegistryProfileCandidate | null;
    officers: RegistryOfficerCandidate[];
    establishments: RegistryEstablishmentCandidate[];
    documents: RegistryDocumentCandidate[];
  }> {
    const client = this.client();
    const [profileRows, officerRows, establishmentRows, documentRows] = await Promise.all([
      client
        .from("company_registry_profiles")
        .select("*")
        .eq("user_id", this.user)
        .eq("snapshot_id", snapshotId)
        .limit(1),
      client
        .from("company_registry_officers")
        .select("*")
        .eq("user_id", this.user)
        .eq("snapshot_id", snapshotId)
        .order("position_index", { ascending: true }),
      client
        .from("company_registry_establishments")
        .select("*")
        .eq("user_id", this.user)
        .eq("snapshot_id", snapshotId)
        .order("siret", { ascending: true }),
      client
        .from("company_registry_documents")
        .select("*")
        .eq("user_id", this.user)
        .eq("snapshot_id", snapshotId)
        .order("fiscal_year_end", { ascending: false }),
    ]);

    const profileRow = (unwrap(profileRows, "company_registry_profiles") as Row[])[0] ?? null;

    return {
      profile: profileRow === null ? null : rowToProfile(profileRow),
      officers: (unwrap(officerRows, "company_registry_officers") as Row[]).map(rowToOfficer),
      establishments: (unwrap(establishmentRows, "company_registry_establishments") as Row[]).map(
        rowToEstablishment,
      ),
      documents: (unwrap(documentRows, "company_registry_documents") as Row[]).map(rowToDocument),
    };
  }

  async lookupEntity(
    request: RegistryLookupRequest,
    options?: RegistryCallOptions,
  ): Promise<RegistryEntityResponse> {
    const adapter = adapterFor(request.provider);
    const sourceId = await this.ensureConnection(adapter);

    if (request.refresh !== true) {
      const fresh = await this.findFreshSnapshot(adapter.provider, request.siren);
      if (fresh !== null) {
        const snapshotId = requireText(fresh.id, "company_registry_snapshots.id");
        const persisted = await this.readPersistedReading(snapshotId);
        return {
          provider: adapter.provider,
          snapshotId,
          observedAt: requireText(fresh.observed_at, "observed_at"),
          staleAfter: text(fresh.stale_after),
          stale: false,
          reusedSnapshot: true,
          profile:
            persisted.profile === null
              ? null
              : toProfileView(persisted.profile, adapter.capabilities),
          officers: persisted.officers,
          establishments: persisted.establishments,
          documents: persisted.documents,
          issues: persisted.profile?.issues ?? [],
          errorCode: null,
          errorMessage: null,
        };
      }
    }

    const response = await adapter.entity(request.siren, options);
    const reading: RegistryEntityReading =
      response.errorCode === null
        ? adapter.readEntity(response)
        : { profile: null, officers: [], establishments: [], documents: [], issues: [] };

    const persisted = await this.persistSnapshot(adapter, sourceId, response, reading);
    const staleAfter = persisted.staleAfter;

    return {
      provider: adapter.provider,
      snapshotId: persisted.snapshotId,
      observedAt: persisted.observedAt,
      staleAfter,
      stale: staleAfter !== null && staleAfter <= new Date().toISOString(),
      reusedSnapshot: false,
      profile:
        reading.profile === null ? null : toProfileView(reading.profile, adapter.capabilities),
      officers: reading.officers,
      establishments: reading.establishments,
      documents: reading.documents,
      issues: [...reading.issues, ...(reading.profile?.issues ?? [])],
      errorCode: response.errorCode,
      errorMessage: response.errorMessage,
    };
  }

  async linkBusiness(request: RegistryLinkRequest): Promise<RegistryLinkSummary> {
    // La BASE du rattachement est une preuve, pas un libellé : `PROVIDER_EXACT` exige un
    // instantané, et la contrainte de base le refuse sans lui.
    const matchBasis = request.snapshotId ? "PROVIDER_EXACT" : "DECLARED";
    await this.rpc("lfo_link_business_registry", {
      business_id: request.businessId,
      provider: request.provider,
      siren: request.siren,
      siret: request.siret ?? null,
      linked_snapshot_id: request.snapshotId ?? null,
      match_basis: matchBasis,
      notes: request.notes ?? null,
    });

    const row = unwrap(
      await this.client()
        .from("business_registry_links")
        .select("business_id, provider, siren, siret, match_basis, linked_at")
        .eq("user_id", this.user)
        .eq("business_id", request.businessId)
        .eq("provider", request.provider)
        .maybeSingle(),
      "business_registry_links",
    ) as Row;

    return {
      businessId: requireText(row.business_id, "business_id"),
      provider: readProvider(row.provider, "business_registry_links.provider"),
      siren: requireText(row.siren, "siren"),
      siret: text(row.siret),
      matchBasis: row.match_basis === "PROVIDER_EXACT" ? "PROVIDER_EXACT" : "DECLARED",
      linkedAt: requireText(row.linked_at, "linked_at"),
    };
  }

  async unlinkBusiness(businessId: string, provider: RegistryProvider): Promise<string> {
    const result = await this.client().rpc("lfo_unlink_business_registry", {
      p_user_id: this.user,
      p_business_id: businessId,
      p_provider: provider,
    });
    if (result.error)
      throw new Error(`Supabase lfo_unlink_business_registry : ${result.error.message}`);
    return businessId;
  }

  private async readIdentity(businessId: string): Promise<{
    identity: BusinessCanonicalIdentity;
    name: string;
  }> {
    const row = unwrap(
      await this.client()
        .from("businesses")
        .select("name, legal_form, sector, naf_code, country, founded_on, siren")
        .eq("id", businessId)
        .eq("user_id", this.user)
        .maybeSingle(),
      "businesses",
    ) as Row;

    return {
      name: requireText(row.name, "businesses.name"),
      identity: {
        name: text(row.name),
        legalForm: text(row.legal_form),
        sector: text(row.sector),
        nafCode: text(row.naf_code),
        country: text(row.country),
        foundedOn: text(row.founded_on),
        siren: text(row.siren),
      },
    };
  }

  async proposeEnrichment(request: RegistryProposeRequest): Promise<RegistryEnrichmentPreview> {
    const client = this.client();
    const snapshot = unwrap(
      await client
        .from("company_registry_snapshots")
        .select("id, provider, observed_at, stale_after, external_source_id, error_code")
        .eq("id", request.snapshotId)
        .eq("user_id", this.user)
        .maybeSingle(),
      "company_registry_snapshots",
    ) as Row;

    if (text(snapshot.error_code) !== null) {
      throw new Error(
        "Cet instantané est un ÉCHEC de fournisseur : il ne porte aucune donnée à proposer",
      );
    }

    const persisted = await this.readPersistedReading(request.snapshotId);
    if (persisted.profile === null) {
      throw new Error(
        "Cet instantané n'a produit aucun profil identifié : aucune proposition n'est possible",
      );
    }

    const sourceRow = unwrap(
      await client
        .from("external_sources")
        .select("capabilities")
        .eq("id", requireText(snapshot.external_source_id, "external_source_id"))
        .eq("user_id", this.user)
        .maybeSingle(),
      "external_sources (capacités)",
    ) as Row;

    // Les capacités RETENUES sont celles DÉCLARÉES par la connexion : c'est la déclaration
    // en vigueur, pas une liste recalculée après coup.
    const capabilities = Array.isArray(sourceRow.capabilities)
      ? sourceRow.capabilities.filter(
          (item): item is RegistryCapability => typeof item === "string",
        )
      : [];

    const { identity } = await this.readIdentity(request.businessId);
    const diff = buildEnrichmentDiff({
      identity,
      profile: persisted.profile,
      capabilities,
      staleAfter: text(snapshot.stale_after),
      now: new Date().toISOString(),
    });

    if (diff.proposals.length > 0) {
      await this.rpc("lfo_propose_business_enrichment", {
        business_id: request.businessId,
        snapshot_id: request.snapshotId,
        fields: diff.proposals.map((proposal) => ({
          field_path: proposal.field,
          candidate_value: proposal.candidateValue,
          canonical_value_before: proposal.canonicalValueBefore,
          state: proposal.state,
        })),
      });
    }

    const openProposals = await this.readOpenProposals(request.businessId);
    return {
      businessId: request.businessId,
      snapshotId: request.snapshotId,
      provider: readProvider(snapshot.provider, "company_registry_snapshots.provider"),
      observedAt: requireText(snapshot.observed_at, "observed_at"),
      staleAfter: text(snapshot.stale_after),
      stale: diff.stale,
      proposals: openProposals.filter((proposal) => proposal.snapshotId === request.snapshotId),
      skipped: diff.skipped,
      issues: diff.issues,
    };
  }

  private async readOpenProposals(businessId: string): Promise<RegistryProposalRow[]> {
    const rows = unwrap(
      await this.client()
        .from("business_enrichment_decisions")
        .select(
          "id, field_path, candidate_value, canonical_value_before, state, snapshot_id, created_at",
        )
        .eq("user_id", this.user)
        .eq("business_id", businessId)
        .is("superseded_by", null)
        .in("state", ["CANDIDATE", "CONFLICT"])
        .order("created_at", { ascending: true }),
      "business_enrichment_decisions",
    ) as Row[];

    if (rows.length === 0) return [];

    const snapshotIds = [
      ...new Set(rows.map((row) => requireText(row.snapshot_id, "snapshot_id"))),
    ];
    const snapshots = unwrap(
      await this.client()
        .from("company_registry_snapshots")
        .select("id, observed_at, stale_after")
        .eq("user_id", this.user)
        .in("id", snapshotIds),
      "company_registry_snapshots (propositions)",
    ) as Row[];
    const byId = new Map(snapshots.map((row) => [requireText(row.id, "id"), row]));
    const now = new Date().toISOString();
    const labels = new Map(enrichableFieldCatalog().map((entry) => [entry.field, entry.label]));

    return rows.flatMap((row) => {
      const field = row.field_path;
      if (!isEnrichableField(field)) return [];
      const snapshotId = requireText(row.snapshot_id, "snapshot_id");
      const snapshot = byId.get(snapshotId);
      const staleAfter = snapshot ? text(snapshot.stale_after) : null;
      const stale = staleAfter !== null && staleAfter <= now;
      const state = row.state === "CONFLICT" ? "CONFLICT" : "CANDIDATE";
      const candidate = jsonToText(row.candidate_value);
      if (candidate === null) return [];
      return [
        {
          decisionId: requireText(row.id, "id"),
          field,
          label: labels.get(field) ?? field,
          candidateValue: candidate,
          canonicalValueBefore: jsonToText(row.canonical_value_before),
          state,
          // `STALE` est DÉRIVÉ : il dépend de l'heure, il n'est jamais persisté.
          displayState: stale ? ("STALE" as const) : state,
          stale,
          snapshotId,
          snapshotObservedAt: snapshot ? requireText(snapshot.observed_at, "observed_at") : "",
        },
      ];
    });
  }

  async decide(request: RegistryDecisionRequest): Promise<RegistryDecisionResult> {
    const applied = await this.rpc("lfo_decide_business_enrichment", {
      business_id: request.businessId,
      reason: request.reason ?? null,
      decisions: request.decisions,
    });
    return { applied: Number(applied ?? 0) };
  }

  async getBusinessRegistryState(businessId: string): Promise<BusinessRegistryState> {
    const client = this.client();
    const { identity, name } = await this.readIdentity(businessId);

    const [linkRows, historyRows] = await Promise.all([
      client
        .from("business_registry_links")
        .select("business_id, provider, siren, siret, match_basis, linked_at")
        .eq("user_id", this.user)
        .eq("business_id", businessId)
        .order("linked_at", { ascending: false }),
      client
        .from("business_enrichment_decisions")
        .select(
          "id, field_path, candidate_value, canonical_value_before, state, decided_at, decided_reason, snapshot_id",
        )
        .eq("user_id", this.user)
        .eq("business_id", businessId)
        .in("state", ["ACCEPTED", "REJECTED"])
        .order("decided_at", { ascending: false })
        .limit(50),
    ]);

    const links = (unwrap(linkRows, "business_registry_links") as Row[]).map((row) => ({
      businessId: requireText(row.business_id, "business_id"),
      provider: readProvider(row.provider, "business_registry_links.provider"),
      siren: requireText(row.siren, "siren"),
      siret: text(row.siret),
      matchBasis:
        row.match_basis === "PROVIDER_EXACT" ? ("PROVIDER_EXACT" as const) : ("DECLARED" as const),
      linkedAt: requireText(row.linked_at, "linked_at"),
    }));

    const decisions = unwrap(historyRows, "business_enrichment_decisions (historique)") as Row[];
    const snapshotIds = [
      ...new Set(decisions.map((row) => requireText(row.snapshot_id, "snapshot_id"))),
    ];
    const decisionSnapshots =
      snapshotIds.length === 0
        ? []
        : ((unwrap(
            await client
              .from("company_registry_snapshots")
              .select("id, provider")
              .eq("user_id", this.user)
              .in("id", snapshotIds),
            "company_registry_snapshots (historique)",
          ) as Row[]) ?? []);
    const providerBySnapshot = new Map(
      decisionSnapshots.map((row) => [
        requireText(row.id, "id"),
        readProvider(row.provider, "provider"),
      ]),
    );

    const history: RegistryDecisionHistoryRow[] = decisions.flatMap((row) => {
      const field = row.field_path;
      if (!isEnrichableField(field)) return [];
      const snapshotId = requireText(row.snapshot_id, "snapshot_id");
      const provider = providerBySnapshot.get(snapshotId);
      if (provider === undefined) return [];
      return [
        {
          decisionId: requireText(row.id, "id"),
          field,
          candidateValue: jsonToText(row.candidate_value),
          canonicalValueBefore: jsonToText(row.canonical_value_before),
          state: row.state === "ACCEPTED" ? ("ACCEPTED" as const) : ("REJECTED" as const),
          decidedAt: requireText(row.decided_at, "decided_at"),
          decidedReason: text(row.decided_reason),
          snapshotId,
          provider,
        },
      ];
    });

    const lastSnapshotRows = unwrap(
      await client
        .from("company_registry_snapshots")
        .select("id, provider, observed_at, stale_after, error_code")
        .eq("user_id", this.user)
        .eq("endpoint", "ENTITY")
        .in("siren", links.map((link) => link.siren).concat(identity.siren ? [identity.siren] : []))
        .order("observed_at", { ascending: false })
        .limit(1),
      "company_registry_snapshots (dernier)",
    ) as Row[];

    const lastSnapshotRow = lastSnapshotRows[0] ?? null;
    const now = new Date().toISOString();
    const staleAfter = lastSnapshotRow ? text(lastSnapshotRow.stale_after) : null;

    return {
      businessId,
      businessName: name,
      canonicalSiren: identity.siren,
      links,
      openProposals: await this.readOpenProposals(businessId),
      history,
      lastSnapshot:
        lastSnapshotRow === null
          ? null
          : {
              snapshotId: requireText(lastSnapshotRow.id, "id"),
              provider: readProvider(lastSnapshotRow.provider, "provider"),
              observedAt: requireText(lastSnapshotRow.observed_at, "observed_at"),
              staleAfter,
              stale: staleAfter !== null && staleAfter <= now,
              errorCode: (text(lastSnapshotRow.error_code) as RegistryErrorCode | null) ?? null,
            },
    };
  }
}

let repository: RegistryRepository | undefined;

export function getRegistryRepository(): RegistryRepository {
  repository ??= new SupabaseRegistryRepository();
  return repository;
}

function isEnrichableField(value: unknown): value is EnrichableField {
  return (
    typeof value === "string" && enrichableFieldCatalog().some((entry) => entry.field === value)
  );
}

/**
 * Une valeur de décision est du jsonb. Seule une CHAÎNE est exploitable comme valeur de
 * champ ; tout le reste est une donnée qu'on refuse d'afficher plutôt que de la coercer.
 */
function jsonToText(value: unknown): string | null {
  if (typeof value === "string") return value;
  return null;
}

function profileToPayload(profile: CompanyRegistryProfileCandidate): Record<string, unknown> {
  return {
    siren: profile.siren,
    legal_name: profile.legalName,
    trade_name: profile.tradeName,
    acronym: profile.acronym,
    legal_form_code: profile.legalFormCode,
    legal_form_label: profile.legalFormLabel,
    naf_code: profile.nafCode,
    naf_label: profile.nafLabel,
    naf_nomenclature: profile.nafNomenclature,
    share_capital: profile.shareCapital,
    share_capital_currency: profile.shareCapitalCurrency,
    employee_range_code: profile.employeeRangeCode,
    employee_range_label: profile.employeeRangeLabel,
    employee_range_year: profile.employeeRangeYear,
    enterprise_category: profile.enterpriseCategory,
    created_on: profile.createdOn,
    ceased_on: profile.ceasedOn,
    registry_status: profile.registryStatus,
    head_office_siret: profile.headOfficeSiret,
    address_line: profile.addressLine,
    postal_code: profile.postalCode,
    city: profile.city,
    city_code: profile.cityCode,
    country: profile.country,
    establishment_count: profile.establishmentCount,
    greffe: profile.greffe,
    rcs_number: profile.rcsNumber,
    issues: profile.issues,
    confidence: "MEDIUM",
  };
}

function officerToPayload(officer: RegistryOfficerCandidate): Record<string, unknown> {
  return {
    officer_kind: officer.officerKind,
    last_name: officer.lastName,
    first_names: officer.firstNames,
    birth_year: officer.birthYear,
    nationality: officer.nationality,
    role_label: officer.roleLabel,
    role_code: officer.roleCode,
    company_siren: officer.companySiren,
    company_name: officer.companyName,
    since_on: officer.sinceOn,
  };
}

function establishmentToPayload(
  establishment: RegistryEstablishmentCandidate,
): Record<string, unknown> {
  return {
    siret: establishment.siret,
    is_head_office: establishment.isHeadOffice,
    establishment_status: establishment.establishmentStatus,
    address_line: establishment.addressLine,
    postal_code: establishment.postalCode,
    city: establishment.city,
    city_code: establishment.cityCode,
    country: establishment.country,
    naf_code: establishment.nafCode,
    naf_label: establishment.nafLabel,
    employee_range_code: establishment.employeeRangeCode,
    created_on: establishment.createdOn,
    closed_on: establishment.closedOn,
  };
}

function documentToPayload(document: RegistryDocumentCandidate): Record<string, unknown> {
  return {
    document_kind: document.documentKind,
    provider_document_id: document.providerDocumentId,
    fiscal_year_end: document.fiscalYearEnd,
    filing_date: document.filingDate,
    confidentiality: document.confidentiality,
    download_available: document.downloadAvailable,
  };
}

function rowToProfile(row: Row): CompanyRegistryProfileCandidate {
  return {
    siren: requireText(row.siren, "company_registry_profiles.siren"),
    legalName: text(row.legal_name),
    tradeName: text(row.trade_name),
    acronym: text(row.acronym),
    legalFormCode: text(row.legal_form_code),
    legalFormLabel: text(row.legal_form_label),
    nafCode: text(row.naf_code),
    nafLabel: text(row.naf_label),
    nafNomenclature: text(row.naf_nomenclature),
    shareCapital: nullableFiniteNumber(
      row.share_capital,
      "company_registry_profiles.share_capital",
    ),
    shareCapitalCurrency: text(row.share_capital_currency),
    employeeRangeCode: text(row.employee_range_code),
    employeeRangeLabel: text(row.employee_range_label),
    employeeRangeYear: nullableFiniteNumber(
      row.employee_range_year,
      "company_registry_profiles.employee_range_year",
    ),
    enterpriseCategory: text(row.enterprise_category),
    createdOn: text(row.created_on),
    ceasedOn: text(row.ceased_on),
    registryStatus: readRegistryStatus(row.registry_status),
    headOfficeSiret: text(row.head_office_siret),
    addressLine: text(row.address_line),
    postalCode: text(row.postal_code),
    city: text(row.city),
    cityCode: text(row.city_code),
    country: text(row.country),
    establishmentCount: nullableFiniteNumber(
      row.establishment_count,
      "company_registry_profiles.establishment_count",
    ),
    greffe: text(row.greffe),
    rcsNumber: text(row.rcs_number),
    issues: Array.isArray(row.issues) ? (row.issues as RegistryIssue[]) : [],
  };
}

function readRegistryStatus(value: unknown): "ACTIVE" | "CEASED" | "UNKNOWN" | null {
  return value === "ACTIVE" || value === "CEASED" || value === "UNKNOWN" ? value : null;
}

function rowToOfficer(row: Row): RegistryOfficerCandidate {
  return {
    officerKind:
      row.officer_kind === "PERSON" || row.officer_kind === "COMPANY"
        ? row.officer_kind
        : "UNKNOWN",
    lastName: text(row.last_name),
    firstNames: text(row.first_names),
    birthYear: nullableFiniteNumber(row.birth_year, "company_registry_officers.birth_year"),
    nationality: text(row.nationality),
    roleLabel: text(row.role_label),
    roleCode: text(row.role_code),
    companySiren: text(row.company_siren),
    companyName: text(row.company_name),
    sinceOn: text(row.since_on),
  };
}

function rowToEstablishment(row: Row): RegistryEstablishmentCandidate {
  return {
    siret: requireText(row.siret, "company_registry_establishments.siret"),
    isHeadOffice: typeof row.is_head_office === "boolean" ? row.is_head_office : null,
    establishmentStatus:
      row.establishment_status === "ACTIVE" ||
      row.establishment_status === "CLOSED" ||
      row.establishment_status === "UNKNOWN"
        ? row.establishment_status
        : null,
    addressLine: text(row.address_line),
    postalCode: text(row.postal_code),
    city: text(row.city),
    cityCode: text(row.city_code),
    country: text(row.country),
    nafCode: text(row.naf_code),
    nafLabel: text(row.naf_label),
    employeeRangeCode: text(row.employee_range_code),
    createdOn: text(row.created_on),
    closedOn: text(row.closed_on),
  };
}

function rowToDocument(row: Row): RegistryDocumentCandidate {
  return {
    documentKind:
      row.document_kind === "ACTE" ||
      row.document_kind === "ANNUAL_ACCOUNTS" ||
      row.document_kind === "BYLAWS"
        ? row.document_kind
        : "OTHER",
    providerDocumentId: text(row.provider_document_id),
    fiscalYearEnd: text(row.fiscal_year_end),
    filingDate: text(row.filing_date),
    confidentiality:
      row.confidentiality === "PUBLIC" ||
      row.confidentiality === "CONFIDENTIAL" ||
      row.confidentiality === "UNKNOWN"
        ? row.confidentiality
        : null,
    downloadAvailable: typeof row.download_available === "boolean" ? row.download_available : null,
  };
}

/**
 * Vue d'affichage d'un profil. Elle porte la liste des capacités NON SERVIES par le
 * fournisseur : sans elle, l'écran ne pourrait pas distinguer « ce registre ne publie pas le
 * capital social » de « le capital social de cette société est inconnu ».
 */
function toProfileView(
  profile: CompanyRegistryProfileCandidate,
  capabilities: readonly RegistryCapability[],
): RegistryEntityProfileView {
  const relevant: RegistryCapability[] = [
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
    "ceased_on",
    "registry_status",
    "head_office",
    "address",
    "country",
    "greffe",
    "rcs_number",
  ];
  return {
    siren: profile.siren,
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    acronym: profile.acronym,
    legalFormCode: profile.legalFormCode,
    legalFormLabel: profile.legalFormLabel,
    nafCode: profile.nafCode,
    nafLabel: profile.nafLabel,
    shareCapital: profile.shareCapital,
    shareCapitalCurrency: profile.shareCapitalCurrency,
    employeeRangeCode: profile.employeeRangeCode,
    employeeRangeLabel: profile.employeeRangeLabel,
    employeeRangeYear: profile.employeeRangeYear,
    enterpriseCategory: profile.enterpriseCategory,
    createdOn: profile.createdOn,
    ceasedOn: profile.ceasedOn,
    registryStatus: profile.registryStatus,
    headOfficeSiret: profile.headOfficeSiret,
    addressLine: profile.addressLine,
    postalCode: profile.postalCode,
    city: profile.city,
    country: profile.country,
    establishmentCount: profile.establishmentCount,
    greffe: profile.greffe,
    rcsNumber: profile.rcsNumber,
    unservedCapabilities: relevant.filter((capability) => !capabilities.includes(capability)),
  };
}
