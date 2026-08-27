import { describe, expect, it } from "vitest";

import { analyzeBankCsv, applyDedupe, type BankCsvAnalysisInput } from "@/lib/acquisition/bank-csv";
import type { BankCsvAnalysis, ExistingTransactionFact } from "@/lib/acquisition/types";
import {
  AMBIGUOUS_AMOUNTS,
  AMBIGUOUS_DATES,
  EN_SIGNED,
  FR_ACCENTED,
  FR_DEBIT_CREDIT,
  FR_SIGNED,
  largeStatement,
  MESSY,
  NO_AMOUNT_COLUMN,
  TAB_SIGNED,
  UNKNOWN_HEADERS,
  utf8,
  utf8Bom,
  windows1252,
} from "@/lib/acquisition/__tests__/fixtures/bank-csv";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const SOURCE = "22222222-2222-4222-8222-222222222222";
const OBSERVED_AT = "2026-08-27";

function analyze(
  bytes: Uint8Array,
  overrides: Partial<BankCsvAnalysisInput> = {},
): BankCsvAnalysis {
  return analyzeBankCsv({
    bytes,
    accountId: ACCOUNT,
    declaredCurrency: "EUR",
    existing: [],
    identities: [],
    sourceKey: SOURCE,
    observationDate: OBSERVED_AT,
    stableIdentifiers: false,
    ...overrides,
  });
}

/**
 * Simule l'écriture canonique : les lignes committables deviennent des faits existants.
 * C'est exactement ce que fait la RPC de commit, sans la base.
 */
function commit(analysis: BankCsvAnalysis, from = 0): ExistingTransactionFact[] {
  return analysis.rows
    .filter((row) => row.status === "READY")
    .map((row, index) => ({
      id: `t${from + index}`,
      accountId: ACCOUNT,
      date: row.transactionDate!,
      label: row.label!,
      amount: row.amount!,
      currency: row.currency!,
    }));
}

describe("format français signé", () => {
  const analysis = analyze(utf8(FR_SIGNED));

  it("reconnaît encodage, séparateur, mapping et conventions", () => {
    expect(analysis.encoding).toBe("UTF_8");
    expect(analysis.delimiter).toBe(";");
    expect(analysis.mappingConfidence).toBe("CERTAIN");
    expect(analysis.conventions).toEqual({
      amount: "DECIMAL_COMMA",
      date: "DAY_FIRST",
      valueDate: null,
    });
  });

  it("lit les montants signés et l'espace insécable de milliers", () => {
    expect(analysis.rows.map((row) => row.amount)).toEqual([-54.28, -950, 3214.57]);
    expect(analysis.rows.map((row) => row.transactionDate)).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-29",
    ]);
  });

  it("ne classe AUCUN flux : trois lignes prêtes, aucune catégorie inventée", () => {
    expect(analysis.counts).toEqual({
      total: 3,
      ready: 2,
      warning: 1,
      blocked: 0,
      duplicate: 0,
      ignored: 0,
    });
    // La ligne du 29 août est postérieure à la date d'observation : signalée, pas bloquée.
    expect(analysis.rows[2].status).toBe("WARNING");
    expect(analysis.rows[2].issues.map((entry) => entry.code)).toContain("DATE_IN_FUTURE");
    expect(analysis.observedPeriod).toEqual({ start: "2026-08-13", end: "2026-08-29" });
  });

  it("le BOM d'Excel ne casse pas le premier en-tête", () => {
    const withBom = analyze(utf8Bom(FR_SIGNED));
    expect(withBom.encoding).toBe("UTF_8_BOM");
    expect(withBom.mappingConfidence).toBe("CERTAIN");
    expect(withBom.counts.ready).toBe(2);
  });
});

describe("colonnes débit et crédit séparées", () => {
  const analysis = analyze(utf8(FR_DEBIT_CREDIT));

  it("donne le sens par la colonne, jamais par le signe", () => {
    expect(analysis.rows.map((row) => row.amount)).toEqual([-54.28, 41.9]);
    expect(analysis.counts.ready).toBe(2);
  });

  it("conserve la date de valeur sans la confondre avec la date d'opération", () => {
    expect(analysis.rows[0].transactionDate).toBe("2026-08-13");
    expect(analysis.rows[0].valueDate).toBe("2026-08-14");
  });

  it("refuse une ligne où débit et crédit sont tous deux renseignés", () => {
    const both = analyze(
      utf8(
        ["Date comptable;Libelle operation;Debit;Credit", "13/08/2026;DEUX SENS;54,28;41,90"].join(
          "\n",
        ),
      ),
    );
    expect(both.rows[0].status).toBe("BLOCKED");
    expect(both.rows[0].issues.map((entry) => entry.code)).toContain("DEBIT_AND_CREDIT_BOTH_SET");
  });

  it("refuse une ligne sans débit ni crédit", () => {
    const neither = analyze(
      utf8(["Date comptable;Libelle operation;Debit;Credit", "13/08/2026;RIEN;;"].join("\n")),
    );
    expect(neither.rows[0].status).toBe("BLOCKED");
    expect(neither.rows[0].issues.map((entry) => entry.code)).toContain("AMOUNT_MISSING");
  });
});

