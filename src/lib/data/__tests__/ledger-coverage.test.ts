import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { completeMonthsPeriod, compareSurplusToScenario } from "@/lib/engine/cash-flow";
import { readLedgerCoverage } from "@/lib/data/shared";
import { mutationSchema } from "@/lib/validation/mutations";
import type { FamilyOfficeRepository } from "@/lib/data/repository";
import type { ExpenseCategory, Provenance, Transaction } from "@/lib/types";

/**
 * Le repository local est testé pour de vrai, pas simulé : il écrit dans un SQLite dont la
 * persistance est précisément ce que ces cas doivent prouver. Il est isolé dans un
 * répertoire temporaire, avec le schéma copié à l'emplacement qu'il attend.
 */
const projectRoot = process.cwd();
const sandbox = mkdtempSync(path.join(tmpdir(), "lfo-coverage-"));
const originalCwd = process.cwd();

beforeAll(() => {
  mkdirSync(path.join(sandbox, "src", "lib", "data"), { recursive: true });
  cpSync(
    path.join(projectRoot, "src", "lib", "data", "schema.sql"),
    path.join(sandbox, "src", "lib", "data", "schema.sql"),
  );
  process.chdir(sandbox);
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

/**
 * Le module met sa connexion en cache. Réinitialiser les modules puis réimporter rejoue
 * exactement ce que fait un redémarrage du serveur sur la même base : c'est la seule façon
 * de distinguer une valeur réellement persistée d'une valeur restée en mémoire.
 */
async function restart(): Promise<FamilyOfficeRepository> {
  vi.resetModules();
  const freshModule = await import("@/lib/data/local-repository");
  return freshModule.createLocalRepository();
}

describe("CASE AK — profondeur non déclarée", () => {
  it("persiste null et laisse T3M non calculable", async () => {
    const repository = await restart();
    const state = await repository.getDashboardState();
    expect(state.ledgerCoverageStart).toBeNull();
    expect(state.ledgerCoverageSource).toBe("MANUAL");

    const comparison = compareSurplusToScenario(
      state.transactions,
      state.expenseCategories,
      state.asOfDate,
      250,
      state.ledgerCoverageStart,
    );
    expect(comparison.observedT3M).toBeNull();
    expect(comparison.observedT12M).toBeNull();
  });
});

describe("CASE AL — déclaration au 2026-05-01", () => {
  it("survit à un redémarrage", async () => {
    const repository = await restart();
    const written = await repository.mutateState({
      action: "set_ledger_coverage",
      startDate: "2026-05-01",
      source: "MANUAL",
    });
    expect(written.ledgerCoverageStart).toBe("2026-05-01");

    // Relecture dans la même instance, puis après redémarrage complet.
    expect((await repository.getDashboardState()).ledgerCoverageStart).toBe("2026-05-01");
    const restarted = await restart();
    const state = await restarted.getDashboardState();
    expect(state.ledgerCoverageStart).toBe("2026-05-01");
    expect(state.ledgerCoverageSource).toBe("MANUAL");
  });
});

describe("CASE AM — remise à null", () => {
  it("efface la déclaration et rend les moyennes non calculables", async () => {
    const repository = await restart();
    await repository.mutateState({
      action: "set_ledger_coverage",
      startDate: "2026-05-01",
      source: "MANUAL",
    });
    const cleared = await repository.mutateState({
      action: "set_ledger_coverage",
      startDate: null,
      source: "MANUAL",
    });
    expect(cleared.ledgerCoverageStart).toBeNull();

    const restarted = await restart();
    const state = await restarted.getDashboardState();
    expect(state.ledgerCoverageStart).toBeNull();
    const comparison = compareSurplusToScenario(
      state.transactions,
      state.expenseCategories,
      state.asOfDate,
      250,
      state.ledgerCoverageStart,
    );
    expect(comparison.observedT3M).toBeNull();
    expect(comparison.observedT12M).toBeNull();
  });
});

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

describe("CASE AQ — même contrat des deux côtés", () => {
  /**
   * Les deux adaptateurs passent par `readLedgerCoverage`. Les lignes ci-dessous
   * reproduisent ce que chaque pilote rend réellement : SQLite ne connaît pas `undefined`
   * mais peut ne pas avoir la colonne, Postgres rend `null` pour une valeur non déclarée.
   */
  const sqliteRow = { ledger_coverage_start: "2026-05-01", ledger_coverage_source: "MANUAL" };
  const postgresRow = { ledger_coverage_start: "2026-05-01", ledger_coverage_source: "MANUAL" };

  it("expose la même valeur pour une déclaration identique", () => {
    expect(readLedgerCoverage(sqliteRow)).toEqual(readLedgerCoverage(postgresRow));
    expect(readLedgerCoverage(sqliteRow)).toEqual({ start: "2026-05-01", source: "MANUAL" });
  });

  it("traite null, undefined et ligne absente comme « non déclarée »", () => {
    const expected = { start: null, source: "MANUAL" as const };
    expect(readLedgerCoverage({ ledger_coverage_start: null })).toEqual(expected);
    expect(readLedgerCoverage({})).toEqual(expected);
    expect(readLedgerCoverage(undefined)).toEqual(expected);
    expect(readLedgerCoverage(null)).toEqual(expected);
  });

  it("retombe sur MANUAL plutôt que d’inventer une provenance", () => {
    expect(
      readLedgerCoverage({ ledger_coverage_start: "2026-05-01", ledger_coverage_source: "WAT" })
        .source,
    ).toBe("MANUAL");
    expect(
      readLedgerCoverage({ ledger_coverage_start: "2026-05-01", ledger_coverage_source: "API" })
        .source,
    ).toBe("API");
  });
});
