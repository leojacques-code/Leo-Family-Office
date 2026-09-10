"use client";

import { Currency, Percent } from "@/components/ui";
import { NOT_COMPUTABLE, allocationSliceLabel, issueSummary } from "@/components/pages/shared";
import type { NetWorthView } from "@/lib/presentation/net-worth-view";

/**
 * SECOND NIVEAU DU CANVAS : répartition, évolution, périmètre de détention.
 *
 * Le §21 demande, à côté du bilan visuel, « la répartition liquide, financier, immobilier,
 * entreprise et autres », « la propriété personnelle attribuable » et « l'évolution depuis une
 * clôture comparable ». Le premier est déjà dans les familles du canvas ; ces trois panneaux
 * portent le reste, sans redevenir la grille de cartes que le §29 refuse : ils sont secondaires,
 * compacts, et chacun dit ce qu'il NE couvre pas.
 */

/**
 * Composition des actifs FINANCIERS, et d'eux seuls.
 *
 * `buildCanonicalAllocation` ventile les comptes et leurs positions : c'est le KPI
 * `asset_allocation` du registre, dont le bouclage se fait sur `financialAssets`. Il ne ventile
 * NI l'immobilier NI les sociétés détenues, et le panneau le dit plutôt que de laisser croire
 * qu'il décrit tout le patrimoine.
 */
function AllocationPanel({ view, onInspect }: { view: NetWorthView; onInspect: () => void }) {
  const { allocation } = view;
  if (allocation.slices.length === 0) return null;
  const total = allocation.knownValue;
  return (
    <section aria-label="Composition des actifs financiers" className="nw-panel">
      <h3>Composition des placements</h3>
      <ul className="nw-slices">
        {allocation.slices.map((slice) => (
          <li
            className="nw-slice"
            data-unreliable={slice.unreliable ? "true" : undefined}
            key={slice.key}
          >
            <span>
              {allocationSliceLabel(slice)}
              {slice.unreliable ? " · exposition non fiable" : ""}
            </span>
            <span>
              <Currency compact value={slice.value} />
            </span>
            <span
              className="nw-slice-bar"
              // La largeur est la donnée. Un total connu nul rendrait la division absurde :
              // la tranche existe alors sans proportion à afficher.
              style={{ width: total > 0 ? `${(slice.value / total) * 100}%` : "100%" }}
            />
          </li>
        ))}
      </ul>
      <p className="nw-note">
        Cette ventilation porte sur les seuls actifs financiers. L’immobilier et les sociétés
        détenues n’y sont pas ventilés : ils apparaissent comme familles du bilan.
        {allocation.compositionStatus !== "COMPLETE"
          ? ` Ventilation partielle : ${issueSummary(allocation.blockers)}.`
          : ""}
      </p>
      <button className="button secondary" onClick={onInspect} type="button">
        Voir le bouclage
      </button>
    </section>
  );
}

/**
 * Évolution depuis la clôture, et la clôture elle-même quand elle manque.
 *
 * Le §9 refuse toute variation dont les deux clôtures ne sont pas comparables, et il n'y a rien
 * à saisir pour rendre comparables deux périmètres qui ont changé. Ce panneau ne propose donc
 * pas un écart approximatif : il dit la réserve, et il propose l'acte qui la lèverait quand
 * c'est une clôture qui manque.
 */
