import { describe, expect, it } from "vitest";

import {
  buildBusinessEquityPortfolio,
  businessEquityBalanceSheetContributions,
} from "@/lib/engine/business-equity";
import { SYNTHETIC_PORTFOLIO } from "@/lib/engine/__tests__/fixtures/business-companies";
import { flagCodes, positionOf } from "@/lib/engine/__tests__/fixtures/business";

/**
 * VALIDATION SUR SIX SOCIÉTÉS COMPLÈTES ET SYNTHÉTIQUES.
 *
 * Aucune de ces sociétés n'existe : ce sont des cas construits, jamais des entreprises
 * réelles. Chaque attendu ci-dessous est recalculé À LA MAIN dans le test, terme par terme,
 * sans réutiliser une fonction du moteur — c'est ce qui distingue une validation d'un
 * simple enregistrement du comportement courant.
 */

const result = buildBusinessEquityPortfolio(SYNTHETIC_PORTFOLIO);

describe("1. PME rentable — Atelier Vernier (synthétique)", () => {
  const position = positionOf(result, "vernier");
  const adjustedEbitda = 650_000 + 60_000 + 25_000;
  const enterprise = adjustedEbitda * 6.5;
  const equity = enterprise - 1_100_000 + 300_000;

  it("valorise sur un EBITDA ajusté de retraitements déclarés", () => {
    expect(position.valuation.adjustedMetric?.value).toBe(735_000);
    expect(position.enterpriseValue.central.value).toBe(enterprise);
    expect(enterprise).toBe(4_777_500);
  });

  it("ponte vers une Equity Value de 3 977 500 €", () => {
    expect(position.equityValue.central.value).toBe(equity);
    expect(equity).toBe(3_977_500);
    expect(position.attributableValue.central.value).toBe(3_977_500);
  });

  it("encadre la valeur par les multiples bas et haut déclarés", () => {
    expect(position.attributableValue.low.value).toBe(735_000 * 5.5 - 1_100_000 + 300_000);
    expect(position.attributableValue.high.value).toBe(735_000 * 7.5 - 1_100_000 + 300_000);
  });

  it("mesure une performance sur un historique déclaré complet", () => {
    expect(position.capital.investedCapital.value).toBe(350_000);
    expect(position.capital.cashReturned.value).toBe(135_000);
    expect(position.capital.moic.value).toBeCloseTo((3_977_500 + 135_000) / 350_000, 10);
    expect(position.capital.totalEconomicGain.value).toBe(3_977_500 + 135_000 - 350_000);
  });

  it("expose une trajectoire financière sur trois exercices", () => {
    expect(position.financials.periods).toHaveLength(3);
    const latest = position.financials.periods.at(-1)!;
    expect(latest.revenueGrowth.value).toBeCloseTo(4_800_000 / 4_350_000 - 1, 10);
    expect(latest.ebitdaMargin.value).toBeCloseTo(650_000 / 4_800_000, 10);
    expect(latest.leverage.value).toBeCloseTo((1_100_000 - 300_000) / 650_000, 10);
  });
});

describe("2. Société endettée — Groupe Fontaine (synthétique)", () => {
  const position = positionOf(result, "fontaine");
  const equity = 980_000 * 5 - 3_600_000 + 210_000;

  it("laisse le levier écraser l'Equity Value sans la masquer", () => {
    expect(position.enterpriseValue.central.value).toBe(4_900_000);
    expect(position.equityValue.central.value).toBe(equity);
    expect(equity).toBe(1_510_000);
  });

  it("n'attribue au patrimoine que la quote-part de l'equity, jamais de l'EV", () => {
    expect(position.attributableValue.central.value).toBeCloseTo(1_510_000 * 0.6, 6);
    expect(position.attributableValue.central.value).toBeCloseTo(906_000, 6);
  });

  it("montre une moins-value économique plutôt qu'un gain flatteur", () => {
    expect(position.capital.totalEconomicGain.value).toBeCloseTo(906_000 - 1_200_000, 6);
    expect(position.capital.moic.value).toBeCloseTo(906_000 / 1_200_000, 10);
  });

  it("mesure un levier supérieur à trois fois l'EBITDA", () => {
    expect(position.financials.periods.at(-1)!.leverage.value).toBeCloseTo(3_390_000 / 980_000, 10);
    expect(position.netDebt.value).toBe(3_390_000);
  });

  it("ne fait jamais entrer la dette corporate au passif personnel", () => {
    const lines = businessEquityBalanceSheetContributions(result);
    expect(lines.every((line) => line.side === "ASSET")).toBe(true);
  });
});

