/**
 * MOTEUR D'ESTIMATION DE MARCHÉ PAR COMPARABLES
 *
 * Fonctions pures. Aucun accès base, aucun React, aucun réseau.
 *
 * Ce moteur est la SEULE place du dépôt où un prix au mètre carré est calculé, et il ne
 * persiste rien. Il produit un CANDIDAT à valorisation, que seule une décision humaine
 * transforme en fait canonique.
 *
 * Trois distinctions gouvernent le fichier :
 *
 *   PRIX AU M² ≠ VALEUR DU BIEN. Une médiane multipliée par une surface est un MODÈLE sous
 *   convention déclarée, pas une observation. Le résultat porte donc `MODEL_ASSUMPTION` et
 *   le nom de sa convention, et il n'entre jamais seul au bilan.
 *
 *   MUTATION MULTI-LOTS ≠ COMPARABLE. Un prix global pour plusieurs lots divisé par la
 *   surface de l'un d'eux ne veut rien dire : ces mutations sont exclues en le disant.
 *
 *   ÉCHANTILLON INSUFFISANT ≠ ESTIMATION PRUDENTE. Sous le seuil, le résultat est
 *   `NOT_COMPUTABLE`, pas une estimation à confiance basse. Un chiffre affiché avec un
 *   avertissement finit par être lu sans l'avertissement.
 *
 * Le moteur N'ENTRE PAS dans le bilan canonique ni dans le Personal Monthly Financial Model :
 * il alimente une décision, et c'est la valorisation promue qui suit ensuite le chemin
 * existant de Real Estate V2.
 */

/** Nom de la convention, persisté avec chaque chiffre. Il change si la formule change. */
export const COMPARABLE_CONVENTION = "MEDIANE_PRIX_M2_LOT_UNIQUE_SURFACE_BATIE" as const;

/**
 * Nombre minimal de mutations exploitables. Sous ce seuil, aucune estimation n'est rendue.
 *
 * Cinq n'est pas un chiffre magique et n'est pas présenté comme tel : c'est le seuil en
 * dessous duquel une médiane est dominée par une transaction particulière. Il est exporté
 * pour être discuté et modifié en connaissance de cause, jamais enfoui.
 */
export const MIN_USABLE_COMPARABLES = 5;

/**
 * Dispersion au-delà de laquelle l'échantillon est signalé HÉTÉROGÈNE. L'estimation reste
 * rendue — elle est calculable — mais sa confiance tombe et le drapeau est explicite : une
 * médiane sur un échantillon très dispersé décrit mal un bien particulier.
 */
export const HIGH_DISPERSION_RATIO = 0.6;

export type MarketFlagCode =
  | "NO_USABLE_COMPARABLE"
  | "SAMPLE_TOO_SMALL"
  | "SURFACE_NOT_DECLARED"
  | "HIGH_DISPERSION"
  | "MULTI_LOT_EXCLUDED"
  | "MISSING_AREA_EXCLUDED"
  | "CURRENCY_MIXED"
  | "SNAPSHOT_STALE"
  | "COVERAGE_NOT_DECLARED";

export interface MarketFlag {
  code: MarketFlagCode;
  severity: "INFO" | "WARNING" | "ERROR";
  message: string;
}

/** Une mutation telle que le moteur la consomme. Aucun terme n'est optionnel par défaut. */
export interface ComparableSaleFact {
  price: number;
  currency: string;
  builtAreaSqm: number | null;
  lotCount: number | null;
  mutatedOn: string;
  propertyKind: string | null;
}

export interface UnitPriceDistribution {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  /** (p75 - p25) / médiane. Mesure de dispersion relative, sans hypothèse de loi. */
  interquartileRatio: number;
}

/**
 * Résultat. `status` est le premier champ à lire : `NOT_COMPUTABLE` ne porte AUCUNE valeur,
 * et il n'y a pas de valeur « par défaut » à côté.
 */
