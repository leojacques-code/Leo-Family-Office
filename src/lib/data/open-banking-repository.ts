import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import {
  createSandboxProvider,
  normalizeBalance,
  normalizeObservation,
  readAllTransactionPages,
  reconcileObservations,
  SANDBOX_CAPABILITIES,
  SANDBOX_PROVIDER_ID,
  SANDBOX_PROVIDER_VERSION,
} from "@/lib/acquisition/banking";
import type {
  BankDataProvider,
  BankSyncContext,
  BankSyncIssue,
  KnownObservation,
  NormalizedObservation,
  ProviderTransaction,
  SandboxScenario,
} from "@/lib/acquisition/banking";
import { civilDateIn, resolveTimeZone } from "@/lib/acquisition/clock";
import type { ExistingIdentity, ExistingTransactionFact } from "@/lib/acquisition/types";
import type {
  BankSyncCommitResult,
  BankSyncPreview,
  BankSyncPreviewRow,
  OpenBankingOverview,
} from "@/lib/data/open-banking-contracts";
import { readAllPages } from "@/lib/data/pagination";
import { nullableFiniteNumber } from "@/lib/data/row-validation";
import { ownerId, supabaseAdmin } from "@/lib/data/supabase-client";

type Row = Record<string, unknown>;

/**
 * Marge, en jours, ajoutée autour de la période observée pour lire les transactions déjà
 * canoniques. Elle sert la RESSEMBLANCE : une opération datée par la banque au jour de
 * valeur tombe à quelques jours de son jumeau.
 */
const DEDUPE_MARGIN_DAYS = 7;

/** Plafond d'AFFICHAGE des lignes de preview. Le staging en contient toujours l'intégralité. */
const PREVIEW_ROW_LIMIT = 300;

const str = (value: unknown): string => String(value ?? "");
const nullableStr = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function unwrap<T>(result: { data: T | null; error: PostgrestError | null }, context: string): T {
  if (result.error) throw new Error(`Supabase ${context} : ${result.error.message}`);
  if (result.data === null) throw new Error(`Supabase ${context} : réponse vide`);
  return result.data;
}

