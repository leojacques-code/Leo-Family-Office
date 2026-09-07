import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION, NAV_ITEMS, isRoutedSection, isValidSection, sectionLabel } from "@/lib/navigation";

describe("navigation", () => {
  it("expose des données sérialisables entre serveur et client", () => {
    // Régression du crash de production : un Set exporté depuis un module "use client"
    // arrivait côté serveur sans sa méthode has().
    const roundTripped = JSON.parse(JSON.stringify(NAV_ITEMS));
    expect(roundTripped).toEqual(JSON.parse(JSON.stringify(NAV_ITEMS)));
    expect(Array.isArray(roundTripped)).toBe(true);
  });

  it("valide les sections connues et rejette les autres", () => {
    expect(isValidSection("net-worth")).toBe(true);
    expect(isValidSection(DEFAULT_SECTION)).toBe(true);
    expect(isValidSection("inconnue")).toBe(false);
    expect(isValidSection("")).toBe(false);
  });

  it("exclut la section racine du routage /[section]", () => {
    expect(isRoutedSection(DEFAULT_SECTION)).toBe(false);
    expect(isRoutedSection("scenarios")).toBe(true);
  });

  it("donne un href absolu à chaque entrée et des identifiants uniques", () => {
    expect(NAV_ITEMS.every((item) => item.href.startsWith("/"))).toBe(true);
    expect(new Set(NAV_ITEMS.map((item) => item.id)).size).toBe(NAV_ITEMS.length);
  });

  it("retombe sur Today pour un libellé inconnu", () => {
    expect(sectionLabel("scenarios")).toBe("Scenarios");
    expect(sectionLabel("inconnue")).toBe("Today");
  });
});
