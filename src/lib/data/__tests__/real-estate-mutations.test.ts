import { describe, expect, it } from "vitest";

import { mutationSchema } from "@/lib/validation/mutations";

const PROPERTY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIABILITY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TRANSACTION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function parse(payload: unknown) {
  return mutationSchema.safeParse(payload);
}

const asset = {
  propertyId: null,
  name: "Appartement",
  location: "Lyon",
  surfaceSqm: 62,
  usage: "RENTAL" as const,
  ownershipShare: 1,
  acquisitionDate: "2020-06-15",
  disposalDate: null,
  notes: null,
};

const terms = {
  propertyId: PROPERTY,
  effectiveFrom: "2026-01-01",
  currency: "EUR",
  annualGrossRent: 12_000,
  vacancyRate: 0.05,
  annualOperatingCharges: 0,
  annualPropertyTax: null,
  annualInsurance: null,
  annualMaintenance: null,
  annualManagementFees: 800,
  managementFeeRate: null,
  annualOtherCosts: null,
  effectiveIncomeTaxRate: null,
  notes: null,
};

describe("mutations Real Estate V2 — identité du bien", () => {
  it("accepte un usage et une quote-part non déclarés", () => {
    const result = parse({
      action: "save_real_estate_asset",
      asset: { ...asset, usage: null, ownershipShare: null },
    });
    expect(result.success).toBe(true);
    if (!result.success || result.data.action !== "save_real_estate_asset") return;
    // Le `null` traverse la validation intact : « non déclaré » n'est pas remplacé.
    expect(result.data.asset.usage).toBeNull();
    expect(result.data.asset.ownershipShare).toBeNull();
  });

  it("refuse une quote-part nulle ou supérieure à 1", () => {
    // Détenir 0 % d'un bien, c'est ne pas le détenir : ce n'est pas une quote-part.
    expect(
      parse({ action: "save_real_estate_asset", asset: { ...asset, ownershipShare: 0 } }).success,
    ).toBe(false);
    expect(
      parse({ action: "save_real_estate_asset", asset: { ...asset, ownershipShare: 1.2 } }).success,
    ).toBe(false);
  });

  it("refuse une cession antérieure à l'acquisition", () => {
    expect(
      parse({
        action: "save_real_estate_asset",
        asset: { ...asset, disposalDate: "2019-01-01" },
      }).success,
    ).toBe(false);
  });

  it("refuse un usage hors nomenclature et un champ inconnu", () => {
    expect(
      parse({ action: "save_real_estate_asset", asset: { ...asset, usage: "CHÂTEAU" } }).success,
    ).toBe(false);
    expect(
      parse({
        action: "save_real_estate_asset",
        asset: { ...asset, valeurDeMarche: 300_000 },
      }).success,
    ).toBe(false);
  });

  it("refuse une date inexistante au calendrier", () => {
    expect(
      parse({
        action: "save_real_estate_asset",
        asset: { ...asset, acquisitionDate: "2026-02-31" },
      }).success,
    ).toBe(false);
  });
});

describe("mutations Real Estate V2 — faits chiffrés", () => {
  it("accepte une valorisation datée avec sa méthode", () => {
    const result = parse({
      action: "record_real_estate_valuation",
      valuation: {
        propertyId: PROPERTY,
        valuedAt: "2026-06-30",
        value: 260_000,
        currency: "EUR",
        method: "AGENT_ESTIMATE",
        notes: null,
      },
    });
    expect(result.success).toBe(true);
  });

  it("refuse un montant de capital négatif : la direction vient du type", () => {
    const event = {
      propertyId: PROPERTY,
      type: "CAPEX" as const,
      eventDate: "2026-04-01",
      amount: -1_000,
      currency: "EUR",
      label: null,
      transactionId: null,
      notes: null,
    };
    expect(parse({ action: "record_real_estate_capital_event", event }).success).toBe(false);
    expect(
      parse({ action: "record_real_estate_capital_event", event: { ...event, amount: 1_000 } })
        .success,
    ).toBe(true);
  });

  it("accepte une jambe de trésorerie existante et refuse un identifiant qui n'en est pas un", () => {
    const event = {
      propertyId: PROPERTY,
      type: "ACQUISITION_COST" as const,
      eventDate: "2020-06-15",
      amount: 16_000,
      currency: "EUR",
      label: "Frais de notaire",
      transactionId: TRANSACTION,
      notes: null,
    };
    expect(parse({ action: "record_real_estate_capital_event", event }).success).toBe(true);
    expect(
      parse({
        action: "record_real_estate_capital_event",
        event: { ...event, transactionId: "pas-un-uuid" },
      }).success,
    ).toBe(false);
  });
});

