import { describe, expect, it } from "vitest";
import { completeMonthsPeriod, compareSurplusToScenario } from "@/lib/engine/cash-flow";
import { readLedgerCoverage } from "@/lib/data/shared";
import { mutationSchema } from "@/lib/validation/mutations";
import type { ExpenseCategory, Provenance, Transaction } from "@/lib/types";

describe("CASE AN — validation", () => {
  const parse = (startDate: string | null) =>
    mutationSchema.safeParse({ action: "set_ledger_coverage", startDate, source: "MANUAL" });

  it("refuse une date postérieure à la date d’observation", () => {
    // AS_OF_DATE vaut 2026-08-19 : certifier exhaustif un historique à venir n'a aucun sens.
    expect(parse("2026-12-01").success).toBe(false);
    expect(parse("2026-08-20").success).toBe(false);
  });

  it("refuse une date qui n’existe pas au calendrier", () => {
    expect(parse("2026-02-31").success).toBe(false);
  });

  it("refuse une forme non ISO", () => {
    expect(parse("01/05/2026").success).toBe(false);
  });

  it("accepte une date passée et accepte null", () => {
    expect(parse("2026-05-01").success).toBe(true);
    expect(parse(null).success).toBe(true);
    expect(parse("2026-08-19").success).toBe(true);
  });

  it("refuse une provenance inventée", () => {
    expect(
      mutationSchema.safeParse({
        action: "set_ledger_coverage",
        startDate: "2026-05-01",
        source: "CERTIFIED",
      }).success,
    ).toBe(false);
  });
});

const provenance: Provenance = { kind: "ACTUAL", confidence: "HIGH" };
const categories: ExpenseCategory[] = [
  {
    id: "c_salary",
    name: "Salaire",
    // Le groupe porte un libellé arbitraire : le moteur ne doit jamais le lire.
    groupName: "Libellé sans rôle de calcul",
    cashFlowKind: "INCOME",
    essentiality: "UNKNOWN",
    behavior: "UNKNOWN",
    monthlyAmount: null,
    essential: false,
    archived: false,
    provenance,
  },
];
const tx = (amount: number, date: string): Transaction => ({
  id: `t_${date}_${amount}`,
  accountId: "acc",
  accountName: "Ultim",
  date,
  label: "Salaire",
  categoryId: "c_salary",
  categoryName: "Salaire",
  amount,
  currency: "EUR",
  kindOverride: null,
  transferGroupId: null,
  notes: null,
  provenance,
});

describe("CASE AO — couverture 2026-05-01 observée au 2026-08-24", () => {
  it("certifie mai, juin et juillet et rend T3M calculable", () => {
    const transactions = [
      tx(1000, "2026-05-10"),
      tx(1200, "2026-06-10"),
      tx(800, "2026-07-10"),
      tx(5000, "2026-08-10"),
    ];
    const comparison = compareSurplusToScenario(
      transactions,
      categories,
      "2026-08-24",
      250,
      "2026-05-01",
    );
    expect(comparison.coverageT3M.completeCoveredMonths).toBe(3);
    expect(completeMonthsPeriod("2026-08-24", 3)).toEqual({
      start: "2026-05-01",
      end: "2026-07-31",
    });
    // Août reste hors moyenne et n'apparaît qu'en month-to-date.
    expect(comparison.observedT3M).toBeCloseTo(1000, 6);
    expect(comparison.monthToDate).toBeCloseTo(5000, 6);
    expect(comparison.observedT12M).toBeNull();
  });
});

describe("CASE AP — couverture 2026-06-05", () => {
  it("laisse juin partiel et refuse de calculer T3M", () => {
    const transactions = [tx(1200, "2026-06-10"), tx(800, "2026-07-10")];
    const comparison = compareSurplusToScenario(
      transactions,
      categories,
      "2026-08-24",
      250,
      "2026-06-05",
    );
    expect(comparison.coverageT3M.completeCoveredMonths).toBe(1);
    expect(comparison.coverageT3M.status).toBe("PARTIAL");
    expect(comparison.observedT3M).toBeNull();
  });
});

describe("CASE AQ — contrat Supabase strict", () => {
  const postgresRow = { ledger_coverage_start: "2026-05-01", ledger_coverage_source: "MANUAL" };

  it("expose une déclaration valide", () => {
    expect(readLedgerCoverage(postgresRow)).toEqual({ start: "2026-05-01", source: "MANUAL" });
  });

  it("conserve null comme valeur métier non déclarée", () => {
    const expected = { start: null, source: "MANUAL" as const };
    expect(
      readLedgerCoverage({ ledger_coverage_start: null, ledger_coverage_source: "MANUAL" }),
    ).toEqual(expected);
  });

  it("refuse une migration absente ou une provenance invalide", () => {
    expect(() => readLedgerCoverage({})).toThrow(/Schéma Supabase incomplet/);
    expect(() => readLedgerCoverage(undefined)).toThrow(/profil propriétaire absent/);
    expect(() =>
      readLedgerCoverage({ ledger_coverage_start: "2026-05-01", ledger_coverage_source: "WAT" }),
    ).toThrow(/profiles\.ledger_coverage_source/);
    expect(
      readLedgerCoverage({ ledger_coverage_start: "2026-05-01", ledger_coverage_source: "API" })
        .source,
    ).toBe("API");
  });
});
