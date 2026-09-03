import { describe, expect, it } from "vitest";

import {
  asArray,
  asObject,
  checkProfileCoherence,
  emptyProfile,
  pick,
  pickPath,
  readBoolean,
  readCountryCode,
  readCurrency,
  readDecimal,
  readInteger,
  readIsoDate,
  readSirenField,
  readSiretField,
  readText,
} from "@/lib/acquisition/registry/normalize";
import type { RegistryIssue } from "@/lib/acquisition/registry/types";

function issues(): RegistryIssue[] {
  return [];
}

function codes(list: RegistryIssue[]): string[] {
  return list.map((issue) => issue.code);
}

describe("navigation défensive", () => {
  it("ne descend pas dans ce qui n'est pas un objet", () => {
    expect(pick(null, "a")).toBeUndefined();
    expect(pick("texte", "a")).toBeUndefined();
    expect(pick([1, 2], "a")).toBeUndefined();
    expect(pickPath({ a: { b: 1 } }, "a", "b")).toBe(1);
    expect(pickPath({ a: { b: 1 } }, "a", "c")).toBeUndefined();
    expect(pickPath({ a: 1 }, "a", "b")).toBeUndefined();
  });

  it("distingue objet, tableau et reste", () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
    expect(asObject([1])).toBeNull();
    expect(asArray([1])).toEqual([1]);
    expect(asArray({ a: 1 })).toBeNull();
  });
});