describe("mutations Real Estate V2 — termes d'exploitation", () => {
  it("préserve la différence entre une charge déclarée à zéro et une charge non déclarée", () => {
    const result = parse({ action: "set_real_estate_operating_terms", terms });
    expect(result.success).toBe(true);
    if (!result.success || result.data.action !== "set_real_estate_operating_terms") return;
    expect(result.data.terms.annualOperatingCharges).toBe(0);
    expect(result.data.terms.annualPropertyTax).toBeNull();
    expect(result.data.terms.effectiveIncomeTaxRate).toBeNull();
  });

  it("refuse les deux formes de frais de gestion déclarées ensemble", () => {
    expect(
      parse({
        action: "set_real_estate_operating_terms",
        terms: { ...terms, annualManagementFees: 800, managementFeeRate: 0.07 },
      }).success,
    ).toBe(false);
    // Chacune seule reste acceptée.
    expect(
      parse({
        action: "set_real_estate_operating_terms",
        terms: { ...terms, annualManagementFees: null, managementFeeRate: 0.07 },
      }).success,
    ).toBe(true);
  });

  it("refuse un taux de vacance ou d'imposition hors de [0,1]", () => {
    expect(
      parse({ action: "set_real_estate_operating_terms", terms: { ...terms, vacancyRate: 1.4 } })
        .success,
    ).toBe(false);
    expect(
      parse({
        action: "set_real_estate_operating_terms",
        terms: { ...terms, effectiveIncomeTaxRate: -0.1 },
      }).success,
    ).toBe(false);
  });

  it("refuse une charge négative", () => {
    expect(
      parse({
        action: "set_real_estate_operating_terms",
        terms: { ...terms, annualInsurance: -300 },
      }).success,
    ).toBe(false);
  });
});

describe("mutations Real Estate V2 — rattachement et attribution", () => {
  it("accepte une quote-part de concours dans ]0,1]", () => {
    const link = {
      propertyId: PROPERTY,
      liabilityId: LIABILITY,
      allocationShare: 0.6,
      notes: null,
    };
    expect(parse({ action: "set_real_estate_financing_link", link }).success).toBe(true);
    expect(
      parse({ action: "set_real_estate_financing_link", link: { ...link, allocationShare: 1 } })
        .success,
    ).toBe(true);
    // Une part nulle n'est pas un rattachement, une part supérieure à 1 compterait la dette
    // plus d'une fois.
    expect(
      parse({ action: "set_real_estate_financing_link", link: { ...link, allocationShare: 0 } })
        .success,
    ).toBe(false);
    expect(
      parse({ action: "set_real_estate_financing_link", link: { ...link, allocationShare: 1.1 } })
        .success,
    ).toBe(false);
  });

  it("accepte le détachement d'un flux : `null` est une valeur", () => {
    expect(
      parse({
        action: "attribute_transaction_to_property",
        transactionId: TRANSACTION,
        propertyId: null,
      }).success,
    ).toBe(true);
    expect(
      parse({
        action: "attribute_transaction_to_property",
        transactionId: TRANSACTION,
        propertyId: PROPERTY,
      }).success,
    ).toBe(true);
  });

  it("n'expose aucun champ de montant sur l'attribution d'un flux", () => {
    // Le rattachement ne doit jamais pouvoir modifier le flux : la vérité de trésorerie
    // reste celle du Cash Flow Engine.
    expect(
      parse({
        action: "attribute_transaction_to_property",
        transactionId: TRANSACTION,
        propertyId: PROPERTY,
        amount: 999,
      }).success,
    ).toBe(false);
  });
});
