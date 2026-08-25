import { describe, expect, it } from "vitest";
import { diffExactInventory, missingFrom, unexpectedIn } from "./schema-diff.ts";

const CANONICAL = ["202608190001", "20260825021742"] as const;

describe("missingFrom", () => {
  it("signale ce que le code attend et que la base n'a pas", () => {
    expect(missingFrom(CANONICAL, ["202608190001"])).toEqual(["20260825021742"]);
  });

  it("ne signale rien quand la base contient tout l'attendu", () => {
    expect(missingFrom(CANONICAL, [...CANONICAL])).toEqual([]);
  });
});

describe("unexpectedIn", () => {
  it("signale une version appliquée hors du repo", () => {
    expect(unexpectedIn(CANONICAL, [...CANONICAL, "20260825063626"])).toEqual(["20260825063626"]);
  });

  it("ne signale rien sur un historique aligné", () => {
    expect(unexpectedIn(CANONICAL, [...CANONICAL])).toEqual([]);
  });

  it("dédoublonne et ordonne les surnuméraires", () => {
    expect(unexpectedIn(CANONICAL, ["b", "a", "b"])).toEqual(["a", "b"]);
  });
});

describe("diffExactInventory", () => {
  it("accepte deux historiques identiques", () => {
    expect(diffExactInventory("Migration(s)", CANONICAL, [...CANONICAL])).toEqual([]);
  });

  it("refuse un historique amputé", () => {
    const failures = diffExactInventory("Migration(s)", CANONICAL, ["202608190001"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("manquant(s) : 20260825021742");
  });

  it("refuse un historique en avance sur le repo, le cas que l'ancien gate laissait passer", () => {
    const failures = diffExactInventory("Migration(s)", CANONICAL, [
      ...CANONICAL,
      "20260825063626",
      "20260825063831",
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("inattendu(s) : 20260825063626, 20260825063831");
  });

  it("signale les deux sens simultanément", () => {
    expect(diffExactInventory("Migration(s)", CANONICAL, ["202608190001", "99999999"])).toEqual([
      "Migration(s) manquant(s) : 20260825021742",
      "Migration(s) inattendu(s) : 99999999",
    ]);
  });
});