describe("lecture d'un texte", () => {
  it("rend null et signale un type inattendu, sans coercition", () => {
    const list = issues();
    expect(readText({ nested: true }, "nom", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNEXPECTED_TYPE"]);
  });

  it("distingue une case VIDE d'une absence, et le signale en INFO", () => {
    const list = issues();
    expect(readText("   ", "nom", list)).toBeNull();
    expect(list[0].code).toBe("FIELD_EMPTY_STRING");
    expect(list[0].severity).toBe("INFO");
  });

  it("n'émet aucune anomalie pour un champ simplement absent", () => {
    const list = issues();
    expect(readText(undefined, "nom", list)).toBeNull();
    expect(readText(null, "nom", list)).toBeNull();
    expect(list).toHaveLength(0);
  });
});

describe("lecture d'un nombre", () => {
  it("accepte un entier, refuse un décimal déguisé", () => {
    const list = issues();
    expect(readInteger(12, "effectif", list)).toBe(12);
    expect(readInteger("12", "effectif", list)).toBe(12);
    expect(readInteger(12.5, "effectif", list)).toBeNull();
    expect(codes(list)).toContain("FIELD_UNREADABLE_NUMBER");
  });

  it("ne devine AUCUNE convention décimale sur une réponse JSON", () => {
    const list = issues();
    // « 1,5 » pourrait valoir 1,5 ou 15 selon la convention. Sur du JSON, le point est la
    // seule convention : la valeur est écartée plutôt qu'arbitrée.
    expect(readDecimal("1,5", "capital", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNREADABLE_NUMBER"]);
    expect(readDecimal("1.5", "capital", issues())).toBe(1.5);
  });

  it("distingue zéro d'une absence", () => {
    expect(readDecimal(0, "capital", issues())).toBe(0);
    expect(readDecimal(null, "capital", issues())).toBeNull();
  });
});

describe("lecture d'une date", () => {
  it("accepte l'ISO complet et la partie date d'un horodatage", () => {
    expect(readIsoDate("2019-04-15", "creation", issues())).toBe("2019-04-15");
    expect(readIsoDate("2019-04-15T10:20:30Z", "creation", issues())).toBe("2019-04-15");
  });

  it("ne COMPLÈTE jamais une date partielle", () => {
    const list = issues();
    expect(readIsoDate("2019", "creation", list)).toBeNull();
    expect(readIsoDate("2019-04", "creation", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNREADABLE_DATE", "FIELD_UNREADABLE_DATE"]);
  });

  it("refuse une date qui n'existe pas au calendrier", () => {
    const list = issues();
    expect(readIsoDate("2019-02-31", "creation", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNREADABLE_DATE"]);
  });

  it("n'accepte aucun format jour/mois ambigu", () => {
    const list = issues();
    expect(readIsoDate("15/04/2019", "creation", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNREADABLE_DATE"]);
  });
});

describe("lecture d'un booléen, d'un pays, d'une devise", () => {
  it("n'accepte pas 1 ou 0 comme booléen", () => {
    expect(readBoolean("true", "siege", issues())).toBe(true);
    expect(readBoolean(false, "siege", issues())).toBe(false);
    const list = issues();
    expect(readBoolean("1", "siege", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNEXPECTED_TYPE"]);
  });

  it("exige un code pays à deux lettres, pas un libellé", () => {
    expect(readCountryCode("fr", "pays", issues())).toBe("FR");
    const list = issues();
    expect(readCountryCode("France", "pays", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNEXPECTED_TYPE"]);
  });

  it("exige un code devise ISO : FX ABSENT n'est pas FX ÉGAL À 1", () => {
    expect(readCurrency("eur", "devise", issues())).toBe("EUR");
    const list = issues();
    expect(readCurrency("€", "devise", list)).toBeNull();
    expect(codes(list)).toEqual(["FIELD_UNEXPECTED_TYPE"]);
  });
});

describe("lecture d'une identité", () => {
  it("signale une clé de contrôle en échec sans écarter la valeur", () => {
    const list = issues();
    expect(readSirenField("900000002", "siren", list)).toBe("900000002");
    expect(codes(list)).toEqual(["SIREN_CHECKSUM_FAILED"]);
    expect(list[0].severity).toBe("WARNING");
  });

  it("écarte une forme invalide, en ERREUR", () => {
    const list = issues();
    expect(readSirenField("abc", "siren", list)).toBeNull();
    expect(codes(list)).toEqual(["SIREN_MALFORMED"]);
    expect(list[0].severity).toBe("ERROR");
  });

  it("refuse un SIRET qui ne porte pas le SIREN de son entité", () => {
    const list = issues();
    expect(readSiretField("90000001900017", "siege.siret", list, "900000001")).toBeNull();
    expect(codes(list)).toContain("SIRET_SIREN_MISMATCH");
  });

  it("accepte un SIRET cohérent avec son entité", () => {
    expect(readSiretField("90000000100009", "siege.siret", issues(), "900000001")).toBe(
      "90000000100009",
    );
  });
});

describe("cohérence d'un profil", () => {
  it("écarte un capital sans devise : un montant sans devise n'est pas un montant", () => {
    const result = checkProfileCoherence(
      { ...emptyProfile("900000001"), shareCapital: 50_000, shareCapitalCurrency: null },
      0,
    );
    expect(result.shareCapital).toBeNull();
    expect(codes(result.issues)).toEqual(["CAPITAL_WITHOUT_CURRENCY"]);
  });

  it("écarte un capital négatif", () => {
    const result = checkProfileCoherence(
      { ...emptyProfile("900000001"), shareCapital: -1, shareCapitalCurrency: "EUR" },
      0,
    );
    expect(result.shareCapital).toBeNull();
    expect(result.shareCapitalCurrency).toBeNull();
    expect(codes(result.issues)).toEqual(["CAPITAL_NEGATIVE"]);
  });

  it("conserve un capital nul déclaré : zéro déclaré est une information", () => {
    const result = checkProfileCoherence(
      { ...emptyProfile("900000001"), shareCapital: 0, shareCapitalCurrency: "EUR" },
      0,
    );
    expect(result.shareCapital).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  it("signale une cessation antérieure à la création SANS corriger les dates", () => {
    const result = checkProfileCoherence(
      { ...emptyProfile("900000001"), createdOn: "2019-04-15", ceasedOn: "2018-01-01" },
      0,
    );
    expect(result.createdOn).toBe("2019-04-15");
    expect(result.ceasedOn).toBe("2018-01-01");
    expect(codes(result.issues)).toEqual(["CESSATION_BEFORE_CREATION"]);
  });

  it("signale un siège rattaché à un autre SIREN", () => {
    const result = checkProfileCoherence(
      { ...emptyProfile("900000001"), headOfficeSiret: "90000001900017" },
      0,
    );
    expect(codes(result.issues)).toEqual(["HEAD_OFFICE_SIREN_MISMATCH"]);
  });

  it("ne recalcule pas un décompte publié, et ne signale que l'écart impossible", () => {
    const fewer = checkProfileCoherence({ ...emptyProfile("900000001"), establishmentCount: 5 }, 2);
    // Une fiche peut publier 5 établissements et n'en détailler que 2 : ce n'est pas un écart.
    expect(fewer.issues).toHaveLength(0);
    expect(fewer.establishmentCount).toBe(5);

    const more = checkProfileCoherence({ ...emptyProfile("900000001"), establishmentCount: 1 }, 3);
    expect(codes(more.issues)).toEqual(["ESTABLISHMENT_COUNT_MISMATCH"]);
    expect(more.establishmentCount).toBe(1);
  });
});
