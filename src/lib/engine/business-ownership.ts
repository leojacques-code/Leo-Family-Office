import {
  blocker,
  dedupeFlags,
  flag,
  known,
  latestAtOrBefore,
  unknown,
  type BusinessAmount,
  type BusinessEntity,
  type BusinessFlag,
  type BusinessHoldingLink,
  type BusinessOwnership,
} from "@/lib/engine/business-equity-facts";

/**
 * DÉTENTION ET CAP TABLE
 *
 * Quatre taux distincts, jamais interchangeables :
 *   — JURIDIQUE      : la part du capital détenue ;
 *   — ÉCONOMIQUE     : la part de la VALEUR qui revient réellement au détenteur ;
 *   — DE VOTE        : le pouvoir, qui ne suit pas nécessairement le capital ;
 *   — PLEINEMENT DILUÉ : ce que la détention devient une fois tous les droits exercés.
 *
 * C'est le taux ÉCONOMIQUE qui attribue de la valeur au patrimoine. Le confondre avec le
 * taux juridique surévalue une participation dès qu'il existe des actions de préférence.
 *
 * NOMBRE DE TITRES > TAUX DÉCLARÉ. Quand les titres sont connus, ils sont la vérité la
 * plus fine et le taux en est DÉRIVÉ. Une contradiction entre les deux n'est pas arbitrée
 * en silence : elle est signalée.
 */

/** Écart au-delà duquel un taux déclaré et un taux dérivé des titres sont contradictoires. */
export const OWNERSHIP_RATE_TOLERANCE = 1e-6;

export interface BusinessOwnershipView {
  /** Détention applicable à la date de lecture. `null` = aucune détention déclarée. */
  record: BusinessOwnership | null;
  history: BusinessOwnership[];
  legalRate: BusinessAmount;
  economicRate: BusinessAmount;
  votingRate: BusinessAmount;
  fullyDilutedRate: BusinessAmount;
  sharesHeld: number | null;
  sharesOutstanding: number | null;
  fullyDilutedShares: number | null;
  /** Vrai quand les taux ont été dérivés d'un nombre de titres plutôt que déclarés. */
  derivedFromShares: boolean;
  /** Vrai quand la détention est tombée à zéro : la participation est sortie. */
  fullyExited: boolean;
  flags: BusinessFlag[];
}

function rateFromShares(held: number | null, outstanding: number | null): number | null {
  if (held === null || outstanding === null || outstanding <= 0) return null;
  return held / outstanding;
}

export function buildOwnershipView(
  business: BusinessEntity,
  ownership: BusinessOwnership[],
  asOfDate: string,
): BusinessOwnershipView {
  const history = ownership
    .filter((row) => row.businessId === business.id)
    .sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate));
  const record = latestAtOrBefore(history, asOfDate, (row) => row.effectiveDate);
  if (!record) {
    return {
      record: null,
      history,
      legalRate: unknown([blocker("OWNERSHIP_MISSING", business.id)]),
      economicRate: unknown([blocker("OWNERSHIP_MISSING", business.id)]),
      votingRate: unknown([blocker("OWNERSHIP_MISSING", business.id)]),
      fullyDilutedRate: unknown([blocker("OWNERSHIP_MISSING", business.id)]),
      sharesHeld: null,
      sharesOutstanding: null,
      fullyDilutedShares: null,
      derivedFromShares: false,
      fullyExited: false,
      flags: [],
    };
  }

  const flags: BusinessFlag[] = [];
  const sharesRate = rateFromShares(record.sharesHeld, record.sharesOutstanding);
  // Ne rien détenir juridiquement, c'est n'avoir aucun droit économique. Ce n'est pas une
  // information manquante : c'est le résultat d'une sortie, et il vaut zéro.
  const exited = record.legalRate === 0 && (sharesRate === null || sharesRate === 0);
  const dilutedSharesRate = rateFromShares(record.sharesHeld, record.fullyDilutedShares);
  if (sharesRate !== null && Math.abs(sharesRate - record.legalRate) > OWNERSHIP_RATE_TOLERANCE) {
    flags.push(
      flag(
        "SHARE_COUNTS_INCONSISTENT",
        business.id,
        `taux déclaré ${(record.legalRate * 100).toFixed(4)} % contre ${(sharesRate * 100).toFixed(4)} % dérivé des titres`,
      ),
    );
  }

  const legalRate = sharesRate ?? record.legalRate;
  // Droits économiques non déclarés : la valeur attribuable N'EST PAS calculable. Retomber
  // sur la détention juridique surévaluerait toute participation portant des préférences.
  const economicRate = exited
    ? known(0)
    : record.economicRate === null
      ? unknown([blocker("ECONOMIC_OWNERSHIP_MISSING", business.id)])
      : known(record.economicRate);
  const fullyDilutedRate = dilutedSharesRate ?? record.fullyDilutedRate ?? null;
  // La dilution n'est une réserve UTILE que là où elle est structurelle : une startup porte
  // presque toujours des BSPCE ou des convertibles, et une cap table exprimée en titres qui
  // omet le pleinement dilué a une lacune identifiée. Le signaler partout ailleurs noierait
  // les vraies réserves sous une réserve de principe.
  const dilutionMatters =
    business.type === "STARTUP" ||
    (record.sharesOutstanding !== null && record.fullyDilutedShares === null);
  if (fullyDilutedRate === null && dilutionMatters)
    flags.push(flag("FULLY_DILUTED_UNKNOWN", business.id));

  const fullyExited = exited;
  if (fullyExited) flags.push(flag("OWNERSHIP_FULLY_EXITED", business.id));

  return {
    record,
    history,
    legalRate: known(legalRate),
    economicRate,
    votingRate:
      record.votingRate === null
        ? unknown([blocker("OWNERSHIP_MISSING", business.id, "droits de vote")])
        : known(record.votingRate),
    fullyDilutedRate:
      fullyDilutedRate === null
        ? unknown([blocker("OWNERSHIP_MISSING", business.id, "pleinement dilué")])
        : known(fullyDilutedRate),
    sharesHeld: record.sharesHeld,
    sharesOutstanding: record.sharesOutstanding,
    fullyDilutedShares: record.fullyDilutedShares,
    derivedFromShares: sharesRate !== null,
    fullyExited,
    flags: dedupeFlags(flags),
  };
}