export interface MarketEstimate {
  status: "COMPUTED" | "NOT_COMPUTABLE";
  convention: typeof COMPARABLE_CONVENTION;
  /** Valeur estimée, en devise des comparables. `null` si non calculable. */
  value: number | null;
  currency: string | null;
  /** Distribution des prix unitaires réellement retenus. `null` si aucune. */
  distribution: UnitPriceDistribution | null;
  /** Surface retenue, telle que déclarée sur le bien. */
  surfaceSqm: number | null;
  /** Confiance à porter sur le fait canonique si l'utilisateur promeut ce chiffre. */
  confidence: "MEDIUM" | "LOW";
  /** Décompte des exclusions, par motif nommé. Rien n'est écarté en silence. */
  exclusions: {
    multiLot: number;
    missingArea: number;
    nonPositivePrice: number;
    otherCurrency: number;
  };
  flags: MarketFlag[];
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * Calcule la distribution des prix unitaires exploitables.
 *
 * Exportée séparément parce qu'elle est utile seule : montrer la distribution sans en tirer
 * une valeur est souvent la lecture la plus honnête d'un petit échantillon.
 */
export function unitPriceDistribution(sales: readonly ComparableSaleFact[]): {
  distribution: UnitPriceDistribution | null;
  exclusions: MarketEstimate["exclusions"];
  currency: string | null;
} {
  const exclusions = { multiLot: 0, missingArea: 0, nonPositivePrice: 0, otherCurrency: 0 };

  // La devise de référence est celle de la MAJORITÉ des mutations exploitables. Mélanger
  // deux devises dans une médiane produirait un nombre sans unité ; le FX Engine n'a pas sa
  // place ici, parce que convertir des prix de marché historiques suppose une courbe.
  const currencyCounts = new Map<string, number>();
  for (const sale of sales) {
    currencyCounts.set(sale.currency, (currencyCounts.get(sale.currency) ?? 0) + 1);
  }
  let currency: string | null = null;
  let best = 0;
  for (const [code, count] of currencyCounts) {
    if (count > best) {
      currency = code;
      best = count;
    }
  }

  const unitPrices: number[] = [];
  for (const sale of sales) {
    if (currency !== null && sale.currency !== currency) {
      exclusions.otherCurrency += 1;
      continue;
    }
    if (sale.price <= 0) {
      exclusions.nonPositivePrice += 1;
      continue;
    }
    if (sale.builtAreaSqm === null) {
      // SURFACE ABSENTE ≠ SURFACE NULLE : la mutation existe, son prix unitaire n'existe pas.
      exclusions.missingArea += 1;
      continue;
    }
    if ((sale.lotCount ?? 1) > 1) {
      exclusions.multiLot += 1;
      continue;
    }
    unitPrices.push(sale.price / sale.builtAreaSqm);
  }

  if (unitPrices.length === 0) {
    return { distribution: null, exclusions, currency };
  }

  const sorted = [...unitPrices].sort((left, right) => left - right);
  const median = quantile(sorted, 0.5);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);

  return {
    distribution: {
      count: sorted.length,
      min: sorted[0],
      p25,
      median,
      p75,
      max: sorted[sorted.length - 1],
      interquartileRatio: median === 0 ? 0 : (p75 - p25) / median,
    },
    exclusions,
    currency,
  };
}

export interface MarketEstimateInput {
  sales: readonly ComparableSaleFact[];
  /** Surface du bien, telle qu'elle est DÉCLARÉE. `null` = non déclarée. */
  surfaceSqm: number | null;
  /** Couverture déclarée de l'instantané. Un vide hors couverture ne dit rien. */
  coverageState: "DECLARED_COVERED" | "DECLARED_NOT_COVERED" | "COVERAGE_UNKNOWN";
  /** Vrai si l'instantané a dépassé sa fraîcheur déclarée. */
  stale: boolean;
}

const NOT_COMPUTABLE = (
  flags: MarketFlag[],
  exclusions: MarketEstimate["exclusions"],
  surfaceSqm: number | null,
  distribution: UnitPriceDistribution | null,
  currency: string | null,
): MarketEstimate => ({
  status: "NOT_COMPUTABLE",
  convention: COMPARABLE_CONVENTION,
  value: null,
  currency,
  distribution,
  surfaceSqm,
  confidence: "LOW",
  exclusions,
  flags,
});

/**
 * Estime la valeur d'un bien depuis un jeu de comparables.
 *
 * Elle rend `NOT_COMPUTABLE` — et non un chiffre prudent — dès que l'un des trois manque :
 * une surface déclarée, assez de mutations exploitables, une devise unique. Le nombre de
 * mutations lues n'est pas un indicateur de qualité si aucune ne porte de surface.
 */
