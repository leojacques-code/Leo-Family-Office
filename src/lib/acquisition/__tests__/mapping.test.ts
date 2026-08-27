import { describe, expect, it } from "vitest";

import { inferBankMapping, normalizeHeader, validateBankMapping } from "@/lib/acquisition/mapping";

describe("normalisation d'en-tête", () => {
  it("ignore accents, casse et ponctuation", () => {
    expect(normalizeHeader("Date de l'opération")).toBe("date de l operation");
    expect(normalizeHeader("MONTANT (EUR)")).toBe("montant eur");
  });
});

describe("inférence de mapping", () => {
  it("sépare un identifiant de transaction d'une référence descriptive", () => {
    const result = inferBankMapping([
      "Date operation",
      "Libelle",
      "Montant",
      "Reference bancaire",
      "Transaction ID",
    ]);
    expect(result.mapping.reference).toBe(3);
    expect(result.mapping.externalTransactionId).toBe(4);
  });

  it("une colonne « Reference » seule n'est jamais lue comme un identifiant", () => {
    const result = inferBankMapping(["Date operation", "Libelle", "Montant", "Reference"]);
    expect(result.mapping.reference).toBe(3);
    expect(result.mapping.externalTransactionId).toBeUndefined();
  });

  it("associe un format français signé sans ambiguïté", () => {
    const result = inferBankMapping(["Date operation", "Libelle", "Montant", "Devise"]);
    expect(result.mapping).toEqual({ transactionDate: 0, label: 1, amount: 2, currency: 3 });
    expect(result.confidence).toBe("CERTAIN");
  });

  it("associe des colonnes débit et crédit séparées", () => {
    const result = inferBankMapping([
      "Date comptable",
      "Date de valeur",
      "Libelle operation",
      "Debit",
      "Credit",
    ]);
    expect(result.mapping.debit).toBe(3);
    expect(result.mapping.credit).toBe(4);
    expect(result.mapping.valueDate).toBe(1);
    expect(result.mapping.amount).toBeUndefined();
  });

  it("ne confond pas date de valeur et date d'opération", () => {
    const result = inferBankMapping(["Date de valeur", "Date operation", "Libelle", "Montant"]);
    expect(result.mapping.valueDate).toBe(0);
    expect(result.mapping.transactionDate).toBe(1);
  });

  it("réclame une confirmation quand la date d'opération n'est que déduite", () => {
    const result = inferBankMapping(["Date de valeur", "Libelle", "Montant"]);
    expect(result.mapping.transactionDate).toBeUndefined();
    expect(result.confidence).toBe("INCOMPLETE");
    expect(result.issues.map((entry) => entry.code)).toContain("MAPPING_REQUIRED_FIELD_MISSING");
  });

  it("refuse un fichier sans colonne de montant", () => {
    const result = inferBankMapping(["Date operation", "Libelle", "Devise"]);
    expect(result.confidence).toBe("INCOMPLETE");
    const codes = result.issues.map((entry) => entry.code);
    expect(codes).toContain("MAPPING_REQUIRED_FIELD_MISSING");
  });

  it("laisse les en-têtes inconnus non associés plutôt que de les forcer", () => {
    const result = inferBankMapping(["Col1", "Col2", "Col3"]);
    expect(result.mapping).toEqual({});
    expect(result.unmappedHeaders).toEqual(["Col1", "Col2", "Col3"]);
    expect(result.confidence).toBe("INCOMPLETE");
  });

  it("signale deux colonnes qui revendiquent le même champ", () => {
    const result = inferBankMapping(["Montant", "Montant", "Date operation", "Libelle"]);
    expect(result.issues.map((entry) => entry.code)).toContain("MAPPING_AMBIGUOUS");
    expect(result.confidence).toBe("AMBIGUOUS");
  });
});

describe("validation d'un mapping imposé", () => {
  it("refuse un montant signé cumulé avec débit/crédit", () => {
    const result = validateBankMapping(["a", "b", "c", "d"], {
      transactionDate: 0,
      label: 1,
      amount: 2,
      debit: 3,
    });
    expect(result.issues.map((entry) => entry.code)).toContain("MAPPING_CONFLICT");
    expect(result.confidence).toBe("INCOMPLETE");
  });

  it("refuse une colonne source associée à deux champs", () => {
    // Une colonne ne peut pas être à la fois le libellé et la référence : ce serait deux
    // faits tirés de la même observation, sans qu'aucun soit faux isolément.
    const result = validateBankMapping(["Date", "Libelle", "Montant"], {
      transactionDate: 0,
      label: 1,
      reference: 1,
      amount: 2,
    });
    expect(result.issues.map((entry) => entry.code)).toContain("MAPPING_DUPLICATE_COLUMN");
    expect(result.confidence).toBe("INCOMPLETE");
  });

  it("refuse un mapping qui désigne une colonne absente du fichier", () => {
    const result = validateBankMapping(["a", "b"], { transactionDate: 0, label: 1, amount: 7 });
    expect(result.issues.map((entry) => entry.code)).toContain("MAPPING_UNKNOWN_COLUMN");
  });

  it("accepte un mapping complet et cohérent", () => {
    const result = validateBankMapping(["a", "b", "c"], {
      transactionDate: 0,
      label: 1,
      amount: 2,
    });
    expect(result.confidence).toBe("CERTAIN");
    expect(result.issues).toHaveLength(0);
  });
});
