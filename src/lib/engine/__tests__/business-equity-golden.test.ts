import { describe, expect, it } from "vitest";

import { businessEquityBalanceSheetContributions } from "@/lib/engine/business-equity";
import { fundingRoundOutcome } from "@/lib/engine/business-ownership";
import {
  AS_OF,
  adjustment,
  blockerCodes,
  business,
  capitalEvent,
  financials,
  flagCodes,
  holding,
  ownership,
  portfolio,
  positionOf,
  rate,
  valuation,
} from "@/lib/engine/__tests__/fixtures/business";

/**
 * GOLDEN CASES BUSINESS EQUITY V2.1
 *
 * Chaque cas suit la même structure : INPUT (les faits déclarés), EXPECTED DERIVATION (le
 * chemin que le moteur doit emprunter), EXPECTED OUTPUT (les montants), EXPECTED QUALITY
 * (les motifs et réserves). Un cas qui produirait le bon chiffre par le mauvais chemin est
 * un cas raté : c'est pourquoi la dérivation est vérifiée étape par étape sur le pont.
 *
 * Les montants attendus sont posés à la main, indépendamment du code, et non recopiés
 * depuis une exécution : un golden test qui grave le comportement actuel ne teste rien.
 */

const COMPLETE_HISTORY = {
  capitalHistorySource: "DECLARED_COMPLETE" as const,
  capitalHistoryStart: "2015-01-01",
};

describe("Golden case 1 — PME rentable valorisée au multiple d'EBITDA", () => {
  /**
   * INPUT       CA 4,8 M€ · EBITDA 650 k€ · cash 300 k€ · dette brute 1,1 M€ · 6,0× · 70 %
   * DERIVATION  650 000 × 6 = 3 900 000 (EV) ; 3 900 000 − 1 100 000 + 300 000 = 3 100 000
   *             (Equity) ; 3 100 000 × 0,70 = 2 170 000 (valeur personnelle)
   * OUTPUT      EV 3,9 M€ · dette nette 800 k€ · Equity 3,1 M€ · attribuable 2,17 M€
   * QUALITY     aucun motif, aucune réserve
   */
  const result = portfolio({
    businesses: [business({ id: "pme", name: "OpCo", ...COMPLETE_HISTORY })],
    ownership: [
      ownership({ id: "o", businessId: "pme", effectiveDate: "2020-01-01", legalRate: 0.7 }),
    ],
    financials: [
      financials({
        id: "f",
        businessId: "pme",
        periodEnd: "2025-12-31",
        revenue: 4_800_000,
        ebitda: 650_000,
        cash: 300_000,
        grossDebt: 1_100_000,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "pme",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
        metricBasis: "EBITDA",
      }),
    ],
    capitalEvents: [
      capitalEvent({
        id: "c",
        businessId: "pme",
        type: "OPENING_COST_BASIS",
        eventDate: "2015-01-01",
        amount: 500_000,
      }),
    ],
  });
  const position = positionOf(result, "pme");

  it("dérive l'Enterprise Value du multiple appliqué à l'EBITDA, sans jamais la faire saisir", () => {
    expect(position.valuation.isDerivedByEngine).toBe(true);
    expect(position.valuation.basis?.enterpriseValue).toBeNull();
    expect(position.enterpriseValue.central.value).toBe(3_900_000);
  });

  it("ponte EV vers Equity par la dette brute et le cash, jamais par la détention", () => {
    expect(position.netDebt.value).toBe(800_000);
    expect(position.equityValue.central.value).toBe(3_100_000);
  });

  it("attribue au patrimoine la seule part des droits économiques", () => {
    expect(position.attributableValue.central.value).toBe(2_170_000);
    expect(result.totalAttributableValue.central.value).toBe(2_170_000);
    expect(result.status).toBe("COMPLETE");
  });

  it("expose un pont lisible de l'EBITDA observé à la valeur personnelle", () => {
    const keys = position.valuation.bridge.map((step) => step.key);
    expect(keys).toEqual([
      "METRIC_OBSERVED:EBITDA",
      "MULTIPLE",
      "ENTERPRISE_VALUE",
      "GROSS_DEBT",
      "CASH",
      "EQUITY_VALUE",
      "ECONOMIC_OWNERSHIP",
      "ATTRIBUTABLE_VALUE",
    ]);
    expect(position.valuation.bridge.at(-1)?.amount.value).toBe(2_170_000);
  });

  it("ne signale ni motif ni réserve", () => {
    expect(position.quality.blockers).toEqual([]);
    expect(position.quality.flags).toEqual([]);
  });
});

describe("Golden case 2 — société en trésorerie nette", () => {
  /**
   * INPUT       EBITDA 367 293 € · multiple 6,0× · cash 45 000 € · dette brute 0 DÉCLARÉE
   * DERIVATION  367 293 × 6 = 2 203 758 ; 2 203 758 − 0 + 45 000 = 2 248 758
   * OUTPUT      EV 2 203 758 € · Equity 2 248 758 € · dette nette −45 000 €
   * QUALITY     aucun motif : le zéro de dette est DÉCLARÉ, pas supposé
   */
  const result = portfolio({
    businesses: [business({ id: "b", name: "NetCash", ...COMPLETE_HISTORY })],
    ownership: [ownership({ id: "o", businessId: "b", effectiveDate: "2020-01-01", legalRate: 1 })],
    financials: [
      financials({
        id: "f",
        businessId: "b",
        periodEnd: "2025-12-31",
        ebitda: 367_293,
        cash: 45_000,
        grossDebt: 0,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "b",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
      }),
    ],
    capitalEvents: [
      capitalEvent({
        id: "c",
        businessId: "b",
        type: "ACQUISITION",
        eventDate: "2015-06-01",
        amount: 900_000,
      }),
    ],
  });
  const position = positionOf(result, "b");

  it("produit exactement 2 203 758 € d'Enterprise Value", () => {
    expect(position.enterpriseValue.central.value).toBe(2_203_758);
  });

  it("ajoute la trésorerie et retranche une dette déclarée nulle", () => {
    expect(position.equityValue.central.value).toBe(2_248_758);
    expect(position.netDebt.value).toBe(-45_000);
  });
});

