import { describe, expect, it } from "vitest";

import {
  analyzeFec,
  toBusinessFinancialCandidate,
  type FecAnalysisInput,
} from "@/lib/acquisition/fec";
import { pcgClassOf, pcgGroupOf } from "@/lib/acquisition/fec/pcg";
import { parseFecDate } from "@/lib/acquisition/fec/parse";
import { resolveFecHeader } from "@/lib/acquisition/fec/spec";
import type { FecAnalysis } from "@/lib/acquisition/fec/types";
import {
  ACCENTED,
  ATYPICAL_ORDER,
  BOTH_SIDES,
  EXPLICIT_ZERO,
  FEC_HEADER,
  FINANCIAL_EXPENSES_SPLIT,
  FOREIGN_CURRENCY,
  HEADER_WITHOUT_ACCOUNT,
  INVALID_DATE,
  largeFec,
  MISSING_ACCOUNT,
  MISSING_JOURNAL,
  NEGATIVE_CASH,
  NO_AMOUNT,
  NOMINAL,
  NON_STANDARD_DATE,
  OVERDRAFT_ACCOUNT,
  PIPE_DELIMITED,
  TRADING,
  TWO_FISCAL_YEARS,
  UNBALANCED,
  UNKNOWN_ACCOUNT_CLASS,
  utf8,
  windows1252,
} from "@/lib/acquisition/fec/__tests__/fixtures/fec";

const YEAR_2025 = { start: "2025-01-01", end: "2025-12-31" };

function analyze(bytes: Uint8Array, overrides: Partial<FecAnalysisInput> = {}): FecAnalysis {
  return analyzeFec({
    bytes,
    currency: "EUR",
    coverage: "DECLARED_COMPLETE",
    fiscalYear: YEAR_2025,
    ...overrides,
  });
}

function codes(issues: Array<{ code: string }>): string[] {
  return issues.map((entry) => entry.code);
}

function lineAt(analysis: FecAnalysis, rowNumber: number) {
  const line = analysis.lines.find((entry) => entry.rowNumber === rowNumber);
  if (!line) throw new Error(`Ligne ${rowNumber} absente`);
  return line;
}

describe("1-3 · format réglementaire", () => {
  it("1 · lit un FEC nominal équilibré", () => {
    const analysis = analyze(utf8(NOMINAL));
    expect(analysis.counts.blocked).toBe(0);
    expect(analysis.counts.unbalancedEntries).toBe(0);
    expect(analysis.counts.lines).toBe(24);
    expect(analysis.statement.status).toBe("CALCULABLE");
  });

  it("2 · reconnaît les journaux distincts sans les inventer", () => {
    const analysis = analyze(utf8(NOMINAL));
    expect(analysis.counts.journals).toBe(5);
    expect(analysis.counts.entries).toBe(11);
  });

  it("3 · une écriture multi-lignes reste UNE écriture", () => {
    const analysis = analyze(utf8(NOMINAL));
    const sale = analysis.entries.find((entry) => entry.entryNumber === "1");
    expect(sale?.lineNumbers).toHaveLength(3);
    expect(sale?.totalDebit).toBe(1200);
    expect(sale?.totalCredit).toBe(1200);
    expect(sale?.balanced).toBe(true);
  });

  it("résout l'en-tête par NOM, et signale un ordre non réglementaire", () => {
    const reordered = resolveFecHeader([
      "EcritureDate",
      "JournalCode",
      "EcritureNum",
      "CompteNum",
      "Debit",
      "Credit",
    ]);
    expect(reordered.positions.EcritureDate).toBe(0);
    expect(reordered.positions.JournalCode).toBe(1);
    expect(codes(reordered.issues)).toContain("FEC_HEADER_INVALID");
  });

  it("lit un séparateur barre verticale", () => {
    const analysis = analyze(utf8(PIPE_DELIMITED));
    expect(analysis.delimiter).toBe("|");
    expect(analysis.counts.blocked).toBe(0);
  });
});