function shiftDate(iso: string, days: number): string {
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Date d'observation de la synchronisation. CIVILE et dans le fuseau du produit, jamais en
 * UTC : à 00 h 30 à Paris l'UTC est encore la veille, et une opération du jour serait
 * signalée « postérieure à la synchronisation ».
 *
 * DÉLIBÉRÉMENT distincte de `AS_OF_DATE` : une opération bookée hier est un fait, même si
 * le reporting est arrêté le mois précédent.
 */
function observationDate(): string {
  return civilDateIn(new Date(), resolveTimeZone(process.env.LFO_TIME_ZONE));
}

function issuesOf(value: unknown): BankSyncIssue[] {
  return Array.isArray(value) ? (value as BankSyncIssue[]) : [];
}

/**
 * Fabrique d'adaptateur.
 *
 * Un SEUL adaptateur est fourni : le sandbox, alimenté par un scénario déclaré. Aucun
 * adaptateur d'agrégateur réel n'est enregistré ici, et ce n'est pas un oubli — sans contrat
 * signé, sans identifiants et sans réponse réelle à observer, un adaptateur « Bridge » ou
 * « Powens » écrit de mémoire produirait un FAUX SUPPORT : du code qui paraît prêt et qui
 * échoue au premier appel, ou pire, qui lit la mauvaise colonne.
 *
 * Un fournisseur réel s'ajoute ici, et il reste `BLOCKED_EXTERNAL` jusqu'à ce qu'un contrat
 * et des identifiants existent.
 */
export function resolveProvider(adapterId: string, scenario: SandboxScenario): BankDataProvider {
  if (adapterId === SANDBOX_PROVIDER_ID) return createSandboxProvider(scenario);
  throw new Error(
    `Adaptateur « ${adapterId} » non fourni. Aucun adaptateur d'agrégateur réel n'est ` +
      "implémenté : un format inventé de mémoire serait un faux support.",
  );
}

export class OpenBankingRepository {
  private readonly client = supabaseAdmin();
  private readonly userId = ownerId();

  /** Vue complète : fournisseurs, consentements, comptes, exécutions, soldes, observations. */
  async overview(): Promise<OpenBankingOverview> {
    const providers = unwrap(
      await this.client
        .from("bank_providers")
        .select(
          "id, adapter_id, adapter_version, label, auth_mode, status, capabilities, secret_vault, last_success_at, last_error",
        )
        .eq("user_id", this.userId)
        .order("created_at", { ascending: false }),
      "lecture bank_providers",
    ) as Row[];

    const consents = unwrap(
      await this.client
        .from("bank_consents")
        .select(
          "id, provider_id, consent_reference, scopes, status, granted_at, expiry_declared, expires_at, revoked_at, revoked_reason, last_error",
        )
        .eq("user_id", this.userId)
        .order("created_at", { ascending: false }),
      "lecture bank_consents",
    ) as Row[];

    const accounts = unwrap(
      await this.client
        .from("bank_provider_accounts")
        .select(
          "id, consent_id, provider_account_id, name, masked_identifier, account_type, currency, account_id, mapped_at, mapping_reason, last_seen_at",
        )
        .eq("user_id", this.userId)
        .order("created_at", { ascending: true }),
      "lecture bank_provider_accounts",
    ) as Row[];

    const cursors = unwrap(
      await this.client
        .from("bank_sync_cursors")
        .select("provider_account_id, cursor, complete")
        .eq("user_id", this.userId),
      "lecture bank_sync_cursors",
    ) as Row[];
    const cursorByAccount = new Map(
      cursors.map((row) => [str(row.provider_account_id), row] as const),
    );

    const runs = unwrap(
      await this.client
        .from("bank_sync_runs")
        .select(
          "id, consent_id, provider_account_id, session_id, trigger, status, started_at, finished_at, pages_read, items_read, resume_cursor, complete, failure_code, failure_message, issues",
        )
        .eq("user_id", this.userId)
        .order("started_at", { ascending: false })
        .limit(50),
      "lecture bank_sync_runs",
    ) as Row[];

    const sessionIds = runs
      .map((row) => nullableStr(row.session_id))
      .filter((value): value is string => value !== null);
    const sessions = sessionIds.length
      ? ((unwrap(
          await this.client
            .from("import_sessions")
            .select("id, status, committed_count")
            .eq("user_id", this.userId)
            .in("id", sessionIds),
          "lecture import_sessions",
        ) as Row[]) ?? [])
      : [];
    const sessionById = new Map(sessions.map((row) => [str(row.id), row] as const));

    const balances = unwrap(
      await this.client
        .from("bank_balance_observations")
        .select(
          "id, provider_account_id, balance_type, amount, currency, observed_at, retrieved_at, issues",
        )
        .eq("user_id", this.userId)
        .order("observed_at", { ascending: false })
        .limit(100),
      "lecture bank_balance_observations",
    ) as Row[];

    const observations = unwrap(
      await this.client
        .from("bank_observed_transactions")
        .select(
          "id, provider_account_id, state, provider_transaction_id, operation_date, value_date, booking_date, amount, currency, label, counterparty, reference, original_amount, original_currency, external_key, first_seen_at, last_seen_at, committed_normalized_record_id, issues",
        )
        .eq("user_id", this.userId)
        .order("operation_date", { ascending: false, nullsFirst: false })
        .limit(200),
      "lecture bank_observed_transactions",
    ) as Row[];

    const decisions = unwrap(
      await this.client
        .from("bank_reconciliation_decisions")
        .select("observation_id, decision, reason, linked_transaction_id")
        .eq("user_id", this.userId),
      "lecture bank_reconciliation_decisions",
    ) as Row[];
    const decisionByObservation = new Map(
      decisions.map((row) => [str(row.observation_id), row] as const),
    );

    const candidateAccounts = unwrap(
      await this.client
        .from("financial_accounts")
        .select("id, name, currency, account_type")
        .eq("user_id", this.userId)
        .order("name", { ascending: true }),
      "lecture financial_accounts",
    ) as Row[];

    return {
      providers: providers.map((row) => ({
        id: str(row.id),
        adapterId: str(row.adapter_id),
        adapterVersion: str(row.adapter_version),
        label: str(row.label),
        authMode: str(row.auth_mode),
        status: str(row.status),
        capabilities:
          row.capabilities && typeof row.capabilities === "object"
            ? (row.capabilities as Record<string, unknown>)
            : {},
        secretVault: nullableStr(row.secret_vault),
        lastSuccessAt: nullableStr(row.last_success_at),
        lastError: nullableStr(row.last_error),
      })),
      consents: consents.map((row) => ({
        id: str(row.id),
        providerId: str(row.provider_id),
        consentReference: str(row.consent_reference),
        scopes: Array.isArray(row.scopes)
          ? (row.scopes as OpenBankingOverview["consents"][number]["scopes"])
          : [],
        status: str(row.status) as OpenBankingOverview["consents"][number]["status"],
        grantedAt: nullableStr(row.granted_at),
        expiryDeclared: row.expiry_declared === true,
        expiresAt: nullableStr(row.expires_at),
        revokedAt: nullableStr(row.revoked_at),
        revokedReason: nullableStr(row.revoked_reason),
        lastError: nullableStr(row.last_error),
      })),
      accounts: accounts.map((row) => {
        const cursor = cursorByAccount.get(str(row.id));
        return {
          id: str(row.id),
          consentId: str(row.consent_id),
          providerAccountId: str(row.provider_account_id),
          name: nullableStr(row.name),
          maskedIdentifier: nullableStr(row.masked_identifier),
          accountType: nullableStr(row.account_type),
          currency: nullableStr(row.currency),
          accountId: nullableStr(row.account_id),
          mappedAt: nullableStr(row.mapped_at),
          mappingReason: nullableStr(row.mapping_reason),
          lastSeenAt: str(row.last_seen_at),
          cursor: cursor ? nullableStr(cursor.cursor) : null,
          complete: cursor ? cursor.complete === true : false,
        };
      }),
      runs: runs.map((row) => {
        const session = nullableStr(row.session_id);
        const found = session === null ? undefined : sessionById.get(session);
        return {
          id: str(row.id),
          consentId: str(row.consent_id),
          providerAccountId: str(row.provider_account_id),
          sessionId: session,
          trigger: str(row.trigger),
          status: str(row.status),
          startedAt: str(row.started_at),
          finishedAt: nullableStr(row.finished_at),
          pagesRead: Number(row.pages_read ?? 0),
          itemsRead: Number(row.items_read ?? 0),
          resumeCursor: nullableStr(row.resume_cursor),
          complete: row.complete === true,
          failureCode: nullableStr(row.failure_code),
          failureMessage: nullableStr(row.failure_message),
          issues: issuesOf(row.issues),
          sessionStatus: found ? str(found.status) : null,
          committedCount: found ? Number(found.committed_count ?? 0) : 0,
        };
      }),
      balances: balances.map((row) => ({
        id: str(row.id),
        providerAccountId: str(row.provider_account_id),
        balanceType: str(row.balance_type),
        // ABSENT ≠ ZÉRO : un solde non servi reste `null` jusque dans l'écran.
        amount: nullableFiniteNumber(row.amount, "bank_balance_observations.amount"),
        currency: nullableStr(row.currency),
        observedAt: str(row.observed_at),
        retrievedAt: str(row.retrieved_at),
        issues: issuesOf(row.issues),
      })),
      observations: observations.map((row) => {
        const decision = decisionByObservation.get(str(row.id));
        return {
          id: str(row.id),
          providerAccountId: str(row.provider_account_id),
          state: str(row.state) as OpenBankingOverview["observations"][number]["state"],
          providerTransactionId: nullableStr(row.provider_transaction_id),
          operationDate: nullableStr(row.operation_date),
          valueDate: nullableStr(row.value_date),
          bookingDate: nullableStr(row.booking_date),
          amount: nullableFiniteNumber(row.amount, "bank_observed_transactions.amount"),
          currency: nullableStr(row.currency),
          label: nullableStr(row.label),
          counterparty: nullableStr(row.counterparty),
          reference: nullableStr(row.reference),
          originalAmount: nullableFiniteNumber(
            row.original_amount,
            "bank_observed_transactions.original_amount",
          ),
          originalCurrency: nullableStr(row.original_currency),
          externalKey: nullableStr(row.external_key),
          firstSeenAt: str(row.first_seen_at),
          lastSeenAt: str(row.last_seen_at),
          written: row.committed_normalized_record_id !== null,
          decision: decision
            ? (str(decision.decision) as OpenBankingOverview["observations"][number]["decision"])
            : null,
          decisionReason: decision ? nullableStr(decision.reason) : null,
          linkedTransactionId: decision ? nullableStr(decision.linked_transaction_id) : null,
          issues: issuesOf(row.issues),
        };
      }),
      candidateAccounts: candidateAccounts.map((row) => ({
        id: str(row.id),
        name: str(row.name),
        currency: str(row.currency),
        accountType: str(row.account_type),
      })),
    };
  }

  /** Enregistre l'adaptateur sandbox et ses capacités DÉCLARÉES. */
  async registerSandbox(): Promise<string> {
    const result = unwrap(
      await this.client.rpc("lfo_register_bank_provider", {
        p_user_id: this.userId,
        p_payload: {
          adapter_id: SANDBOX_PROVIDER_ID,
          adapter_version: SANDBOX_PROVIDER_VERSION,
          label: "Sandbox AIS (fixture, sans réseau)",
          // FIXTURE : aucun secret n'existe, donc aucune référence n'est enregistrée. Un
          // adaptateur réel exigerait un coffre déclaré, et la base le refuserait sans.
          auth_mode: "FIXTURE",
          capabilities: SANDBOX_CAPABILITIES,
          status: "ACTIVE",
        },
      }),
      "lfo_register_bank_provider",
    );
    return String(result);
  }

  /** Ouvre un consentement sandbox. */
  async openConsent(input: {
    providerId: string;
    consentReference: string;
    scopes: string[];
    expiresAt: string | null;
  }): Promise<string> {
    const result = unwrap(
      await this.client.rpc("lfo_open_bank_consent", {
        p_user_id: this.userId,
        p_payload: {
          provider_id: input.providerId,
          consent_reference: input.consentReference,
          scopes: input.scopes,
          status: "ACTIVE",
          // EXPIRATION NON DÉCLARÉE ≠ SANS EXPIRATION : la déclaration est explicite.
          expiry_declared: input.expiresAt !== null,
          expires_at: input.expiresAt,
        },
      }),
      "lfo_open_bank_consent",
    );
    return String(result);
  }

  /** Révoque un consentement, avec son motif. */
  async revokeConsent(consentId: string, reason: string): Promise<string> {
    const result = unwrap(
      await this.client.rpc("lfo_set_bank_consent_status", {
        p_user_id: this.userId,
        p_payload: { consent_id: consentId, status: "REVOKED", reason },
      }),
      "lfo_set_bank_consent_status",
    );
    return String(result);
  }

  /** Lit les comptes du fournisseur et les enregistre, sans en rattacher aucun. */
  async discoverAccounts(consentId: string, scenario: SandboxScenario): Promise<number> {
    const consent = unwrap(
      await this.client
        .from("bank_consents")
        .select("id, consent_reference, provider_id, bank_providers!inner(adapter_id)")
        .eq("user_id", this.userId)
        .eq("id", consentId)
        .maybeSingle(),
      "lecture bank_consents",
    ) as Row;
    const adapterId = str(
      (consent.bank_providers as Row | undefined)?.adapter_id ?? SANDBOX_PROVIDER_ID,
    );
    const provider = resolveProvider(adapterId, scenario);
    const context: BankSyncContext = {
      consentReference: str(consent.consent_reference),
      // FIXTURE : la référence est nommée et vide de valeur. Aucun secret ne traverse ici.
      secret: { vault: "FIXTURE", key: adapterId },
      now: new Date(),
    };
    const accounts = await provider.listAccounts(context);
    if (!accounts.ok) throw new Error(accounts.failure.message);

    const result = unwrap(
      await this.client.rpc("lfo_sync_bank_accounts", {
        p_user_id: this.userId,
        p_payload: {
          consent_id: consentId,
          accounts: accounts.value.map((account) => ({
            provider_account_id: account.providerAccountId,
            provider_institution_id: account.providerInstitutionId,
            institution_name: account.providerInstitutionId,
            name: account.name,
            masked_identifier: account.maskedIdentifier,
            account_type: account.accountType,
            currency: account.currency,
          })),
        },
      }),
      "lfo_sync_bank_accounts",
    );
    return Number(result);
  }

  /** Rattache ou détache un compte fournisseur. */
  async mapAccount(input: {
    providerAccountId: string;
    accountId: string | null;
    reason: string | null;
  }): Promise<string> {
    const result = unwrap(
      await this.client.rpc("lfo_map_bank_account", {
        p_user_id: this.userId,
        p_payload: {
          provider_account_id: input.providerAccountId,
          account_id: input.accountId,
          reason: input.reason,
        },
      }),
      "lfo_map_bank_account",
    );
    return String(result);
  }

  /**
   * Synchronise un compte : pagination, reprise, rejeu, observations et staging.
   *
   * AUCUN fait canonique n'est écrit ici. La synchronisation produit un PREVIEW ; la
   * validation est un acte distinct.
   */
  async synchronize(input: {
    providerAccountId: string;
    trigger: "MANUAL" | "WEBHOOK" | "SCHEDULED";
    scenario: SandboxScenario;
  }): Promise<BankSyncPreview> {
    const account = unwrap(
      await this.client
        .from("bank_provider_accounts")
        .select(
          "id, consent_id, provider_account_id, account_id, currency, bank_consents!inner(consent_reference, provider_id, bank_providers!inner(adapter_id, capabilities))",
        )
        .eq("user_id", this.userId)
        .eq("id", input.providerAccountId)
        .maybeSingle(),
      "lecture bank_provider_accounts",
    ) as Row;
    const consent = account.bank_consents as Row;
    const providerRow = consent.bank_providers as Row;
    const adapterId = str(providerRow.adapter_id);
    const provider = resolveProvider(adapterId, input.scenario);
    const stableTransactionIds = provider.capabilities.stableTransactionIds;

    const runId = String(
      unwrap(
        await this.client.rpc("lfo_open_bank_sync_run", {
          p_user_id: this.userId,
          p_payload: {
            provider_account_id: input.providerAccountId,
            trigger: input.trigger,
            observation_date: observationDate(),
            stable_transaction_id_declared: stableTransactionIds,
          },
        }),
        "lfo_open_bank_sync_run",
      ),
    );

    try {
      return await this.runSynchronization({
        runId,
        provider,
        account,
        consentReference: str(consent.consent_reference),
        adapterId,
        stableTransactionIds,
      });
    } catch (error) {
      // Un échec NOMME sa cause et CONSERVE son curseur : la reprise ne relit pas ce qui a
      // déjà été écrit, et le diagnostic reste possible.
      await this.client.rpc("lfo_fail_bank_sync_run", {
        p_user_id: this.userId,
        p_payload: {
          run_id: runId,
          failure_code: "SERVER_ERROR",
          failure_message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  private async runSynchronization(input: {
    runId: string;
    provider: BankDataProvider;
    account: Row;
    consentReference: string;
    adapterId: string;
    stableTransactionIds: boolean;
  }): Promise<BankSyncPreview> {
    const { runId, provider, account } = input;
    const providerAccountRowId = str(account.id);
    const providerAccountKey = str(account.provider_account_id);
    const canonicalAccountId = nullableStr(account.account_id);

    const context: BankSyncContext = {
      consentReference: input.consentReference,
      secret: { vault: "FIXTURE", key: input.adapterId },
      now: new Date(),
    };

    // Curseur de reprise et pages déjà connues : une page rejouée est SIGNALÉE et non
    // recomptée, un curseur persisté évite de relire ce qui est écrit.
    const cursorRow = unwrap(
      await this.client
        .from("bank_sync_cursors")
        .select("cursor, checkpoint_page_number")
        .eq("user_id", this.userId)
        .eq("provider_account_id", providerAccountRowId)
        .maybeSingle(),
      "lecture bank_sync_cursors",
    ) as Row | null;
    const knownPages = unwrap(
      await this.client
        .from("bank_sync_raw_pages")
        .select("payload_hash")
        .eq("user_id", this.userId)
        .eq("provider_account_id", providerAccountRowId),
      "lecture bank_sync_raw_pages",
    ) as Row[];

    const outcome = await readAllTransactionPages<ProviderTransaction>({
      context,
      startCursor: cursorRow ? nullableStr(cursorRow.cursor) : null,
      knownPayloadHashes: new Set(knownPages.map((row) => str(row.payload_hash))),
      // La numérotation des pages est CONTINUE dans la session : elle repart du checkpoint.
      lastPageNumber: 0,
      fetchPage: (cursor) => provider.listTransactions(context, providerAccountKey, cursor),
    });

    const issues: BankSyncIssue[] = [...outcome.issues];
    const known = await this.knownObservations(providerAccountRowId);
    const seenExternalKeys = new Map(
      known
        .filter((entry) => entry.externalKey !== null)
        .map((entry) => [entry.externalKey as string, entry] as const),
    );

    for (const page of outcome.pages) {
      // Une page REJOUÉE n'est pas réécrite : son contenu est déjà persisté, et le
      // réenregistrer serait refusé par l'unicité de page.
      if (page.replayed) continue;

      const normalized: NormalizedObservation[] = page.items.map((transaction) =>
        normalizeObservation({
          transaction,
          capabilities: provider.capabilities,
          providerId: input.adapterId,
          accountCurrency: nullableStr(account.currency),
          mappedAccountId: canonicalAccountId,
          accountAmbiguous: false,
        }),
      );
      const identities = await this.existingIdentities(normalized);
      const existing = await this.existingTransactions(canonicalAccountId, normalized);
      const reconciled = reconcileObservations({
        observations: normalized,
        known,
        identities,
        existing,
        stableTransactionIds: input.stableTransactionIds,
      });

      await this.client
        .rpc("lfo_append_bank_sync_page", {
          p_user_id: this.userId,
          p_payload: {
            run_id: runId,
            page: {
              page_number: page.pageNumber,
              request_cursor: page.requestCursor,
              next_cursor: page.nextCursor,
              payload_hash: page.payloadHash,
              raw_payload: page.rawPayload,
              item_count: page.items.length,
            },
            rows: reconciled.map((entry, index) => ({
              raw_item: page.items[index] ?? {},
              state: entry.observation.state,
              provider_transaction_id: entry.observation.providerTransactionId,
              operation_date: entry.observation.operationDate,
              value_date: entry.observation.valueDate,
              booking_date: entry.observation.bookingDate,
              amount: entry.observation.amount,
              currency: entry.observation.currency,
              label: entry.observation.label,
              counterparty: entry.observation.counterparty,
              reference: entry.observation.reference,
              original_amount: entry.observation.originalAmount,
              original_currency: entry.observation.originalCurrency,
              match_key: entry.observation.matchKey,
              external_key: entry.observation.externalKey,
              replaces_observation_id: entry.replacesObservationId,
              status: entry.status,
              dedupe_verdict: entry.verdict,
              matched_transaction_id: entry.matchedTransactionId,
              issues: [...entry.observation.issues, ...entry.issues],
            })),
          },
        })
        .then((result) => unwrap(result, "lfo_append_bank_sync_page"));

      for (const entry of reconciled) {
        if (entry.observation.externalKey !== null) {
          seenExternalKeys.set(entry.observation.externalKey, {
            id: "",
            externalKey: entry.observation.externalKey,
            matchKey: entry.observation.matchKey,
            providerTransactionId: entry.observation.providerTransactionId,
            providerAccountId: providerAccountKey,
            operationDate: entry.observation.operationDate,
            amount: entry.observation.amount,
            currency: entry.observation.currency,
            state: entry.observation.state,
            decision: null,
            transactionId: null,
          });
        }
      }
    }

    // Les soldes sont lus après les opérations : un échec de solde ne doit pas priver
    // l'utilisateur des opérations déjà écrites.
    await this.recordBalances(runId, providerAccountRowId, providerAccountKey, provider, context);

    if (outcome.failure !== null) {
      unwrap(
        await this.client.rpc("lfo_fail_bank_sync_run", {
          p_user_id: this.userId,
          p_payload: {
            run_id: runId,
            failure_code: outcome.failure.code,
            failure_message: outcome.failure.message,
            resume_cursor: outcome.resumeCursor,
            issues,
          },
        }),
        "lfo_fail_bank_sync_run",
      );
    } else {
      unwrap(
        await this.client.rpc("lfo_finalize_bank_sync_run", {
          p_user_id: this.userId,
          p_payload: { run_id: runId, complete: outcome.complete, issues },
        }),
        "lfo_finalize_bank_sync_run",
      );
    }

    return this.preview(runId);
  }

  private async recordBalances(
    runId: string,
    providerAccountRowId: string,
    providerAccountKey: string,
    provider: BankDataProvider,
    context: BankSyncContext,
  ): Promise<void> {
    const balances = await provider.listBalances(context, providerAccountKey);
    if (!balances.ok) return;
    const normalized = balances.value.map((balance) =>
      normalizeBalance(balance, provider.capabilities),
    );
    const written = normalized.filter((balance) => balance.observedAt !== null);
    if (written.length === 0) return;
    unwrap(
      await this.client.rpc("lfo_record_bank_balances", {
        p_user_id: this.userId,
        p_payload: {
          run_id: runId,
          provider_account_id: providerAccountRowId,
          balances: written.map((balance) => ({
            balance_type: balance.balanceType,
            // ABSENT ≠ ZÉRO : un solde non servi est écrit `null`.
            amount: balance.amount,
            currency: balance.currency,
            observed_at: balance.observedAt,
            issues: balance.issues,
          })),
        },
      }),
      "lfo_record_bank_balances",
    );
  }

  private async knownObservations(providerAccountRowId: string): Promise<KnownObservation[]> {
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>("bank_observed_transactions", async (from, to) =>
        this.client
          .from("bank_observed_transactions")
          .select(
            "id, external_key, match_key, provider_transaction_id, operation_date, amount, currency, state, committed_normalized_record_id",
          )
          .eq("user_id", this.userId)
          .eq("provider_account_id", providerAccountRowId)
          .order("created_at", { ascending: true })
          .range(from, to),
      ),
      "lecture bank_observed_transactions",
    );
    const decisions = unwrap(
      await this.client
        .from("bank_reconciliation_decisions")
        .select("observation_id, decision, linked_transaction_id")
        .eq("user_id", this.userId),
      "lecture bank_reconciliation_decisions",
    ) as Row[];
    const decisionByObservation = new Map(
      decisions.map((row) => [str(row.observation_id), row] as const),
    );

    const links = unwrap(
      await this.client
        .from("import_record_links")
        .select("normalized_record_id, transaction_id")
        .eq("user_id", this.userId)
        .eq("target_domain", "CASH_FLOW_TRANSACTION"),
      "lecture import_record_links",
    ) as Row[];
    const transactionByRecord = new Map(
      links
        .filter((row) => row.normalized_record_id !== null)
        .map((row) => [str(row.normalized_record_id), str(row.transaction_id)] as const),
    );

    return rows.map((row) => {
      const decision = decisionByObservation.get(str(row.id));
      const committedRecord = nullableStr(row.committed_normalized_record_id);
      const producedTransaction =
        committedRecord === null ? null : (transactionByRecord.get(committedRecord) ?? null);
      return {
        id: str(row.id),
        externalKey: nullableStr(row.external_key),
        matchKey: nullableStr(row.match_key),
        providerTransactionId: nullableStr(row.provider_transaction_id),
        providerAccountId: providerAccountRowId,
        operationDate: nullableStr(row.operation_date),
        amount: nullableFiniteNumber(row.amount, "bank_observed_transactions.amount"),
        currency: nullableStr(row.currency),
        state: str(row.state),
        decision: decision ? (str(decision.decision) as KnownObservation["decision"]) : null,
        transactionId:
          producedTransaction ?? (decision ? nullableStr(decision.linked_transaction_id) : null),
      };
    });
  }

  /**
   * Identités canoniques déjà écrites, sur TOUT l'historique et sans filtre de date.
   *
   * Borner cette recherche à une fenêtre ferait annoncer « nouvelle » une opération que
   * l'index unique du staging refuserait ensuite, et tout le commit échouerait.
   */
  private async existingIdentities(
    observations: readonly NormalizedObservation[],
  ): Promise<ExistingIdentity[]> {
    const keys = observations
      .map((observation) => observation.externalKey)
      .filter((value): value is string => value !== null);
    if (keys.length === 0) return [];
    const rows = unwrap(
      await this.client
        .from("import_normalized_records")
        .select("external_key, import_record_links!inner(transaction_id)")
        .eq("user_id", this.userId)
        .eq("commit_state", "COMMITTED")
        .in("external_key", keys),
      "lecture identités canoniques",
    ) as Row[];
    return rows
      .map((row) => {
        const link = row.import_record_links as Row | Row[] | undefined;
        const transactionId = Array.isArray(link)
          ? nullableStr(link[0]?.transaction_id)
          : nullableStr(link?.transaction_id);
        return transactionId === null
          ? null
          : { externalKey: str(row.external_key), transactionId };
      })
      .filter((entry): entry is ExistingIdentity => entry !== null);
  }

  /** Transactions canoniques du VOISINAGE, pour la RESSEMBLANCE seule. */
  private async existingTransactions(
    accountId: string | null,
    observations: readonly NormalizedObservation[],
  ): Promise<ExistingTransactionFact[]> {
    if (accountId === null) return [];
    const dates = observations
      .map((observation) => observation.operationDate)
      .filter((value): value is string => value !== null)
      .sort();
    if (dates.length === 0) return [];
    const rows = unwrap(
      await readAllPages<Row, PostgrestError>("transactions", async (from, to) =>
        this.client
          .from("transactions")
          .select("id, account_id, transaction_date, label, amount, currency")
          .eq("user_id", this.userId)
          .eq("account_id", accountId)
          .gte("transaction_date", shiftDate(dates[0], -DEDUPE_MARGIN_DAYS))
          .lte("transaction_date", shiftDate(dates[dates.length - 1], DEDUPE_MARGIN_DAYS))
          .order("transaction_date", { ascending: true })
          .range(from, to),
      ),
      "lecture transactions",
    );
    return rows.map((row) => ({
      id: str(row.id),
      accountId: str(row.account_id),
      date: str(row.transaction_date),
      label: str(row.label),
      amount: Number(row.amount ?? 0),
      currency: str(row.currency),
    }));
  }

  /** Preview d'une exécution : ce que l'écran présente avant toute décision. */
  async preview(runId: string): Promise<BankSyncPreview> {
    const run = unwrap(
      await this.client
        .from("bank_sync_runs")
        .select(
          "id, session_id, provider_account_id, status, complete, pages_read, resume_cursor, failure_code, failure_message, issues",
        )
        .eq("user_id", this.userId)
        .eq("id", runId)
        .maybeSingle(),
      "lecture bank_sync_runs",
    ) as Row;
    const sessionId = nullableStr(run.session_id);
    if (sessionId === null) throw new Error("Exécution sans session d'acquisition");

    const session = unwrap(
      await this.client
        .from("import_sessions")
        .select(
          "id, status, row_count, ready_count, warning_count, blocked_count, duplicate_count, ignored_count, observed_period_start, observed_period_end",
        )
        .eq("user_id", this.userId)
        .eq("id", sessionId)
        .maybeSingle(),
      "lecture import_sessions",
    ) as Row;

    const rows = unwrap(
      await this.client
        .from("import_normalized_records")
        .select(
          "id, transaction_date, label, amount, currency, counterparty, reference, status, dedupe_verdict, matched_transaction_id, commit_state, issues, external_key, external_transaction_id, import_raw_records!inner(row_number)",
        )
        .eq("user_id", this.userId)
        .eq("session_id", sessionId)
        .order("created_at", { ascending: true })
        .limit(PREVIEW_ROW_LIMIT),
      "lecture import_normalized_records",
    ) as Row[];

    const observations = unwrap(
      await this.client
        .from("bank_observed_transactions")
        .select("id, external_key, provider_transaction_id")
        .eq("user_id", this.userId)
        .eq("provider_account_id", str(run.provider_account_id)),
      "lecture bank_observed_transactions",
    ) as Row[];
    const observationByKey = new Map<string, string>();
    for (const observation of observations) {
      const key = nullableStr(observation.external_key);
      if (key !== null) observationByKey.set(`key:${key}`, str(observation.id));
      const providerId = nullableStr(observation.provider_transaction_id);
      if (providerId !== null) observationByKey.set(`ptx:${providerId}`, str(observation.id));
    }

    const previewRows: BankSyncPreviewRow[] = rows.map((row) => {
      const raw = row.import_raw_records as Row | Row[] | undefined;
      const rowNumber = Array.isArray(raw)
        ? Number(raw[0]?.row_number ?? 0)
        : Number(raw?.row_number ?? 0);
      const externalKey = nullableStr(row.external_key);
      const providerTransactionId = nullableStr(row.external_transaction_id);
      const observationId =
        (externalKey !== null ? observationByKey.get(`key:${externalKey}`) : undefined) ??
        (providerTransactionId !== null
          ? observationByKey.get(`ptx:${providerTransactionId}`)
          : undefined) ??
        null;
      return {
        id: str(row.id),
        rowNumber,
        transactionDate: nullableStr(row.transaction_date),
        label: nullableStr(row.label),
        amount: nullableFiniteNumber(row.amount, "import_normalized_records.amount"),
        currency: nullableStr(row.currency),
        counterparty: nullableStr(row.counterparty),
        reference: nullableStr(row.reference),
        status: str(row.status) as BankSyncPreviewRow["status"],
        dedupeVerdict: (nullableStr(row.dedupe_verdict) ??
          null) as BankSyncPreviewRow["dedupeVerdict"],
        matchedTransactionId: nullableStr(row.matched_transaction_id),
        commitState: str(row.commit_state),
        issues: issuesOf(row.issues),
        observationId,
      };
    });

    return {
      runId,
      sessionId,
      providerAccountId: str(run.provider_account_id),
      status: str(run.status),
      complete: run.complete === true,
      pagesRead: Number(run.pages_read ?? 0),
      rowCount: Number(session.row_count ?? 0),
      readyCount: Number(session.ready_count ?? 0),
      warningCount: Number(session.warning_count ?? 0),
      blockedCount: Number(session.blocked_count ?? 0),
      duplicateCount: Number(session.duplicate_count ?? 0),
      ignoredCount: Number(session.ignored_count ?? 0),
      observedPeriodStart: nullableStr(session.observed_period_start),
      observedPeriodEnd: nullableStr(session.observed_period_end),
      resumeCursor: nullableStr(run.resume_cursor),
      failureCode: nullableStr(run.failure_code),
      failureMessage: nullableStr(run.failure_message),
      issues: issuesOf(run.issues),
      rows: previewRows,
      totalRows: Number(session.row_count ?? 0),
    };
  }

  /** Enregistre une décision humaine de réconciliation. */
  async decide(input: {
    observationId: string;
    decision: "ACCEPT_NEW" | "LINK_EXISTING" | "REFUSE";
    linkedTransactionId: string | null;
    reason: string | null;
    sessionId: string | null;
  }): Promise<number> {
    const result = unwrap(
      await this.client.rpc("lfo_decide_bank_reconciliation", {
        p_user_id: this.userId,
        p_payload: {
          observation_id: input.observationId,
          decision: input.decision,
          linked_transaction_id: input.linkedTransactionId,
          reason: input.reason,
          session_id: input.sessionId,
        },
      }),
      "lfo_decide_bank_reconciliation",
    );
    return Number(result);
  }

  /** Valide une session : seul endroit qui écrit des faits canoniques. */
  async commit(sessionId: string, includeRecordIds: string[]): Promise<BankSyncCommitResult> {
    const result = unwrap(
      await this.client.rpc("lfo_commit_bank_sync_session", {
        p_user_id: this.userId,
        p_payload: { session_id: sessionId, include_record_ids: includeRecordIds },
      }),
      "lfo_commit_bank_sync_session",
    );
    return { sessionId, committed: Number(result) };
  }

  /** Enregistre une notification. Le rejeu est refusé par la BASE, pas par ce code. */
  async recordEvent(input: {
    providerId: string;
    consentId: string | null;
    providerEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    signatureVerified: boolean;
  }): Promise<string> {
    const result = unwrap(
      await this.client.rpc("lfo_record_bank_sync_event", {
        p_user_id: this.userId,
        p_payload: {
          provider_id: input.providerId,
          consent_id: input.consentId,
          provider_event_id: input.providerEventId,
          event_type: input.eventType,
          payload: input.payload,
          signature_verified: input.signatureVerified,
        },
      }),
      "lfo_record_bank_sync_event",
    );
    return String(result);
  }
}

let repository: OpenBankingRepository | undefined;

export function getOpenBankingRepository(): OpenBankingRepository {
  if (!repository) repository = new OpenBankingRepository();
  return repository;
}