describe("Golden case 3 — Enterprise Value connue, dette inconnue", () => {
  /**
   * INPUT       EV observée 12 M€ · détention 30 % · aucune période financière
   * DERIVATION  refus : sans dette brute ni cash datés, EV × détention attribuerait à
   *             l'actionnaire la valeur qui revient aux créanciers
   * OUTPUT      Equity Value et valeur attribuable NON CALCULABLES
   * QUALITY     EV_TO_EQUITY_GROSS_DEBT_MISSING, EV_TO_EQUITY_CASH_MISSING
   */
  const result = portfolio({
    businesses: [business({ id: "t", name: "Target" })],
    ownership: [
      ownership({ id: "o", businessId: "t", effectiveDate: "2025-01-01", legalRate: 0.3 }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "t",
        valuationDate: "2026-01-01",
        method: "EXTERNAL_APPRAISAL",
        enterpriseValue: 12_000_000,
      }),
    ],
  });
  const position = positionOf(result, "t");

  it("connaît l'Enterprise Value", () => {
    expect(position.enterpriseValue.central.value).toBe(12_000_000);
  });

  it("refuse d'en dériver une Equity Value", () => {
    expect(position.equityValue.central.value).toBeNull();
    expect(blockerCodes(position.equityValue.central)).toEqual(
      expect.arrayContaining(["EV_TO_EQUITY_GROSS_DEBT_MISSING", "EV_TO_EQUITY_CASH_MISSING"]),
    );
  });

  it("rend la valeur attribuable non calculable, et le total avec elle", () => {
    expect(position.attributableValue.central.value).toBeNull();
    expect(result.totalAttributableValue.central.value).toBeNull();
    expect(result.status).toBe("NOT_COMPUTABLE");
  });
});

describe("Golden case 4 — dilution d'une startup au tour de table", () => {
  /**
   * INPUT       pre-money 8 M€ · argent frais primaire 2 M€ · détention 25 % · aucune
   *             souscription de l'utilisateur
   * DERIVATION  post-money = 8 + 2 = 10 M€ ; détention = (0,25 × 8) ÷ 10 = 20 %
   * OUTPUT      post-money 10 M€ · détention 20 % · dilution 5 points
   * QUALITY     PREFERRED_RIGHTS_UNKNOWN : post-money × détention est une borne haute
   */
  const outcome = fundingRoundOutcome({
    preMoneyEquityValue: 8_000_000,
    primaryNewMoney: 2_000_000,
    secondaryAmount: null,
    ownershipBefore: 0.25,
    investorContribution: 0,
    preferredRightsKnown: false,
  });

  it("dérive le post-money du seul argent frais primaire", () => {
    expect(outcome.postMoneyEquityValue.value).toBe(10_000_000);
  });

  it("dilue l'actionnaire qui ne participe pas au ratio pre ÷ post", () => {
    expect(outcome.ownershipAfter.value).toBeCloseTo(0.2, 12);
    expect(outcome.dilution.value).toBeCloseTo(0.05, 12);
  });

  it("réserve explicitement la valeur économique tant que les préférences sont inconnues", () => {
    expect(flagCodes(outcome.ownershipAfter)).toContain("PREFERRED_RIGHTS_UNKNOWN");
  });

  it("alimente le portefeuille par la même mécanique, sans double saisie", () => {
    const result = portfolio({
      businesses: [business({ id: "s", name: "Startup", type: "STARTUP" })],
      ownership: [
        ownership({ id: "o", businessId: "s", effectiveDate: "2026-03-01", legalRate: 0.2 }),
      ],
      valuations: [
        valuation({
          id: "v",
          businessId: "s",
          valuationDate: "2026-03-01",
          method: "FUNDING_ROUND",
          preMoneyEquityValue: 8_000_000,
          primaryNewMoney: 2_000_000,
          preferredRightsKnown: false,
        }),
      ],
    });
    const position = positionOf(result, "s");
    expect(position.equityValue.central.value).toBe(10_000_000);
    expect(position.attributableValue.central.value).toBe(2_000_000);
    expect(flagCodes(position.quality)).toContain("PREFERRED_RIGHTS_UNKNOWN");
  });
});

/** Socle commun aux cas de cession : une société valorisée 4 M€ d'Equity Value. */
function saleCase(
  events: Parameters<typeof capitalEvent>[0][],
  ownershipRows: Parameters<typeof ownership>[0][],
) {
  return portfolio({
    businesses: [
      business({ id: "x", name: "ExitCo", ...COMPLETE_HISTORY, capitalHistoryStart: "2018-01-01" }),
    ],
    ownership: ownershipRows.map(ownership),
    financials: [
      financials({
        id: "f",
        businessId: "x",
        periodEnd: "2025-12-31",
        ebitda: 500_000,
        cash: 0,
        grossDebt: 0,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "x",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 8,
      }),
    ],
    capitalEvents: events.map(capitalEvent),
  });
}