function CloseChangePanel({
  view,
  busy,
  onClose,
}: {
  view: NetWorthView;
  busy: boolean;
  onClose: () => void;
}) {
  const change = view.closeChange.view;
  return (
    <section aria-label="Évolution depuis la clôture" className="nw-panel">
      <h3>Évolution depuis la clôture</h3>
      {change ? (
        <>
          <p className="nw-note">
            Du {change.fromDate} au {change.toDate} :{" "}
            <strong>
              <Currency sign value={change.amount} />
            </strong>
          </p>
          {change.causes.length > 0 ? (
            <ul className="nw-slices">
              {change.causes.map((cause) => (
                <li className="nw-slice" key={cause.label}>
                  <span>{cause.label}</span>
                  <span>
                    <Currency compact sign value={cause.amount} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="nw-note">
              Aucun poste de la composition persistée n’a varié entre les deux clôtures.
            </p>
          )}
        </>
      ) : (
        <p className="nw-note">{view.closeChange.reserve}</p>
      )}
      {/* La clôture n'est proposée QUE si elle peut aboutir : la condition est celle que le
          repository applique, lue au même endroit. Un bouton actif sur un bilan incomplet
          échouerait au clic sans dire ce qui manque. */}
      {view.closeReadiness.ready ? (
        <button className="button secondary" disabled={busy} onClick={onClose} type="button">
          Arrêter le patrimoine au {view.asOfDate}
        </button>
      ) : (
        <p className="nw-note">
          Clôture impossible tant que le bilan n’est pas entièrement calculable :{" "}
          {issueSummary(view.closeReadiness.blockers)}.
        </p>
      )}
      {view.closeCount === 1 && view.closeReadiness.ready ? (
        <p className="nw-note">
          Une seule clôture existe. Une évolution en demande deux, de même périmètre et de même
          devise de reporting.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Ce que la quote-part détenue couvre, et ce qu'elle ne couvre pas.
 *
 * DÉCISION DE LA PHASE 4A, arbitrée par le propriétaire du produit : la quote-part n'existe pas
 * sur un compte financier dans le modèle de données. Elle est portée par l'immobilier et les
 * sociétés détenues, dont les contributions au bilan sont DÉJÀ pondérées. Un compte entre donc
 * en totalité, et la page le DÉCLARE — la constitution du dépôt interdit de supposer 100 %, et
 * le taire équivaudrait à le supposer sans le dire.
 */
function OwnershipPanel({ view }: { view: NetWorthView }) {
  const { ownership } = view;
  return (
    <section aria-label="Périmètre de détention" className="nw-panel">
      <h3>Détention</h3>
      {ownership.attributedFamilies.length > 0 ? (
        <p className="nw-note">
          Quote-part appliquée sur{" "}
          {ownership.attributedFamilies
            .map((id) => view.assets.find((block) => block.id === id)?.label ?? id)
            .join(" et ")}
          . Leur montant au bilan est déjà votre part.
        </p>
      ) : null}
      {ownership.unattributedLineCount > 0 ? (
        <p className="nw-note">
          {ownership.unattributedLineCount} compte(s) financier(s) entrent en totalité : le modèle
          de données ne porte pas de quote-part sur un compte. Une détention partagée n’est donc pas
          encore représentable ici.
        </p>
      ) : null}
      {ownership.undeclaredShareLineCount > 0 ? (
        <p className="nw-note">
          {ownership.undeclaredShareLineCount} ligne(s) sans quote-part déclarée : leur valeur
          attribuable reste non calculable. Elle n’est jamais supposée entière.
        </p>
      ) : null}
      <p className="nw-note">
        Liquidité immédiate :{" "}
        {view.immediateCash.value === null ? (
          <span title={issueSummary(view.immediateCash.blockers)}>{NOT_COMPUTABLE}</span>
        ) : (
          <Currency value={view.immediateCash.value} />
        )}
        {view.liquidShareOfGrossAssets.value === null ? null : (
          <>
            {" "}
            · part liquide des actifs bruts <Percent value={view.liquidShareOfGrossAssets.value} />
          </>
        )}
        . La liquidité n’est pas le patrimoine net.
      </p>
    </section>
  );
}

export function NetWorthInsights({
  view,
  busy,
  onInspectAllocation,
  onCreateClose,
}: {
  view: NetWorthView;
  busy: boolean;
  onInspectAllocation: () => void;
  onCreateClose: () => void;
}) {
  return (
    <div className="nw-secondary">
      <AllocationPanel onInspect={onInspectAllocation} view={view} />
      <CloseChangePanel busy={busy} onClose={onCreateClose} view={view} />
      <OwnershipPanel view={view} />
    </div>
  );
}