describe("format international", () => {
  const analysis = analyze(utf8(EN_SIGNED));

  it("lit dates ISO, point décimal et devise déclarée par la source", () => {
    expect(analysis.conventions.amount).toBe("DECIMAL_POINT");
    expect(analysis.conventions.date).toBe("ISO");
    expect(analysis.rows.map((row) => row.amount)).toEqual([-3.2, -3.2, 1.05]);
    expect(analysis.rows.every((row) => row.currency === "EUR")).toBe(true);
  });

  it("une colonne d'identifiant NE devient PAS une identité sans déclaration", () => {
    // Deux lignes rigoureusement identiques sauf leur Transaction ID. Sans déclaration de
    // stabilité, l'identifiant est conservé mais ne produit aucune clé d'identité.
    expect(analysis.rows.slice(0, 2).map((row) => row.verdict)).toEqual(["NEW", "NEW"]);
    expect(analysis.rows.every((row) => row.externalKey === null)).toBe(true);
    expect(analysis.rows[0].externalTransactionId).toBe("TX-0001");
    expect(analysis.counts.ready).toBe(3);
  });

  it("la déclaration de stabilité produit une identité par ligne", () => {
    const declared = analyze(utf8(EN_SIGNED), { stableIdentifiers: true });
    expect(declared.rows[0].externalKey).not.toBe(declared.rows[1].externalKey);
    expect(declared.rows.every((row) => row.externalKey !== null)).toBe(true);
    expect(declared.counts.ready).toBe(3);
  });
});

describe("tabulations et encodage hérité", () => {
  it("lit un export tabulé", () => {
    const analysis = analyze(utf8(TAB_SIGNED));
    expect(analysis.delimiter).toBe("\t");
    expect(analysis.counts.ready).toBe(2);
  });

  it("lit un fichier Windows-1252 en signalant le repli", () => {
    const analysis = analyze(windows1252(FR_ACCENTED));
    expect(analysis.encoding).toBe("WINDOWS_1252");
    expect(analysis.rows[0].label).toBe("PRÉLÈVEMENT ÉLECTRICITÉ");
    expect(analysis.issues.map((entry) => entry.code)).toContain("ENCODING_FALLBACK");
  });
});

describe("devise absente", () => {
  it("applique la devise DÉCLARÉE pour l'import et le signale", () => {
    const analysis = analyze(
      utf8(["Date operation;Libelle;Montant", "13/08/2026;OPERATION;-10,00"].join("\n")),
    );
    expect(analysis.rows[0].currency).toBe("EUR");
    expect(analysis.rows[0].issues.map((entry) => entry.code)).toContain(
      "CURRENCY_FROM_SESSION_DECLARATION",
    );
    expect(analysis.rows[0].status).toBe("READY");
  });

  it("bloque la ligne quand aucune devise n'est déclarée nulle part", () => {
    const analysis = analyze(
      utf8(["Date operation;Libelle;Montant", "13/08/2026;OPERATION;-10,00"].join("\n")),
      { declaredCurrency: null },
    );
    expect(analysis.rows[0].status).toBe("BLOCKED");
    expect(analysis.rows[0].issues.map((entry) => entry.code)).toContain("CURRENCY_MISSING");
  });
});