describe("Golden case 5 — cession partielle", () => {
  /**
   * INPUT       coût de revient 1 M€ (100 %) · cession de 40 points le 31/03/2026 pour
   *             1,6 M€ · Equity Value 4 M€ · détention résiduelle 60 %
   * DERIVATION  coût libéré = 1 000 000 × (0,40 ÷ 1,00) = 400 000 (coût moyen pondéré)
   *             PnL réalisée = 1 600 000 − 400 000 = 1 200 000
   *             valeur restante = 4 000 000 × 0,60 = 2 400 000
   *             PnL latente = 2 400 000 − 600 000 = 1 800 000
   * OUTPUT      MOIC = (2 400 000 + 1 600 000) ÷ 1 000 000 = 4,00×
   * QUALITY     aucun motif : l'historique est déclaré complet
   */
  const result = saleCase(
    [
      {
        id: "c1",
        businessId: "x",
        type: "OPENING_COST_BASIS",
        eventDate: "2018-01-01",
        amount: 1_000_000,
      },
      {
        id: "c2",
        businessId: "x",
        type: "SALE",
        eventDate: "2026-03-31",
        amount: 1_600_000,
        ownershipDelta: -0.4,
        ownershipRateAfter: 0.6,
      },
    ],
    [
      { id: "o1", businessId: "x", effectiveDate: "2018-01-01", legalRate: 1 },
      { id: "o2", businessId: "x", effectiveDate: "2026-03-31", legalRate: 0.6 },
    ],
  );
  const position = positionOf(result, "x");

  it("retient la détention applicable à la date de lecture", () => {
    expect(position.ownership.economicRate.value).toBe(0.6);
    expect(position.attributableValue.central.value).toBe(2_400_000);
  });

  it("libère le coût de revient au prorata de la quote-part cédée", () => {
    expect(position.capital.releasedCostBasis.value).toBe(400_000);
    expect(position.capital.remainingCostBasis.value).toBe(600_000);
  });

  it("sépare PnL réalisée et PnL latente", () => {
    expect(position.capital.realisedPnL.value).toBe(1_200_000);
    expect(position.capital.unrealisedPnL.value).toBe(1_800_000);
  });

  it("calcule un MOIC de 4,00×", () => {
    expect(position.capital.moic.value).toBeCloseTo(4, 12);
    expect(position.capital.cashReturned.value).toBe(1_600_000);
  });
});

describe("Golden case 6 — cession totale", () => {
  /**
   * INPUT       coût de revient 1 M€ · cession intégrale le 31/03/2026 pour 4 M€ ·
   *             détention ramenée à 0
   * DERIVATION  fraction cédée = 1 ; coût libéré = 1 M€ ; PnL réalisée = 3 M€
   *             ne rien détenir d'une société encore valorisée vaut ZÉRO, pas « inconnu »
   * OUTPUT      valeur personnelle 0 € · MOIC 4,00× · XIRR calculable
   * QUALITY     OWNERSHIP_FULLY_EXITED
   */
  const result = saleCase(
    [
      {
        id: "c1",
        businessId: "x",
        type: "OPENING_COST_BASIS",
        eventDate: "2018-01-01",
        amount: 1_000_000,
      },
      {
        id: "c2",
        businessId: "x",
        type: "SALE",
        eventDate: "2026-03-31",
        amount: 4_000_000,
        ownershipDelta: -1,
        ownershipRateAfter: 0,
      },
    ],
    [
      { id: "o1", businessId: "x", effectiveDate: "2018-01-01", legalRate: 1 },
      { id: "o2", businessId: "x", effectiveDate: "2026-03-31", legalRate: 0 },
    ],
  );
  const position = positionOf(result, "x");

  it("ramène la valeur personnelle à zéro sans la rendre non calculable", () => {
    expect(position.attributableValue.central.value).toBe(0);
    expect(position.attributableValue.central.blockers).toEqual([]);
    expect(flagCodes(position.ownership)).toContain("OWNERSHIP_FULLY_EXITED");
  });

  it("réalise l'intégralité de la plus-value", () => {
    expect(position.capital.realisedPnL.value).toBe(3_000_000);
    expect(position.capital.remainingCostBasis.value).toBe(0);
    expect(position.capital.unrealisedPnL.value).toBe(0);
  });

  it("mesure un rendement sur des flux complets", () => {
    expect(position.capital.moic.value).toBeCloseTo(4, 12);
    expect(position.capital.xirr.value).not.toBeNull();
    expect(position.capital.xirr.value!).toBeGreaterThan(0.15);
  });
});

describe("Golden case 7 — dividendes : distribution sociale ≠ cash reçu", () => {
  /**
   * INPUT       détention économique 30 % · distribution SOCIALE de 200 k€ le 30/06/2026 ·
   *             dividende PERSONNEL de 40 k€ le 15/07/2026
   * DERIVATION  part personnelle de la distribution sociale = 200 000 × 0,30 = 60 000
   *             cash retourné = 60 000 + 40 000 = 100 000
   * OUTPUT      distributions perçues 100 k€, jamais 240 k€
   * QUALITY     DISTRIBUTION_DERIVED_PRO_RATA sur la ligne dérivée
   */
  const result = portfolio({
    businesses: [business({ id: "d", name: "DivCo", ...COMPLETE_HISTORY })],
    ownership: [
      ownership({ id: "o", businessId: "d", effectiveDate: "2015-01-01", legalRate: 0.3 }),
    ],
    financials: [
      financials({
        id: "f",
        businessId: "d",
        periodEnd: "2025-12-31",
        ebitda: 400_000,
        cash: 0,
        grossDebt: 0,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "d",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 5,
      }),
    ],
    capitalEvents: [
      capitalEvent({
        id: "c0",
        businessId: "d",
        type: "ACQUISITION",
        eventDate: "2015-01-01",
        amount: 300_000,
      }),
      capitalEvent({
        id: "c1",
        businessId: "d",
        type: "DISTRIBUTION",
        eventDate: "2026-06-30",
        amount: 200_000,
        amountScope: "COMPANY_TOTAL",
      }),
      capitalEvent({
        id: "c2",
        businessId: "d",
        type: "DIVIDEND",
        eventDate: "2026-07-15",
        amount: 40_000,
      }),
    ],
  });
  const position = positionOf(result, "d");

  it("ne confond jamais le montant distribué par la société avec le cash personnel", () => {
    const social = position.capital.events.find((view) => view.event.id === "c1")!;
    expect(social.companyAmount?.value).toBe(200_000);
    expect(social.userCash.value).toBe(60_000);
    expect(social.derivedProRata).toBe(true);
  });

  it("consolide 100 k€ de distributions perçues", () => {
    expect(position.capital.distributionsReceived.value).toBe(100_000);
  });

  it("signale la dérivation au prorata plutôt que de la passer sous silence", () => {
    const social = position.capital.events.find((view) => view.event.id === "c1")!;
    expect(flagCodes(social.userCash)).toContain("DISTRIBUTION_DERIVED_PRO_RATA");
  });
});

