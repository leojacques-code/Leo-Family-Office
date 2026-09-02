"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, Ban, Check, Info, MapPin, Search } from "lucide-react";

import { Callout, EmptyState } from "@/components/ui";
import { formatDate, NOT_COMPUTABLE } from "@/components/pages/shared";
import type {
  MatchSummary,
  PropertyPublicDataView,
  PublicDataReadResult,
  PublicDataSourceSummary,
} from "@/lib/data/public-data-contracts";

/**
 * DONNÉES PUBLIQUES IMMOBILIÈRES — écran
 *
 * Il ne calcule rien. Il rend ce que le serveur a lu et ce qu'il propose, avec ses réserves.
 *
 * Trois choses que cet écran refuse d'afficher, et ce sont des décisions de conception :
 *
 *   * un rapprochement accepté d'un clic. Accepter demande un motif écrit, parce qu'une
 *     adresse désigne un immeuble et qu'un immeuble porte autant de diagnostics que de lots ;
 *   * une estimation quand elle n'est pas calculable. Le message dit pourquoi ; il n'y a
 *     pas de chiffre à côté, parce qu'un chiffre accompagné d'un avertissement finit par
 *     être lu sans l'avertissement ;
 *   * un vide présenté comme une absence de marché. Un instantané sans résultat porte son
 *     statut de couverture, et un « hors couverture » est dit tel quel.
 */

type Mode = "DVF" | "DPE";

interface Props {
  properties: Array<{
    id: string;
    name: string;
    location: string | null;
    surfaceSqm: number | null;
  }>;
  sources: PublicDataSourceSummary[];
  refresh: () => void;
}

const CONFIDENCE_LABELS: Record<MatchSummary["matchConfidence"], string> = {
  HIGH: "Forte",
  MEDIUM: "Moyenne",
  LOW: "Faible",
};

const STATE_LABELS: Record<MatchSummary["state"], string> = {
  CANDIDATE: "À trancher",
  CONFLICT: "En conflit",
  ACCEPTED: "Accepté",
  REJECTED: "Écarté",
};

const COVERAGE_LABELS: Record<string, string> = {
  DECLARED_COVERED: "Zone déclarée couverte",
  DECLARED_NOT_COVERED: "Zone déclarée NON couverte",
  COVERAGE_UNKNOWN: "Couverture non déclarée",
};

