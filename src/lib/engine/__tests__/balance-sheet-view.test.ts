import { describe, expect, it } from "vitest";
import { buildCanonicalBalanceSheet } from "@/lib/engine/balance-sheet";
import {
  accountGroupTotal,
  buildCanonicalAllocation,
  canonicalBalanceSheetOf,
  envelopeExposureOf,
  knownEnvelopeCash,
  knownMarketExposure,
  marketPositionLines,
  unrealisedPnL,
} from "@/lib/engine/balance-sheet-view";
import type { CurrencyRate } from "@/lib/engine/fx";
import type { DashboardState, FinancialAccount, Position, Provenance } from "@/lib/types";

// Toutes les valeurs de ce fichier sont des fixtures synthétiques.
const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH", effectiveDate: "2026-08-19" };
const AS_OF = "2026-08-19";

function account(
  id: string,
  balance: number,
  type: FinancialAccount["type"] = "PEA",
  currency = "EUR",
): FinancialAccount {
  return {
    id,
    institutionId: "i",
    institution: "Établissement test",
    name: `Compte ${id}`,
    type,
    currency,
    balance,
    balanceDate: AS_OF,
    liquidity: type === "BANK" || type === "SAVINGS" ? "IMMEDIATE" : "LIQUID",
    provenance,
  };
}

function position(
  id: string,
  accountId: string,
  value: number,
  overrides: Partial<Position> = {},
): Position {
  return {
    id,
    accountId,
    securityName: `Titre ${id}`,
    assetClass: "Actions",
    value,
    currency: "EUR",
    isCash: false,
    provenance,
    ...overrides,
  };
}

const usdRate = (rate: number, rateDate = AS_OF): CurrencyRate => ({
  baseCurrency: "USD",
  quoteCurrency: "EUR",
  rate,
  rateDate,
  provenance,
});

function sheetOf(input: {
  accounts: FinancialAccount[];
  positions?: Position[];
  currencyRates?: CurrencyRate[];
}) {
  return buildCanonicalBalanceSheet({
    asOfDate: AS_OF,
    reportingCurrency: "EUR",
    accounts: input.accounts,
    positions: input.positions ?? [],
    liabilities: [],
    currencyRates: input.currencyRates ?? [],
  });
}

/**
 * CAS DE RÉFÉRENCE DU GATE : deux enveloppes, une seule incohérente.
 *
 * PEA 50 000 € parfaitement réconcilié, CTO 2 000 € over-explained. L'exposition du PEA
 * doit rester entièrement connue, le CTO doit rester signalé, le portefeuille global ne
 * doit pas être ramené à zéro et aucune exposition ne doit être inventée au CTO.
 */
describe("expositions par enveloppe — une enveloppe incohérente n’invalide pas les autres", () => {
  const accounts = [
    account("bank", 1000, "BANK"),
    account("pea", 50_000, "PEA"),
    account("cto", 2000, "CTO"),
  ];
  const positions = [
    position("pea-eq", "pea", 40_000),
    position("pea-cash", "pea", 10_000, { assetClass: "Cash", isCash: true }),
    position("cto-eq", "cto", 2500),
  ];
  const sheet = sheetOf({ accounts, positions });

  it("garde l’exposition du PEA entièrement connue", () => {
    const pea = envelopeExposureOf(sheet, "pea");
    expect(pea?.state).toBe("RECONCILED");
    expect(pea?.exposureKnown).toBe(true);
    expect(pea?.marketExposure.value).toBeCloseTo(40_000, 6);
    expect(pea?.cashExposure.value).toBeCloseTo(10_000, 6);
    expect(pea?.unexposedValue.value).toBeCloseTo(0, 6);
  });

  it("laisse le CTO flaggé sans lui inventer d’exposition", () => {
    const cto = envelopeExposureOf(sheet, "cto");
    expect(cto?.state).toBe("OVER_EXPLAINED");
    expect(cto?.exposureKnown).toBe(false);
    // Sa valeur comptable reste entière et sans exposition : ni 2 500 €, ni 0 €.
    expect(cto?.unexposedValue.value).toBeCloseTo(2000, 6);
    expect(cto?.gapNativeValue).toBeCloseTo(-500, 6);
    expect(sheet.quality.flags).toContain("ENVELOPE_EXPOSURE_UNKNOWN:cto");
    expect(sheet.quality.flags).toContain("POSITION_OVER_EXPLAINED:cto");
  });

  it("ne ramène pas le portefeuille global à zéro", () => {
    expect(knownMarketExposure(sheet).value).toBeCloseTo(40_000, 6);
    expect(knownEnvelopeCash(sheet).value).toBeCloseTo(10_000, 6);
  });

  it("boucle la ventilation sur les actifs financiers comptables", () => {
    const allocation = buildCanonicalAllocation(sheet);
    expect(sheet.financialAssets.value).toBeCloseTo(53_000, 6);
    expect(allocation.knownValue).toBeCloseTo(53_000, 6);
    expect(allocation.residual).toBeCloseTo(0, 6);
    // Le total est complet, la ventilation ne l'est pas : les deux statuts sont distincts.
    expect(allocation.compositionStatus).toBe("PARTIAL");
    expect(allocation.blockers).toContain("ENVELOPE_EXPOSURE_UNKNOWN:cto");
    const slice = (key: string) => allocation.slices.find((item) => item.key === key);
    expect(slice("Actions")?.value).toBeCloseTo(40_000, 6);
    expect(slice("ENVELOPE_CASH")?.value).toBeCloseTo(10_000, 6);
    expect(slice("BANK_CASH")?.value).toBeCloseTo(1000, 6);
    expect(slice("UNEXPOSED_ENVELOPE")?.value).toBeCloseTo(2000, 6);
    expect(slice("UNEXPOSED_ENVELOPE")?.unreliable).toBe(true);
  });

  it("n’ajoute jamais les positions du CTO à une classe d’actif", () => {
    const allocation = buildCanonicalAllocation(sheet);
    const actions = allocation.slices.find((item) => item.key === "Actions");
    expect(actions?.accountIds).toEqual(["pea"]);
  });
});