describe("Golden case 8 — coût de revient historique absent", () => {
  /**
   * INPUT       société valorisée, aucune opération de capital, couverture NON déclarée
   * DERIVATION  aucune : une absence d'événement n'est pas un historique vide
   * OUTPUT      capital investi, gain, MOIC et XIRR NON CALCULABLES ; la valeur, elle,
   *             reste calculable
   * QUALITY     COST_BASIS_HISTORY_MISSING, CAPITAL_HISTORY_NOT_DECLARED
   */
  const result = portfolio({
    businesses: [business({ id: "n", name: "NoHistory" })],
    ownership: [
      ownership({ id: "o", businessId: "n", effectiveDate: "2024-01-01", legalRate: 0.2 }),
    ],
    financials: [
      financials({
        id: "f",
        businessId: "n",
        periodEnd: "2025-12-31",
        ebitda: 100_000,
        cash: 0,
        grossDebt: 0,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "n",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 10,
      }),
    ],
  });
  const position = positionOf(result, "n");

  it("valorise malgré tout la participation", () => {
    expect(position.attributableValue.central.value).toBe(200_000);
  });

  it("n'invente jamais un capital investi nul", () => {
    expect(position.capital.investedCapital.value).toBeNull();
    expect(blockerCodes(position.capital.investedCapital)).toContain("COST_BASIS_HISTORY_MISSING");
  });

  it("refuse tout indicateur de performance sur un historique non déclaré", () => {
    expect(position.capital.totalEconomicGain.value).toBeNull();
    expect(position.capital.moic.value).toBeNull();
    expect(position.capital.xirr.value).toBeNull();
    expect(blockerCodes(position.capital.moic)).toContain("CAPITAL_HISTORY_NOT_DECLARED");
  });
});

describe("Golden case 9 — holding à un niveau", () => {
  /**
   * INPUT       utilisateur 80 % de HoldCo · HoldCo 60 % d'OpCo · OpCo Equity 5 M€ ·
   *             HoldCo cash propre 200 k€, dette propre 400 k€
   * DERIVATION  HoldCo = 0,60 × 5 000 000 − 400 000 + 200 000 = 2 800 000
   *             personnel = 0,80 × 2 800 000 = 2 240 000
   * OUTPUT      total 2,24 M€ — OpCo n'entre PAS séparément au patrimoine
   * QUALITY     LOOK_THROUGH_VALUATION
   */
  const result = portfolio({
    businesses: [
      business({ id: "h", name: "HoldCo", type: "HOLDING" }),
      business({ id: "c", name: "OpCo" }),
    ],
    ownership: [
      ownership({ id: "o", businessId: "h", effectiveDate: "2020-01-01", legalRate: 0.8 }),
    ],
    financials: [
      financials({
        id: "fh",
        businessId: "h",
        periodEnd: "2025-12-31",
        cash: 200_000,
        grossDebt: 400_000,
      }),
    ],
    valuations: [
      valuation({
        id: "vc",
        businessId: "c",
        valuationDate: "2026-06-30",
        method: "EXTERNAL_APPRAISAL",
        equityValue: 5_000_000,
      }),
    ],
    holdings: [
      holding({
        id: "l",
        parentBusinessId: "h",
        childBusinessId: "c",
        effectiveDate: "2020-01-01",
        ownershipRate: 0.6,
      }),
    ],
  });

  it("valorise la holding par transparence, bilan propre compris", () => {
    expect(positionOf(result, "h").equityValue.central.value).toBe(2_800_000);
  });

  it("n'attribue au patrimoine que la holding détenue directement", () => {
    expect(positionOf(result, "h").attributableValue.central.value).toBe(2_240_000);
    expect(result.totalAttributableValue.central.value).toBe(2_240_000);
    expect(result.directPositions.map((position) => position.business.id)).toEqual(["h"]);
  });

  it("n'émet aucune ligne de bilan pour la filiale déjà comptée dans la mère", () => {
    const lines = businessEquityBalanceSheetContributions(result);
    expect(lines).toHaveLength(1);
    expect(lines[0].entityId).toBe("h");
  });
});

describe("Golden case 10 — holding à plusieurs niveaux", () => {
  /**
   * INPUT       utilisateur 80 % TopCo · TopCo 60 % MidCo · MidCo 50 % OpCo ·
   *             OpCo Equity 10 M€ · TopCo cash propre 100 k€ · MidCo bilan propre nul DÉCLARÉ
   * DERIVATION  MidCo = 0,50 × 10 000 000 = 5 000 000
   *             TopCo = 0,60 × 5 000 000 + 100 000 = 3 100 000
   *             personnel = 0,80 × 3 100 000 = 2 480 000
   * OUTPUT      2,48 M€
   */
  const result = portfolio({
    businesses: [
      business({ id: "top", name: "TopCo", type: "HOLDING" }),
      business({ id: "mid", name: "MidCo", type: "HOLDING" }),
      business({ id: "op", name: "OpCo" }),
    ],
    ownership: [
      ownership({ id: "o", businessId: "top", effectiveDate: "2020-01-01", legalRate: 0.8 }),
    ],
    financials: [
      financials({
        id: "ft",
        businessId: "top",
        periodEnd: "2025-12-31",
        cash: 100_000,
        grossDebt: 0,
      }),
      financials({ id: "fm", businessId: "mid", periodEnd: "2025-12-31", cash: 0, grossDebt: 0 }),
    ],
    valuations: [
      valuation({
        id: "vo",
        businessId: "op",
        valuationDate: "2026-06-30",
        method: "EXTERNAL_APPRAISAL",
        equityValue: 10_000_000,
      }),
    ],
    holdings: [
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
    ],
  });

  it("remonte la chaîne de détention niveau par niveau", () => {
    expect(positionOf(result, "mid").equityValue.central.value).toBe(5_000_000);
    expect(positionOf(result, "top").equityValue.central.value).toBe(3_100_000);
  });

  it("n'attribue au patrimoine que le sommet de la chaîne", () => {
    expect(result.totalAttributableValue.central.value).toBe(2_480_000);
    expect(result.directPositions).toHaveLength(1);
  });

  it("expose la détention économique effective de la filiale terminale", () => {
    expect(positionOf(result, "op").lookThroughEconomicRate.value).toBeCloseTo(0.8 * 0.6 * 0.5, 12);
  });
});