export function estimateMarketValue(input: MarketEstimateInput): MarketEstimate {
  const flags: MarketFlag[] = [];
  const { distribution, exclusions, currency } = unitPriceDistribution(input.sales);

  if (input.coverageState === "COVERAGE_UNKNOWN") {
    flags.push({
      code: "COVERAGE_NOT_DECLARED",
      severity: "WARNING",
      message:
        "La couverture du jeu n'est pas déclarée pour cette zone : ce qu'il ne contient pas ne prouve rien sur le marché",
    });
  }
  if (input.stale) {
    flags.push({
      code: "SNAPSHOT_STALE",
      severity: "WARNING",
      message:
        "L'instantané a dépassé sa fraîcheur déclarée : il reste lisible, mais il décrit un marché passé",
    });
  }
  if (exclusions.multiLot > 0) {
    flags.push({
      code: "MULTI_LOT_EXCLUDED",
      severity: "INFO",
      message: `${exclusions.multiLot} mutation(s) multi-lots exclues : un prix global divisé par la surface d'un lot ne veut rien dire`,
    });
  }
  if (exclusions.missingArea > 0) {
    flags.push({
      code: "MISSING_AREA_EXCLUDED",
      severity: "INFO",
      message: `${exclusions.missingArea} mutation(s) sans surface bâtie exclues : une surface absente ne vaut pas zéro, elle rend le prix unitaire non calculable`,
    });
  }
  if (exclusions.otherCurrency > 0) {
    flags.push({
      code: "CURRENCY_MIXED",
      severity: "WARNING",
      message: `${exclusions.otherCurrency} mutation(s) dans une autre devise exclues : mélanger deux devises dans une médiane produirait un nombre sans unité`,
    });
  }

  if (distribution === null) {
    flags.push({
      code: "NO_USABLE_COMPARABLE",
      severity: "ERROR",
      message:
        "Aucune mutation exploitable : sans prix strictement positif, surface bâtie et lot unique, il n'y a rien à comparer",
    });
    return NOT_COMPUTABLE(flags, exclusions, input.surfaceSqm, null, currency);
  }

  if (distribution.count < MIN_USABLE_COMPARABLES) {
    flags.push({
      code: "SAMPLE_TOO_SMALL",
      severity: "ERROR",
      message: `${distribution.count} mutation(s) exploitable(s) pour un minimum de ${MIN_USABLE_COMPARABLES} : la distribution est affichée, aucune valeur n'en est dérivée`,
    });
    return NOT_COMPUTABLE(flags, exclusions, input.surfaceSqm, distribution, currency);
  }

  if (input.surfaceSqm === null || input.surfaceSqm <= 0) {
    flags.push({
      code: "SURFACE_NOT_DECLARED",
      severity: "ERROR",
      message:
        "Surface du bien non déclarée : le prix au mètre carré est connu, la valeur du bien ne l'est pas. Elle ne se remplace pas par une hypothèse",
    });
    return NOT_COMPUTABLE(flags, exclusions, input.surfaceSqm, distribution, currency);
  }

  const dispersed = distribution.interquartileRatio > HIGH_DISPERSION_RATIO;
  if (dispersed) {
    flags.push({
      code: "HIGH_DISPERSION",
      severity: "WARNING",
      message: `Écart interquartile de ${(distribution.interquartileRatio * 100).toFixed(0)} % de la médiane : l'échantillon est hétérogène, et une médiane y décrit mal un bien particulier`,
    });
  }

  return {
    status: "COMPUTED",
    convention: COMPARABLE_CONVENTION,
    // Arrondi à l'euro : une estimation par médiane n'a aucune précision au centime, et
    // l'afficher en donnerait une fausse.
    value: Math.round(distribution.median * input.surfaceSqm),
    currency,
    distribution,
    surfaceSqm: input.surfaceSqm,
    // Jamais HIGH. Une estimation par comparables reste un modèle, quelle que soit la
    // qualité de l'échantillon.
    confidence: dispersed || input.stale ? "LOW" : "MEDIUM",
    exclusions,
    flags,
  };
}

/**
 * Intrants à persister avec le chiffre, dans `real_estate_valuations.derivation`.
 *
 * Ils rendent le nombre REPRODUCTIBLE : sans eux, une valeur en base serait un chiffre
 * orphelin, et la base le refuse d'ailleurs pour cette méthode.
 */
export function derivationOf(estimate: MarketEstimate): Record<string, unknown> {
  return {
    convention: estimate.convention,
    comparable_count: estimate.distribution?.count ?? 0,
    unit_price_median: estimate.distribution?.median ?? null,
    unit_price_p25: estimate.distribution?.p25 ?? null,
    unit_price_p75: estimate.distribution?.p75 ?? null,
    interquartile_ratio: estimate.distribution?.interquartileRatio ?? null,
    surface_sqm: estimate.surfaceSqm,
    exclusions: estimate.exclusions,
    flags: estimate.flags.map((flag) => flag.code),
  };
}