describe("4-6 · NULL et ZÉRO", () => {
  it("4-5 · un débit et un crédit explicitement à zéro sont des VALEURS", () => {
    const analysis = analyze(utf8(EXPLICIT_ZERO));
    expect(lineAt(analysis, 2).credit).toBe(0);
    expect(lineAt(analysis, 3).debit).toBe(0);
    expect(analysis.counts.unbalancedEntries).toBe(0);
    // Un zéro transmis n'est pas une anomalie : le format autorise le côté non employé.
    expect(codes(lineAt(analysis, 2).issues)).not.toContain("FEC_AMOUNT_MISSING");
  });

  it("6 · un champ facultatif ABSENT reste null, sans être converti en zéro", () => {
    const analysis = analyze(utf8(NOMINAL));
    const row = lineAt(analysis, 2);
    expect(row.credit).toBeNull();
    expect(row.debit).toBe(1200);
    expect(row.auxAccountNumber).toBeNull();
    expect(row.currencyAmount).toBeNull();
  });

  it("les deux côtés absents bloquent la ligne : elle n'a aucun montant", () => {
    const analysis = analyze(utf8(NO_AMOUNT));
    expect(lineAt(analysis, 2).status).toBe("BLOCKED");
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_AMOUNT_MISSING");
  });
});

describe("7-10 · contrôles comptables", () => {
  it("7 · une écriture déséquilibrée est signalée sur CHACUNE de ses lignes", () => {
    const analysis = analyze(utf8(UNBALANCED));
    expect(analysis.counts.unbalancedEntries).toBe(1);
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_ENTRY_UNBALANCED");
    expect(codes(lineAt(analysis, 3).issues)).toContain("FEC_ENTRY_UNBALANCED");
    expect(analysis.entries[0].imbalance).toBe(200);
  });

  it("un déséquilibre empêche la reconstruction de devenir fiable", () => {
    const analysis = analyze(utf8(UNBALANCED));
    expect(analysis.statement.status).not.toBe("CALCULABLE");
    expect(codes(analysis.statement.blockers)).toContain("FEC_ENTRY_UNBALANCED");
  });

  it("8 · une date inexistante au calendrier bloque la ligne", () => {
    const analysis = analyze(utf8(INVALID_DATE));
    expect(lineAt(analysis, 2).status).toBe("BLOCKED");
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_ENTRY_DATE_INVALID");
  });

  it("9 · un compte absent bloque la ligne", () => {
    const analysis = analyze(utf8(MISSING_ACCOUNT));
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_ACCOUNT_MISSING");
  });

  it("10 · un journal absent bloque la ligne", () => {
    const analysis = analyze(utf8(MISSING_JOURNAL));
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_JOURNAL_MISSING");
  });

  it("débit et crédit simultanément non nuls : ambiguïté signalée, solde net exploitable", () => {
    const analysis = analyze(utf8(BOTH_SIDES));
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_AMOUNT_BOTH_SIDES");
    expect(analysis.counts.unbalancedEntries).toBe(0);
  });

  it("un en-tête sans champ structurant ne produit AUCUNE ligne", () => {
    const analysis = analyze(utf8(HEADER_WITHOUT_ACCOUNT));
    expect(analysis.lines).toHaveLength(0);
    expect(codes(analysis.issues)).toContain("FEC_HEADER_MISSING_FIELD");
    expect(analysis.statement.status).toBe("NOT_COMPUTABLE");
  });
});

describe("11-16 · champs facultatifs, devise, encodage", () => {
  it("11-13 · auxiliaire, lettrage et pièce sont conservés tels quels", () => {
    const analysis = analyze(utf8(NOMINAL));
    const settlement = lineAt(analysis, 18);
    expect(settlement.letterCode).toBe("AA");
    expect(settlement.letterDate).toBe("2025-06-30");
    expect(settlement.pieceReference).toBe("FA-001");
  });

  it("14 · la devise native est conservée, sans aucune conversion", () => {
    const analysis = analyze(utf8(FOREIGN_CURRENCY));
    expect(lineAt(analysis, 2).currencyCode).toBe("USD");
    expect(lineAt(analysis, 2).currencyAmount).toBe(1100);
    // Le montant en devise de tenue reste celui du débit : rien n'est converti ici.
    expect(lineAt(analysis, 2).debit).toBe(1000);
    expect(analysis.currencies).toEqual(["USD"]);
    expect(codes(analysis.statement.blockers)).toContain("FEC_MULTI_CURRENCY");
  });

  it("un montant en devise sans code devise est signalé", () => {
    const analysis = analyze(utf8(FOREIGN_CURRENCY));
    expect(codes(lineAt(analysis, 4).issues)).toContain("FEC_CURRENCY_AMOUNT_WITHOUT_CODE");
  });

  it("15-16 · accents lus en UTF-8 comme en Windows-1252", () => {
    const utf = analyze(utf8(ACCENTED));
    expect(lineAt(utf, 2).entryLabel).toBe("Prestation réalisée à Nîmes");
    const legacy = analyze(windows1252(ACCENTED));
    expect(legacy.encoding).toBe("WINDOWS_1252");
    expect(lineAt(legacy, 2).entryLabel).toBe("Prestation réalisée à Nîmes");
    expect(codes(legacy.issues)).toContain("ENCODING_FALLBACK");
  });

  it("un format de date non réglementaire est lu ET signalé", () => {
    const analysis = analyze(utf8(NON_STANDARD_DATE), { fiscalYear: null });
    expect(lineAt(analysis, 2).entryDate).toBe("2025-01-31");
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_NON_STANDARD_DATE_FORMAT");
  });

  it("la date réglementaire AAAAMMJJ se lit sans convention", () => {
    expect(parseFecDate("20250131", "AMBIGUOUS")).toEqual({ value: "2025-01-31", code: "OK" });
    expect(parseFecDate("20250231", "AMBIGUOUS").code).toBe("INVALID");
    expect(parseFecDate("", "AMBIGUOUS").code).toBe("EMPTY");
  });
});

