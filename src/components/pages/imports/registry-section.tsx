"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Clock, Link2, Search } from "lucide-react";

import { Callout, EmptyState } from "@/components/ui";
import { NOT_COMPUTABLE, formatDate } from "@/components/pages/shared";
import { formatSiren } from "@/lib/acquisition/registry/siren";
import type {
  RegistryFieldSkip,
  RegistryIssue,
  RegistryProvider,
  RegistrySearchHit,
} from "@/lib/acquisition/registry/types";
import type {
  BusinessRegistryState,
  RegistryConnectionSummary,
  RegistryEntityResponse,
  RegistryEnrichmentPreview,
  RegistryProposalRow,
  RegistrySearchResponse,
} from "@/lib/data/registry-contracts";

/**
 * REGISTRE D'ENTREPRISES — écran d'acquisition et d'enrichissement.
 *
 * Cet écran ne calcule rien et n'écrit rien de lui-même : il affiche ce que le registre a
 * répondu, ce que la lecture en a compris, et propose des décisions champ par champ.
 *
 * Trois choses y sont dites explicitement, parce que les taire serait mentir par omission :
 *
 *   * « non servi par ce fournisseur » n'est PAS un vide. Un annuaire qui ne publie pas le
 *     capital social ne dit rien du capital, et l'écran l'écrit noir sur blanc ;
 *   * un instantané PÉRIMÉ reste affiché, signalé, jamais corrigé ni masqué ;
 *   * une proposition ne s'applique jamais toute seule. Le bouton « accepter » écrit un
 *     champ, un seul, et la valeur canonique d'avant est conservée.
 */

const SKIP_LABELS: Record<RegistryFieldSkip["reason"], string> = {
  CAPABILITY_NOT_SERVED: "Non servi par ce fournisseur",
  CANDIDATE_MISSING: "Non renseigné par le registre",
  ALREADY_ALIGNED: "Déjà identique",
};

const SKIP_EXPLANATIONS: Record<RegistryFieldSkip["reason"], string> = {
  CAPABILITY_NOT_SERVED:
    "Ce registre ne publie pas ce champ. Ce n'est pas une donnée manquante sur la société : c'est une limite de la source.",
  CANDIDATE_MISSING:
    "Le registre publie ce champ, mais il est vide pour cette société. L'information est donc inconnue, et sûrement pas zéro.",
  ALREADY_ALIGNED:
    "La valeur du registre et celle du cockpit désignent la même information : rien à décider.",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Connectée",
  CREDENTIALS_MISSING: "Identifiant absent",
  RATE_LIMITED: "Quota atteint",
  REAUTH_REQUIRED: "Ré-autorisation requise",
  ERROR: "En erreur",
  DISCONNECTED: "Déconnectée",
  STALE: "Observation ancienne",
  FIXTURE: "Fixtures (hors ligne)",
};

