import {
  buildCanonicalAllocation,
  canonicalBalanceSheetOf,
  canonicalMetricsOf,
  lineGroupTotal,
  monthlyCloseReadiness,
  type CanonicalAllocation,
  type MonthlyCloseReadiness,
} from "@/lib/engine/balance-sheet-view";
import type {
  CanonicalAggregate,
  CanonicalBalanceSheet,
  ConvertedBalanceSheetLine,
} from "@/lib/engine/balance-sheet";
import type { MetricValue } from "@/lib/engine/balance-sheet-metrics";
import { buildCloseChange, type CloseChangeResult } from "@/lib/presentation/today/flow";
import type { DashboardState } from "@/lib/types";

/**
 * MODÈLE DE LECTURE DU POSTE DE TRAVAIL PATRIMOINE
 *
 * Il ne calcule AUCUNE vérité financière. Il sélectionne, groupe et met en forme des montants
 * déjà convertis par le Canonical Balance Sheet, exactement comme `balance-sheet-view.ts` le
 * fait pour le bilan et l'allocation. Aucun taux de change n'y est résolu, aucun solde natif
 * n'y est resommé, aucune quote-part n'y est appliquée : celle de l'immobilier et des sociétés
 * détenues est DÉJÀ portée par leurs contributions au bilan.
 *
 * Il existe pour que le composant n'ait plus une seule formule. Le §10.2 du plan l'exige, et le
 * §17 le suppose : un canvas qui grouperait lui-même les contributions déciderait de la
 * composition du bilan dans du JSX, là où personne ne la relit.
 *
 * LES `null` VIVENT ICI. Une famille dont aucune ligne n'est convertible n'a pas une hauteur
 * nulle : elle a une hauteur INCONNUE, et le §22 de la spécification V10 dit ce qu'il faut en
 * faire — « missing data changes geometry, not just text ». Le canvas rend alors une zone
 * détourée, jamais une barre à zéro, qui affirmerait que la famille ne vaut rien.
 */

export type NetWorthAssetFamilyId =
  "LIQUID" | "FINANCIAL" | "REAL_ESTATE" | "BUSINESS" | "OTHER_ASSET";

export type NetWorthLiabilityGroupId = "CONTRACTUAL_DEBT" | "ACCOUNT_OVERDRAFT" | "OTHER_LIABILITY";

export type NetWorthBlockId = NetWorthAssetFamilyId | NetWorthLiabilityGroupId;

/**
 * Une famille d'actif ou un groupe de passif du canvas.
 *
 * `weight` est la géométrie, `share` la part économique. Les deux sont distincts : la part est
 * un ratio par rapport à un total qui peut être non calculable, la géométrie une proportion de
 * ce qui est CONNU. Une famille sans montant connu n'a ni l'une ni l'autre.
 */
export interface NetWorthBlock {
  readonly id: NetWorthBlockId;
  readonly label: string;
  readonly side: "ASSET" | "LIABILITY";
  /** Domaine propriétaire de la vérité, pour l'inspecteur du §21 : « accès par actif au domaine ». */
  readonly ownerDomain: string;
  readonly aggregate: CanonicalAggregate;
  readonly lines: readonly ConvertedBalanceSheetLine[];
  /** Part du côté auquel le bloc appartient. `null` dès qu'un des deux montants manque. */
  readonly share: number | null;
  /** Proportion de la base de géométrie, dans ]0,1]. `null` = hauteur inconnue, zone détourée. */
  readonly weight: number | null;
  /** Nombre de lignes dont la valeur de reporting manque. */
  readonly unknownLineCount: number;
}

export interface NetWorthOwnership {
  /** Familles dont la contribution au bilan est DÉJÀ pondérée par une quote-part déclarée. */
  readonly attributedFamilies: readonly NetWorthAssetFamilyId[];
  /** Lignes qui entrent en totalité, faute de quote-part dans le modèle de données. */
  readonly unattributedLineCount: number;
  /** Lignes dont la quote-part est requise et non déclarée : leur montant est inconnu. */
  readonly undeclaredShareLineCount: number;
}