/** Rattachements actifs d'une holding à une date : le plus récent par filiale. */
export function activeHoldingLinks(
  holdings: BusinessHoldingLink[],
  parentBusinessId: string,
  asOfDate: string,
): BusinessHoldingLink[] {
  return holdings
    .filter((link) => link.parentBusinessId === parentBusinessId && link.effectiveDate <= asOfDate)
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))
    .filter(
      (link, index, all) =>
        all.findIndex((other) => other.childBusinessId === link.childBusinessId) === index,
    );
}

/**
 * Détention économique EFFECTIVE d'une société : la part directe, plus la part détenue au
 * travers de chaque holding qui la porte.
 *
 * C'est une grandeur d'EXPOSITION, jamais une grandeur d'attribution : la valeur attribuée
 * au patrimoine passe par la valeur look-through des holdings, pas par ce taux. La calculer
 * sert à détecter l'incohérence — une exposition effective supérieure à 100 % signifie que
 * la même société est comptée deux fois quelque part.
 */
export function lookThroughEconomicRate(
  businessId: string,
  directRateOf: (id: string) => number | null,
  holdings: BusinessHoldingLink[],
  asOfDate: string,
  visiting: Set<string> = new Set(),
): number | null {
  if (visiting.has(businessId)) return null;
  visiting.add(businessId);
  const direct = directRateOf(businessId) ?? 0;
  const parents = holdings
    .filter((link) => link.childBusinessId === businessId && link.effectiveDate <= asOfDate)
    .sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))
    .filter(
      (link, index, all) =>
        all.findIndex((other) => other.parentBusinessId === link.parentBusinessId) === index,
    );
  let indirect = 0;
  for (const link of parents) {
    const parentRate = lookThroughEconomicRate(
      link.parentBusinessId,
      directRateOf,
      holdings,
      asOfDate,
      visiting,
    );
    if (parentRate === null) {
      visiting.delete(businessId);
      return null;
    }
    indirect += parentRate * link.ownershipRate;
  }
  visiting.delete(businessId);
  return direct + indirect;
}

// ─── Levée de fonds ─────────────────────────────────────────────────────────────────────

export interface FundingRoundInput {
  /** Valeur de l'equity AVANT le tour, telle que négociée. */
  preMoneyEquityValue: number;
  /** Argent frais entrant au capital. Seul le primaire crée de la valeur post-money. */
  primaryNewMoney: number;
  /**
   * Secondaire : rachat de titres existants. Il change qui détient, jamais la valeur de la
   * société ni le post-money. Le confondre avec du primaire gonfle la valorisation.
   */
  secondaryAmount: number | null;
  /** Détention économique de l'utilisateur avant le tour. */
  ownershipBefore: number;
  /** Montant souscrit par l'utilisateur dans ce tour. 0 = il ne participe pas. */
  investorContribution: number;
  /**
   * Les droits attachés aux nouveaux titres sont-ils connus ? Sans cette connaissance,
   * post-money × détention n'est PAS la valeur économique du détenteur ordinaire.
   */
  preferredRightsKnown: boolean;
}

export interface FundingRoundOutcome {
  postMoneyEquityValue: BusinessAmount;
  ownershipBefore: BusinessAmount;
  ownershipAfter: BusinessAmount;
  dilution: BusinessAmount;
  /** Valeur de la part de l'utilisateur au post-money, sous réserve des préférences. */
  positionValueAfter: BusinessAmount;
  flags: BusinessFlag[];
}

/**
 * Conséquences d'un tour de table.
 *
 * post-money = pre-money + argent frais PRIMAIRE.
 * détention après = (détention avant × pre-money + souscription) ÷ post-money.
 *
 * Cette forme se lit économiquement : la valeur détenue avant le tour, augmentée de ce que
 * l'utilisateur remet au pot, rapportée à la valeur totale après. Un actionnaire qui ne
 * participe pas est dilué exactement du ratio pre/post.
 */
export function fundingRoundOutcome(input: FundingRoundInput): FundingRoundOutcome {
  const flags: BusinessFlag[] = [];
  if (!input.preferredRightsKnown) flags.push(flag("PREFERRED_RIGHTS_UNKNOWN"));
  const postMoney = input.preMoneyEquityValue + input.primaryNewMoney;
  const ownershipBefore = known(input.ownershipBefore);
  if (postMoney <= 0) {
    const blocked = unknown([blocker("FUNDING_ROUND_TERMS_MISSING")], flags);
    return {
      postMoneyEquityValue: blocked,
      ownershipBefore,
      ownershipAfter: blocked,
      dilution: blocked,
      positionValueAfter: blocked,
      flags,
    };
  }
  const after =
    (input.ownershipBefore * input.preMoneyEquityValue + input.investorContribution) / postMoney;
  return {
    postMoneyEquityValue: known(postMoney, flags),
    ownershipBefore,
    ownershipAfter: known(after, flags),
    dilution: known(input.ownershipBefore - after, flags),
    positionValueAfter: known(after * postMoney, flags),
    flags: dedupeFlags(flags),
  };
}