function eur(value: number | null): string {
  if (value === null) return NOT_COMPUTABLE;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function PublicDataSection({ properties, sources, refresh }: Props) {
  const [mode, setMode] = useState<Mode>("DVF");
  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [communeCode, setCommuneCode] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [address, setAddress] = useState("");
  const [mutatedFrom, setMutatedFrom] = useState("");
  const [mutatedTo, setMutatedTo] = useState("");
  const [useFixture, setUseFixture] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<PublicDataReadResult | null>(null);
  const [view, setView] = useState<PropertyPublicDataView | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [valuedAt, setValuedAt] = useState(new Date().toISOString().slice(0, 10));

  const selected = properties.find((property) => property.id === propertyId) ?? null;
  const source = sources.find((entry) => entry.dataset === mode) ?? null;

  const loadView = useCallback(async (id: string) => {
    const response = await fetch(`/api/real-estate/public-data?property=${encodeURIComponent(id)}`);
    const payload = (await response.json()) as PropertyPublicDataView & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Lecture de l'état du bien impossible");
    setView(payload);
  }, []);

  const post = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/real-estate/public-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Commande impossible");
      return payload;
    } finally {
      setBusy(false);
    }
  }, []);

  const runFetch = useCallback(async () => {
    if (propertyId === "") {
      setError("Sélectionnez d'abord un bien");
      return;
    }
    try {
      const payload = (await post({
        action: "fetch",
        propertyId,
        dataset: mode,
        useFixture,
        communeCode: communeCode.trim() === "" ? null : communeCode.trim().toUpperCase(),
        postalCode: postalCode.trim() === "" ? null : postalCode.trim(),
        address: address.trim() === "" ? null : address.trim(),
        mutatedFrom: mutatedFrom === "" ? null : mutatedFrom,
        mutatedTo: mutatedTo === "" ? null : mutatedTo,
      })) as unknown as PublicDataReadResult;
      setResult(payload);
      await loadView(propertyId);
      setNotice(
        `Instantané enregistré : ${payload.snapshot.recordCount} enregistrement(s), ${payload.matches.length} rapprochement(s) proposé(s)`,
      );
      refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lecture impossible");
    }
  }, [
    address,
    communeCode,
    loadView,
    mode,
    mutatedFrom,
    mutatedTo,
    post,
    postalCode,
    propertyId,
    refresh,
    useFixture,
  ]);

  const decide = useCallback(
    async (matchId: string, decision: "ACCEPT" | "REJECT") => {
      const reason = (reasons[matchId] ?? "").trim();
      if (decision === "ACCEPT" && reason === "") {
        setError(
          "Accepter un rapprochement exige un motif écrit : une adresse désigne un immeuble, pas un lot",
        );
        return;
      }
      try {
        await post({ action: "decide", matchId, decision, reason: reason === "" ? null : reason });
        await loadView(propertyId);
        setNotice(decision === "ACCEPT" ? "Rapprochement accepté" : "Rapprochement écarté");
        refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Décision impossible");
      }
    },
    [loadView, post, propertyId, reasons, refresh],
  );

  const promote = useCallback(
    async (matchId: string) => {
      try {
        await post({ action: "promote", matchId, valuedAt, notes: null });
        await loadView(propertyId);
        setNotice("Estimation écrite comme valorisation datée, méthode « comparables »");
        refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Promotion impossible");
      }
    },
    [loadView, post, propertyId, refresh, valuedAt],
  );

  if (properties.length === 0) {
    return (
      <EmptyState
        title="Aucun bien immobilier"
        detail="Les données publiques se rattachent à un bien détenu. Créez d'abord un bien dans Immobilier, avec son adresse et sa surface : sans surface déclarée, aucune estimation au mètre carré ne sera calculable."
      />
    );
  }

  const openMatches = (view?.matches ?? []).filter(
    (match) => match.state === "CANDIDATE" || match.state === "CONFLICT",
  );
  const acceptedComparable = (view?.matches ?? []).find(
    (match) =>
      match.target === "COMPARABLE_SET" &&
      match.state === "ACCEPTED" &&
      match.supersededBy === null,
  );

  return (
    <div className="page-stack">
      <Callout tone="warning" title="Ce que ces jeux disent, et ce qu'ils ne disent pas">
        DVF publie les ventes d&apos;AUTRUI : un jeu de comparables n&apos;est pas la valeur de
        votre bien, et rien n&apos;est écrit au patrimoine sans votre décision. Un DPE trouvé à une
        adresse peut être celui d&apos;un autre lot du même immeuble. Un résultat vide ne signifie
        pas « aucune vente » ni « aucun diagnostic » : il peut signifier « zone non publiée ».
      </Callout>

      <div className="import-filters">
        {(
          [
            ["DVF", "Mutations (DVF)"],
            ["DPE", "Performance énergétique (DPE)"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`button ${mode === value ? "primary" : "secondary"}`}
            onClick={() => setMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {source !== null && !source.configured ? (
        <Callout tone="warning" title="Adaptateur non configuré">
          Aucun point d&apos;accès n&apos;est renseigné côté serveur pour {mode}. Une capacité non
          servie n&apos;est pas une absence de donnée : la lecture réelle est indisponible, et seule
          la fixture locale permet de parcourir l&apos;écran. Une lecture de fixture reste
          identifiable comme telle pour toujours.
        </Callout>
      ) : null}

      <section className="panel">
        <h3>
          <Search size={16} /> Interroger la source
        </h3>
        <div className="form-grid">
          <label>
            Bien concerné
            <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Code commune (INSEE)
            <input
              className="text-input"
              value={communeCode}
              maxLength={5}
              placeholder="75112"
              onChange={(event) => setCommuneCode(event.target.value)}
            />
          </label>
          <label>
            Code postal
            <input
              className="text-input"
              value={postalCode}
              maxLength={5}
              placeholder="75012"
              onChange={(event) => setPostalCode(event.target.value)}
            />
          </label>
          {mode === "DPE" ? (
            <label>
              Adresse recherchée
              <input
                className="text-input"
                value={address}
                placeholder="12 rue des Lilas"
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                Mutations depuis
                <input
                  className="text-input"
                  type="date"
                  value={mutatedFrom}
                  onChange={(event) => setMutatedFrom(event.target.value)}
                />
              </label>
              <label>
                Mutations jusqu&apos;au
                <input
                  className="text-input"
                  type="date"
                  value={mutatedTo}
                  onChange={(event) => setMutatedTo(event.target.value)}
                />
              </label>
            </>
          )}
        </div>

        {selected !== null && selected.surfaceSqm === null ? (
          <p className="panel-note warning-text">
            Ce bien n&apos;a pas de surface déclarée. Les mutations seront lues et conservées, mais
            aucune estimation au mètre carré n&apos;en sera calculable : une surface absente ne vaut
            pas zéro.
          </p>
        ) : null}
        {selected !== null && (selected.location === null || selected.location.trim() === "") ? (
          <p className="panel-note warning-text">
            Ce bien n&apos;a pas d&apos;adresse déclarée. Aucun rapprochement d&apos;adresse ne
            pourra être proposé : il ne s&apos;invente pas.
          </p>
        ) : null}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={useFixture}
            onChange={(event) => setUseFixture(event.target.checked)}
          />
          Lire une fixture locale au lieu de la source réelle
        </label>

        <div className="form-actions">
          <button
            type="button"
            className="button primary"
            disabled={busy || propertyId === ""}
            onClick={() => void runFetch()}
          >
            {busy ? "Lecture…" : "Lire la source"}
          </button>
        </div>
        <p className="panel-note">
          La lecture est enregistrée même si elle échoue : une interrogation tentée laisse toujours
          une trace, sans quoi un silence de la source serait indistinguable d&apos;un oubli.
        </p>
      </section>

      {error !== "" ? (
        <Callout tone="warning" title="Refus">
          {error}
        </Callout>
      ) : null}
      {notice !== "" ? (
        <Callout tone="success" title="Fait">
          {notice}
        </Callout>
      ) : null}

      {result !== null ? (
        <section className="panel">
          <h3>Instantané enregistré</h3>
          <dl className="detail-grid">
            <div>
              <dt>Statut</dt>
              <dd>{result.snapshot.status}</dd>
            </div>
            <div>
              <dt>Couverture</dt>
              <dd>
                {COVERAGE_LABELS[result.snapshot.coverageState] ?? result.snapshot.coverageState}
              </dd>
            </div>
            <div>
              <dt>Enregistrements</dt>
              <dd>{result.snapshot.recordCount}</dd>
            </div>
            <div>
              <dt>Lu le</dt>
              <dd>{formatDate(result.snapshot.retrievedAt)}</dd>
            </div>
            <div>
              <dt>Périmé après</dt>
              <dd>{formatDate(result.snapshot.staleAfter)}</dd>
            </div>
            <div>
              <dt>Millésime</dt>
              <dd>{result.snapshot.datasetVersion ?? "Inconnu"}</dd>
            </div>
          </dl>
          {result.snapshot.coverageNote !== null ? (
            <p className="panel-note">{result.snapshot.coverageNote}</p>
          ) : null}
          {result.snapshot.errorMessage !== null ? (
            <p className="panel-note warning-text">
              {result.snapshot.errorCode} : {result.snapshot.errorMessage}
            </p>
          ) : null}

          {result.issues.length > 0 ? (
            <div className="issue-list">
              {result.issues.slice(0, 40).map((issue, index) => (
                <small
                  key={`${issue.code}-${index}`}
                  className={issue.severity === "ERROR" ? "warning-text" : undefined}
                >
                  {issue.severity === "ERROR" ? <AlertTriangle size={13} /> : <Info size={13} />}{" "}
                  {issue.message}
                </small>
              ))}
            </div>
          ) : null}

          {result.sales.length > 0 ? (
            <div className="table-scroll">
              <table className="flat-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Prix</th>
                    <th>Surface bâtie</th>
                    <th>Lots</th>
                    <th>Prix au m²</th>
                    <th>Voie</th>
                  </tr>
                </thead>
                <tbody>
                  {result.sales.slice(0, 100).map((sale) => (
                    <tr key={sale.id}>
                      <td>{formatDate(sale.mutatedOn)}</td>
                      <td>{eur(sale.price)}</td>
                      <td>
                        {sale.builtAreaSqm === null ? NOT_COMPUTABLE : `${sale.builtAreaSqm} m²`}
                      </td>
                      <td>{sale.lotCount ?? "—"}</td>
                      <td>
                        {sale.unitPrice === null ? (
                          <span title={sale.exclusionReason ?? undefined}>{NOT_COMPUTABLE}</span>
                        ) : (
                          eur(Math.round(sale.unitPrice))
                        )}
                      </td>
                      <td>{sale.streetLabel ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {result.certificates.length > 0 ? (
            <div className="table-scroll">
              <table className="flat-table">
                <thead>
                  <tr>
                    <th>Établi le</th>
                    <th>Fin de validité</th>
                    <th>Méthode</th>
                    <th>Étiquette</th>
                    <th>GES</th>
                    <th>Surface</th>
                    <th>Adresse imprimée</th>
                  </tr>
                </thead>
                <tbody>
                  {result.certificates.slice(0, 100).map((certificate) => (
                    <tr key={certificate.id}>
                      <td>
                        {certificate.issuedOn === null
                          ? "Inconnu"
                          : formatDate(certificate.issuedOn)}
                      </td>
                      <td>
                        {certificate.validUntil === null
                          ? "Non déclarée"
                          : formatDate(certificate.validUntil)}
                      </td>
                      <td>{certificate.methodVersion ?? "Inconnue"}</td>
                      <td>{certificate.energyLabel ?? "Inconnue"}</td>
                      <td>{certificate.ghgLabel ?? "Inconnue"}</td>
                      <td>
                        {certificate.livingAreaSqm === null
                          ? "Inconnue"
                          : `${certificate.livingAreaSqm} m²`}
                      </td>
                      <td>{certificate.addressLabel ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {openMatches.length > 0 ? (
        <section className="panel">
          <h3>
            <MapPin size={16} /> Rapprochements à trancher
          </h3>
          <p className="panel-note">
            Rien n&apos;est accepté d&apos;office, quel que soit le score. Une adresse identique
            désigne un immeuble, et un immeuble porte autant de diagnostics que de lots :
            l&apos;acceptation demande un motif écrit, qui reste attaché à la décision.
          </p>
          {openMatches.map((match) => (
            <article key={match.id} className="decision-card">
              <header>
                <strong>
                  {match.target === "COMPARABLE_SET" ? "Jeu de comparables" : "Diagnostic (DPE)"}
                </strong>
                <span>
                  Score {match.matchScore === null ? NOT_COMPUTABLE : match.matchScore.toFixed(2)} ·
                  confiance {CONFIDENCE_LABELS[match.matchConfidence]} · {STATE_LABELS[match.state]}
                </span>
              </header>
              <pre className="basis-block">{JSON.stringify(match.basis, null, 2)}</pre>
              <label>
                Motif de la décision
                <input
                  className="text-input"
                  value={reasons[match.id] ?? ""}
                  placeholder="Pourquoi ce rattachement est-il le bon ?"
                  onChange={(event) =>
                    setReasons((current) => ({ ...current, [match.id]: event.target.value }))
                  }
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => void decide(match.id, "ACCEPT")}
                >
                  <Check size={15} /> Accepter
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void decide(match.id, "REJECT")}
                >
                  <Ban size={15} /> Écarter
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {view !== null ? (
        <section className="panel">
          <h3>État du bien</h3>
          <dl className="detail-grid">
            <div>
              <dt>Adresse déclarée</dt>
              <dd>{view.location ?? "Non déclarée"}</dd>
            </div>
            <div>
              <dt>Surface déclarée</dt>
              <dd>{view.surfaceSqm === null ? "Non déclarée" : `${view.surfaceSqm} m²`}</dd>
            </div>
            <div>
              <dt>Étiquette énergétique retenue</dt>
              <dd>{view.currentCertificate?.energyLabel ?? "Aucun diagnostic accepté"}</dd>
            </div>
            <div>
              <dt>Fin de validité du diagnostic</dt>
              <dd>
                {view.currentCertificate === null
                  ? "—"
                  : (view.currentCertificate.validUntil ?? "Non déclarée par la source")}
              </dd>
            </div>
          </dl>

          {view.estimate !== null ? (
            <>
              <h4>Estimation par comparables</h4>
              {view.estimate.status === "NOT_COMPUTABLE" ? (
                <Callout tone="warning" title="Estimation non calculable">
                  {view.estimate.flags
                    .filter((flag) => flag.severity === "ERROR")
                    .map((flag) => flag.message)
                    .join(" ; ") || "Les intrants nécessaires ne sont pas réunis."}
                </Callout>
              ) : (
                <dl className="detail-grid">
                  <div>
                    <dt>Valeur estimée</dt>
                    <dd>{eur(view.estimate.value)}</dd>
                  </div>
                  <div>
                    <dt>Convention</dt>
                    <dd>{view.estimate.convention}</dd>
                  </div>
                  <div>
                    <dt>Médiane au m²</dt>
                    <dd>
                      {view.estimate.distribution === null
                        ? NOT_COMPUTABLE
                        : eur(Math.round(view.estimate.distribution.median))}
                    </dd>
                  </div>
                  <div>
                    <dt>Mutations retenues</dt>
                    <dd>{view.estimate.distribution?.count ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Confiance</dt>
                    <dd>{CONFIDENCE_LABELS[view.estimate.confidence]}</dd>
                  </div>
                </dl>
              )}
              <div className="issue-list">
                {view.estimate.flags.map((flag) => (
                  <small
                    key={flag.code}
                    className={flag.severity === "ERROR" ? "warning-text" : undefined}
                  >
                    {flag.message}
                  </small>
                ))}
              </div>

              {view.estimate.status === "COMPUTED" && acceptedComparable !== undefined ? (
                <>
                  <label>
                    Date d&apos;estimation
                    <input
                      className="text-input"
                      type="date"
                      value={valuedAt}
                      onChange={(event) => setValuedAt(event.target.value)}
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy}
                      onClick={() => void promote(acceptedComparable.id)}
                    >
                      Écrire comme valorisation datée
                    </button>
                  </div>
                  <p className="panel-note">
                    La valeur écrite est une HYPOTHÈSE DE MODÈLE sous convention déclarée, pas une
                    observation : elle porte sa convention, ses intrants et l&apos;instantané qui la
                    justifie. Elle est recalculée côté serveur depuis les mutations persistées, puis
                    encadrée par la base : le chiffre affiché ici n&apos;entre pas dans la décision.
                  </p>
                </>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default PublicDataSection;
