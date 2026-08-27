import { describe, expect, it } from "vitest";

import { importAnalyzeSchema, importCommandSchema } from "@/lib/validation/imports";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const RECORD = "33333333-3333-4333-8333-333333333333";

function analyze(overrides: Record<string, unknown> = {}) {
  return importAnalyzeSchema.safeParse({
    accountId: ACCOUNT,
    declaredCurrency: "eur",
    declaredPeriodStart: null,
    declaredPeriodEnd: null,
    mapping: null,
    stableTransactionIdDeclared: false,
    rememberMapping: true,
    retainFile: false,
    ...overrides,
  });
}

describe("paramètres d'analyse", () => {
  it("accepte une saisie complète et normalise la devise", () => {
    const parsed = analyze();
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.declaredCurrency).toBe("EUR");
  });

  it("accepte l'absence de devise déclarée comme une valeur", () => {
    const parsed = analyze({ declaredCurrency: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.declaredCurrency).toBeNull();
  });

  it("refuse une devise qui n'est pas un code de trois lettres", () => {
    expect(analyze({ declaredCurrency: "EURO" }).success).toBe(false);
    expect(analyze({ declaredCurrency: "" }).success).toBe(false);
  });

  it("refuse une date inexistante au calendrier", () => {
    expect(analyze({ declaredPeriodStart: "2026-02-31" }).success).toBe(false);
  });

  it("refuse une période déclarée qui se termine avant de commencer", () => {
    expect(
      analyze({ declaredPeriodStart: "2026-08-31", declaredPeriodEnd: "2026-08-01" }).success,
    ).toBe(false);
    expect(
      analyze({ declaredPeriodStart: "2026-08-01", declaredPeriodEnd: "2026-08-31" }).success,
    ).toBe(true);
  });

  it("accepte un mapping imposé et refuse un champ cible inconnu", () => {
    expect(analyze({ mapping: { transactionDate: 0, label: 1, amount: 2 } }).success).toBe(true);
    expect(analyze({ mapping: { transactionDate: 0, inventé: 1 } }).success).toBe(false);
    // Le champ historique a été scindé : une référence n'est plus un identifiant.
    expect(analyze({ mapping: { externalReference: 1 } }).success).toBe(false);
    expect(analyze({ mapping: { reference: 1, externalTransactionId: 2 } }).success).toBe(true);
  });

  it("exige une déclaration EXPLICITE de stabilité de l'identifiant", () => {
    const parsed = analyze({ stableTransactionIdDeclared: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.stableTransactionIdDeclared).toBe(true);
    // Le champ est obligatoire : l'omettre ne vaut pas « non déclaré par défaut » côté API,
    // la valeur doit être portée par l'appelant.
    const missing = importAnalyzeSchema.safeParse({
      accountId: ACCOUNT,
      declaredCurrency: "EUR",
      declaredPeriodStart: null,
      declaredPeriodEnd: null,
      mapping: null,
      rememberMapping: true,
      retainFile: false,
    });
    expect(missing.success).toBe(false);
  });

  it("refuse un index de colonne négatif ou non entier", () => {
    expect(analyze({ mapping: { transactionDate: -1 } }).success).toBe(false);
    expect(analyze({ mapping: { transactionDate: 1.5 } }).success).toBe(false);
  });

  it("refuse un champ inattendu à la racine", () => {
    expect(analyze({ categoryId: ACCOUNT }).success).toBe(false);
  });
});

describe("commandes d'import", () => {
  it("accepte une validation avec inclusions nommées", () => {
    const parsed = importCommandSchema.safeParse({
      action: "commit",
      sessionId: SESSION,
      includeRecordIds: [RECORD],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepte une validation sans aucune inclusion", () => {
    expect(
      importCommandSchema.safeParse({ action: "commit", sessionId: SESSION, includeRecordIds: [] })
        .success,
    ).toBe(true);
  });

  it("accepte un abandon et refuse qu'il transporte des inclusions", () => {
    expect(importCommandSchema.safeParse({ action: "discard", sessionId: SESSION }).success).toBe(
      true,
    );
    expect(
      importCommandSchema.safeParse({
        action: "discard",
        sessionId: SESSION,
        includeRecordIds: [RECORD],
      }).success,
    ).toBe(false);
  });

  it("refuse une action inconnue et une session qui n'est pas un UUID", () => {
    expect(importCommandSchema.safeParse({ action: "delete", sessionId: SESSION }).success).toBe(
      false,
    );
    expect(
      importCommandSchema.safeParse({ action: "commit", sessionId: "abc", includeRecordIds: [] })
        .success,
    ).toBe(false);
  });
});