describe("3. Startup financée en capital-risque — Lumen Analytics (synthétique)", () => {
  const position = positionOf(result, "lumen");

  it("dérive le post-money des seuls termes du tour", () => {
    expect(position.equityValue.central.value).toBe(28_000_000);
    expect(position.attributableValue.central.value).toBeCloseTo(28_000_000 * 0.085, 6);
    expect(position.attributableValue.central.value).toBeCloseTo(2_380_000, 6);
  });

  it("réserve explicitement la valeur tant que les préférences sont inconnues", () => {
    expect(flagCodes(position.quality)).toContain("PREFERRED_RIGHTS_UNKNOWN");
  });

  it("ne prétend à aucune Enterprise Value sur un tour de table", () => {
    expect(position.enterpriseValue.central.value).toBeNull();
  });

  it("agrège les deux apports successifs au capital investi", () => {
    expect(position.capital.investedCapital.value).toBe(400_000);
    expect(position.capital.moic.value).toBeCloseTo(2_380_000 / 400_000, 10);
  });
});

describe("4. Holding — Sévigné Holding et Comptoir Marceau (synthétiques)", () => {
  const holdingPosition = positionOf(result, "sevigne");
  const child = positionOf(result, "marceau");
  const childEquity = 820_000 * 6 - 900_000 + 150_000;
  const holdingEquity = childEquity * 0.55 - 1_000_000 + 320_000;

  it("valorise la filiale par son propre pont", () => {
    expect(child.equityValue.central.value).toBe(childEquity);
    expect(childEquity).toBe(4_170_000);
  });

  it("remonte la quote-part et applique le bilan propre de la holding", () => {
    expect(holdingPosition.equityValue.central.value).toBeCloseTo(holdingEquity, 6);
    expect(holdingEquity).toBeCloseTo(1_613_500, 6);
  });

  it("ne compte jamais la filiale une seconde fois au patrimoine personnel", () => {
    expect(child.isDirectHolding).toBe(false);
    expect(result.directPositions.map((position) => position.business.id)).not.toContain("marceau");
    expect(
      businessEquityBalanceSheetContributions(result).map((line) => line.entityId),
    ).not.toContain("marceau");
  });

  it("expose la détention effective de la filiale sans lui attribuer de valeur", () => {
    expect(child.lookThroughEconomicRate.value).toBeCloseTo(0.55, 10);
    expect(child.attributableValue.central.value).toBeNull();
  });
});

describe("5. Participation minoritaire — Clinique Beauvoir (synthétique)", () => {
  const position = positionOf(result, "beauvoir");

  it("applique la quote-part à une Equity Value observée", () => {
    expect(position.equityValue.central.value).toBe(18_500_000);
    expect(position.attributableValue.central.value).toBeCloseTo(18_500_000 * 0.12, 6);
    expect(position.attributableValue.central.value).toBeCloseTo(2_220_000, 6);
  });

  it("dérive la part personnelle des distributions sociales au prorata", () => {
    expect(position.capital.distributionsReceived.value).toBeCloseTo(
      900_000 * 0.12 + 1_200_000 * 0.12,
      6,
    );
    expect(position.capital.distributionsReceived.value).toBeCloseTo(252_000, 6);
    expect(flagCodes(position.capital.events[1].userCash)).toContain(
      "DISTRIBUTION_DERIVED_PRO_RATA",
    );
  });

  it("compose valeur restante et cash retourné dans le MOIC", () => {
    expect(position.capital.moic.value).toBeCloseTo((2_220_000 + 252_000) / 1_000_000, 10);
  });

  it("ne présente pas une expertise externe comme une valeur dérivée", () => {
    expect(position.valuation.isObservedFact).toBe(true);
    expect(position.valuation.isDerivedByEngine).toBe(false);
  });
});