describe("Golden case 11 — devise étrangère", () => {
  /**
   * INPUT       société en CHF · EBITDA 1 000 000 CHF · 5,0× · dette 1 000 000 CHF ·
   *             cash 500 000 CHF · taux CHF→EUR 0,95
   * DERIVATION  EV 5 000 000 CHF → 4 750 000 € ; dette 950 000 € ; cash 475 000 €
   *             Equity = 4 750 000 − 950 000 + 475 000 = 4 275 000 €
   * OUTPUT      4 275 000 €
   * QUALITY     aucune : le taux est daté et antérieur aux faits convertis
   */
  const rates = [rate("CHF", "EUR", 0.95, "2025-01-01")];
  const base = {
    businesses: [business({ id: "ch", name: "SwissCo", functionalCurrency: "CHF", country: "CH" })],
    ownership: [
      ownership({ id: "o", businessId: "ch", effectiveDate: "2020-01-01", legalRate: 1 }),
    ],
    financials: [
      financials({
        id: "f",
        businessId: "ch",
        periodEnd: "2025-12-31",
        currency: "CHF",
        ebitda: 1_000_000,
        cash: 500_000,
        grossDebt: 1_000_000,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "ch",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 5,
        currency: "CHF",
      }),
    ],
  };

  it("convertit chaque fait à la date du fait, via le FX Engine", () => {
    const position = positionOf(portfolio({ ...base, currencyRates: rates }), "ch");
    expect(position.enterpriseValue.central.value).toBeCloseTo(4_750_000, 6);
    expect(position.equityValue.central.value).toBeCloseTo(4_275_000, 6);
  });

  it("refuse de convertir à un pour un quand aucun taux n'existe", () => {
    const position = positionOf(portfolio({ ...base, currencyRates: [] }), "ch");
    expect(position.equityValue.central.value).toBeNull();
    expect(blockerCodes(position.equityValue.central)).toContain("FX_RATE_MISSING");
  });
});

describe("Golden case 12 — valorisation périmée", () => {
  /**
   * INPUT       valorisation du 30/06/2024, lue au 19/08/2026 (> 365 jours)
   * DERIVATION  la valeur est utilisée TELLE QUELLE : ni indexée, ni corrigée
   * OUTPUT      Equity Value 2 000 000 €
   * QUALITY     VALUATION_STALE, et statut STALE sur la ligne de bilan
   */
  const result = portfolio({
    businesses: [business({ id: "s", name: "StaleCo" })],
    ownership: [ownership({ id: "o", businessId: "s", effectiveDate: "2020-01-01", legalRate: 1 })],
    valuations: [
      valuation({
        id: "v",
        businessId: "s",
        valuationDate: "2024-06-30",
        method: "TRANSACTION",
        equityValue: 2_000_000,
      }),
    ],
  });
  const position = positionOf(result, "s");

  it("conserve la valeur observée sans la corriger", () => {
    expect(position.equityValue.central.value).toBe(2_000_000);
  });

  it("signale l'ancienneté et la propage au bilan", () => {
    expect(flagCodes(position.quality)).toContain("VALUATION_STALE");
    expect(businessEquityBalanceSheetContributions(result)[0].valuationStatus).toBe("STALE");
  });
});

describe("Golden case 13 — EBITDA négatif", () => {
  /**
   * INPUT       CA 3 M€ · EBITDA −200 k€ · dette 500 k€ · cash 100 k€
   * DERIVATION  un multiple d'EBITDA appliqué à un EBITDA négatif produit une EV négative :
   *             le calcul aboutit mais est SIGNALÉ. Le multiple de CA reste, lui, pertinent.
   * OUTPUT      multiple de CA 1,2× → EV 3,6 M€ → Equity 3,2 M€
   * QUALITY     EBITDA_NEGATIVE sur le chemin EBITDA
   */
  const facts = {
    businesses: [business({ id: "l", name: "LossCo", type: "STARTUP" })],
    ownership: [ownership({ id: "o", businessId: "l", effectiveDate: "2020-01-01", legalRate: 1 })],
    financials: [
      financials({
        id: "f",
        businessId: "l",
        periodEnd: "2025-12-31",
        revenue: 3_000_000,
        ebitda: -200_000,
        cash: 100_000,
        grossDebt: 500_000,
      }),
    ],
  };

  it("signale qu'un multiple d'EBITDA n'a pas de sens sur un EBITDA négatif", () => {
    const result = portfolio({
      ...facts,
      valuations: [
        valuation({
          id: "v",
          businessId: "l",
          valuationDate: "2026-06-30",
          method: "EBITDA_MULTIPLE",
          multiple: 6,
        }),
      ],
    });
    expect(flagCodes(positionOf(result, "l").quality)).toContain("EBITDA_NEGATIVE");
  });

  it("permet la valorisation par multiple de chiffre d'affaires", () => {
    const result = portfolio({
      ...facts,
      valuations: [
        valuation({
          id: "v",
          businessId: "l",
          valuationDate: "2026-06-30",
          method: "REVENUE_MULTIPLE",
          multiple: 1.2,
          metricBasis: "REVENUE",
        }),
      ],
    });
    const position = positionOf(result, "l");
    expect(position.enterpriseValue.central.value).toBeCloseTo(3_600_000, 6);
    expect(position.equityValue.central.value).toBeCloseTo(3_200_000, 6);
  });
});

