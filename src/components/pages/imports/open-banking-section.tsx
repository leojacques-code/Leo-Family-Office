"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, RefreshCw, ShieldOff, Unplug } from "lucide-react";

import type { BankSyncPreview, OpenBankingOverview } from "@/lib/data/open-banking-contracts";

/**
 * OPEN BANKING (AIS) — ÉCRAN DE LECTURE SEULE
 *
 * Aucune formule financière ici, aucune valeur devinée. Un solde absent s'affiche comme
 * absent, une observation en attente est décochée par défaut, une opération annulée n'est
 * jamais cochable, et un rattachement de compte se DÉCIDE.
 *
 * Il n'existe dans cet écran aucun bouton d'ordre de paiement, de virement ou de mandat :
 * la route n'expose aucune action de ce genre.
 */

const SCENARIO_LABELS: Record<string, string> = {
  NOMINAL: "Nominal — 3 pages dont une VIDE au milieu",
  PENDING_THEN_BOOKED: "En attente puis comptabilisée (remplacement déclaré)",
  CORRECTED_AND_CANCELLED: "Corrigée et annulée par la banque",
  FOREIGN_CURRENCY: "Devise étrangère et opération convertie",
  MISSING_FIELDS: "Champs manquants (montant, date, libellé, devise, identifiant)",
  UNSTABLE_IDS: "Identifiants NON déclarés stables",
  RATE_LIMITED: "Quota dépassé (429) puis succès",
  SERVER_ERROR: "Erreur serveur persistante (5xx)",
  CONSENT_REVOKED: "Consentement révoqué côté fournisseur",
  UNAUTHORIZED: "Jeton refusé (401)",
  STUCK_CURSOR: "Curseur qui ne progresse pas (boucle)",
};

const SCENARIOS = Object.keys(SCENARIO_LABELS);

const STATUS_LABELS: Record<string, string> = {
  READY: "Prête",
  WARNING: "Signalée",
  BLOCKED: "Bloquée",
  DUPLICATE: "Doublon",
  IGNORED: "Ignorée",
};

function amountLabel(amount: number | null, currency: string | null): string {
  // ABSENT ≠ ZÉRO : un montant non servi ne s'affiche jamais « 0 ».
  if (amount === null) return "non servi";
  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === null ? `${formatted} (devise inconnue)` : `${formatted} ${currency}`;
}