describe("17-19 · exercices et cohérences temporelles", () => {
  it("19 · une écriture hors exercice déclaré est signalée, pas supprimée", () => {
    const analysis = analyze(utf8(TWO_FISCAL_YEARS));
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_DATE_OUT_OF_FISCAL_YEAR");
    expect(lineAt(analysis, 2).entryDate).toBe("2024-12-15");
    expect(lineAt(analysis, 4).issues.map((entry) => entry.code)).not.toContain(
      "FEC_DATE_OUT_OF_FISCAL_YEAR",
    );
  });

  it("la période observée n'est pas la couverture déclarée", () => {
    const observed = analyze(utf8(NOMINAL), { coverage: "OBSERVED_ONLY", fiscalYear: null });
    expect(observed.observedPeriod).toEqual({ start: "2025-01-31", end: "2025-12-31" });
    // Des dates minimale et maximale ne prouvent pas un exercice complet.
    expect(observed.statement.status).toBe("PARTIAL");
    expect(codes(observed.statement.blockers)).toContain("FEC_COVERAGE_NOT_DECLARED");
  });

  it("une date de validation antérieure à l'écriture est signalée", () => {
    const analysis = analyze(utf8(ATYPICAL_ORDER));
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_VALID_DATE_BEFORE_ENTRY");
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_LETTER_DATE_WITHOUT_CODE");
  });
});