describe("fichier désordonné", () => {
  const analysis = analyze(utf8(MESSY));

  it("classe chaque ligne pour ce qu'elle est", () => {
    const byRow = new Map(analysis.rows.map((row) => [row.rowNumber, row]));
    expect(byRow.get(2)!.status).toBe("READY");
    expect(byRow.get(3)!.status).toBe("IGNORED");
    expect(byRow.get(3)!.issues.map((entry) => entry.code)).toContain("ROW_EMPTY");
    expect(byRow.get(4)!.status).toBe("READY");
    expect(byRow.get(4)!.verdict).toBe("NEW");
    expect(byRow.get(5)!.issues.map((entry) => entry.code)).toContain("DATE_NOT_A_CALENDAR_DATE");
    expect(byRow.get(6)!.issues.map((entry) => entry.code)).toContain("AMOUNT_UNPARSEABLE");
    expect(byRow.get(7)!.issues.map((entry) => entry.code)).toContain("LABEL_MISSING");
    expect(byRow.get(8)!.status).toBe("IGNORED");
    expect(byRow.get(8)!.issues.map((entry) => entry.code)).toContain("ROW_TOTAL_SUSPECTED");
    expect(byRow.get(9)!.issues.map((entry) => entry.code)).toContain("CURRENCY_UNKNOWN");
  });

  it("deux lignes identiques du même fichier restent deux opérations", () => {
    const identical = analysis.rows.filter((row) => row.label === "CARTE 1208 AMAZON EU");
    expect(identical.map((row) => row.verdict)).toEqual(["NEW", "NEW"]);
    expect(new Set(identical.map((row) => row.matchKey)).size).toBe(2);
  });

  it("aucune ligne bloquée n'est committable", () => {
    expect(analysis.counts.blocked).toBe(4);
    expect(
      analysis.rows.filter((row) => row.status === "BLOCKED").every((row) => row.verdict === null),
    ).toBe(true);
  });
});

describe("ambiguïtés non tranchées", () => {
  it("une colonne de dates entièrement sous 13 ne produit aucune date", () => {
    const analysis = analyze(utf8(AMBIGUOUS_DATES));
    expect(analysis.conventions.date).toBe("AMBIGUOUS");
    expect(analysis.issues.map((entry) => entry.code)).toContain("DATE_CONVENTION_AMBIGUOUS");
    expect(analysis.counts.ready).toBe(0);
    expect(analysis.counts.blocked).toBe(2);
  });

  it("une colonne de montants indécidable ne produit aucun montant", () => {
    const analysis = analyze(utf8(AMBIGUOUS_AMOUNTS));
    expect(analysis.conventions.amount).toBe("AMBIGUOUS");
    expect(analysis.issues.map((entry) => entry.code)).toContain("AMOUNT_CONVENTION_AMBIGUOUS");
    expect(analysis.counts.ready).toBe(0);
  });
});

describe("mapping impossible ou imposé", () => {
  it("aucune ligne n'est normalisée tant que le mapping est incomplet", () => {
    const analysis = analyze(utf8(UNKNOWN_HEADERS));
    expect(analysis.mappingConfidence).toBe("INCOMPLETE");
    expect(analysis.rows).toHaveLength(0);
    expect(analysis.counts.total).toBe(0);
  });

  it("un fichier sans colonne de montant est refusé, pas rempli de zéros", () => {
    const analysis = analyze(utf8(NO_AMOUNT_COLUMN));
    expect(analysis.rows).toHaveLength(0);
    expect(analysis.issues.map((entry) => entry.code)).toContain("MAPPING_REQUIRED_FIELD_MISSING");
  });

  it("un mapping imposé permet de lire un fichier aux en-têtes inconnus", () => {
    const analysis = analyze(utf8(UNKNOWN_HEADERS), {
      mappingOverride: { transactionDate: 0, label: 1, amount: 2 },
    });
    expect(analysis.mappingConfidence).toBe("CERTAIN");
    expect(analysis.rows[0].amount).toBe(-10);
  });

  it("une même colonne source ne peut pas alimenter deux champs", () => {
    const analysis = analyze(utf8(FR_SIGNED), {
      mappingOverride: { transactionDate: 0, label: 1, reference: 1, amount: 2 },
    });
    expect(analysis.mappingConfidence).toBe("INCOMPLETE");
    expect(analysis.rows).toHaveLength(0);
    expect(analysis.issues.map((entry) => entry.code)).toContain("MAPPING_DUPLICATE_COLUMN");
  });

  it("un mapping imposé faux échoue au lieu de déplacer les colonnes", () => {
    const analysis = analyze(utf8(FR_SIGNED), {
      mappingOverride: { transactionDate: 2, label: 1, amount: 0 },
    });
    expect(analysis.counts.ready).toBe(0);
    expect(analysis.counts.blocked).toBe(3);
  });
});

