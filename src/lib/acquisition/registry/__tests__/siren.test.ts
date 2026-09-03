import { describe, expect, it } from "vitest";

import { formatSiren, formatSiret, readSiren, readSiret } from "@/lib/acquisition/registry/siren";

/**
 * Les identifiants employés ici sont SYNTHÉTIQUES, dans une plage volontairement improbable,
 * et leur clé de contrôle a été CALCULÉE. Aucun n'est recopié d'un registre : un test ne doit
 * pas transporter l'identité d'une société réelle.
 *
 * `732829320` fait exception, et pour une raison précise : c'est l'exemple canonique de la
 * documentation de l'algorithme, utilisé ici comme VECTEUR DE TEST de la clé, pas comme
 * désignation d'une entreprise.
 */
describe("lecture d'un SIREN", () => {
  it("accepte neuf chiffres et valide la clé de contrôle", () => {
    expect(readSiren("900000001")).toEqual({
      value: "900000001",
      wellFormed: true,
      checksumValid: true,
    });
    expect(readSiren("732829320").checksumValid).toBe(true);
  });

  it("retire les séparateurs de saisie", () => {
    expect(readSiren("900 000 001").value).toBe("900000001");
    expect(readSiren("900-000-001").value).toBe("900000001");
  });

  it("distingue une FORME invalide d'une CLÉ invalide", () => {
    // Huit chiffres : ce n'est pas un SIREN, et la clé n'est même pas vérifiée.
    expect(readSiren("90000000")).toEqual({
      value: null,
      wellFormed: false,
      checksumValid: null,
    });
    // Neuf chiffres, clé fausse : la valeur reste lisible, et c'est délibéré. Des
    // identifiants réellement attribués échouent au calcul de clé.
    expect(readSiren("900000002")).toEqual({
      value: "900000002",
      wellFormed: true,
      checksumValid: false,
    });
  });

  it("refuse ce qui n'est pas une chaîne ou un nombre", () => {
    expect(readSiren(null).wellFormed).toBe(false);
    expect(readSiren({ siren: "900000001" }).wellFormed).toBe(false);
    expect(readSiren(true).wellFormed).toBe(false);
  });

  it("lit un SIREN fourni comme nombre", () => {
    expect(readSiren(900000001).value).toBe("900000001");
  });
});

describe("lecture d'un SIRET", () => {
  it("valide quatorze chiffres et porte le SIREN de son entité", () => {
    const reading = readSiret("90000000100009");
    expect(reading.wellFormed).toBe(true);
    expect(reading.checksumValid).toBe(true);
    expect(reading.siren).toBe("900000001");
  });

  it("refuse une longueur qui n'est pas celle d'un SIRET", () => {
    expect(readSiret("900000001").wellFormed).toBe(false);
    expect(readSiret("900000001000091").wellFormed).toBe(false);
  });
});

describe("présentation", () => {
  it("groupe les chiffres sans les altérer", () => {
    expect(formatSiren("900000001")).toBe("900 000 001");
    expect(formatSiret("90000000100009")).toBe("900 000 001 00009");
  });

  it("laisse intacte une valeur qui n'a pas la bonne forme", () => {
    expect(formatSiren("ABC")).toBe("ABC");
    expect(formatSiret("123")).toBe("123");
  });
});