describe("20-28 · reconstruction comptable", () => {
  const analysis = analyze(utf8(NOMINAL));
  const income = analysis.statement.income;
  const balance = analysis.statement.balanceSheet;

  it("20 · chiffre d'affaires reconstruit depuis les comptes 70", () => {
    expect(income.revenue.value).toBe(1000);
    expect(income.revenue.basis).toContain("70");
  });

  it("21 · charges externes reconstruites depuis les comptes 61 et 62", () => {
    expect(income.externalServices.value).toBe(300);
  });

  it("22 · masse salariale reconstruite depuis les comptes 64", () => {
    expect(income.personnelExpense.value).toBe(800);
  });

  it("23 · dotations aux amortissements isolées des comptes 68", () => {
    expect(income.depreciationExpense.value).toBe(500);
    expect(balance.fixedAssetsDepreciation.value).toBe(500);
    // Un amortissement cumulé au bilan n'est pas un capex décaissé.
    expect(balance.fixedAssetsDepreciation.note).toContain("capex");
  });

  it("EBE reconstruit selon la convention SIG, et la convention est NOMMÉE", () => {
    // Production 1 000 − consommations (500 achats + 300 services) = 200 de valeur ajoutée
    // 200 − 50 d'impôts et taxes − 800 de personnel = −650
    expect(income.addedValue.value).toBe(200);
    expect(income.grossOperatingSurplus.value).toBe(-650);
    expect(income.grossOperatingSurplus.basis).toContain("SIG");
    expect(income.grossOperatingSurplus.note).toContain("REPORTING");
  });

  it("résultat d'exploitation, financier et net s'enchaînent", () => {
    expect(income.operatingResult.value).toBe(-1150);
    expect(income.financialResult.value).toBe(-120);
    expect(income.currentResultBeforeTax.value).toBe(-1270);
    expect(income.incomeTaxExpense.value).toBe(60);
    expect(income.netResult.value).toBe(-1330);
  });

  it("24 · trésorerie comptable reconstruite depuis 512", () => {
    expect(balance.cash.value).toBe(3080);
    expect(balance.cash.note).toContain("COMPTABLE");
  });

  it("25 · dette comptable reconstruite depuis les comptes 16", () => {
    expect(balance.financialDebt.value).toBe(5000);
    expect(balance.financialDebt.note).toContain("Debt Engine");
  });

  it("26-27 · fournisseurs et clients isolés", () => {
    expect(balance.suppliers.value).toBe(900);
    expect(balance.tradeReceivables.value).toBe(0);
  });

  it("28 · compte courant d'associé ISOLÉ et non qualifié", () => {
    expect(balance.shareholderCurrentAccounts.value).toBe(2000);
    expect(balance.shareholderCurrentAccounts.note).toContain("convention de deal");
    // Il n'entre PAS dans la dette financière.
    expect(balance.financialDebt.value).toBe(5000);
  });

  it("le BFR d'exploitation exclut trésorerie, dette et comptes courants", () => {
    // Clients 1 200 − 1 200 = 0, stocks absents = 0.
    // Fournisseurs 401000 : 600 + 300 = 900.
    // Dettes fiscales et sociales (42, 43, 44) : 445710 +200, 445660 −100, 421000 +800,
    // 447000 +50, 444000 +60 = 1 010 au crédit.
    // BFR = 0 + 0 + 0 − 900 − 1 010 − 0 = −1 910.
    expect(balance.operatingWorkingCapital.value).toBe(-1910);
    expect(balance.operatingWorkingCapital.note).toContain("NWC contractuel");
  });

  it("chaque solde de groupe expose les comptes qui l'ont produit", () => {
    const cash = analysis.statement.groups.find((group) => group.group === "CASH");
    expect(cash?.accounts).toEqual(["512000"]);
    // 512000 apparaît sur les écritures 8, 9 et 10 : trois lignes, un seul compte.
    expect(cash?.lineCount).toBe(3);
  });
});

describe("trésorerie négative et découvert", () => {
  it("une trésorerie comptable négative n'est PAS transmise comme cash", () => {
    const analysis = analyze(utf8(NEGATIVE_CASH));
    expect(analysis.statement.balanceSheet.cash.value).toBe(-500);
    expect(codes(analysis.statement.blockers)).toContain("FEC_CASH_NEGATIVE");
    const candidate = toBusinessFinancialCandidate(analysis.statement);
    expect(candidate?.cash).toBeNull();
  });

  it("un concours bancaire courant est un passif, il ne réduit pas le cash", () => {
    const analysis = analyze(utf8(OVERDRAFT_ACCOUNT));
    expect(analysis.statement.balanceSheet.cash.value).toBe(800);
    expect(analysis.statement.balanceSheet.bankOverdraft.value).toBe(800);
    expect(analysis.statement.balanceSheet.bankOverdraft.note).toContain("découvert");
  });
});

describe("classification comptable, jamais économique", () => {
  it("classe et groupe déterministes, règle la plus spécifique gagnante", () => {
    expect(pcgClassOf("701000")).toBe(7);
    expect(pcgGroupOf("701000")).toBe("REVENUE");
    expect(pcgGroupOf("455100")).toBe("SHAREHOLDER_CURRENT_ACCOUNT");
    expect(pcgGroupOf("451000")).toBe("OTHER_RECEIVABLES");
    expect(pcgGroupOf("519000")).toBe("BANK_OVERDRAFT");
    expect(pcgGroupOf("512000")).toBe("CASH");
    expect(pcgGroupOf("603000")).toBe("INVENTORY_CHANGE");
    expect(pcgGroupOf("601000")).toBe("PURCHASES");
    expect(pcgGroupOf("281500")).toBe("FIXED_ASSETS_DEPRECIATION");
    expect(pcgGroupOf("215000")).toBe("FIXED_ASSETS_GROSS");
    expect(pcgGroupOf("108000")).toBe("SHAREHOLDER_CURRENT_ACCOUNT");
  });

  it("un compte 625 reste un poste comptable, jamais une dépense personnelle", () => {
    // Le groupe est celui des services extérieurs. Aucun retraitement, aucune étiquette
    // « dirigeant » : le jugement appartient au ledger de QoE de Business Equity.
    expect(pcgGroupOf("625100")).toBe("EXTERNAL_SERVICES");
  });

  it("un compte hors nomenclature ne participe à aucune reconstruction", () => {
    const analysis = analyze(utf8(UNKNOWN_ACCOUNT_CLASS));
    expect(lineAt(analysis, 2).pcgGroup).toBe("UNCLASSIFIED");
    expect(codes(lineAt(analysis, 2).issues)).toContain("FEC_ACCOUNT_UNKNOWN_CLASS");
    expect(analysis.statement.income.revenue.value).toBe(0);
  });
});

