import { describe, expect, it } from "vitest";

import {
  buildOwnershipView,
  fundingRoundOutcome,
  lookThroughEconomicRate,
} from "@/lib/engine/business-ownership";
import {
  AS_OF,
  blockerCodes,
  business,
  flagCodes,
  holding,
  ownership,
  portfolio,
  positionOf,
} from "@/lib/engine/__tests__/fixtures/business";

describe("Cap table", () => {
  const target = business({ id: "c", name: "CapCo" });

  it("dérive le taux des titres quand ils sont connus", () => {
    const view = buildOwnershipView(
      target,
      [
        ownership({
          id: "o",
          businessId: "c",
          effectiveDate: "2024-01-01",
          legalRate: 0.25,
          sharesHeld: 250,
          sharesOutstanding: 1_000,
          fullyDilutedShares: 1_250,
        }),
      ],
      AS_OF,
    );
    expect(view.legalRate.value).toBeCloseTo(0.25, 12);
    expect(view.fullyDilutedRate.value).toBeCloseTo(0.2, 12);
    expect(view.derivedFromShares).toBe(true);
  });

  it("signale une contradiction entre titres et taux déclaré au lieu de trancher en silence", () => {
    const view = buildOwnershipView(
      target,
      [
        ownership({
          id: "o",
          businessId: "c",
          effectiveDate: "2024-01-01",
          legalRate: 0.3,
          sharesHeld: 250,
          sharesOutstanding: 1_000,
        }),
      ],
      AS_OF,
    );
    expect(flagCodes(view)).toContain("SHARE_COUNTS_INCONSISTENT");
    expect(view.legalRate.value).toBeCloseTo(0.25, 12);
  });

  it("retient la détention applicable à la date, jamais une détention future", () => {
    const view = buildOwnershipView(
      target,
      [
        ownership({ id: "o1", businessId: "c", effectiveDate: "2020-01-01", legalRate: 1 }),
        ownership({ id: "o2", businessId: "c", effectiveDate: "2025-06-30", legalRate: 0.55 }),
        ownership({ id: "o3", businessId: "c", effectiveDate: "2027-01-01", legalRate: 0.1 }),
      ],
      AS_OF,
    );
    expect(view.record?.effectiveDate).toBe("2025-06-30");
    expect(view.legalRate.value).toBe(0.55);
  });

  it("ne retombe jamais sur la détention juridique quand les droits économiques manquent", () => {
    const view = buildOwnershipView(
      target,
      [
        ownership({
          id: "o",
          businessId: "c",
          effectiveDate: "2020-01-01",
          legalRate: 0.4,
          economicRate: null,
        }),
      ],
      AS_OF,
    );
    expect(view.economicRate.value).toBeNull();
    expect(blockerCodes(view.economicRate)).toContain("ECONOMIC_OWNERSHIP_MISSING");
  });
});

describe("Détention look-through", () => {
  const holdings = [
    holding({
      id: "l1",
      parentBusinessId: "top",
      childBusinessId: "mid",
      effectiveDate: "2020-01-01",
      ownershipRate: 0.6,
    }),
    holding({
      id: "l2",
      parentBusinessId: "mid",
      childBusinessId: "op",
      effectiveDate: "2020-01-01",
      ownershipRate: 0.5,
    }),
  ];

  it("compose la chaîne de détention", () => {
    const direct = (id: string) => (id === "top" ? 0.8 : null);
    expect(lookThroughEconomicRate("op", direct, holdings, AS_OF)).toBeCloseTo(0.24, 12);
    expect(lookThroughEconomicRate("mid", direct, holdings, AS_OF)).toBeCloseTo(0.48, 12);
  });

  it("détecte une exposition effective supérieure à 100 %", () => {
    const result = portfolio({
      businesses: [
        business({ id: "hold", name: "HoldCo", type: "HOLDING" }),
        business({ id: "op", name: "OpCo" }),
      ],
      ownership: [
        ownership({ id: "o1", businessId: "hold", effectiveDate: "2020-01-01", legalRate: 1 }),
        ownership({ id: "o2", businessId: "op", effectiveDate: "2020-01-01", legalRate: 0.6 }),
      ],
      holdings: [
        holding({
          id: "l",
          parentBusinessId: "hold",
          childBusinessId: "op",
          effectiveDate: "2020-01-01",
          ownershipRate: 0.6,
        }),
      ],
    });
    const position = positionOf(result, "op");
    expect(position.lookThroughEconomicRate.value).toBeCloseTo(1.2, 12);
    expect(flagCodes(position.quality)).toEqual(
      expect.arrayContaining([
        "LOOK_THROUGH_OWNERSHIP_EXCEEDS_ONE",
        "DIRECT_AND_INDIRECT_OWNERSHIP",
      ]),
    );
  });
});

describe("Tour de table", () => {
  it("laisse la détention inchangée quand l'actionnaire souscrit au prorata", () => {
    const outcome = fundingRoundOutcome({
      preMoneyEquityValue: 8_000_000,
      primaryNewMoney: 2_000_000,
      secondaryAmount: null,
      ownershipBefore: 0.25,
      investorContribution: 500_000,
      preferredRightsKnown: true,
    });
    expect(outcome.postMoneyEquityValue.value).toBe(10_000_000);
    expect(outcome.ownershipAfter.value).toBeCloseTo(0.25, 12);
    expect(outcome.dilution.value).toBeCloseTo(0, 12);
    expect(flagCodes(outcome.ownershipAfter)).not.toContain("PREFERRED_RIGHTS_UNKNOWN");
  });

  it("ne laisse jamais un secondaire gonfler le post-money", () => {
    const withSecondary = fundingRoundOutcome({
      preMoneyEquityValue: 8_000_000,
      primaryNewMoney: 2_000_000,
      secondaryAmount: 1_500_000,
      ownershipBefore: 0.25,
      investorContribution: 0,
      preferredRightsKnown: true,
    });
    expect(withSecondary.postMoneyEquityValue.value).toBe(10_000_000);
  });

  it("refuse de conclure sur un post-money nul", () => {
    const outcome = fundingRoundOutcome({
      preMoneyEquityValue: 0,
      primaryNewMoney: 0,
      secondaryAmount: null,
      ownershipBefore: 0.5,
      investorContribution: 0,
      preferredRightsKnown: true,
    });
    expect(outcome.ownershipAfter.value).toBeNull();
    expect(blockerCodes(outcome.ownershipAfter)).toContain("FUNDING_ROUND_TERMS_MISSING");
  });
});
