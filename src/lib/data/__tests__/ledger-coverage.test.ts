import { describe, expect, it } from "vitest";
import { completeMonthsPeriod, compareSurplusToScenario } from "@/lib/engine/cash-flow";
import { readLedgerCoverage } from "@/lib/data/shared";
import { operationalToday } from "@/lib/financial-date";
import { mutationSchema } from "@/lib/validation/mutations";
import type { ExpenseCategory, Provenance, Transaction } from "@/lib/types";

describe("CASE AN — validation", () => {
  const parse = (startDate: string | null) =>
    mutationSchema.safeParse({ action: "set_ledger_coverage", startDate, source: "MANUAL" });

  /**
   * Les bornes se DÉRIVENT du jour courant, elles ne sont pas écrites en dur.
   *
   * Ce test affirmait auparavant le refus du 2026-08-20, parce que la borne était la
   * constante `AS_OF_DATE = "2026-08-19"`. Il prouvait donc le bug au lieu de l'invariant :
   * le lendemain de l'arrêté, le produit refusait toute déclaration de couverture. Un test
   * dont les bornes sont littérales périme, et il périme en verrouillant la faute.
   */
  const shift = (days: number) => {
    const base = new Date(`${operationalToday()}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() + days);
    return base.toISOString().slice(0, 10);
  };

  it("refuse une date postérieure au jour courant", () => {
    // Certifier exhaustif un historique qui n'a pas encore eu lieu n'a aucun sens.
    expect(parse(shift(1)).success).toBe(false);
    expect(parse(shift(120)).success).toBe(false);
  });

  it("refuse une date qui n’existe pas au calendrier", () => {
    expect(parse("2026-02-31").success).toBe(false);
  });

  it("refuse une forme non ISO", () => {
    expect(parse("01/05/2026").success).toBe(false);
  });

  it("accepte une date passée, le jour courant, et accepte null", () => {
    expect(parse(shift(-120)).success).toBe(true);
    expect(parse(null).success).toBe(true);
    // La borne est inclusive : le jour courant est un jour révolu au moment où on le lit.
    expect(parse(shift(0)).success).toBe(true);
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
  propertyId: null,
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