export interface NetWorthView {
  readonly asOfDate: string;
  readonly reportingCurrency: string;
  /** Familles d'actif NON VIDES, dans l'ordre du §21. Une famille sans ligne n'est pas rendue. */
  readonly assets: readonly NetWorthBlock[];
  readonly liabilities: readonly NetWorthBlock[];
  readonly grossAssets: CanonicalAggregate;
  readonly totalLiabilities: CanonicalAggregate;
  readonly netWorth: CanonicalAggregate;
  readonly immediateCash: CanonicalAggregate;
  readonly liquidAssets: CanonicalAggregate;
  /** Base commune de proportion des deux colonnes. `null` quand rien n'est connu. */
  readonly scaleBasis: number | null;
  /** Écart entre la somme des familles et l'agrégat canonique. Doit rester nul. */
  readonly assetResidual: number;
  readonly liabilityResidual: number;
  /** `true` dès qu'une famille ou un groupe rendu porte une hauteur inconnue. */
  readonly geometryIsPartial: boolean;
  /** Composition des seuls actifs financiers, telle que le KPI `asset_allocation` la déclare. */
  readonly allocation: CanonicalAllocation;
  /** Évolution depuis la clôture comparable, vérité unique partagée avec Aujourd'hui. */
  readonly closeChange: CloseChangeResult;
  /**
   * Le bilan peut-il être clôturé ?
   *
   * Même condition que celle appliquée par le repository, lue depuis le même endroit. Sans
   * elle, la page proposerait une clôture qui échouerait au clic sans dire ce qui manque.
   */
  readonly closeReadiness: MonthlyCloseReadiness;
  /** Clôtures déjà persistées : une évolution en demande deux comparables. */
  readonly closeCount: number;
  readonly ownership: NetWorthOwnership;
  readonly liquidShareOfGrossAssets: MetricValue;
  readonly largestAccountConcentration: MetricValue;
  /** Complétude déclarée du bilan lui-même, réserves comprises. */
  readonly quality: CanonicalBalanceSheet["quality"];
  /** Aucun actif ni passif déclaré : la page ouvre son parcours d'installation. */
  readonly isEmpty: boolean;
}

/** Libellés et domaine propriétaire, dans l'ordre du canvas du §21. */
const ASSET_FAMILIES: readonly {
  id: NetWorthAssetFamilyId;
  label: string;
  ownerDomain: string;
  matches: (line: ConvertedBalanceSheetLine) => boolean;
}[] = [
  {
    id: "LIQUID",
    label: "Liquidités",
    ownerDomain: "Patrimoine",
    matches: (line) => line.domain === "FINANCIAL_ACCOUNT" && line.category === "CASH_ACCOUNT",
  },
  {
    id: "FINANCIAL",
    label: "Placements financiers",
    ownerDomain: "Placements",
    matches: (line) =>
      line.domain === "FINANCIAL_ACCOUNT" && line.category === "INVESTMENT_ENVELOPE",
  },
  {
    id: "REAL_ESTATE",
    label: "Immobilier",
    ownerDomain: "Immobilier",
    matches: (line) => line.domain === "REAL_ESTATE",
  },
  {
    id: "BUSINESS",
    label: "Sociétés détenues",
    ownerDomain: "Sociétés",
    matches: (line) => line.domain === "BUSINESS_EQUITY",
  },
  {
    id: "OTHER_ASSET",
    label: "Autres actifs",
    ownerDomain: "Patrimoine",
    // Filet : tout ce que les quatre familles nommées ne prennent pas. Il ne disparaît pas en
    // silence, sans quoi une contribution d'un domaine futur cesserait d'être affichée sans
    // que le bouclage le dise.
    matches: () => true,
  },
];

const LIABILITY_GROUPS: readonly {
  id: NetWorthLiabilityGroupId;
  label: string;
  ownerDomain: string;
  matches: (line: ConvertedBalanceSheetLine) => boolean;
}[] = [
  {
    id: "CONTRACTUAL_DEBT",
    label: "Dettes contractuelles",
    ownerDomain: "Dette",
    matches: (line) => line.category === "CONTRACTUAL_DEBT",
  },
  {
    id: "ACCOUNT_OVERDRAFT",
    label: "Découverts bancaires",
    ownerDomain: "Patrimoine",
    matches: (line) => line.category === "ACCOUNT_OVERDRAFT",
  },
  {
    id: "OTHER_LIABILITY",
    label: "Autres passifs",
    ownerDomain: "Patrimoine",
    matches: () => true,
  },
];

/** Familles dont la contribution au bilan porte DÉJÀ la quote-part détenue déclarée. */
const ATTRIBUTED_FAMILIES: readonly NetWorthAssetFamilyId[] = ["REAL_ESTATE", "BUSINESS"];

const ratioOf = (part: CanonicalAggregate, whole: CanonicalAggregate): number | null =>
  part.value === null || whole.value === null || whole.value === 0
    ? null
    : part.value / whole.value;

function partition<T extends { matches: (line: ConvertedBalanceSheetLine) => boolean }>(
  definitions: readonly T[],
  lines: readonly ConvertedBalanceSheetLine[],
): Map<T, ConvertedBalanceSheetLine[]> {
  const buckets = new Map<T, ConvertedBalanceSheetLine[]>(
    definitions.map((definition) => [definition, [] as ConvertedBalanceSheetLine[]]),
  );
  for (const line of lines) {
    // Premier match l'emporte : l'ordre des définitions est le contrat, et le dernier est un
    // filet. Une ligne n'est donc jamais comptée deux fois, ni perdue.
    const definition = definitions.find((candidate) => candidate.matches(line));
    if (definition) buckets.get(definition)!.push(line);
  }
  return buckets;
}