describe("enveloppe partiellement expliquée", () => {
  const sheet = sheetOf({
    accounts: [account("pea", 50_000, "PEA")],
    positions: [position("eq", "pea", 30_000)],
  });

  it("conserve le reliquat comme valeur sans exposition connue", () => {
    const pea = envelopeExposureOf(sheet, "pea");
    expect(pea?.state).toBe("UNDER_EXPLAINED");
    expect(pea?.exposureKnown).toBe(true);
    expect(pea?.marketExposure.value).toBeCloseTo(30_000, 6);
    expect(pea?.unexposedValue.value).toBeCloseTo(20_000, 6);
  });

  it("ventile le reliquat sans le compter deux fois ni l’exposer au marché", () => {
    const allocation = buildCanonicalAllocation(sheet);
    expect(allocation.knownValue).toBeCloseTo(50_000, 6);
    expect(allocation.residual).toBeCloseTo(0, 6);
    // Un écart connu et assumé ne dégrade pas la ventilation : il EST la ventilation.
    expect(allocation.compositionStatus).toBe("COMPLETE");
    expect(allocation.slices.find((item) => item.key === "UNEXPOSED_ENVELOPE")?.value).toBeCloseTo(
      20_000,
      6,
    );
  });
});

describe("enveloppe sans aucune position", () => {
  const sheet = sheetOf({ accounts: [account("pea", 7000, "PEA")] });

  it("n’expose rien et ne prétend pas être réconciliée", () => {
    const pea = envelopeExposureOf(sheet, "pea");
    expect(pea?.state).toBe("UNDER_EXPLAINED");
    expect(pea?.marketExposure.value).toBe(0);
    expect(pea?.unexposedValue.value).toBeCloseTo(7000, 6);
    expect(buildCanonicalAllocation(sheet).knownValue).toBeCloseTo(7000, 6);
  });
});

