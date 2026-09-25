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
    const model = await createSupabaseRepository("owner").getDebtReadModel();
    expect(model.metrics.bankCash).toBe(0); // Somme canonique du périmètre identifié vide.
    expect(model.cashObservationPresent).toBe(false); // Ne prouve pas un cash déclaré nul.
    expect(model).not.toHaveProperty("accounts");
    expect(model).not.toHaveProperty("goals");
    expect(model).not.toHaveProperty("balanceSheet");
    expect(queries.map((q) => q.table)).toEqual(
      expect.arrayContaining(["liabilities", "loan_schedules", "financial_accounts"]),
    );
    // 14 lectures historiques + les trois tables de l'assurance séparée (B17), toutes
    // propres au domaine Dettes et cloisonnées par propriétaire.
    expect(queries).toHaveLength(17);
    expect(queries.map((q) => q.table)).toEqual(
      expect.arrayContaining([
        "loan_insurance_policies",
        "loan_insurance_insured",
        "loan_insurance_periods",
      ]),
    );
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
    const model = await createSupabaseRepository("owner").getDebtReadModel();
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
    expect(
      (await createSupabaseRepository("owner").getDebtReadModel()).metrics.bankCash,
    ).toBeNull();
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
    expect(
      (await createSupabaseRepository("owner").getDebtReadModel()).metrics.bankCash,
    ).toBeCloseTo(1614.969, 6);
  });
  it("échoue explicitement si une dépendance manque, sans rendre de résultat partiel", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    install({}, "loan_schedules");
    await expect(createSupabaseRepository("owner").getDebtReadModel()).rejects.toThrow(
      "momentanément indisponibles",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
    log.mockRestore();
  });
  it("conserve la preuve de transactions sans charger les montants du ledger", async () => {
    install({ transactions: [{ transaction_date: "2026-08-30" }] });
    const model = await createSupabaseRepository("owner").getDebtReadModel();
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
      expect((await createSupabaseRepository("owner").getDebtReadModel()).asOfDate).toBe(
        "2026-08-31",
      );
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
    expect((await createSupabaseRepository("owner").getDebtReadModel()).metrics.bankCash).toBe(
      1794.41,
    );
  });
  it("un OTHER immédiat ne prouve pas du cash bancaire, un découvert bancaire est une observation", async () => {
    install({
      financial_accounts: [{ ...account, account_type: "OTHER" }],
      account_balances: [observation],
    });
    expect(
      (await createSupabaseRepository("owner").getDebtReadModel()).cashObservationPresent,
    ).toBe(false);
    install({
      financial_accounts: [account],
      account_balances: [{ ...observation, balance: -50 }],
    });
    const model = await createSupabaseRepository("owner").getDebtReadModel();
    expect(model.cashObservationPresent).toBe(true);
    expect(model.metrics.bankCash).toBe(0);
  });
  it("acquitte la mutation sans déclencher getDashboardState", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    await createSupabaseRepository("owner").executeMutation({
      action: "archive_debt",
      liabilityId: "loan",
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("sépare une dette connue par son seul encours sans lire de terme, et garde les contrats", async () => {
    const provenance = { data_kind: "ACTUAL", confidence: "HIGH", source: "Saisie" };
    install({
      liabilities: [
        {
          id: "outstanding",
          name: "Prêt familial",
          lender: null,
          current_balance: "1000",
          currency: "USD",
          terms_status: "OUTSTANDING_ONLY",
          principal: null,
          annual_rate: null,
          monthly_payment: null,
          payment_count: null,
          first_payment_date: null,
          maturity_date: null,
          rate_type: null,
          deferral_kind: null,
          deferral_months: null,
          deferral_interest_treatment: null,
          amortisation_profile: null,
          payment_frequency: null,
          interest_convention: null,
          monthly_insurance: null,
          recurring_fees: null,
          payment_includes_insurance: null,
          balloon_amount: null,
          facility_id: null,
          notes: null,
          archived: false,
          ...provenance,
        },
        {
          // Base antérieure à la migration : aucune colonne terms_status, donc un contrat.
          id: "contract",
          name: "Crédit auto",
          lender: "Banque",
          principal: "1200",
          current_balance: "1200",
          currency: "EUR",
          annual_rate: "0",
          monthly_payment: "100",
          payment_count: "12",
          first_payment_date: "2026-10-05",
          maturity_date: "2027-09-05",
          rate_type: "FIXED",
          deferral_kind: "NONE",
          deferral_months: 0,
          deferral_interest_treatment: "UNKNOWN",
          amortisation_profile: "AMORTIZING",
          payment_frequency: "MONTHLY",
          interest_convention: "PROPORTIONAL",
          monthly_insurance: null,
          recurring_fees: null,
          payment_includes_insurance: null,
          balloon_amount: null,
          facility_id: null,
          notes: null,
          archived: false,
          ...provenance,
        },
      ],
      liability_balance_observations: [
        {
          id: "o1",
          liability_id: "outstanding",
          observed_at: "2026-09-20",
          balance: "950",
          created_at: "2026-09-20T10:00:00Z",
          ...provenance,
        },
      ],
    });
    const model = await createSupabaseRepository("owner").getDebtReadModel();
    expect(model.liabilities.map((item) => item.id)).toEqual(["contract"]);
    expect(model.outstandingDebts).toEqual([
      expect.objectContaining({
        id: "outstanding",
        lender: null,
        currentBalance: 950,
        currency: "USD",
        balanceDate: "2026-09-20",
      }),
    ]);
    // Aucun champ de terme n'existe sur une dette encours seul : rien ne peut valoir zéro.
    expect(model.outstandingDebts[0]).not.toHaveProperty("annualRate");
    expect(model.outstandingDebts[0]).not.toHaveProperty("monthlyPayment");
    // L'encours déclaré est présent ; le contrat l'est aussi (ligne legacy), mais par SA preuve.
    const rail = Object.fromEntries(model.railSources.map((source) => [source.id, source.status]));
    expect(rail.outstanding).toBe("ACTIVE");
    expect(rail.contract).toBe("ACTIVE");
  });
  it("ne présente pas un encours déclaré comme un contrat détenu", async () => {
    install({
      liabilities: [
        {
          id: "outstanding",
          name: "Prêt familial",
          lender: null,
          current_balance: "1000",
          currency: "EUR",
          terms_status: "OUTSTANDING_ONLY",
          notes: null,
          archived: false,
          data_kind: "ACTUAL",
          confidence: "HIGH",
          source: "Saisie",
        },
      ],
    });
    const model = await createSupabaseRepository("owner").getDebtReadModel();
    const rail = Object.fromEntries(model.railSources.map((source) => [source.id, source.status]));
    expect(rail.contract).toBe("ABSENTE");
    expect(rail.outstanding).toBe("ACTIVE");
    // Sans observation datée, aucune date n'est fabriquée.
    expect(model.outstandingDebts[0]).not.toHaveProperty("balanceDate");
  });
});