/**
 * Le poste de travail Patrimoine, lu depuis les vérités canoniques.
 *
 * Aucune API externe n'est lue : le §21 l'interdit explicitement. Aucun montant n'est reconverti
 * ni repondéré. La fonction est pure : mêmes entrées, mêmes sorties, aucun accès au temps.
 */
export function buildNetWorthView(state: DashboardState): NetWorthView {
  const sheet = canonicalBalanceSheetOf(state);
  const metrics = canonicalMetricsOf(state);
  const primary = sheet.contributions.filter((line) => line.isAccountingPrimary);
  const assetLines = primary.filter((line) => line.side === "ASSET");
  const liabilityLines = primary.filter((line) => line.side === "LIABILITY");

  const assetBuckets = partition(ASSET_FAMILIES, assetLines);
  const liabilityBuckets = partition(LIABILITY_GROUPS, liabilityLines);

  // La base de géométrie compare les deux colonnes sur la MÊME échelle. Sans elle, une dette
  // de 16 745 € et des actifs de 24 200 € se dessineraient à hauteur égale.
  const scaleCandidate = Math.max(sheet.grossAssets.knownValue, sheet.totalLiabilities.knownValue);
  const scaleBasis = scaleCandidate > 0 ? scaleCandidate : null;

  const toBlock = (
    definition: { id: NetWorthBlockId; label: string; ownerDomain: string },
    side: "ASSET" | "LIABILITY",
    lines: ConvertedBalanceSheetLine[],
    total: CanonicalAggregate,
  ): NetWorthBlock => {
    const aggregate = lineGroupTotal(lines);
    return {
      id: definition.id,
      label: definition.label,
      side,
      ownerDomain: definition.ownerDomain,
      aggregate,
      lines,
      share: ratioOf(aggregate, total),
      // Une famille sans aucun montant connu n'a pas une hauteur de zéro : elle n'a pas de
      // hauteur. Le zéro serait une affirmation, l'absence est un fait.
      weight:
        scaleBasis === null || aggregate.knownValue === 0
          ? aggregate.status === "COMPLETE" && aggregate.value === 0
            ? 0
            : null
          : aggregate.knownValue / scaleBasis,
      unknownLineCount: lines.filter((line) => line.reportingValue === null).length,
    };
  };

  const assets = ASSET_FAMILIES.map((definition) =>
    toBlock(definition, "ASSET", assetBuckets.get(definition)!, sheet.grossAssets),
  ).filter((block) => block.lines.length > 0);
  const liabilities = LIABILITY_GROUPS.map((definition) =>
    toBlock(definition, "LIABILITY", liabilityBuckets.get(definition)!, sheet.totalLiabilities),
  ).filter((block) => block.lines.length > 0);

  const knownSum = (blocks: readonly NetWorthBlock[]) =>
    blocks.reduce((sum, block) => sum + block.aggregate.knownValue, 0);

  const undeclaredShareLineCount = assetLines.filter((line) =>
    (line.valuationBlockers ?? []).some((blocker) => blocker.includes("OWNERSHIP_SHARE_MISSING")),
  ).length;

  return {
    asOfDate: sheet.asOfDate,
    reportingCurrency: sheet.reportingCurrency,
    assets,
    liabilities,
    grossAssets: sheet.grossAssets,
    totalLiabilities: sheet.totalLiabilities,
    netWorth: sheet.netWorth,
    immediateCash: sheet.immediateCash,
    liquidAssets: sheet.liquidAssets,
    scaleBasis,
    // Bouclage : les familles rendues doivent redonner l'agrégat canonique. Un écart signale
    // qu'une contribution a été perdue par le partitionnement, ce qu'aucun total ne dirait.
    assetResidual: knownSum(assets) - sheet.grossAssets.knownValue,
    liabilityResidual: knownSum(liabilities) - sheet.totalLiabilities.knownValue,
    geometryIsPartial: [...assets, ...liabilities].some((block) => block.weight === null),
    allocation: buildCanonicalAllocation(sheet),
    closeChange: buildCloseChange(state.monthlyCloses ?? [], state.reportingCurrency),
    closeReadiness: monthlyCloseReadiness(sheet),
    closeCount: (state.monthlyCloses ?? []).length,
    ownership: {
      attributedFamilies: ATTRIBUTED_FAMILIES.filter((id) =>
        assets.some((block) => block.id === id),
      ),
      // Un compte financier n'a pas de quote-part dans le modèle : il entre en totalité. Le
      // dire est la seule honnêteté disponible tant que la donnée n'existe pas.
      unattributedLineCount: assetLines.filter((line) => line.domain === "FINANCIAL_ACCOUNT")
        .length,
      undeclaredShareLineCount,
    },
    liquidShareOfGrossAssets: metrics.ratios.liquidShareOfGrossAssets,
    largestAccountConcentration: metrics.ratios.largestAccountConcentration,
    quality: sheet.quality,
    isEmpty: assetLines.length === 0 && liabilityLines.length === 0,
  };
}