describe("positions multi-devise", () => {
  const accounts = [account("pea", 50_000, "PEA")];
  const positions = [
    position("eq-eur", "pea", 20_000),
    position("eq-usd", "pea", 30_000, { currency: "USD" }),
  ];

  it("réconcilie et ventile après conversion datée", () => {
    const sheet = sheetOf({ accounts, positions, currencyRates: [usdRate(1)] });
    const pea = envelopeExposureOf(sheet, "pea");
    expect(pea?.state).toBe("RECONCILED");
    expect(pea?.marketExposure.value).toBeCloseTo(50_000, 6);
    expect(buildCanonicalAllocation(sheet).residual).toBeCloseTo(0, 6);
  });

  it("n’additionne pas deux devises sans taux : l’enveloppe devient non exploitable", () => {
    const sheet = sheetOf({ accounts, positions });
    const pea = envelopeExposureOf(sheet, "pea");
    expect(pea?.state).toBe("MISSING");
    expect(pea?.exposureKnown).toBe(false);
    // La valeur comptable de l'enveloppe reste connue ; seule l'exposition est inconnue.
    expect(pea?.unexposedValue.value).toBeCloseTo(50_000, 6);
    expect(sheet.marketInvestedAssets.value).toBeNull();
    expect(sheet.marketInvestedAssets.knownValue).toBeCloseTo(20_000, 6);
    const allocation = buildCanonicalAllocation(sheet);
    expect(allocation.knownValue).toBeCloseTo(50_000, 6);
    expect(allocation.compositionStatus).toBe("PARTIAL");
  });

  it("convertit une enveloppe étrangère et son contenu", () => {
    const sheet = sheetOf({
      accounts: [account("cto", 1000, "CTO", "USD")],
      positions: [position("eq", "cto", 1000, { currency: "USD" })],
      currencyRates: [usdRate(0.9)],
    });
    const cto = envelopeExposureOf(sheet, "cto");
    expect(cto?.state).toBe("RECONCILED");
    expect(cto?.accountValue.value).toBeCloseTo(900, 6);
    expect(cto?.marketExposure.value).toBeCloseTo(900, 6);
    expect(buildCanonicalAllocation(sheet).residual).toBeCloseTo(0, 6);
  });
});

describe("compte non convertible", () => {
  const sheet = sheetOf({
    accounts: [account("bank", 1000, "BANK"), account("usd", 2000, "BANK", "USD")],
  });

  it("ne compte ni pour zéro ni un pour un dans la ventilation", () => {
    const allocation = buildCanonicalAllocation(sheet);
    expect(allocation.flags).toContain("ALLOCATION_ACCOUNT_NOT_CONVERTED:usd");
    expect(allocation.knownValue).toBeCloseTo(1000, 6);
    expect(allocation.financialAssets.value).toBeNull();
    expect(allocation.residual).toBeCloseTo(0, 6);
  });

  it("rend le total d’un groupe non calculable plutôt que faux", () => {
    const total = accountGroupTotal(sheet, ["bank", "usd"]);
    expect(total.value).toBeNull();
    expect(total.knownValue).toBeCloseTo(1000, 6);
    expect(accountGroupTotal(sheet, ["bank"]).value).toBeCloseTo(1000, 6);
  });
});

describe("plus-value latente", () => {
  it("se calcule seulement si tous les coûts sont connus", () => {
    const sheet = sheetOf({
      accounts: [account("pea", 1000, "PEA")],
      positions: [
        position("a", "pea", 600, { costBasis: 500 }),
        position("b", "pea", 400, { costBasis: 450 }),
      ],
    });
    expect(unrealisedPnL(marketPositionLines(sheet)).unrealised).toBeCloseTo(50, 6);
  });

  it("reste non calculable dès qu’un coût manque", () => {
    const sheet = sheetOf({
      accounts: [account("pea", 1000, "PEA")],
      positions: [position("a", "pea", 600, { costBasis: 500 }), position("b", "pea", 400)],
    });
    const pnl = unrealisedPnL(marketPositionLines(sheet));
    expect(pnl.unrealised).toBeNull();
    expect(pnl.blockers).toContain("COST_BASIS_MISSING:b");
  });

  it("signale que l’effet de change n’est pas isolé sur une position étrangère", () => {
    const sheet = sheetOf({
      accounts: [account("cto", 900, "CTO")],
      positions: [position("a", "cto", 1000, { currency: "USD", costBasis: 800 })],
      currencyRates: [usdRate(0.9)],
    });
    const pnl = unrealisedPnL(marketPositionLines(sheet));
    expect(pnl.unrealised).toBeCloseTo(180, 6);
    expect(pnl.fxEffectNotIsolated).toBe(true);
  });
});

describe("canonicalBalanceSheetOf", () => {
  it("reconstruit le bilan à l’identique quand l’état ne le porte pas", () => {
    const accounts = [account("pea", 50_000, "PEA")];
    const positions = [position("eq", "pea", 50_000)];
    const state = {
      asOfDate: AS_OF,
      reportingCurrency: "EUR",
      accounts,
      positions,
      liabilities: [],
      currencyRates: [],
    } as unknown as DashboardState;
    expect(canonicalBalanceSheetOf(state).netWorth.value).toBeCloseTo(50_000, 6);
    const provided = sheetOf({ accounts, positions });
    expect(canonicalBalanceSheetOf({ ...state, balanceSheet: provided })).toBe(provided);
  });
});