function IssueList({ issues }: { issues: RegistryIssue[] }) {
  if (issues.length === 0) return null;
  const errors = issues.filter((issue) => issue.severity === "ERROR");
  const warnings = issues.filter((issue) => issue.severity === "WARNING");
  const infos = issues.filter((issue) => issue.severity === "INFO");
  return (
    <div className="issue-list">
      {[...errors, ...warnings, ...infos].map((issue, index) => (
        <p
          key={`${issue.code}-${issue.field ?? "global"}-${index}`}
          className={issue.severity === "INFO" ? undefined : "warning-text"}
        >
          <small>
            <strong>{issue.code}</strong> {issue.message}
            {issue.sourceValue ? ` — valeur source : « ${issue.sourceValue} »` : ""}
          </small>
        </p>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="table-row">
      <span>{label}</span>
      <span>{value ?? <span className="warning-text">{NOT_COMPUTABLE}</span>}</span>
    </div>
  );
}

interface RegistrySectionProps {
  businesses: Array<{ id: string; name: string }>;
  /** Rafraîchit le cockpit : une décision acceptée modifie une société. */
  refresh: () => Promise<void>;
}

export default function RegistrySection({ businesses, refresh }: RegistrySectionProps) {
  const [connections, setConnections] = useState<RegistryConnectionSummary[] | null>(null);
  const [provider, setProvider] = useState<RegistryProvider>("RECHERCHE_ENTREPRISES");
  const [criterion, setCriterion] = useState<"text" | "siren" | "officer">("text");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<RegistrySearchResponse | null>(null);
  const [entity, setEntity] = useState<RegistryEntityResponse | null>(null);
  const [businessId, setBusinessId] = useState("");
  const [registryState, setRegistryState] = useState<BusinessRegistryState | null>(null);
  const [preview, setPreview] = useState<RegistryEnrichmentPreview | null>(null);
  const [reason, setReason] = useState("");

  const connection = useMemo(
    () => connections?.find((item) => item.provider === provider) ?? null,
    [connections, provider],
  );

  const loadConnections = useCallback(async () => {
    const response = await fetch("/api/registry?connections=1", { cache: "no-store" });
    const body = (await response.json()) as
      { connections: RegistryConnectionSummary[] } | { error: string };
    if (!response.ok || "error" in body) {
      setError("error" in body ? body.error : "Connexions illisibles");
      return;
    }
    setConnections(body.connections);
  }, []);

  const loadRegistryState = useCallback(async (id: string) => {
    if (!id) {
      setRegistryState(null);
      return;
    }
    const response = await fetch(`/api/registry?business=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as BusinessRegistryState | { error: string };
    if (!response.ok || "error" in body) {
      setError("error" in body ? body.error : "État du registre illisible");
      return;
    }
    setRegistryState(body);
  }, []);

  // Les deux chargements passent par une fonction asynchrone et un drapeau d'annulation,
  // comme le reste de la page : un état posé après un démontage déclencherait un rendu pour
  // rien, et une réponse arrivée en retard écraserait une sélection plus récente.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/registry?connections=1", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as {
        connections?: RegistryConnectionSummary[];
        error?: string;
      };
      if (cancelled) return;
      if (!response.ok) {
        setError(payload.error ?? "Connexions illisibles");
        return;
      }
      setConnections(payload.connections ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Aucune remise à zéro synchrone ici : l'état est REMPLACÉ par la sélection, et
    // l'affichage n'est rendu que pour la société réellement sélectionnée.
    if (!businessId) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/registry?business=${encodeURIComponent(businessId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as BusinessRegistryState & {
        error?: string;
      };
      if (cancelled) return;
      if (!response.ok) {
        setError(payload.error ?? "État du registre illisible");
        return;
      }
      setRegistryState(payload);
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setEntity(null);
    setPreview(null);
    try {
      const payload =
        criterion === "siren"
          ? { provider, siren: query }
          : criterion === "officer"
            ? { provider, officerName: query }
            : { provider, text: query };
      const response = await fetch("/api/registry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ search: payload }),
      });
      const body = (await response.json()) as RegistrySearchResponse | { error: string };
      if (!response.ok || "error" in body) {
        setError("error" in body ? body.error : "Recherche impossible");
        return;
      }
      setSearch(body);
      await loadConnections();
    } finally {
      setBusy(false);
    }
  }

  async function openEntity(siren: string, refreshSnapshot = false) {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch("/api/registry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lookup: { provider, siren, refresh: refreshSnapshot } }),
      });
      const body = (await response.json()) as RegistryEntityResponse | { error: string };
      if (!response.ok || "error" in body) {
        setError("error" in body ? body.error : "Fiche illisible");
        return;
      }
      setEntity(body);
      await loadConnections();
    } finally {
      setBusy(false);
    }
  }

  async function command(payload: Record<string, unknown>): Promise<unknown | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/registry", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok || typeof body.error === "string") {
        setError(typeof body.error === "string" ? body.error : "Commande refusée");
        return null;
      }
      return body;
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    if (!businessId || !entity?.profile) return;
    const result = await command({
      action: "link",
      businessId,
      provider,
      siren: entity.profile.siren,
      siret: entity.profile.headOfficeSiret,
      snapshotId: entity.snapshotId,
    });
    if (result) {
      await Promise.all([loadRegistryState(businessId), refresh()]);
    }
  }

  async function unlink(target: RegistryProvider) {
    if (!businessId) return;
    const result = await command({ action: "unlink", businessId, provider: target });
    if (result) {
      await Promise.all([loadRegistryState(businessId), refresh()]);
    }
  }

  async function propose() {
    if (!businessId || !entity) return;
    const result = (await command({
      action: "propose",
      businessId,
      snapshotId: entity.snapshotId,
    })) as RegistryEnrichmentPreview | null;
    if (result) {
      setPreview(result);
      await loadRegistryState(businessId);
    }
  }

  async function decide(rows: RegistryProposalRow[], action: "accept" | "reject") {
    if (!businessId || rows.length === 0) return;
    const result = await command({
      action: "decide",
      businessId,
      reason: reason.trim().length > 0 ? reason.trim() : null,
      decisions: rows.map((row) => ({ decisionId: row.decisionId, action })),
    });
    if (result) {
      setPreview(null);
      setReason("");
      await Promise.all([loadRegistryState(businessId), refresh()]);
    }
  }

  const openProposals = registryState?.openProposals ?? [];

  return (
    <div className="page-stack">
      {error ? (
        <Callout tone="warning" title="Registre">
          {error}
        </Callout>
      ) : null}

      <section className="panel">
        <h2>Fournisseurs déclarés</h2>
        <p>
          <small>
            Ce que chaque registre SERT est déclaré avant tout appel. Un champ absent de la liste ne
            sera jamais proposé, et l&apos;écran l&apos;écrira plutôt que d&apos;afficher un vide.
          </small>
        </p>
        {connections === null ? (
          <p>
            <small>Lecture des connexions…</small>
          </p>
        ) : (
          <div className="table">
            {connections.map((item) => (
              <div key={item.provider} className="table-row">
                <span>
                  <strong>{item.label}</strong>
                  <br />
                  <small>{STATUS_LABELS[item.status] ?? item.status}</small>
                </span>
                <span>
                  <small>
                    {item.authMode === "NONE"
                      ? "Aucun identifiant requis"
                      : item.credentialPresent
                        ? `Jeton présent (${item.credentialEnvVar})`
                        : `Jeton absent : renseignez ${item.credentialEnvVar} côté serveur`}
                  </small>
                  <br />
                  <small>
                    {item.snapshotTtlMinutes === null
                      ? "Fraîcheur non déclarée"
                      : `Fraîcheur déclarée : ${Math.round(item.snapshotTtlMinutes / 60)} h`}
                    {item.rateLimitPerMinute === null
                      ? " · quota non déclaré"
                      : ` · ${item.rateLimitPerMinute} appels/min`}
                  </small>
                </span>
                <span>
                  <small>
                    {item.unservedFields.length === 0
                      ? "Tous les champs enrichissables sont servis"
                      : `Non servi : ${item.unservedFields.map((field) => field.label).join(", ")}`}
                  </small>
                  {item.lastError ? (
                    <>
                      <br />
                      <small className="warning-text">Dernière erreur : {item.lastError}</small>
                    </>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Rechercher une entreprise</h2>
        <form className="form-grid" onSubmit={runSearch}>
          <label>
            Fournisseur
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as RegistryProvider)}
            >
              {(connections ?? []).map((item) => (
                <option key={item.provider} value={item.provider}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Critère
            <select
              value={criterion}
              onChange={(event) => setCriterion(event.target.value as "text" | "siren" | "officer")}
            >
              <option value="text">Raison sociale</option>
              <option value="siren">SIREN</option>
              <option value="officer">Dirigeant</option>
            </select>
          </label>
          <label>
            Recherche
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={criterion === "siren" ? "123 456 789" : "Nom recherché"}
              minLength={2}
              required
            />
          </label>
          <button className="button primary" type="submit" disabled={busy}>
            <Search size={16} /> Interroger
          </button>
        </form>

        {connection && connection.authMode !== "NONE" && !connection.credentialPresent ? (
          <Callout tone="warning" title="Identifiant absent">
            {`Ce fournisseur exige un jeton serveur (${connection.credentialEnvVar}). L'appel sera refusé avant toute sortie réseau, et l'échec sera conservé comme observation datée.`}
          </Callout>
        ) : null}

        {search ? (
          <>
            <p>
              <small>
                Instantané {search.snapshotId.slice(0, 8)} observé le{" "}
                {formatDate(search.observedAt.slice(0, 10))}
                {search.totalResults === null
                  ? ""
                  : ` · ${search.totalResults} résultat(s) annoncé(s)`}
              </small>
            </p>
            {search.errorCode ? (
              <Callout tone="warning" title={`Échec conservé : ${search.errorCode}`}>
                {search.errorMessage ??
                  "Le fournisseur n'a pas répondu. L'échec est un fait daté, il est persisté."}
              </Callout>
            ) : null}
            <IssueList issues={search.issues} />
            {search.hits.length === 0 ? (
              <EmptyState
                title="Aucun résultat exploitable"
                detail="La recherche a répondu, elle n'a rien trouvé. Aucune donnée n'a été inventée pour combler."
              />
            ) : (
              <div className="table">
                {search.hits.map((hit: RegistrySearchHit) => (
                  <div key={hit.siren} className="table-row">
                    <span>
                      <strong>{hit.legalName ?? "Dénomination non publiée"}</strong>
                      <br />
                      <small>
                        {formatSiren(hit.siren)}
                        {hit.city ? ` · ${hit.city}` : ""}
                        {hit.postalCode ? ` (${hit.postalCode})` : ""}
                      </small>
                    </span>
                    <span>
                      <small>
                        {hit.registryStatus === "CEASED"
                          ? "Cessée"
                          : hit.registryStatus === "ACTIVE"
                            ? "Active"
                            : "Statut inconnu"}
                        {hit.nafCode ? ` · NAF ${hit.nafCode}` : ""}
                      </small>
                      {hit.officerNames.length > 0 ? (
                        <>
                          <br />
                          <small>{hit.officerNames.join(", ")}</small>
                        </>
                      ) : null}
                    </span>
                    <span>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void openEntity(hit.siren)}
                      >
                        Ouvrir la fiche
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </section>

      {entity ? (
        <section className="panel">
          <h2>
            <Building2 size={18} /> Fiche {entity.profile ? formatSiren(entity.profile.siren) : ""}
          </h2>
          <p>
            <small>
              Observé le {formatDate(entity.observedAt.slice(0, 10))}
              {entity.reusedSnapshot
                ? " · instantané réutilisé, aucun appel supplémentaire"
                : " · appel neuf"}
              {entity.staleAfter === null
                ? " · fraîcheur non déclarée"
                : ` · périme le ${formatDate(entity.staleAfter.slice(0, 10))}`}
            </small>
          </p>

          {entity.stale ? (
            <Callout tone="warning" title="Observation périmée">
              Cet instantané a dépassé la fraîcheur déclarée du fournisseur. Il reste lisible et
              n&apos;est pas corrigé. Réinterrogez le registre avant de décider d&apos;un
              enrichissement.
            </Callout>
          ) : null}

          {entity.errorCode ? (
            <Callout tone="warning" title={`Échec conservé : ${entity.errorCode}`}>
              {entity.errorMessage ?? "Le fournisseur n'a pas répondu."}
            </Callout>
          ) : null}

          <IssueList issues={entity.issues} />

          {entity.profile ? (
            <>
              <div className="table">
                <Field label="Dénomination légale" value={entity.profile.legalName} />
                <Field label="Nom commercial" value={entity.profile.tradeName} />
                <Field
                  label="Forme juridique"
                  value={
                    entity.profile.legalFormLabel ??
                    (entity.profile.legalFormCode
                      ? `code ${entity.profile.legalFormCode} (libellé non servi)`
                      : null)
                  }
                />
                <Field
                  label="Activité"
                  value={
                    entity.profile.nafCode
                      ? `${entity.profile.nafCode}${entity.profile.nafLabel ? ` — ${entity.profile.nafLabel}` : " (libellé non servi)"}`
                      : null
                  }
                />
                <Field
                  label="Capital social"
                  value={
                    entity.profile.shareCapital === null
                      ? entity.profile.unservedCapabilities.includes("share_capital")
                        ? "Non servi par ce fournisseur"
                        : null
                      : `${new Intl.NumberFormat("fr-FR").format(entity.profile.shareCapital)} ${entity.profile.shareCapitalCurrency ?? ""}`
                  }
                />
                <Field label="Création" value={entity.profile.createdOn} />
                <Field label="Cessation" value={entity.profile.ceasedOn} />
                <Field
                  label="Siège"
                  value={
                    [entity.profile.addressLine, entity.profile.postalCode, entity.profile.city]
                      .filter(Boolean)
                      .join(" ") || null
                  }
                />
                <Field
                  label="Établissements publiés"
                  value={
                    entity.profile.establishmentCount === null
                      ? null
                      : String(entity.profile.establishmentCount)
                  }
                />
                <Field label="Greffe" value={entity.profile.greffe} />
              </div>

              {entity.profile.unservedCapabilities.length > 0 ? (
                <p>
                  <small>
                    Non publié par ce fournisseur : {entity.profile.unservedCapabilities.join(", ")}
                    . Une capacité non servie n&apos;est pas une donnée manquante, et encore moins
                    un zéro.
                  </small>
                </p>
              ) : null}

              {entity.officers.length > 0 ? (
                <>
                  <h3>Dirigeants publiés</h3>
                  <div className="table">
                    {entity.officers.map((officer, index) => (
                      <div
                        key={`${officer.lastName ?? officer.companyName ?? index}`}
                        className="table-row"
                      >
                        <span>
                          {officer.officerKind === "COMPANY"
                            ? (officer.companyName ?? "Personne morale")
                            : [officer.firstNames, officer.lastName].filter(Boolean).join(" ")}
                        </span>
                        <span>
                          <small>{officer.roleLabel ?? "Qualité non publiée"}</small>
                        </span>
                        <span>
                          <small>
                            {officer.officerKind === "COMPANY"
                              ? officer.companySiren
                                ? formatSiren(officer.companySiren)
                                : "SIREN non publié"
                              : officer.birthYear
                                ? `né(e) en ${officer.birthYear}`
                                : "Année de naissance non publiée"}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {entity.documents.length > 0 ? (
                <>
                  <h3>Dépôts disponibles chez le fournisseur</h3>
                  <p>
                    <small>
                      Métadonnée, pas fichier. Un dépôt disponible n&apos;est pas un état financier
                      lu : aucun fait Business n&apos;en découle.
                    </small>
                  </p>
                  <div className="table">
                    {entity.documents.map((document, index) => (
                      <div key={`${document.providerDocumentId ?? index}`} className="table-row">
                        <span>{document.documentKind}</span>
                        <span>
                          <small>
                            Exercice clos {document.fiscalYearEnd ?? NOT_COMPUTABLE}
                            {document.filingDate ? ` · déposé le ${document.filingDate}` : ""}
                          </small>
                        </span>
                        <span>
                          <small>
                            {document.confidentiality === "CONFIDENTIAL"
                              ? "Déclaré confidentiel"
                              : document.confidentiality === "PUBLIC"
                                ? "Public"
                                : "Confidentialité non déclarée"}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <h3>Rattacher au patrimoine</h3>
              <div className="form-grid">
                <label>
                  Société
                  <select
                    value={businessId}
                    onChange={(event) => {
                      setRegistryState(null);
                      setPreview(null);
                      setBusinessId(event.target.value);
                    }}
                  >
                    <option value="">Choisir…</option>
                    {businesses.map((business) => (
                      <option key={business.id} value={business.id}>
                        {business.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !businessId}
                  onClick={() => void link()}
                >
                  <Link2 size={16} /> Rattacher ce SIREN
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !businessId}
                  onClick={() => void propose()}
                >
                  Comparer les champs
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    if (entity.profile) void openEntity(entity.profile.siren, true);
                  }}
                >
                  <Clock size={16} /> Réinterroger
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              title="Aucun profil identifié"
              detail="Le fournisseur a répondu, mais la réponse ne portait pas d'identité exploitable. L'instantané est conservé avec son anomalie."
            />
          )}
        </section>
      ) : null}

      {preview ? (
        <section className="panel">
          <h2>Comparaison champ par champ</h2>
          <p>
            <small>
              Aucune valeur n&apos;est écrite sans votre décision. Une proposition acceptée conserve
              la valeur du cockpit d&apos;avant, et un champ que le registre ne publie pas
              n&apos;est jamais proposé : accepter un vide effacerait votre saisie.
            </small>
          </p>
          <IssueList issues={preview.issues} />

          {preview.proposals.length === 0 ? (
            <EmptyState
              title="Rien à décider"
              detail="Aucun écart proposable entre le registre et le cockpit."
            />
          ) : (
            <>
              <div className="table">
                {preview.proposals.map((row) => (
                  <div key={row.decisionId} className="table-row">
                    <span>
                      <strong>{row.label}</strong>
                      <br />
                      <small>
                        {row.displayState === "STALE"
                          ? "Observation périmée"
                          : row.state === "CONFLICT"
                            ? "Conflit : deux valeurs différentes"
                            : "Remplissage : le cockpit ne portait rien"}
                      </small>
                    </span>
                    <span>
                      <small>Cockpit</small>
                      <br />
                      {row.canonicalValueBefore ?? (
                        <span className="warning-text">{NOT_COMPUTABLE}</span>
                      )}
                    </span>
                    <span>
                      <small>Registre</small>
                      <br />
                      {row.candidateValue}
                    </span>
                    <span>
                      <button
                        type="button"
                        className="button primary"
                        disabled={busy}
                        onClick={() => void decide([row], "accept")}
                      >
                        Accepter
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void decide([row], "reject")}
                      >
                        Refuser
                      </button>
                    </span>
                  </div>
                ))}
              </div>
              <label>
                Motif de la décision
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Pourquoi cette décision (conservé dans la piste d'audit)"
                  maxLength={500}
                />
              </label>
            </>
          )}

          {preview.skipped.length > 0 ? (
            <>
              <h3>Champs non proposés</h3>
              <div className="table">
                {preview.skipped.map((skip) => (
                  <div key={skip.field} className="table-row">
                    <span>{skip.label}</span>
                    <span>
                      <small>{SKIP_LABELS[skip.reason]}</small>
                    </span>
                    <span>
                      <small>{SKIP_EXPLANATIONS[skip.reason]}</small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {businessId && registryState && registryState.businessId === businessId ? (
        <section className="panel">
          <h2>Identité légale de {registryState.businessName}</h2>
          <div className="table">
            <Field
              label="SIREN canonique"
              value={
                registryState.canonicalSiren ? formatSiren(registryState.canonicalSiren) : null
              }
            />
          </div>

          {registryState.links.length > 0 ? (
            <>
              <h3>Rattachements</h3>
              <div className="table">
                {registryState.links.map((item) => (
                  <div key={item.provider} className="table-row">
                    <span>{item.provider}</span>
                    <span>
                      <small>
                        {formatSiren(item.siren)} ·{" "}
                        {item.matchBasis === "PROVIDER_EXACT"
                          ? "confirmé par un instantané"
                          : "déclaré sans interrogation"}
                      </small>
                    </span>
                    <span>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy}
                        onClick={() => void unlink(item.provider)}
                      >
                        Détacher
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {openProposals.length > 0 ? (
            <>
              <h3>Propositions ouvertes</h3>
              <div className="table">
                {openProposals.map((row) => (
                  <div key={row.decisionId} className="table-row">
                    <span>{row.label}</span>
                    <span>
                      <small>
                        {row.canonicalValueBefore ?? "vide"} → {row.candidateValue}
                      </small>
                    </span>
                    <span>
                      <small>{row.displayState}</small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {registryState.history.length > 0 ? (
            <>
              <h3>Décisions passées</h3>
              <div className="table">
                {registryState.history.map((row) => (
                  <div key={row.decisionId} className="table-row">
                    <span>{row.field}</span>
                    <span>
                      <small>
                        {row.state === "ACCEPTED" ? "Acceptée" : "Refusée"} le{" "}
                        {formatDate(row.decidedAt.slice(0, 10))}
                      </small>
                    </span>
                    <span>
                      <small>
                        {row.canonicalValueBefore ?? "vide"} → {row.candidateValue ?? "vide"}
                        {row.decidedReason ? ` · ${row.decidedReason}` : ""}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
