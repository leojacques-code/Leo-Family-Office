import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/data/supabase-client", () => ({
  ownerId: () => "owner",
  supabaseAdmin: () => mocks,
  DOCUMENTS_BUCKET: "test",
}));
import { createSupabaseRepository } from "../supabase-repository";

type Row = Record<string, unknown>;
const queries: { table: string; filters: unknown[][]; ranges: number[][]; orders: string[] }[] = [];
function install(rows: Record<string, Row[]> = {}, failed?: string) {
  mocks.from.mockImplementation((table: string) => {
    const trace = {
      table,
      filters: [] as unknown[][],
      ranges: [] as number[][],
      orders: [] as string[],
    };
    queries.push(trace);
    const equals: [string, unknown][] = [];
    const ceilings: [string, string][] = [];
    const included: [string, unknown[]][] = [];
    let start = 0,
      end = Infinity;
    const q = {
      select: () => q,
      eq: (...args: unknown[]) => {
        trace.filters.push(args);
        equals.push(args as [string, unknown]);
        return q;
      },
      lte: (field: string, value: string) => {
        ceilings.push([field, value]);
        return q;
      },
      in: (field: string, values: unknown[]) => {
        included.push([field, values]);
        return q;
      },
      order: (field: string) => {
        trace.orders.push(field);
        return q;
      },
      limit: (size: number) => {
        end = size - 1;
        return q;
      },
      range: (from: number, to: number) => {
        start = from;
        end = to;
        trace.ranges.push([from, to]);
        return q;
      },
      then: (resolve: (value: unknown) => void) =>
        resolve({
          data:
            failed === table
              ? null
              : (rows[table] ?? [])
                  .filter((row) =>
                    equals.every(([field, value]) => field === "user_id" || row[field] === value),
                  )
                  .filter((row) => ceilings.every(([field, value]) => String(row[field]) <= value))
                  .filter((row) => included.every(([field, values]) => values.includes(row[field])))
                  .slice(start, end + 1),
          error: failed === table ? { message: "JWT issued at future SECRET" } : null,
        }),
    };
    return q;
  });
}
const account = {
  id: "a",
  institution_id: "i",
  name: "Compte",
  account_type: "BANK",
  status: "ACTIVE",
  liquidity: "IMMEDIATE",
  currency: "EUR",
};
const observation = {
  id: "b",
  account_id: "a",
  balance: "1794.41",
  balance_date: "2026-08-31",
  created_at: "2026-09-01T00:00:00Z",
  data_kind: "ACTUAL",
  confidence: "HIGH",
};

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
});
describe("B09 — lecture des seules dépendances des dettes", () => {
  it("ne lit aucun domaine étranger, ne sérialise aucun état global, ne fabrique pas de cash", async () => {
    install();
    const model = await createSupabaseRepository().getDebtReadModel();
    expect(model.metrics.bankCash).toBe(0); // Somme canonique du périmètre identifié vide.
    expect(model.cashObservationPresent).toBe(false); // Ne prouve pas un cash déclaré nul.
    expect(model).not.toHaveProperty("accounts");
    expect(model).not.toHaveProperty("goals");
    expect(model).not.toHaveProperty("balanceSheet");
    expect(queries.map((q) => q.table)).toEqual(
      expect.arrayContaining(["liabilities", "loan_schedules", "financial_accounts"]),
    );
    expect(queries).toHaveLength(14);
    for (const q of queries) expect(q.filters).toContainEqual(["user_id", "owner"]);
    expect(queries.find((q) => q.table === "profiles")!.orders).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("lit au-delà de mille observations et conserve la correction à même date", async () => {
    install({
      financial_accounts: [account],
      account_balances: [
        ...Array.from({ length: 1000 }, (_, index) => ({ ...observation, id: `b${index}` })),
        { ...observation, id: "last", balance: "0", created_at: "2026-09-02T00:00:00Z" },
      ],
    });
    const model = await createSupabaseRepository().getDebtReadModel();
    expect(model.metrics.bankCash).toBe(0);
    expect(queries.filter((q) => q.table === "account_balances").flatMap((q) => q.ranges)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
  it("applique les mêmes conversions de cash et refuse un FX absent", async () => {
    const rows = {
      financial_accounts: [{ ...account, currency: "USD" }],
      account_balances: [observation],
    };
    install(rows);
    expect((await createSupabaseRepository().getDebtReadModel()).metrics.bankCash).toBeNull();
    install({
      ...rows,
      currency_rates: [
        {
          id: "fx",
          base_currency: "USD",
          quote_currency: "EUR",
          rate: 0.9,
          rate_date: "2026-08-31",
          data_kind: "EXTERNAL_DATA",
        },
      ],
    });
    expect((await createSupabaseRepository().getDebtReadModel()).metrics.bankCash).toBeCloseTo(
      1614.969,
      6,
    );
  });
  it("échoue explicitement si une dépendance manque, sans rendre de résultat partiel", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    install({}, "loan_schedules");
    await expect(createSupabaseRepository().getDebtReadModel()).rejects.toThrow(
      "momentanément indisponibles",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
    log.mockRestore();
  });
  it("conserve la preuve de transactions sans charger les montants du ledger", async () => {
    install({ transactions: [{ transaction_date: "2026-08-30" }] });
    const model = await createSupabaseRepository().getDebtReadModel();
    expect(model.railSources.find((source) => source.category === "BANQUE")).toMatchObject({
      status: "ACTIVE",
      latestDate: "2026-08-30",
    });
    expect(model).not.toHaveProperty("transactions");
  });
  it("ignore les clôtures futures avant de choisir la dernière date pertinente", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
    try {
      install({ monthly_closes: [{ close_date: "2026-12-31" }, { close_date: "2026-08-31" }] });
      expect((await createSupabaseRepository().getDebtReadModel()).asOfDate).toBe("2026-08-31");
    } finally {
      vi.useRealTimers();
    }
  });
  it("un PEA sans observation ne bloque pas le cash et ses soldes ne sont pas lus", async () => {
    install({
      financial_accounts: [
        account,
        { ...account, id: "pea", liquidity: "LIQUID", account_type: "PEA" },
      ],
      account_balances: [observation, { id: "bad", account_id: "pea", balance: "invalid" }],
    });
    expect((await createSupabaseRepository().getDebtReadModel()).metrics.bankCash).toBe(1794.41);
  });
  it("un OTHER immédiat ne prouve pas du cash bancaire, un découvert bancaire est une observation", async () => {
    install({
      financial_accounts: [{ ...account, account_type: "OTHER" }],
      account_balances: [observation],
    });
    expect((await createSupabaseRepository().getDebtReadModel()).cashObservationPresent).toBe(
      false,
    );
    install({
      financial_accounts: [account],
      account_balances: [{ ...observation, balance: -50 }],
    });
    const model = await createSupabaseRepository().getDebtReadModel();
    expect(model.cashObservationPresent).toBe(true);
    expect(model.metrics.bankCash).toBe(0);
  });
  it("acquitte la mutation sans déclencher getDashboardState", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await createSupabaseRepository().executeMutation({
      action: "archive_debt",
      liabilityId: "loan",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
