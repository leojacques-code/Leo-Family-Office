import { describe, expect, it } from "vitest";

import {
  proposeCertificateMatch,
  proposeComparableSetMatch,
} from "@/lib/acquisition/realestate/match";
import type { EnergyCertificateCandidate } from "@/lib/acquisition/realestate/types";

function certificate(
  overrides: Partial<EnergyCertificateCandidate> = {},
): EnergyCertificateCandidate {
  return {
    rowIndex: 0,
    certificateRef: "2345E0000001",
    issuedOn: "2025-06-01",
    validUntil: "2035-06-01",
    methodVersion: "3CL",
    energyLabel: "C",
    energyValue: 132,
    energyUnit: "kWh/m2/an",
    ghgLabel: "B",
    ghgValue: 12,
    ghgUnit: "kgCO2/m2/an",
    livingAreaSqm: 62,
    buildingKind: "Appartement",
    constructionYear: 1970,
    addressLabel: "12 avenue des Lilas 75012 Paris",
    postalCode: "75012",
    communeCode: "75112",
    raw: {},
    issues: [],
    ...overrides,
  };
}

describe("rapprochement d'un diagnostic", () => {
  it("ne dépasse JAMAIS une confiance moyenne, même sur une adresse identique", () => {
    // Le point du test : une adresse désigne un immeuble, et un immeuble porte autant de
    // diagnostics que de lots.
    const proposal = proposeCertificateMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      certificate: certificate(),
    });
    expect(proposal.score).toBe(1);
    expect(proposal.confidence).toBe("MEDIUM");
    expect(proposal.issues.map((issue) => issue.message).join(" ")).toContain("plafonnée à MEDIUM");
  });

  it("retombe en confiance faible quand la surface discorde", () => {
    const proposal = proposeCertificateMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      certificate: certificate({ livingAreaSqm: 110 }),
    });
    expect(proposal.confidence).toBe("LOW");
    expect(proposal.issues.map((issue) => issue.message).join(" ")).toContain("autre lot");
  });

  it("reste en confiance faible quand la surface est inconnue d'un côté", () => {
    const proposal = proposeCertificateMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: null,
      certificate: certificate(),
    });
    expect(proposal.confidence).toBe("LOW");
  });

  it("refuse tout rapprochement sans adresse déclarée sur le bien", () => {
    const proposal = proposeCertificateMatch({
      propertyLocation: null,
      propertySurfaceSqm: 62,
      certificate: certificate(),
    });
    expect(proposal.score).toBeNull();
    expect(proposal.issues[0].message).toContain("ne s'invente pas");
  });

  it("refuse tout rapprochement sans adresse sur le diagnostic", () => {
    const proposal = proposeCertificateMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      certificate: certificate({ addressLabel: null }),
    });
    expect(proposal.score).toBeNull();
  });

  it("retombe en confiance faible sur un désaccord d'adresse", () => {
    const proposal = proposeCertificateMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      certificate: certificate({ addressLabel: "40 rue des Roses 75012 Paris" }),
    });
    expect(proposal.confidence).toBe("LOW");
    expect(proposal.score).toBeLessThan(1);
  });

  it("retombe en confiance faible quand trop peu de critères sont connus", () => {
    const proposal = proposeCertificateMatch({
      propertyLocation: "Paris",
      propertySurfaceSqm: 62,
      certificate: certificate({ addressLabel: "Paris" }),
    });
    expect(proposal.confidence).toBe("LOW");
  });

  it("porte toujours la base nommée, même en refus", () => {
    const proposal = proposeCertificateMatch({
      propertyLocation: null,
      propertySurfaceSqm: null,
      certificate: certificate(),
    });
    expect(proposal.basis.kind).toBe("ADDRESS");
    expect(Array.isArray(proposal.basis.criteria)).toBe(true);
  });
});

describe("rapprochement d'un jeu de comparables", () => {
  it("refuse un jeu interrogé hors du code postal du bien", () => {
    const proposal = proposeComparableSetMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      queriedCommuneCode: null,
      queriedPostalCode: "33000",
      saleCount: 40,
      usableSaleCount: 30,
    });
    expect(proposal.score).toBe(0);
    expect(proposal.issues[0].severity).toBe("ERROR");
  });

  it("accepte la bonne zone avec assez de mutations exploitables", () => {
    const proposal = proposeComparableSetMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      queriedCommuneCode: "75112",
      queriedPostalCode: "75012",
      saleCount: 40,
      usableSaleCount: 30,
    });
    expect(proposal.score).toBe(1);
    expect(proposal.confidence).toBe("MEDIUM");
  });

  it("signale une surface non déclarée sans refuser le rattachement", () => {
    const proposal = proposeComparableSetMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: null,
      queriedCommuneCode: "75112",
      queriedPostalCode: "75012",
      saleCount: 40,
      usableSaleCount: 30,
    });
    expect(proposal.score).toBe(1);
    expect(proposal.issues.map((issue) => issue.message).join(" ")).toContain("ne vaut pas zéro");
  });

  it("refuse un jeu sans aucune mutation exploitable", () => {
    const proposal = proposeComparableSetMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      queriedCommuneCode: "75112",
      queriedPostalCode: "75012",
      saleCount: 40,
      usableSaleCount: 0,
    });
    expect(proposal.confidence).toBe("LOW");
    expect(proposal.issues.map((issue) => issue.code)).toContain("AMOUNT_NOT_COMPARABLE");
  });

  it("distingue « nombre lu » et « nombre exploitable » dans la base", () => {
    const proposal = proposeComparableSetMatch({
      propertyLocation: "12 avenue des Lilas 75012 Paris",
      propertySurfaceSqm: 62,
      queriedCommuneCode: "75112",
      queriedPostalCode: "75012",
      saleCount: 40,
      usableSaleCount: 6,
    });
    expect(proposal.basis.saleCount).toBe(40);
    expect(proposal.basis.usableSaleCount).toBe(6);
  });
});