describe("idempotence", () => {
  it("le même fichier relu n'écrit RIEN par défaut, sans prétendre à une identité", () => {
    // Le réimport du fichier identique est refusé en amont par l'empreinte du fichier
    // (invariant de base). Même si on force la relecture, aucune ligne n'est prête : les
    // trois sont reconnues comme probablement déjà présentes et attendent une décision.
    const first = analyze(utf8(FR_SIGNED));
    expect(first.counts.ready + first.counts.warning).toBe(3);

    const existing = first.rows
      .filter((row) => row.status === "READY" || row.status === "WARNING")
      .map((row, index) => ({
        id: `t${index}`,
        accountId: ACCOUNT,
        date: row.transactionDate!,
        label: row.label!,
        amount: row.amount!,
        currency: row.currency!,
      }));

    const second = analyze(utf8(FR_SIGNED), { existing });
    expect(second.counts.ready).toBe(0);
    expect(second.verdicts.probableDuplicate).toBe(3);
    // Aucune ligne n'est déclarée doublon d'identité : rien ne le prouve.
    expect(second.verdicts.exactDuplicate).toBe(0);
  });

  it("un recouvrement partiel n'écrit que le delta", () => {
    const january = utf8(
      [
        "Date operation;Libelle;Montant;Devise",
        "15/01/2026;OPERATION A;-10,00;EUR",
        "16/01/2026;OPERATION B;-20,00;EUR",
      ].join("\n"),
    );
    const overlapping = utf8(
      [
        "Date operation;Libelle;Montant;Devise",
        "16/01/2026;OPERATION B;-20,00;EUR",
        "17/01/2026;OPERATION C;-30,00;EUR",
      ].join("\n"),
    );
    const first = analyze(january);
    expect(first.counts.ready).toBe(2);
    const second = analyze(overlapping, { existing: commit(first) });
    // La ligne commune est RAPPROCHÉE et attend une confirmation ; seule la nouvelle est
    // prête. Aucune occurrence supplémentaire n'est éliminée d'office.
    expect(second.verdicts.probableDuplicate).toBe(1);
    expect(second.counts.ready).toBe(1);
    expect(second.rows.filter((row) => row.status === "READY")[0].label).toBe("OPERATION C");
  });

  it("un identifiant DÉCLARÉ stable rend le réimport idempotent sans ambiguïté", () => {
    const first = analyze(utf8(EN_SIGNED), { stableIdentifiers: true });
    // Les identités écrites sont réinjectées telles que le repository les relit : par clé,
    // sans aucun filtre de date.
    const identities = first.rows
      .filter((row) => row.externalKey !== null)
      .map((row, index) => ({ externalKey: row.externalKey!, transactionId: `t${index}` }));
    const second = analyze(utf8(EN_SIGNED), {
      stableIdentifiers: true,
      existing: commit(first),
      identities,
    });
    expect(second.counts.duplicate).toBe(3);
    expect(second.verdicts.exactDuplicate).toBe(3);
    expect(second.counts.ready).toBe(0);
  });
});

describe("date d'observation de l'import ≠ date d'arrêté du reporting", () => {
  // Le cockpit arrête ses comptes au 19/08 ; l'import est réalisé le 27/08. Une opération
  // bookée le 26/08 est un fait réel : l'acquisition l'ingère, et c'est au moteur financier
  // de décider s'il la retient dans une lecture au 19/08.
  const statement = utf8(
    [
      "Date operation;Libelle;Montant;Devise",
      "26/08/2026;OPERATION VEILLE;-10,00;EUR",
      "27/08/2026;OPERATION DU JOUR;-20,00;EUR",
      "28/08/2026;OPERATION DEMAIN;-30,00;EUR",
    ].join("\n"),
  );

  it("n'exige aucune intervention humaine sur un fait postérieur à la date d'arrêté", () => {
    const analysis = analyze(statement, { observationDate: "2026-08-27" });
    const byRow = new Map(analysis.rows.map((row) => [row.rowNumber, row]));
    expect(byRow.get(2)!.status).toBe("READY");
    expect(byRow.get(3)!.status).toBe("READY");
    expect(byRow.get(4)!.status).toBe("WARNING");
    expect(byRow.get(4)!.issues.map((entry) => entry.code)).toContain("DATE_IN_FUTURE");
  });

  it("ne signale une date future que par rapport au jour de l'import", () => {
    const earlier = analyze(statement, { observationDate: "2026-08-19" });
    // Au 19/08, les trois lignes sont bien postérieures : le signalement est cohérent avec
    // la date d'observation réelle, quelle qu'elle soit.
    expect(earlier.rows.filter((row) => row.status === "WARNING")).toHaveLength(3);
    expect(earlier.counts.ready).toBe(0);
  });
});

