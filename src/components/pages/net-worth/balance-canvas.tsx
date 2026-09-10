"use client";

import { Currency } from "@/components/ui";
import { NOT_COMPUTABLE, issueSummary } from "@/components/pages/shared";
import type { NetWorthBlock, NetWorthView } from "@/lib/presentation/net-worth-view";

/**
 * CANVAS DU BILAN : `ACTIFS − DETTES = PATRIMOINE NET`
 *
 * Le §10 de la spécification V10 appelle cette composition une « spatial equation », et le §21
 * du plan de refonte demande « un bilan visuel actifs / passifs / patrimoine net ». Ce n'est pas
 * une exigence esthétique : le §29 fait échouer un domaine dont « the main visual could belong
 * unchanged to another domain », ce qu'une grille de quatre cartes de KPI était exactement.
 *
 * LA SURFACE ENCODE LE MONTANT. Les deux colonnes partagent une base de proportion, sans quoi
 * une dette de 16 745 € et des actifs de 334 200 € se dessineraient à hauteur comparable. La
 * base vient du modèle de lecture ; ce composant ne calcule rien.
 *
 * UN MONTANT INCONNU N'A PAS DE HAUTEUR. Le §22 de V10 : « missing data changes geometry, not
 * just text ». Une famille sans montant convertible devient une zone DÉTOURÉE, de hauteur fixe
 * et visiblement non mesurée. Une barre à zéro dirait que le bien ne vaut rien ; un zéro
 * DÉCLARÉ, lui, garde bien une hauteur de zéro.
 */

/** Hauteur du couloir de chaque colonne, en pixels. La proportion s'y inscrit. */
const TRACK_HEIGHT = 340;
/** Hauteur minimale d'un bloc mesuré, pour que son libellé et son montant restent lisibles. */
const MIN_BLOCK_HEIGHT = 46;

function blockHeight(block: NetWorthBlock): number | null {
  if (block.weight === null) return null;
  return Math.max(MIN_BLOCK_HEIGHT, Math.round(block.weight * TRACK_HEIGHT));
}

function BalanceBlock({
  block,
  selected,
  onSelect,
}: {
  block: NetWorthBlock;
  selected: boolean;
  onSelect: (block: NetWorthBlock) => void;
}) {
  const height = blockHeight(block);
  const unknown = block.aggregate.value === null;
  return (
    <button
      aria-pressed={selected}
      className="nw-block"
      data-side={block.side}
      data-unknown={unknown ? "true" : undefined}
      onClick={() => onSelect(block)}
      // La hauteur est la donnée : elle ne peut pas vivre dans une feuille de style, qui ne
      // connaît pas le montant. Une famille non mesurée reçoit la hauteur détourée du CSS.
      style={height === null ? undefined : { height }}
      title={unknown ? issueSummary(block.aggregate.blockers) : undefined}
      type="button"
    >
      <span className="nw-block-label">{block.label}</span>
      <span className="nw-block-value">
        {unknown ? (
          <span className="nw-block-unknown">{NOT_COMPUTABLE}</span>
        ) : (
          <Currency value={block.aggregate.value} compact />
        )}
      </span>
      {/* La part n'est rendue QUE si elle est calculable : un pourcentage d'un total inconnu
          serait un chiffre sans dénominateur. */}
      {block.share === null ? null : (
        <span className="nw-block-share">{Math.round(block.share * 100)} %</span>
      )}
      {unknown && block.aggregate.knownValue > 0 ? (
        <span className="nw-block-partial">
          Connu : <Currency value={block.aggregate.knownValue} compact />
        </span>
      ) : null}
    </button>
  );
}

