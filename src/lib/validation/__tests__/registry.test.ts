import { describe, expect, it } from "vitest";

import {
  registryCommandSchema,
  registryLookupSchema,
  registrySearchSchema,
} from "@/lib/validation/registry";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT = "22222222-2222-4222-8222-222222222222";
const DECISION = "33333333-3333-4333-8333-333333333333";

describe("recherche", () => {
  it("refuse une recherche SANS critère : ce serait une consommation de quota", () => {
    expect(registrySearchSchema.safeParse({ provider: "FIXTURE" }).success).toBe(false);
  });

  it("accepte un SIREN écrit avec des séparateurs et le normalise", () => {
    const parsed = registrySearchSchema.safeParse({
      provider: "FIXTURE",
      siren: "900 000 001",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.siren).toBe("900000001");
  });

  it("valide la FORME d'un SIREN, jamais sa clé de contrôle", () => {
    // Clé fausse mais forme correcte : accepté ici, signalé plus loin par la lecture. Refuser
    // bloquerait des sociétés réelles dont l'identifiant échoue au calcul de clé.
    expect(
      registrySearchSchema.safeParse({ provider: "FIXTURE", siren: "900000002" }).success,
    ).toBe(true);
    expect(registrySearchSchema.safeParse({ provider: "FIXTURE", siren: "90000000" }).success).toBe(
      false,
    );
  });

  it("refuse un fournisseur inconnu", () => {
    expect(
      registrySearchSchema.safeParse({ provider: "AUTRE_REGISTRE", text: "alpha" }).success,
    ).toBe(false);
  });

  it("borne la pagination", () => {
    expect(
      registrySearchSchema.safeParse({ provider: "FIXTURE", text: "alpha", perPage: 500 }).success,
    ).toBe(false);
  });
});

describe("fiche d'entité", () => {
  it("exige un SIREN", () => {
    expect(registryLookupSchema.safeParse({ provider: "FIXTURE" }).success).toBe(false);
    expect(
      registryLookupSchema.safeParse({ provider: "FIXTURE", siren: "900000001" }).success,
    ).toBe(true);
  });
});

describe("commandes", () => {
  it("accepte un rattachement complet", () => {
    const parsed = registryCommandSchema.safeParse({
      action: "link",
      businessId: BUSINESS,
      provider: "FIXTURE",
      siren: "900000001",
      snapshotId: SNAPSHOT,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuse un SIRET qui n'a pas quatorze chiffres", () => {
    expect(
      registryCommandSchema.safeParse({
        action: "link",
        businessId: BUSINESS,
        provider: "FIXTURE",
        siren: "900000001",
        siret: "900000001",
      }).success,
    ).toBe(false);
  });

  it("exige au moins une décision, et refuse une action inconnue", () => {
    expect(
      registryCommandSchema.safeParse({ action: "decide", businessId: BUSINESS, decisions: [] })
        .success,
    ).toBe(false);
    expect(
      registryCommandSchema.safeParse({
        action: "decide",
        businessId: BUSINESS,
        decisions: [{ decisionId: DECISION, action: "appliquer" }],
      }).success,
    ).toBe(false);
    expect(
      registryCommandSchema.safeParse({
        action: "decide",
        businessId: BUSINESS,
        decisions: [{ decisionId: DECISION, action: "accept" }],
      }).success,
    ).toBe(true);
  });

  it("refuse une action hors périmètre", () => {
    expect(
      registryCommandSchema.safeParse({ action: "delete", businessId: BUSINESS }).success,
    ).toBe(false);
  });
});