describe("Golden case 14 — ajustements d'EBITDA", () => {
  /**
   * INPUT       EBITDA observé 300 k€ · rémunération dirigeant normalisée +80 k€ ·
   *             exceptionnel +25 k€ · charge non récurrente −15 k€ · 6,0× · cash 60 k€ ·
   *             dette 0 DÉCLARÉE
   * DERIVATION  EBITDA ajusté = 300 + 80 + 25 − 15 = 390 k€ ; EV = 2 340 k€ ;
   *             Equity = 2 340 + 60 = 2 400 k€
   * OUTPUT      EBITDA ajusté 390 k€ · Equity 2,4 M€
   * QUALITY     EBITDA_ADJUSTED
   */
  const result = portfolio({
    businesses: [business({ id: "a", name: "AdjCo" })],
    ownership: [ownership({ id: "o", businessId: "a", effectiveDate: "2020-01-01", legalRate: 1 })],
    financials: [
      financials({
        id: "f",
        businessId: "a",
        periodEnd: "2025-12-31",
        revenue: 2_000_000,
        ebitda: 300_000,
        cash: 60_000,
        grossDebt: 0,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "a",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
        metricPeriodEnd: "2025-12-31",
      }),
    ],
    ebitdaAdjustments: [
      adjustment({
        id: "a1",
        businessId: "a",
        periodEnd: "2025-12-31",
        label: "Rémunération dirigeant normalisée",
        amount: 80_000,
        category: "OWNER_COMPENSATION",
      }),
      adjustment({
        id: "a2",
        businessId: "a",
        periodEnd: "2025-12-31",
        label: "Litige exceptionnel",
        amount: 25_000,
        category: "EXCEPTIONAL",
      }),
      adjustment({
        id: "a3",
        businessId: "a",
        periodEnd: "2025-12-31",
        label: "Recrutement non récurrent",
        amount: -15_000,
        category: "NON_RECURRING",
      }),
    ],
  });
  const position = positionOf(result, "a");

  it("part de l'EBITDA observé et n'ajoute que des retraitements déclarés", () => {
    expect(position.valuation.observedMetric?.value).toBe(300_000);
    expect(position.valuation.adjustedMetric?.value).toBe(390_000);
  });

  it("rend chaque retraitement visible dans le pont", () => {
    const labels = position.valuation.bridge
      .filter((step) => step.kind === "ADJUSTMENT")
      .map((step) => step.label);
    expect(labels).toEqual([
      "Litige exceptionnel",
      "Recrutement non récurrent",
      "Rémunération dirigeant normalisée",
    ]);
  });

  it("valorise sur l'EBITDA ajusté", () => {
    expect(position.enterpriseValue.central.value).toBe(2_340_000);
    expect(position.equityValue.central.value).toBe(2_400_000);
    expect(flagCodes(position.quality)).toContain("EBITDA_ADJUSTED");
  });
});

describe("Golden case 15 — valorisations contradictoires", () => {
  /**
   * INPUT       même date : TRANSACTION à 5 M€ d'Equity et EXTERNAL_APPRAISAL à 4 M€
   * DERIVATION  préséance documentée : un prix réellement traité prime sur une expertise.
   *             Les deux restent exposées, le conflit n'est ni fusionné ni moyenné.
   * OUTPUT      Equity retenue 5 M€ ; une alternative conservée
   * QUALITY     CONFLICTING_VALUATIONS
   */
  const result = portfolio({
    businesses: [business({ id: "k", name: "ConflictCo" })],
    ownership: [ownership({ id: "o", businessId: "k", effectiveDate: "2020-01-01", legalRate: 1 })],
    valuations: [
      valuation({
        id: "v1",
        businessId: "k",
        valuationDate: "2026-06-30",
        method: "EXTERNAL_APPRAISAL",
        equityValue: 4_000_000,
      }),
      valuation({
        id: "v2",
        businessId: "k",
        valuationDate: "2026-06-30",
        method: "TRANSACTION",
        equityValue: 5_000_000,
      }),
    ],
  });
  const position = positionOf(result, "k");

  it("retient le fait le plus fort sans moyenner", () => {
    expect(position.valuation.method).toBe("TRANSACTION");
    expect(position.equityValue.central.value).toBe(5_000_000);
  });

  it("conserve l'alternative et signale la divergence", () => {
    expect(position.valuation.alternatives.map((item) => item.method)).toEqual([
      "EXTERNAL_APPRAISAL",
    ]);
    expect(flagCodes(position.quality)).toContain("CONFLICTING_VALUATIONS");
  });
});

describe("Golden case 16 — zéro déclaré contre inconnu", () => {
  /**
   * Le même jeu de faits, à un champ près. Une dette DÉCLARÉE nulle produit une Equity
   * Value ; une dette NON DÉCLARÉE n'en produit aucune. C'est l'invariant NULL ≠ ZERO, et
   * il vaut des centaines de milliers d'euros d'écart de patrimoine.
   */
  const shared = {
    businesses: [business({ id: "z", name: "ZeroCo" })],
    ownership: [ownership({ id: "o", businessId: "z", effectiveDate: "2020-01-01", legalRate: 1 })],
    valuations: [
      valuation({
        id: "v",
        businessId: "z",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 5,
      }),
    ],
  };

  it("calcule quand le zéro est déclaré", () => {
    const result = portfolio({
      ...shared,
      financials: [
        financials({
          id: "f",
          businessId: "z",
          periodEnd: "2025-12-31",
          ebitda: 200_000,
          cash: 0,
          grossDebt: 0,
        }),
      ],
    });
    expect(positionOf(result, "z").equityValue.central.value).toBe(1_000_000);
  });

  it("refuse de calculer quand la dette est inconnue", () => {
    const result = portfolio({
      ...shared,
      financials: [
        financials({ id: "f", businessId: "z", periodEnd: "2025-12-31", ebitda: 200_000, cash: 0 }),
      ],
    });
    const position = positionOf(result, "z");
    expect(position.equityValue.central.value).toBeNull();
    expect(blockerCodes(position.equityValue.central)).toContain("EV_TO_EQUITY_GROSS_DEBT_MISSING");
  });
});