describe("contrat d'intégration Business", () => {
  it("un candidat CALCULABLE reprend les noms du contrat canonique", () => {
    const analysis = analyze(utf8(NOMINAL));
    const candidate = toBusinessFinancialCandidate(analysis.statement);
    expect(candidate).not.toBeNull();
    expect(candidate!.blockers).toHaveLength(0);
    expect(candidate!.periodEnd).toBe("2025-12-31");
    expect(candidate!.periodKind).toBe("ANNUAL");
    expect(candidate!.revenue).toBe(1000);
    expect(candidate!.ebitda).toBe(-650);
    expect(candidate!.grossDebt).toBe(5000);
  });

  it("aucun EBITDA normatif n'est inventé : seul l'EBE de reporting est transmis", () => {
    const analysis = analyze(utf8(NOMINAL));
    const candidate = toBusinessFinancialCandidate(analysis.statement)!;
    expect(candidate.basis.ebitda).toContain("SIG");
    expect(candidate.basis.ebitda).not.toContain("normat");
  });

  it("capex et free cash flow restent null : D&A n'est pas un capex décaissé", () => {
    const analysis = analyze(utf8(NOMINAL));
    const candidate = toBusinessFinancialCandidate(analysis.statement)!;
    expect(candidate.capex).toBeNull();
    expect(candidate.freeCashFlow).toBeNull();
    expect(candidate.depreciationAmortisation).toBe(500);
  });

  it("une reconstruction non CALCULABLE n'est pas intégrable", () => {
    const analysis = analyze(utf8(NOMINAL), { coverage: "OBSERVED_ONLY" });
    const candidate = toBusinessFinancialCandidate(analysis.statement)!;
    expect(candidate.blockers.length).toBeGreaterThan(0);
    expect(codes(candidate.blockers)).toContain("FEC_COVERAGE_NOT_DECLARED");
  });

  it("chaque montant transmis porte la convention qui l'a produit", () => {
    const analysis = analyze(utf8(NOMINAL));
    const candidate = toBusinessFinancialCandidate(analysis.statement)!;
    for (const basis of Object.values(candidate.basis)) {
      expect(basis.length).toBeGreaterThan(0);
    }
  });
});

describe("29 · volume", () => {
  it("traite un exercice de 50 000 lignes sans tronquer", () => {
    const analysis = analyze(utf8(largeFec(25_000)));
    expect(analysis.counts.lines).toBe(50_000);
    expect(analysis.counts.entries).toBe(25_000);
    expect(analysis.counts.unbalancedEntries).toBe(0);
    expect(analysis.counts.blocked).toBe(0);
    expect(analysis.statement.status).toBe("CALCULABLE");
  });

  it("refuse explicitement un fichier au-delà du plafond au lieu de le tronquer", () => {
    const analysis = analyze(utf8(largeFec(100)), { maxLines: 50 });
    expect(analysis.lines).toHaveLength(0);
    expect(codes(analysis.issues)).toContain("FEC_LINE_COUNT_EXCEEDED");
  });

  it("le plafond FEC est distinct de celui du relevé bancaire", async () => {
    const { MAX_ROWS_PER_SESSION } = await import("@/lib/acquisition/bank-csv");
    const { MAX_FEC_LINES } = await import("@/lib/acquisition/fec");
    expect(MAX_FEC_LINES).toBeGreaterThan(MAX_ROWS_PER_SESSION);
  });
});