export default function OpenBankingSection({ refresh }: { refresh: () => void }) {
  const [overview, setOverview] = useState<OpenBankingOverview | null>(null);
  const [preview, setPreview] = useState<BankSyncPreview | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [scenario, setScenario] = useState<string>("NOMINAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Aucun `setState` AVANT le premier `await` : appelée depuis un effet, une mise à jour
  // synchrone déclencherait une cascade de rendus.
  const load = useCallback(async () => {
    const response = await fetch("/api/imports/open-banking", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Lecture impossible");
      return;
    }
    setError(null);
    setOverview(payload as OpenBankingOverview);
  }, []);

  // Même forme que le chargement de l'historique d'imports de cette page : la mise à jour
  // n'a lieu qu'APRÈS l'attente, et un démontage l'annule.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/imports/open-banking", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (cancelled) return;
      if (!response.ok) {
        setError(payload.error ?? "Lecture impossible");
        return;
      }
      setOverview(payload as OpenBankingOverview);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const command = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch("/api/imports/open-banking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok) {
          setError(payload.error ?? "Commande impossible");
          return null;
        }
        return payload as Record<string, unknown>;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Commande impossible");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const provider = overview?.providers.find((entry) => entry.adapterId === "sandbox-ais") ?? null;
  const consent = useMemo(
    () =>
      overview?.consents.find(
        (entry) =>
          provider !== null && entry.providerId === provider.id && entry.status === "ACTIVE",
      ) ?? null,
    [overview, provider],
  );
  const accounts = overview?.accounts ?? [];
  const runs = overview?.runs ?? [];

  const committable = preview
    ? preview.rows.filter((row) => row.status === "READY").length + included.size
    : 0;

  async function registerAndConsent() {
    const registered = await command({ action: "register-sandbox" });
    if (registered === null) return;
    const providerId = String(registered.providerId);
    // Expiration DÉCLARÉE à 90 jours : une absence de déclaration serait enregistrée comme
    // telle, jamais comme « sans expiration ».
    const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const opened = await command({
      action: "open-consent",
      providerId,
      consentReference: `sandbox-${Date.now()}`,
      scopes: ["ACCOUNTS", "BALANCES", "TRANSACTIONS"],
      expiresAt,
    });
    if (opened === null) return;
    await command({
      action: "discover-accounts",
      consentId: String(opened.consentId),
      scenario,
    });
    setNotice("Consentement sandbox actif. Les comptes sont observés, aucun n'est rattaché.");
    await load();
  }

  async function mapAccount(providerAccountId: string, accountId: string | null) {
    const result = await command({
      action: "map-account",
      providerAccountId,
      accountId,
      reason:
        accountId === null ? "Détachement demandé" : "Rattachement confirmé par l'utilisateur",
    });
    if (result === null) return;
    await load();
    refresh();
  }

  async function synchronize(providerAccountId: string) {
    const result = await command({
      action: "synchronize",
      providerAccountId,
      trigger: "MANUAL",
      scenario,
    });
    if (result === null) return;
    const next = result.preview as BankSyncPreview;
    setPreview(next);
    setIncluded(new Set());
    await load();
  }

  async function decide(
    observationId: string,
    decision: "ACCEPT_NEW" | "LINK_EXISTING" | "REFUSE",
    linkedTransactionId: string | null,
    reason: string | null,
  ) {
    const result = await command({
      action: "decide",
      observationId,
      decision,
      linkedTransactionId,
      reason,
      sessionId: preview?.sessionId ?? null,
    });
    if (result === null) return;
    if (preview !== null) {
      const refreshed = await fetch(`/api/imports/open-banking?run=${preview.runId}`, {
        cache: "no-store",
      });
      const payload = await refreshed.json();
      if (refreshed.ok) setPreview(payload.preview as BankSyncPreview);
    }
    await load();
  }

  async function commit() {
    if (preview === null) return;
    const result = await command({
      action: "commit",
      sessionId: preview.sessionId,
      includeRecordIds: [...included],
    });
    if (result === null) return;
    setNotice(`${result.committed} opération(s) écrite(s) au Cash Flow.`);
    setPreview(null);
    setIncluded(new Set());
    await load();
    refresh();
  }

  async function replayEvent() {
    if (provider === null) return;
    const first = await command({
      action: "record-event",
      providerId: provider.id,
      consentId: consent?.id ?? null,
      providerEventId: "evt-demo",
      eventType: "TRANSACTIONS_UPDATED",
      payload: { accounts: ["pa-1"] },
      signatureVerified: true,
    });
    if (first === null) return;
    // Le REJEU est refusé par la BASE, pas par ce composant : c'est ce refus qui protège.
    const replay = await fetch("/api/imports/open-banking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record-event",
        providerId: provider.id,
        consentId: consent?.id ?? null,
        providerEventId: "evt-demo",
        eventType: "TRANSACTIONS_UPDATED",
        payload: {},
        signatureVerified: true,
      }),
    });
    setNotice(
      replay.ok
        ? "Événement enregistré. Le rejeu n'a pas été refusé : à vérifier."
        : "Événement enregistré une seule fois : le rejeu a été REFUSÉ par la base.",
    );
    await load();
  }

  return (
    <section className="page-stack">
      <div className="panel">
        <h2>Connexion bancaire (agrégation, lecture seule)</h2>
        <p>
          Un agrégateur LIT les comptes. Aucune initiation de paiement n’existe dans ce module : ni
          virement, ni prélèvement, ni mandat. Une opération lue est une{" "}
          <strong>observation</strong>, jamais un fait du patrimoine : rien n’entre au Cash Flow
          sans votre validation.
        </p>
        <p>
          Aucun agrégateur réel n’est implémenté : sans contrat ni identifiants, un adaptateur écrit
          de mémoire serait un faux support. Le fournisseur <strong>sandbox</strong> couvre la
          chaîne complète sans réseau.
        </p>

        <label className="field-label" htmlFor="ob-scenario">
          Scénario sandbox
        </label>
        <select
          id="ob-scenario"
          className="text-input"
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
        >
          {SCENARIOS.map((name) => (
            <option key={name} value={name}>
              {SCENARIO_LABELS[name]}
            </option>
          ))}
        </select>

        <div className="button-row">
          <button
            className="button primary"
            type="button"
            disabled={busy}
            onClick={registerAndConsent}
          >
            {busy ? "…" : "Créer un consentement sandbox"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw size={16} /> Recharger
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={busy || provider === null}
            onClick={replayEvent}
          >
            Tester le rejeu d’une notification
          </button>
        </div>

        {error ? (
          <p className="form-error">
            <AlertTriangle size={16} /> {error}
          </p>
        ) : null}
        {notice ? <p className="form-notice">{notice}</p> : null}
      </div>

      {provider !== null ? (
        <div className="panel">
          <h3>Fournisseur et consentement</h3>
          <dl className="detail-grid">
            <div>
              <dt>Adaptateur</dt>
              <dd>
                {provider.label} · {provider.adapterId} v{provider.adapterVersion}
              </dd>
            </div>
            <div>
              <dt>Authentification</dt>
              <dd>
                {provider.authMode}
                {provider.secretVault === null
                  ? " · aucune référence de secret (fixture)"
                  : ` · référence conservée dans ${provider.secretVault}`}
              </dd>
            </div>
            <div>
              <dt>Identifiants de transaction</dt>
              <dd>
                {provider.capabilities.stableTransactionIds === true
                  ? "stabilité DÉCLARÉE : la déduplication automatique est autorisée"
                  : "stabilité NON déclarée : aucune déduplication automatique"}
              </dd>
            </div>
            {consent !== null ? (
              <>
                <div>
                  <dt>Portées</dt>
                  <dd>{consent.scopes.join(", ")}</dd>
                </div>
                <div>
                  <dt>Expiration</dt>
                  <dd>
                    {consent.expiryDeclared && consent.expiresAt !== null
                      ? new Date(consent.expiresAt).toLocaleDateString("fr-FR")
                      : "non déclarée par le fournisseur (ce n’est pas « sans expiration »)"}
                  </dd>
                </div>
              </>
            ) : null}
          </dl>
          {consent !== null ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                await command({
                  action: "revoke-consent",
                  consentId: consent.id,
                  reason: "Révocation demandée depuis le cockpit",
                });
                await load();
              }}
            >
              <ShieldOff size={16} /> Révoquer le consentement
            </button>
          ) : null}
        </div>
      ) : null}

      {accounts.length > 0 ? (
        <div className="panel">
          <h3>Comptes observés chez le fournisseur</h3>
          <p>
            Un compte fournisseur n’est <strong>pas</strong> un compte du patrimoine. Aucun n’est
            créé ni rattaché d’office : tant qu’il n’est pas rattaché, ses opérations restent
            observées et non validables.
          </p>
          <div className="import-table">
            <div className="table-head">
              <span>Compte fournisseur</span>
              <span>Identifiant masqué</span>
              <span>Rattachement</span>
              <span>Curseur</span>
              <span />
            </div>
            {accounts.map((account) => (
              <div className="table-row" key={account.id}>
                <span>
                  {account.name ?? account.providerAccountId}
                  <small> · {account.currency ?? "devise inconnue"}</small>
                </span>
                <span>{account.maskedIdentifier ?? "non servi"}</span>
                <span>
                  <select
                    className="text-input"
                    value={account.accountId ?? ""}
                    onChange={(event) =>
                      void mapAccount(
                        account.id,
                        event.target.value === "" ? null : event.target.value,
                      )
                    }
                  >
                    <option value="">Non rattaché</option>
                    {(overview?.candidateAccounts ?? []).map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} ({candidate.currency})
                      </option>
                    ))}
                  </select>
                </span>
                <span>
                  {account.cursor === null
                    ? account.complete
                      ? "pagination terminée"
                      : "jamais synchronisé"
                    : `reprise à ${account.cursor}`}
                </span>
                <span>
                  <button
                    className="button primary"
                    type="button"
                    disabled={busy || account.accountId === null}
                    onClick={() => void synchronize(account.id)}
                  >
                    <RefreshCw size={16} /> Synchroniser
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview !== null ? (
        <div className="panel">
          <h3>Résultat de la synchronisation</h3>
          <p>
            {preview.pagesRead} page(s) lue(s) ·{" "}
            {preview.complete
              ? "pagination terminée, telle que le fournisseur l’a déclarée"
              : "pagination INCOMPLÈTE : la reprise partira du curseur conservé"}
          </p>
          {preview.failureCode !== null ? (
            <p className="form-error">
              <AlertTriangle size={16} /> {preview.failureCode} · {preview.failureMessage}
              {preview.resumeCursor !== null
                ? ` · reprise possible à ${preview.resumeCursor}`
                : null}
            </p>
          ) : null}
          <ul className="count-list">
            <li>{preview.readyCount} prête(s)</li>
            <li>{preview.warningCount} signalée(s)</li>
            <li>{preview.blockedCount} bloquée(s)</li>
            <li>{preview.duplicateCount} doublon(s)</li>
            <li>{preview.ignoredCount} ignorée(s)</li>
          </ul>
          {preview.issues.length > 0 ? (
            <ul className="issue-list">
              {preview.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>
                  <strong>{issue.code}</strong> · {issue.message}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="import-table">
            <div className="table-head">
              <span>Ligne</span>
              <span>Date d’opération</span>
              <span>Libellé</span>
              <span>Montant</span>
              <span>État</span>
              <span>Décision</span>
            </div>
            {preview.rows.map((row) => (
              <div className="table-row" key={row.id}>
                <span>{row.rowNumber}</span>
                <span>{row.transactionDate ?? "absente"}</span>
                <span>
                  {row.label ?? "absent"}
                  {row.issues.length > 0 ? (
                    <small>{row.issues.map((issue) => issue.code).join(" · ")}</small>
                  ) : null}
                </span>
                <span>{amountLabel(row.amount, row.currency)}</span>
                <span>
                  {STATUS_LABELS[row.status] ?? row.status}
                  {row.dedupeVerdict !== null ? <small>{row.dedupeVerdict}</small> : null}
                </span>
                <span>
                  {row.status === "WARNING" ? (
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={included.has(row.id)}
                        onChange={(event) => {
                          const next = new Set(included);
                          if (event.target.checked) next.add(row.id);
                          else next.delete(row.id);
                          setIncluded(next);
                        }}
                      />
                      Inclure
                    </label>
                  ) : null}
                  {row.observationId !== null && row.status !== "BLOCKED" ? (
                    <button
                      className="button ghost"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void decide(
                          row.observationId as string,
                          "REFUSE",
                          null,
                          "Refusée depuis le rapport de synchronisation",
                        )
                      }
                    >
                      <Unplug size={14} /> Refuser
                    </button>
                  ) : null}
                  {row.observationId !== null && row.matchedTransactionId !== null ? (
                    <button
                      className="button ghost"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void decide(
                          row.observationId as string,
                          "LINK_EXISTING",
                          row.matchedTransactionId,
                          "Rattachée à l’opération déjà connue",
                        )
                      }
                    >
                      <Link2 size={14} /> Rattacher
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>

          <button
            className="button primary"
            type="button"
            disabled={busy || committable === 0}
            onClick={commit}
          >
            {busy ? "Écriture…" : `Écrire ${committable} opération(s) au Cash Flow`}
          </button>
        </div>
      ) : null}

      {(overview?.balances.length ?? 0) > 0 ? (
        <div className="panel">
          <h3>Soldes observés</h3>
          <p>
            Un solde disponible n’est pas un solde comptable : ils ne s’additionnent pas. Un solde
            non servi par le fournisseur reste <strong>absent</strong>, jamais zéro.
          </p>
          <div className="import-table">
            <div className="table-head">
              <span>Nature</span>
              <span>Montant</span>
              <span>Arrêté au</span>
              <span>Lu le</span>
            </div>
            {(overview?.balances ?? []).map((balance) => (
              <div className="table-row" key={balance.id}>
                <span>{balance.balanceType}</span>
                <span>{amountLabel(balance.amount, balance.currency)}</span>
                <span>{balance.observedAt}</span>
                <span>{new Date(balance.retrievedAt).toLocaleString("fr-FR")}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {runs.length > 0 ? (
        <div className="panel">
          <h3>Historique des synchronisations</h3>
          <div className="import-table">
            <div className="table-head">
              <span>Démarrée</span>
              <span>Déclencheur</span>
              <span>État</span>
              <span>Pages</span>
              <span>Opérations</span>
              <span>Reprise</span>
            </div>
            {runs.map((run) => (
              <div className="table-row" key={run.id}>
                <span>{new Date(run.startedAt).toLocaleString("fr-FR")}</span>
                <span>{run.trigger}</span>
                <span>
                  {run.status}
                  {run.failureCode !== null ? <small>{run.failureCode}</small> : null}
                  {run.sessionStatus !== null ? <small>session {run.sessionStatus}</small> : null}
                </span>
                <span>{run.pagesRead}</span>
                <span>
                  {run.itemsRead} lue(s) · {run.committedCount} écrite(s)
                </span>
                <span>{run.resumeCursor ?? "aucune"}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(overview?.observations.length ?? 0) > 0 ? (
        <div className="panel">
          <h3>Observations conservées</h3>
          <p>
            Une observation est durable et transverse aux synchronisations : une opération vue en
            attente puis comptabilisée reste la <strong>même</strong> opération. Une décision prise
            n’est jamais redemandée.
          </p>
          <div className="import-table">
            <div className="table-head">
              <span>Opération</span>
              <span>Dates</span>
              <span>Montant</span>
              <span>État</span>
              <span>Décision</span>
            </div>
            {(overview?.observations ?? []).map((observation) => (
              <div className="table-row" key={observation.id}>
                <span>
                  {observation.label ?? "libellé absent"}
                  <small>{observation.providerTransactionId ?? "aucun identifiant"}</small>
                </span>
                <span>
                  opération {observation.operationDate ?? "absente"}
                  <small>
                    valeur {observation.valueDate ?? "non servie"} · comptabilisation{" "}
                    {observation.bookingDate ?? "non servie"}
                  </small>
                </span>
                <span>
                  {amountLabel(observation.amount, observation.currency)}
                  {observation.originalCurrency !== null ? (
                    <small>
                      origine{" "}
                      {amountLabel(observation.originalAmount, observation.originalCurrency)} ·
                      aucun taux déduit
                    </small>
                  ) : null}
                </span>
                <span>
                  {observation.state}
                  {observation.written ? <small>écrite au Cash Flow</small> : null}
                </span>
                <span>
                  {observation.decision ?? "en attente"}
                  {observation.decisionReason !== null ? (
                    <small>{observation.decisionReason}</small>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