describe("Golden case 17 — société suivie, détention incomplète", () => {
  /**
   * Régression de la faute la plus grave de la version précédente : « Sociétés = 0 /
   * Valeur = 0 € / Qualité = Calculable » pour une société réellement suivie dont les
   * droits économiques n'étaient pas déclarés.
   */
  const result = portfolio({
    businesses: [business({ id: "p", name: "PartialCo" })],
    ownership: [
      ownership({
        id: "o",
        businessId: "p",
        effectiveDate: "2020-01-01",
        legalRate: 0.5,
        economicRate: null,
      }),
    ],
    financials: [
      financials({
        id: "f",
        businessId: "p",
        periodEnd: "2025-12-31",
        ebitda: 400_000,
        cash: 0,
        grossDebt: 0,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "p",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
      }),
    ],
  });

  it("compte la société suivie plutôt que de l'escamoter", () => {
    expect(result.trackedCount).toBe(1);
    expect(result.directPositions).toHaveLength(1);
  });

  it("ne remplace jamais l'inconnu par zéro", () => {
    expect(result.totalAttributableValue.central.value).toBeNull();
    expect(positionOf(result, "p").attributableValue.central.value).toBeNull();
  });

  it("n'annonce pas un résultat « calculable »", () => {
    expect(result.status).toBe("NOT_COMPUTABLE");
    expect(result.valuedCount).toBe(0);
    expect(blockerCodes(result.totalAttributableValue.central)).toContain(
      "ECONOMIC_OWNERSHIP_MISSING",
    );
  });

  it("laisse la ligne de bilan visible, montant inconnu et motifs joints", () => {
    const line = businessEquityBalanceSheetContributions(result)[0];
    expect(line.nativeValue).toBeNull();
    expect(line.valuationStatus).toBe("MISSING");
    expect(line.valuationBlockers).toContain("ECONOMIC_OWNERSHIP_MISSING");
    expect(line.valuationBlockers?.some((code) => code.includes("-"))).toBe(false);
  });
});

describe("Golden case 18 — fourchette de multiples", () => {
  /**
   * INPUT       EBITDA 500 k€ · multiples 5,0× / 6,0× / 7,0× · dette 0 · cash 0 · 100 %
   * DERIVATION  trois EV, trois Equity, trois valeurs personnelles
   * OUTPUT      2,5 M€ / 3,0 M€ / 3,5 M€ — seul le central alimente le bilan
   * QUALITY     MULTIPLE_RANGE_DECLARED
   */
  const result = portfolio({
    businesses: [business({ id: "r", name: "RangeCo" })],
    ownership: [ownership({ id: "o", businessId: "r", effectiveDate: "2020-01-01", legalRate: 1 })],
    financials: [
      financials({
        id: "f",
        businessId: "r",
        periodEnd: "2025-12-31",
        ebitda: 500_000,
        cash: 0,
        grossDebt: 0,
      }),
    ],
    valuations: [
      valuation({
        id: "v",
        businessId: "r",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
        multipleLow: 5,
        multipleHigh: 7,
      }),
    ],
  });
  const position = positionOf(result, "r");

  it("produit une fourchette et non un chiffre unique", () => {
    expect(position.attributableValue.low.value).toBe(2_500_000);
    expect(position.attributableValue.central.value).toBe(3_000_000);
    expect(position.attributableValue.high.value).toBe(3_500_000);
  });

  it("n'alimente le bilan que par le central", () => {
    expect(businessEquityBalanceSheetContributions(result)[0].nativeValue).toBe(3_000_000);
    expect(flagCodes(position.quality)).toContain("MULTIPLE_RANGE_DECLARED");
  });
});

describe("Golden case 19 — frais de transaction sur cession", () => {
  /**
   * INPUT       coût de revient 500 k€ · cession totale 2 M€ avec 60 k€ de frais
   * DERIVATION  cash retourné = 2 000 000 − 60 000 = 1 940 000
   *             PnL réalisée = 1 940 000 − 500 000 = 1 440 000
   * OUTPUT      MOIC = 1 940 000 ÷ 500 000 = 3,88×
   */
  const result = portfolio({
    businesses: [
      business({
        id: "fee",
        name: "FeeCo",
        ...COMPLETE_HISTORY,
        capitalHistoryStart: "2019-01-01",
      }),
    ],
    ownership: [
      ownership({ id: "o1", businessId: "fee", effectiveDate: "2019-01-01", legalRate: 1 }),
      ownership({ id: "o2", businessId: "fee", effectiveDate: "2026-05-01", legalRate: 0 }),
    ],
    capitalEvents: [
      capitalEvent({
        id: "c1",
        businessId: "fee",
        type: "ACQUISITION",
        eventDate: "2019-01-01",
        amount: 500_000,
      }),
      capitalEvent({
        id: "c2",
        businessId: "fee",
        type: "SALE",
        eventDate: "2026-05-01",
        amount: 2_000_000,
        fees: 60_000,
        ownershipDelta: -1,
        ownershipRateAfter: 0,
      }),
    ],
  });
  const position = positionOf(result, "fee");

  it("retranche les frais du cash réellement retourné", () => {
    expect(position.capital.transactionFees.value).toBe(60_000);
    expect(position.capital.cashReturned.value).toBe(1_940_000);
  });

  it("mesure la plus-value réalisée nette de frais", () => {
    expect(position.capital.realisedPnL.value).toBe(1_440_000);
    expect(position.capital.moic.value).toBeCloseTo(3.88, 10);
  });
});

