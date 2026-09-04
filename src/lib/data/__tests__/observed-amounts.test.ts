/**
 * Cette comparaison décide si l'écran présente une ligne comme un REMPLACEMENT, donc si un
 * motif est exigé. Se tromper dans un sens exige une décision pour un rejeu qui ne change
 * rien ; se tromper dans l'autre laisse remplacer un fait sans le dire.
 */
import { describe, expect, it } from "vitest";

import { changedObservedFields, observedAmountChanged } from "@/lib/data/observed-amounts";

describe("comparaison d'un montant observé", () => {
  it("reconnaît la même valeur écrite avec l'échelle de sa colonne", () => {
    // C'est le cas RÉEL : PostgreSQL rend `1810.000000` là où le fichier disait `1810`.
    expect(observedAmountChanged("1810.000000", "1810")).toBe(false);
    expect(observedAmountChanged("10.0000000000", "10")).toBe(false);
    expect(observedAmountChanged("0.5", "0.50")).toBe(false);
    expect(observedAmountChanged("-0", "0")).toBe(false);
  });

  it("reconnaît un vrai changement, jusqu'au dernier centime", () => {
    expect(observedAmountChanged("1810.000000", "1810.01")).toBe(true);
    expect(observedAmountChanged("1810", "1999")).toBe(true);
  });

  it("traite l'APPARITION d'une valeur comme un changement : null n'est pas zéro", () => {
    expect(observedAmountChanged(null, "12")).toBe(true);
    expect(observedAmountChanged("12", null)).toBe(true);
    expect(observedAmountChanged(null, "0")).toBe(true);
    // Deux absences ne sont pas un changement.
    expect(observedAmountChanged(null, null)).toBe(false);
  });

  it("ignore les espaces de bord, qui ne sont pas une valeur", () => {
    expect(observedAmountChanged(" 1810 ", "1810")).toBe(false);
  });

  it("retombe sur le TEXTE plutôt que d'inventer une égalité qu'elle n'a pas comprise", () => {
    // Une valeur illisible ne devient pas égale à une autre par optimisme.
    expect(observedAmountChanged("indisponible", "1810")).toBe(true);
    expect(observedAmountChanged("indisponible", "indisponible")).toBe(false);
    // `Number("")` vaut ZÉRO en JavaScript, pas `NaN` : sans garde explicite sur le blanc,
    // une chaîne vide serait déclarée égale à `"0"`.
    expect(observedAmountChanged("", "0")).toBe(true);
    expect(observedAmountChanged("   ", "0")).toBe(true);
    expect(observedAmountChanged("", "")).toBe(false);
  });
});

describe("champs d'une observation qui changeraient", () => {
  const persisted = {
    quantity: "10.0000000000",
    costBasis: null,
    marketValue: "1810.000000",
    currency: "EUR",
  };

  it("ne nomme AUCUN champ sur un rejeu identique, malgré des écritures différentes", () => {
    // Un rejeu reste un rejeu : le requalifier en correction gonflerait la piste d'audit de
    // décisions vides et exigerait un motif pour rien.
    expect(
      changedObservedFields(persisted, {
        quantity: "10",
        costBasis: null,
        marketValue: "1810",
        currency: "EUR",
      }),
    ).toEqual([]);
  });

  it("nomme le seul champ qui change", () => {
    expect(changedObservedFields(persisted, { ...persisted, marketValue: "1999" })).toEqual([
      "market_value",
    ]);
  });

  it("nomme les champs dans l'ORDRE des colonnes, pour que les messages se lisent pareil", () => {
    expect(
      changedObservedFields(persisted, {
        quantity: "12",
        costBasis: "1500",
        marketValue: "1999",
        currency: "USD",
      }),
    ).toEqual(["quantity", "cost_basis", "market_value", "currency"]);
  });

  it("compte l'apparition d'un coût de revient comme un changement", () => {
    // `cost_basis` est `null` en base : COÛT DE REVIENT ≠ VALEUR DE MARCHÉ, et une absence
    // remplacée par un montant est une information nouvelle.
    expect(changedObservedFields(persisted, { ...persisted, costBasis: "1750" })).toEqual([
      "cost_basis",
    ]);
  });

  it("normalise la CASSE d'une devise : `eur` et `EUR` sont la même devise", () => {
    expect(changedObservedFields(persisted, { ...persisted, currency: "eur" })).toEqual([]);
    expect(changedObservedFields(persisted, { ...persisted, currency: " EUR " })).toEqual([]);
  });

  it("traite une devise ABSENTE comme un changement : FX ABSENT ≠ FX ÉGAL À 1", () => {
    expect(changedObservedFields(persisted, { ...persisted, currency: null })).toEqual([
      "currency",
    ]);
  });

  it("compare la devise en TEXTE, jamais en nombre", () => {
    // Le cas est théorique mais le garde est réel : passer une devise par `Number` rendrait
    // `NaN`, et deux `NaN` ne sont pas égaux — la devise changerait à chaque lecture.
    expect(changedObservedFields(persisted, { ...persisted, currency: "USD" })).toEqual([
      "currency",
    ]);
  });
});
