import { describe, expect, it } from "vitest";

import {
  COMPARABLE_CONVENTION,
  derivationOf,
  estimateMarketValue,
  HIGH_DISPERSION_RATIO,
  MIN_USABLE_COMPARABLES,
  unitPriceDistribution,
  type ComparableSaleFact,
} from "@/lib/engine/real-estate-market";

function sale(overrides: Partial<ComparableSaleFact> = {}): ComparableSaleFact {
  return {
    price: 300_000,
    currency: "EUR",
    builtAreaSqm: 60,
    lotCount: 1,
    mutatedOn: "2026-03-15",
    propertyKind: "Appartement",
    ...overrides,
  };
}

/** Cinq mutations à 5 000 €/m², le minimum exploitable. */
function fiveAtFiveThousand(): ComparableSaleFact[] {
  return [50, 55, 60, 65, 70].map((area) => sale({ builtAreaSqm: area, price: area * 5000 }));
}

describe("distribution des prix unitaires", () => {
  it("exclut une mutation sans surface, en le comptant", () => {
    const result = unitPriceDistribution([sale(), sale({ builtAreaSqm: null })]);
    expect(result.distribution?.count).toBe(1);
    expect(result.exclusions.missingArea).toBe(1);
  });

  it("exclut une mutation multi-lots : un prix global n'a pas de prix unitaire", () => {
    const result = unitPriceDistribution([sale(), sale({ lotCount: 3 })]);
    expect(result.distribution?.count).toBe(1);
    expect(result.exclusions.multiLot).toBe(1);
  });

  it("exclut un prix nul : une donation n'est pas une vente comparable", () => {
    const result = unitPriceDistribution([sale(), sale({ price: 0 })]);
    expect(result.exclusions.nonPositivePrice).toBe(1);
  });

  it("exclut les devises minoritaires plutôt que de mélanger deux unités", () => {
    const result = unitPriceDistribution([sale(), sale(), sale({ currency: "CHF" })]);
    expect(result.currency).toBe("EUR");
    expect(result.exclusions.otherCurrency).toBe(1);
  });

  it("rend une distribution nulle, et non zéro, quand rien n'est exploitable", () => {
    const result = unitPriceDistribution([sale({ builtAreaSqm: null })]);
    expect(result.distribution).toBeNull();
  });

  it("calcule la médiane sur un nombre pair de valeurs", () => {
    const result = unitPriceDistribution([
      sale({ builtAreaSqm: 100, price: 400_000 }),
      sale({ builtAreaSqm: 100, price: 600_000 }),
    ]);
    expect(result.distribution?.median).toBe(5000);
  });
});

describe("estimation par comparables", () => {
  it("multiplie la médiane par la surface DÉCLARÉE", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand(),
      surfaceSqm: 80,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.status).toBe("COMPUTED");
    expect(estimate.value).toBe(400_000);
    expect(estimate.convention).toBe(COMPARABLE_CONVENTION);
  });

  it("rend NOT_COMPUTABLE sans surface déclarée, et AUCUNE valeur à côté", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand(),
      surfaceSqm: null,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.status).toBe("NOT_COMPUTABLE");
    expect(estimate.value).toBeNull();
    expect(estimate.flags.map((flag) => flag.code)).toContain("SURFACE_NOT_DECLARED");
    // La distribution reste rendue : le prix au m² est connu, la valeur du bien ne l'est pas.
    expect(estimate.distribution).not.toBeNull();
  });

  it("traite une surface de zéro comme non déclarée, jamais comme une surface", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand(),
      surfaceSqm: 0,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.status).toBe("NOT_COMPUTABLE");
    expect(estimate.value).toBeNull();
  });

  it("refuse d'estimer sous le seuil d'échantillon, sans dégrader en confiance basse", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand().slice(0, MIN_USABLE_COMPARABLES - 1),
      surfaceSqm: 80,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.status).toBe("NOT_COMPUTABLE");
    expect(estimate.value).toBeNull();
    expect(estimate.flags.map((flag) => flag.code)).toContain("SAMPLE_TOO_SMALL");
  });

  it("rend NOT_COMPUTABLE quand aucune mutation n'est exploitable", () => {
    const estimate = estimateMarketValue({
      sales: [sale({ builtAreaSqm: null }), sale({ lotCount: 4 })],
      surfaceSqm: 80,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.status).toBe("NOT_COMPUTABLE");
    expect(estimate.flags.map((flag) => flag.code)).toContain("NO_USABLE_COMPARABLE");
  });

  it("signale un échantillon hétérogène sans refuser le calcul", () => {
    // Prix unitaires de 2 000 à 12 000 : l'écart interquartile dépasse largement le seuil.
    const sales = [2000, 3000, 5000, 11_000, 12_000].map((unit) =>
      sale({ builtAreaSqm: 50, price: unit * 50 }),
    );
    const estimate = estimateMarketValue({
      sales,
      surfaceSqm: 50,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.status).toBe("COMPUTED");
    expect(estimate.distribution!.interquartileRatio).toBeGreaterThan(HIGH_DISPERSION_RATIO);
    expect(estimate.flags.map((flag) => flag.code)).toContain("HIGH_DISPERSION");
    expect(estimate.confidence).toBe("LOW");
  });

  it("ne rend JAMAIS une confiance forte : une estimation reste un modèle", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand(),
      surfaceSqm: 80,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.confidence).toBe("MEDIUM");
  });

  it("signale un instantané périmé et abaisse la confiance", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand(),
      surfaceSqm: 80,
      coverageState: "DECLARED_COVERED",
      stale: true,
    });
    expect(estimate.flags.map((flag) => flag.code)).toContain("SNAPSHOT_STALE");
    expect(estimate.confidence).toBe("LOW");
  });

  it("signale une couverture non déclarée : un vide y serait muet", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand(),
      surfaceSqm: 80,
      coverageState: "COVERAGE_UNKNOWN",
      stale: false,
    });
    expect(estimate.flags.map((flag) => flag.code)).toContain("COVERAGE_NOT_DECLARED");
  });

  it("compte chaque exclusion par motif nommé : rien n'est écarté en silence", () => {
    const estimate = estimateMarketValue({
      sales: [...fiveAtFiveThousand(), sale({ builtAreaSqm: null }), sale({ lotCount: 2 })],
      surfaceSqm: 80,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    expect(estimate.exclusions.missingArea).toBe(1);
    expect(estimate.exclusions.multiLot).toBe(1);
    expect(estimate.flags.map((flag) => flag.code)).toContain("MISSING_AREA_EXCLUDED");
    expect(estimate.flags.map((flag) => flag.code)).toContain("MULTI_LOT_EXCLUDED");
  });
});

describe("intrants persistés", () => {
  it("porte la convention et le décompte : un chiffre dérivé n'est jamais orphelin", () => {
    const estimate = estimateMarketValue({
      sales: fiveAtFiveThousand(),
      surfaceSqm: 80,
      coverageState: "DECLARED_COVERED",
      stale: false,
    });
    const derivation = derivationOf(estimate);
    expect(derivation.convention).toBe(COMPARABLE_CONVENTION);
    expect(derivation.comparable_count).toBe(5);
    expect(derivation.surface_sqm).toBe(80);
    expect(derivation.unit_price_median).toBe(5000);
  });

  it("reste renseigné même sur un résultat non calculable", () => {
    const derivation = derivationOf(
      estimateMarketValue({
        sales: [],
        surfaceSqm: null,
        coverageState: "COVERAGE_UNKNOWN",
        stale: false,
      }),
    );
    expect(derivation.comparable_count).toBe(0);
    expect(derivation.unit_price_median).toBeNull();
  });
});