describe("6. Société déficitaire — Studio Halden (synthétique)", () => {
  const position = positionOf(result, "halden");
  const equity = 2_600_000 * 1.4 - 150_000 + 480_000;

  it("valorise au multiple de chiffre d'affaires quand l'EBITDA est négatif", () => {
    expect(position.valuation.metricBasis).toBe("REVENUE");
    expect(position.enterpriseValue.central.value).toBeCloseTo(3_640_000, 6);
    expect(position.equityValue.central.value).toBeCloseTo(equity, 6);
    expect(equity).toBeCloseTo(3_970_000, 6);
  });

  it("attribue la quote-part minoritaire", () => {
    expect(position.attributableValue.central.value).toBeCloseTo(3_970_000 * 0.35, 6);
    expect(position.attributableValue.central.value).toBeCloseTo(1_389_500, 6);
  });

  it("refuse toute marge ou levier sur un EBITDA négatif", () => {
    const latest = position.financials.periods.at(-1)!;
    expect(latest.ebitdaMargin.value).toBeCloseTo(-310_000 / 2_600_000, 10);
    expect(latest.leverage.value).toBeNull();
  });
});

describe("Consolidation du portefeuille synthétique", () => {
  const expectedCentral = 3_977_500 + 906_000 + 2_380_000 + 1_613_500 + 2_220_000 + 1_389_500;

  it("additionne les seules détentions directes", () => {
    expect(result.directPositions).toHaveLength(6);
    expect(result.trackedCount).toBe(7);
    expect(result.totalAttributableValue.central.value).toBeCloseTo(expectedCentral, 6);
    expect(expectedCentral).toBe(12_486_500);
  });

  it("propage la fourchette au total", () => {
    expect(result.totalAttributableValue.low.value).toBeCloseTo(
      expectedCentral - 3_977_500 + (735_000 * 5.5 - 800_000),
      6,
    );
    expect(result.totalAttributableValue.high.value).toBeCloseTo(
      expectedCentral - 3_977_500 + (735_000 * 7.5 - 800_000),
      6,
    );
  });

  it("consolide capital investi, cash retourné et MOIC", () => {
    const invested = 350_000 + 1_200_000 + 400_000 + 600_000 + 1_000_000 + 900_000;
    const returned = 135_000 + 252_000;
    expect(result.totalInvestedCapital.value).toBeCloseTo(invested, 6);
    expect(result.totalCashReturned.value).toBeCloseTo(returned, 6);
    expect(result.portfolioMoic.value).toBeCloseTo((expectedCentral + returned) / invested, 8);
  });

  it("calcule un XIRR de portefeuille sur des flux complets", () => {
    expect(result.portfolioXirr.value).not.toBeNull();
    expect(result.portfolioXirr.value!).toBeGreaterThan(0);
    expect(result.portfolioXirr.value!).toBeLessThan(1);
  });

  it("produit une ligne de bilan par détention directe, toutes à l'actif", () => {
    const lines = businessEquityBalanceSheetContributions(result);
    expect(lines).toHaveLength(6);
    expect(lines.every((line) => line.domain === "BUSINESS_EQUITY" && line.side === "ASSET")).toBe(
      true,
    );
    expect(lines.every((line) => line.liquidity === "ILLIQUID")).toBe(true);
    const total = lines.reduce((sum, line) => sum + (line.nativeValue ?? 0), 0);
    expect(total).toBeCloseTo(expectedCentral, 6);
  });

  it("classe la holding dans sa propre catégorie de bilan", () => {
    const lines = businessEquityBalanceSheetContributions(result);
    expect(lines.find((line) => line.entityId === "sevigne")?.category).toBe("HOLDING_EQUITY");
    expect(lines.find((line) => line.entityId === "vernier")?.category).toBe(
      "PRIVATE_BUSINESS_EQUITY",
    );
  });

  it("reste PARTIEL tant qu'une réserve subsiste, sans jamais devenir faux", () => {
    expect(result.status).toBe("COMPLETE");
    expect(result.valuedCount).toBe(6);
    expect(flagCodes(result.quality)).toContain("PREFERRED_RIGHTS_UNKNOWN");
  });
});