function BalanceColumn({
  blocks,
  heading,
  total,
  selectedId,
  onSelect,
  onSelectTotal,
  tone,
}: {
  blocks: readonly NetWorthBlock[];
  heading: string;
  total: NetWorthView["grossAssets"];
  selectedId: string | null;
  onSelect: (block: NetWorthBlock) => void;
  onSelectTotal: () => void;
  tone: "asset" | "liability";
}) {
  return (
    <div className="nw-column" data-tone={tone}>
      {/* Le nom accessible dit ce que le bouton SÉLECTIONNE. « Dettes » seul se confondait avec
          le bloc « Dettes contractuelles » : deux commandes au même nom, dont un lecteur
          d'écran ne peut pas distinguer la portée. */}
      <button
        aria-label={`Total des ${heading.toLowerCase()}`}
        className="nw-column-total"
        onClick={onSelectTotal}
        type="button"
      >
        <span className="nw-column-heading">{heading}</span>
        <strong>
          {total.value === null ? (
            <span className="nw-block-unknown" title={issueSummary(total.blockers)}>
              {NOT_COMPUTABLE}
            </span>
          ) : (
            <Currency value={total.value} />
          )}
        </strong>
      </button>
      <div className="nw-track" style={{ minHeight: TRACK_HEIGHT }}>
        {blocks.length === 0 ? (
          <p className="nw-track-empty">Aucune ligne déclarée</p>
        ) : (
          blocks.map((block) => (
            <BalanceBlock
              block={block}
              key={block.id}
              onSelect={onSelect}
              selected={selectedId === block.id}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function BalanceCanvas({
  view,
  selectedId,
  onSelectBlock,
  onSelectAssets,
  onSelectLiabilities,
  onSelectNetWorth,
}: {
  view: NetWorthView;
  selectedId: string | null;
  onSelectBlock: (block: NetWorthBlock) => void;
  onSelectAssets: () => void;
  onSelectLiabilities: () => void;
  onSelectNetWorth: () => void;
}) {
  return (
    <section aria-label="Bilan consolidé" className="nw-canvas">
      <div className="nw-equation">
        <BalanceColumn
          blocks={view.assets}
          heading="Actifs"
          onSelect={onSelectBlock}
          onSelectTotal={onSelectAssets}
          selectedId={selectedId}
          tone="asset"
          total={view.grossAssets}
        />
        <span aria-hidden="true" className="nw-operator">
          −
        </span>
        <BalanceColumn
          blocks={view.liabilities}
          heading="Dettes"
          onSelect={onSelectBlock}
          onSelectTotal={onSelectLiabilities}
          selectedId={selectedId}
          tone="liability"
          total={view.totalLiabilities}
        />
        <span aria-hidden="true" className="nw-operator">
          =
        </span>
        <button className="nw-result" onClick={onSelectNetWorth} type="button">
          <span className="nw-column-heading">Patrimoine net</span>
          <strong className="nw-result-value">
            {view.netWorth.value === null ? (
              <span className="nw-block-unknown" title={issueSummary(view.netWorth.blockers)}>
                {NOT_COMPUTABLE}
              </span>
            ) : (
              <Currency value={view.netWorth.value} />
            )}
          </strong>
          {view.closeChange.view ? (
            <span
              className="nw-result-delta"
              data-direction={view.closeChange.view.amount >= 0 ? "up" : "down"}
            >
              {view.closeChange.view.amount >= 0 ? "+" : "−"}
              <Currency value={Math.abs(view.closeChange.view.amount)} compact /> depuis le{" "}
              {view.closeChange.view.fromDate}
            </span>
          ) : (
            // Le §9 refuse toute variation dont les deux clôtures ne sont pas comparables. La
            // réserve dit pourquoi, elle ne propose pas un écart approximatif.
            <span className="nw-result-reserve">{view.closeChange.reserve}</span>
          )}
        </button>
      </div>
      {view.geometryIsPartial ? (
        <p className="nw-geometry-note">
          Les zones détourées portent un montant inconnu. Leur hauteur n’est pas mesurée : elle ne
          vaut pas zéro.
        </p>
      ) : null}
      {view.assetResidual !== 0 || view.liabilityResidual !== 0 ? (
        // Bouclage rompu : une contribution du bilan n'est pas rendue. C'est un incident de
        // composition, pas une réserve de donnée, et il se dit à l'écran plutôt qu'en silence.
        <p className="nw-residual" role="alert">
          Écart de bouclage entre les familles et le bilan canonique :{" "}
          <Currency value={view.assetResidual + view.liabilityResidual} /> à l’actif et au passif
          cumulés. Une ligne du bilan n’est pas représentée.
        </p>
      ) : null}
    </section>
  );
}
