import { describe, expect, it } from "vitest";

import { compareAddresses, foldAddressText, normalizeAddress } from "@/lib/acquisition/address";

describe("repli d'une adresse", () => {
  it("ramène accents, casse, apostrophes et ponctuation à une forme unique", () => {
    expect(foldAddressText("12, Rue de l’Église")).toBe("12 RUE DE L EGLISE");
    expect(foldAddressText("  Saint-Étienne  ")).toBe("SAINT ETIENNE");
  });
});

describe("décomposition d'une adresse", () => {
  it("sépare numéro, type de voie, nom, code postal et commune", () => {
    const address = normalizeAddress("12 bis avenue des Lilas 75012 Paris");
    expect(address.number).toBe(12);
    expect(address.repeatIndex).toBe("BIS");
    expect(address.streetType).toBe("AVENUE");
    expect(address.streetName).toBe("LILAS");
    expect(address.postalCode).toBe("75012");
    expect(address.city).toBe("PARIS");
  });

  it("développe les abréviations de type de voie", () => {
    expect(normalizeAddress("3 bd Voltaire 75011 Paris").streetType).toBe("BOULEVARD");
    expect(normalizeAddress("3 av Voltaire").streetType).toBe("AVENUE");
    expect(normalizeAddress("3 imp du Puits").streetType).toBe("IMPASSE");
  });

  it("ne DEVINE aucun terme absent", () => {
    // Le point du test : pas de numéro par défaut, pas de code postal déduit de la commune.
    const address = normalizeAddress("rue des Lilas");
    expect(address.number).toBeNull();
    expect(address.postalCode).toBeNull();
    expect(address.city).toBeNull();
  });

  it("ne prend PAS un nombre du nom de voie pour un numéro de rue", () => {
    // « rue du 8 mai 1945 » : sans cette règle, 1945 deviendrait un numéro et toute la
    // lecture serait décalée.
    const address = normalizeAddress("rue du 8 mai 1945 69100 Villeurbanne");
    expect(address.number).toBeNull();
    expect(address.streetType).toBe("RUE");
    expect(address.streetName).toBe("8 MAI 1945");
  });

  it("rend une décomposition vide sur une chaîne vide, sans rien inventer", () => {
    const address = normalizeAddress("");
    expect(address.number).toBeNull();
    expect(address.streetName).toBeNull();
    expect(address.source).toBe("");
  });

  it("rend une décomposition vide sur null plutôt que de lever", () => {
    expect(normalizeAddress(null).streetName).toBeNull();
  });
});

describe("comparaison d'adresses", () => {
  it("rend un score de 1 sur deux écritures de la même adresse", () => {
    const left = normalizeAddress("12 avenue des Lilas 75012 Paris");
    const right = normalizeAddress("12, Av. des Lilas, 75012 PARIS");
    const comparison = compareAddresses(left, right);
    expect(comparison.score).toBe(1);
    expect(comparison.hasMismatch).toBe(false);
  });

  it("distingue un BIS d'un numéro nu : ce sont deux entrées", () => {
    const comparison = compareAddresses(
      normalizeAddress("12 avenue des Lilas 75012 Paris"),
      normalizeAddress("12 bis avenue des Lilas 75012 Paris"),
    );
    expect(comparison.hasMismatch).toBe(true);
    expect(comparison.criteria.find((c) => c.name === "repeatIndex")?.verdict).toBe("MISMATCH");
  });

  it("un critère INCONNU ne compte ni pour ni contre", () => {
    const comparison = compareAddresses(
      normalizeAddress("avenue des Lilas 75012 Paris"),
      normalizeAddress("avenue des Lilas 75012 Paris"),
    );
    // Le numéro manque des deux côtés : il n'entre pas dans le score, et le score reste 1
    // sur ce qui est réellement connu.
    expect(comparison.criteria.find((c) => c.name === "number")?.verdict).toBe("UNKNOWN");
    expect(comparison.score).toBe(1);
    expect(comparison.knownCount).toBeLessThan(comparison.criteria.length);
  });

  it("rend un score NULL quand rien n'est connu, jamais zéro", () => {
    // Zéro dirait « ça ne correspond pas ». La vérité est « on ne sait pas ».
    const comparison = compareAddresses(normalizeAddress(""), normalizeAddress(""));
    expect(comparison.score).toBeNull();
    expect(comparison.knownCount).toBe(0);
  });

  it("détecte un désaccord de nom de voie", () => {
    const comparison = compareAddresses(
      normalizeAddress("12 avenue des Lilas 75012 Paris"),
      normalizeAddress("12 avenue des Roses 75012 Paris"),
    );
    expect(comparison.hasMismatch).toBe(true);
    expect(comparison.score).toBeLessThan(1);
  });
});