describe("Golden case 20 — boucle de détention entre holdings", () => {
  /**
   * INPUT       A détient B, B détient A
   * DERIVATION  refus : une boucle de détention ne se déroule pas, elle se signale
   * OUTPUT      Equity Value non calculable des deux côtés
   * QUALITY     HOLDING_CYCLE
   */
  const result = portfolio({
    businesses: [
      business({ id: "A", name: "Alpha", type: "HOLDING" }),
      business({ id: "B", name: "Beta", type: "HOLDING" }),
    ],
    ownership: [ownership({ id: "o", businessId: "A", effectiveDate: "2020-01-01", legalRate: 1 })],
    financials: [
      financials({ id: "fa", businessId: "A", periodEnd: "2025-12-31", cash: 0, grossDebt: 0 }),
      financials({ id: "fb", businessId: "B", periodEnd: "2025-12-31", cash: 0, grossDebt: 0 }),
    ],
    holdings: [
      holding({
        id: "l1",
        parentBusinessId: "A",
        childBusinessId: "B",
        effectiveDate: "2020-01-01",
        ownershipRate: 0.5,
      }),
      holding({
        id: "l2",
        parentBusinessId: "B",
        childBusinessId: "A",
        effectiveDate: "2020-01-01",
        ownershipRate: 0.5,
      }),
    ],
  });

  it("détecte le cycle plutôt que de boucler", () => {
    const position = positionOf(result, "A");
    expect(position.equityValue.central.value).toBeNull();
    expect(blockerCodes(position.equityValue.central)).toContain("HOLDING_CYCLE");
  });
});

describe("Golden case 21 — faits postérieurs à la date d'arrêté", () => {
  /**
   * Une valorisation saisie pour une date future ne vaut rien aujourd'hui. Le moteur ne
   * retient que le fait le plus récent NON POSTÉRIEUR à la date de lecture.
   */
  const result = portfolio({
    businesses: [business({ id: "fu", name: "FutureCo" })],
    ownership: [
      ownership({ id: "o", businessId: "fu", effectiveDate: "2020-01-01", legalRate: 1 }),
    ],
    valuations: [
      valuation({
        id: "v1",
        businessId: "fu",
        valuationDate: "2026-01-31",
        method: "TRANSACTION",
        equityValue: 1_000_000,
      }),
      valuation({
        id: "v2",
        businessId: "fu",
        valuationDate: "2026-12-31",
        method: "TRANSACTION",
        equityValue: 9_000_000,
      }),
    ],
  });

  it("ignore la valorisation datée après l'arrêté", () => {
    const position = positionOf(result, "fu");
    expect(position.valuation.valuationDate).toBe("2026-01-31");
    expect(position.equityValue.central.value).toBe(1_000_000);
    expect(AS_OF).toBe("2026-08-19");
  });
});

describe("Golden case 22 — l'Enterprise Value n'existe pas pour toutes les méthodes", () => {
  /**
   * INPUT       une PME valorisée au multiple d'EBITDA, une startup valorisée par un tour
   *             de table, une participation dont seule l'Equity Value est observée
   * DERIVATION  seule la première DÉFINIT une Enterprise Value. Un tour de table négocie
   *             une valeur d'equity ; une Equity Value observée n'implique aucune EV.
   * OUTPUT      l'EV cumulée porte la seule PME, et reste calculable
   * QUALITY     aucune : ne pas avoir d'EV n'est pas une donnée manquante
   */
  const result = portfolio({
    businesses: [
      business({ id: "pme", name: "OpCo" }),
      business({ id: "vc", name: "Startup", type: "STARTUP" }),
      business({ id: "obs", name: "Minoritaire" }),
    ],
    ownership: [
      ownership({ id: "o1", businessId: "pme", effectiveDate: "2020-01-01", legalRate: 1 }),
      ownership({ id: "o2", businessId: "vc", effectiveDate: "2026-01-01", legalRate: 0.1 }),
      ownership({ id: "o3", businessId: "obs", effectiveDate: "2020-01-01", legalRate: 0.2 }),
    ],
    financials: [
      financials({
        id: "f",
        businessId: "pme",
        periodEnd: "2025-12-31",
        ebitda: 500_000,
        cash: 100_000,
        grossDebt: 400_000,
      }),
    ],
    valuations: [
      valuation({
        id: "v1",
        businessId: "pme",
        valuationDate: "2026-06-30",
        method: "EBITDA_MULTIPLE",
        multiple: 6,
      }),
      valuation({
        id: "v2",
        businessId: "vc",
        valuationDate: "2026-01-01",
        method: "FUNDING_ROUND",
        preMoneyEquityValue: 9_000_000,
        primaryNewMoney: 1_000_000,
        preferredRightsKnown: true,
      }),
      valuation({
        id: "v3",
        businessId: "obs",
        valuationDate: "2026-05-01",
        method: "TRANSACTION",
        equityValue: 4_000_000,
      }),
    ],
  });

  it("sait quelles méthodes définissent une Enterprise Value", () => {
    expect(positionOf(result, "pme").valuation.hasEnterpriseValueConcept).toBe(true);
    expect(positionOf(result, "vc").valuation.hasEnterpriseValueConcept).toBe(false);
    expect(positionOf(result, "obs").valuation.hasEnterpriseValueConcept).toBe(false);
  });

  it("n'efface pas l'EV connue des autres à cause d'une méthode qui n'en produit pas", () => {
    expect(result.enterpriseValueCoverage).toBe(1);
    expect(result.totalEnterpriseValue.value).toBe(3_000_000);
  });

  it("bloque en revanche le total quand une EV attendue n'est pas calculable", () => {
    const blocked = portfolio({
      businesses: [business({ id: "x", name: "Sans base" })],
      ownership: [
        ownership({ id: "o", businessId: "x", effectiveDate: "2020-01-01", legalRate: 1 }),
      ],
      valuations: [
        valuation({
          id: "v",
          businessId: "x",
          valuationDate: "2026-06-30",
          method: "EBITDA_MULTIPLE",
          multiple: 6,
        }),
      ],
    });
    expect(blocked.enterpriseValueCoverage).toBe(1);
    expect(blocked.totalEnterpriseValue.value).toBeNull();
  });

  it("additionne les valeurs personnelles quelles que soient les méthodes", () => {
    // 3 000 000 − 400 000 + 100 000 = 2 700 000 · 10 000 000 × 10 % · 4 000 000 × 20 %
    expect(result.totalAttributableValue.central.value).toBeCloseTo(
      2_700_000 + 1_000_000 + 800_000,
      6,
    );
  });
});