describe("en-tête et fichier vide", () => {
  it("un fichier réduit à son en-tête ne produit aucune ligne et aucun état", () => {
    const analysis = analyze(utf8(FEC_HEADER));
    expect(analysis.lines).toHaveLength(0);
    expect(analysis.statement.status).toBe("NOT_COMPUTABLE");
  });

  it("un fichier vide est une erreur, pas zéro écriture", () => {
    const analysis = analyze(utf8(""));
    expect(codes(analysis.issues)).toContain("FILE_EMPTY");
  });
});

describe("charges d'intérêts isolées des autres charges financières", () => {
  const analysis = analyze(utf8(FINANCIAL_EXPENSES_SPLIT));

  it("661 est un groupe distinct de la classe 66", () => {
    expect(pcgGroupOf("661100")).toBe("INTEREST_EXPENSE");
    expect(pcgGroupOf("666000")).toBe("FINANCIAL_EXPENSES");
  });

  it("la charge d'intérêts n'agrège que 661", () => {
    expect(analysis.statement.income.interestExpense.value).toBe(120);
    expect(analysis.statement.income.interestExpense.basis).toContain("661");
    expect(analysis.statement.income.interestExpense.note).toContain("Debt Engine");
  });

  it("le résultat financier reprend TOUTE la classe 66, intérêts inclus", () => {
    // Isoler 661 ne doit rien soustraire : 120 + 30 = 150 de charges financières.
    expect(analysis.statement.income.financialResult.value).toBe(-150);
  });

  it("la charge d'intérêts est transmise au contrat Business avec sa convention", () => {
    const candidate = toBusinessFinancialCandidate(analysis.statement);
    expect(candidate?.interestExpense).toBe(120);
    expect(candidate?.basis.interestExpense).toContain("661");
  });
});

describe("absence totale de ligne exploitable", () => {
  it("un fichier sans ligne exploitable est NOT_COMPUTABLE, jamais un exercice à zéro", () => {
    const analysis = analyze(utf8(`${FEC_HEADER}\n`));
    expect(analysis.counts.lines).toBe(0);
    expect(codes(analysis.statement.blockers)).toContain("FEC_NO_EXPLOITABLE_LINE");
    expect(analysis.statement.status).toBe("NOT_COMPUTABLE");
    expect(analysis.statement.income.revenue.value).toBe(0);
    expect(toBusinessFinancialCandidate(analysis.statement)).toBeNull();
  });

  it("un fichier dont TOUTES les lignes sont bloquées ne produit pas d'état", () => {
    const analysis = analyze(utf8(NO_AMOUNT));
    expect(analysis.counts.blocked).toBe(analysis.counts.lines);
    expect(analysis.statement.status).toBe("NOT_COMPUTABLE");
    expect(codes(analysis.statement.blockers)).toContain("FEC_NO_EXPLOITABLE_LINE");
  });
});

describe("marge commerciale : un solde nommé, jamais la valeur ajoutée renommée", () => {
  it("une société de négoce expose une marge commerciale sur les marchandises seules", () => {
    const analysis = analyze(utf8(TRADING));
    const income = analysis.statement.income;
    // 707 3 000 − 607 1 800 − 6037 200 = 1 000.
    expect(income.merchandiseMargin.value).toBe(1000);
    expect(income.merchandiseMargin.basis).toContain("707");
    // Les agrégats de classe restent complets : 707 dans le 70, 607 et 6037 dans le 60.
    expect(income.revenue.value).toBe(3000);
    expect(income.externalConsumption.value).toBe(2400);
    // Valeur ajoutée 3 000 − 2 400 = 600 : elle DIFFÈRE de la marge commerciale.
    expect(income.addedValue.value).toBe(600);
  });

  it("le contrat Business reçoit la marge commerciale, pas la valeur ajoutée", () => {
    const candidate = toBusinessFinancialCandidate(analyze(utf8(TRADING)).statement);
    expect(candidate?.grossProfit).toBe(1000);
    expect(candidate?.basis.grossProfit).toContain("707");
  });

  it("une société sans compte de marchandises n'a PAS de marge commerciale", () => {
    const analysis = analyze(utf8(NOMINAL));
    expect(analysis.statement.income.merchandiseMargin.value).toBeNull();
    expect(analysis.statement.income.merchandiseMargin.note).toContain("n'en tient pas lieu");
    // Et la valeur ajoutée, elle, reste calculée.
    expect(analysis.statement.income.addedValue.value).not.toBeNull();
    expect(toBusinessFinancialCandidate(analysis.statement)?.grossProfit).toBeNull();
  });
});