describe("fidélité des champs facultatifs", () => {
  // ABSENT ≠ PRÉSENT MAIS ILLISIBLE. Aucun calcul ne consomme ces champs en V1, mais une
  // valeur renseignée que le parseur n'a pas comprise est une information perdue.
  const withOptionals = (valueDate: string, balance: string) =>
    utf8(
      [
        "Date operation;Date de valeur;Libelle;Montant;Solde",
        `13/08/2026;${valueDate};OPERATION;-10,00;${balance}`,
        "20/08/2026;21/08/2026;AUTRE OPERATION;-20,00;1 480,00",
      ].join("\n"),
    );

  it("une cellule facultative VIDE reste null sans anomalie", () => {
    const analysis = analyze(withOptionals("", ""));
    const row = analysis.rows[0];
    expect(row.valueDate).toBeNull();
    expect(row.balanceAfter).toBeNull();
    expect(row.status).toBe("READY");
    // Aucune anomalie ne porte sur les champs facultatifs vides. La seule information
    // émise concerne la devise, absente du fichier et reprise de la déclaration de session.
    expect(row.issues.filter((entry) => entry.field === "valueDate")).toHaveLength(0);
    expect(row.issues.filter((entry) => entry.field === "balanceAfter")).toHaveLength(0);
    expect(row.issues.every((entry) => entry.severity === "INFO")).toBe(true);
  });

  it("une date de valeur renseignée mais illisible est SIGNALÉE", () => {
    const analysis = analyze(withOptionals("pas-une-date", "1 500,00"));
    const row = analysis.rows[0];
    expect(row.valueDate).toBeNull();
    expect(row.status).toBe("WARNING");
    expect(row.issues.map((entry) => entry.code)).toContain("VALUE_DATE_UNPARSEABLE");
  });

  it("un solde renseigné mais illisible est SIGNALÉ", () => {
    const analysis = analyze(withOptionals("14/08/2026", "illisible"));
    const row = analysis.rows[0];
    expect(row.balanceAfter).toBeNull();
    expect(row.status).toBe("WARNING");
    expect(row.issues.map((entry) => entry.code)).toContain("BALANCE_AFTER_UNPARSEABLE");
  });

  it("un champ facultatif illisible ne bloque jamais la ligne", () => {
    const analysis = analyze(withOptionals("pas-une-date", "illisible"));
    expect(analysis.counts.blocked).toBe(0);
    expect(analysis.rows[0].amount).toBe(-10);
  });
});

describe("passe de déduplication rejouable", () => {
  it("remplace le verdict précédent au lieu de l'empiler", () => {
    const first = analyze(utf8(FR_SIGNED));
    const existing = commit(first);
    const context = {
      accountId: ACCOUNT,
      sourceKey: SOURCE,
      existing,
      identities: [],
      stableIdentifiers: false,
    };
    const second = applyDedupe(first, context);
    const third = applyDedupe(second, context);
    expect(third.counts).toEqual(second.counts);
    expect(third.rows.map((row) => row.verdict)).toEqual(second.rows.map((row) => row.verdict));
    // Une même anomalie de déduplication n'apparaît jamais deux fois sur la même ligne.
    for (const row of third.rows) {
      const codes = row.issues.map((entry) => entry.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("ne dépend pas d'un premier appel à vide pour attribuer les empreintes", () => {
    const analysis = analyze(utf8(FR_SIGNED));
    expect(analysis.rows.every((row) => row.verdict !== null)).toBe(true);
    expect(analysis.rows.every((row) => row.matchKey !== null)).toBe(true);
  });
});

describe("volume", () => {
  it("traite un historique bancaire complet sans tronquer", () => {
    const analysis = analyze(utf8(largeStatement(5_000)));
    expect(analysis.counts.total).toBe(5_000);
    expect(analysis.counts.blocked).toBe(0);
    expect(analysis.counts.ready + analysis.counts.warning).toBe(5_000);
    expect(new Set(analysis.rows.map((row) => row.matchKey)).size).toBe(5_000);
  });

  it("refuse explicitement un fichier au-delà du plafond", () => {
    const analysis = analyze(utf8(largeStatement(50)), { maxRows: 20 });
    expect(analysis.rows).toHaveLength(0);
    expect(analysis.issues.map((entry) => entry.code)).toContain("FILE_TOO_MANY_ROWS");
  });
});
