import { describe, expect, it, vi } from "vitest";

/**
 * RÉGRESSION — « column currency_rates.created_at does not exist »
 *
 * `getDashboardState` échouait en production sur cette erreur PostgREST déterministe, et
 * le cockpit ne se chargeait plus du tout. La lecture paginée imposait un tri secondaire
 * sur `created_at`, colonne absente de `currency_rates`.
 *
 * Le test reproduit la cause à la source : le faux client REFUSE une colonne de tri qui
 * n'existe pas dans le schéma canonique, exactement comme PostgREST, et rend la même
 * erreur. Il n'est donc pas satisfait par un `catch` ni par une valeur par défaut — c'est
 * la requête émise qui doit être correcte.
 *
 * Les colonnes ci-dessous sont recopiées du schéma réel. Toute table paginée dont le tri
 * sortirait de sa propre liste fait échouer le test.
 */
const SCHEMA: Record<string, string[]> = {
  // `currency_rates` n'a PAS de `created_at` : c'est le cas qui a cassé la production.
  currency_rates: [
    "id",
    "user_id",
    "base_currency",
    "quote_currency",
    "rate",
    "rate_date",
    "source",
    "data_kind",
  ],
  account_balances: ["id", "user_id", "account_id", "balance", "balance_date", "created_at"],
  position_snapshots: ["id", "user_id", "position_id", "snapshot_date", "created_at"],
  portfolio_events: ["id", "user_id", "account_id", "event_date", "created_at"],
  real_estate_valuations: ["id", "user_id", "property_id", "valued_at", "created_at"],
  real_estate_capital_events: ["id", "user_id", "property_id", "event_date", "created_at"],
  real_estate_operating_terms: ["id", "user_id", "property_id", "effective_from", "created_at"],
  transactions: ["id", "user_id", "transaction_date", "created_at"],
};

/** Tris émis, table par table, dans l'ordre où le repository les demande. */
const emitted: Array<{ table: string; column: string }> = [];

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/data/supabase-client", () => ({
  DOCUMENTS_BUCKET: "family-office-documents",
  ownerId: () => "11111111-1111-4111-8111-111111111111",
  supabaseAdmin: () => ({
    rpc: vi.fn(),
    from: mocks.from,
    storage: { from: vi.fn() },
  }),
}));

import { createSupabaseRepository } from "@/lib/data/supabase-repository";

/**
 * Constructeur de requête minimal. Toute méthode enchaîne, sauf `order` qui vérifie la
 * colonne comme le ferait PostgREST. La requête se résout sur un jeu vide : ce test porte
 * sur la FORME de la requête, pas sur les données.
 */
/**
 * Lignes minimales exigées par le mapping. Le profil propriétaire est obligatoire : sans
 * lui, la lecture s'arrête avant d'atteindre les tris qu'on veut observer.
 */
const ROWS: Record<string, unknown[]> = {
  profiles: [
    {
      user_id: "11111111-1111-4111-8111-111111111111",
      reporting_currency: "EUR",
      ledger_coverage_start: null,
      ledger_coverage_source: "MANUAL",
    },
  ],
};

function builder(table: string) {
  const result = { data: (ROWS[table] ?? []) as unknown[], error: null };
  const chain: Record<string, unknown> = {
    order(column: string) {
      emitted.push({ table, column });
      const columns = SCHEMA[table];
      // Une table hors du schéma de test n'est pas paginée : rien à vérifier.
      if (columns !== undefined && !columns.includes(column)) {
        // Message reproduit de PostgREST, pour que l'échec soit reconnaissable.
        throw new Error(`column ${table}.${column} does not exist`);
      }
      return proxy;
    },
    then(resolve: (value: typeof result) => unknown) {
      return Promise.resolve(resolve(result));
    },
  };
  // Toute méthode inconnue enchaîne. Le proxy se retourne lui-même, sinon le maillon
  // suivant tomberait sur l'objet nu et perdrait le comportement enchaînable.
  const proxy: Record<string, unknown> = new Proxy(chain, {
    get(target, property) {
      if (property in target) return target[property as string];
      return () => proxy;
    },
  });
  return proxy;
}

describe("lecture paginée — colonnes de tri réellement présentes", () => {
  it("charge l'état du cockpit sans requêter une colonne inexistante", async () => {
    emitted.length = 0;
    mocks.from.mockImplementation((table: string) => builder(table));

    const repository = createSupabaseRepository();
    // Avant le correctif, cet appel rejetait sur
    // « column currency_rates.created_at does not exist ».
    await expect(repository.getDashboardState()).resolves.toMatchObject({
      reportingCurrency: expect.any(String),
    });

    const fxOrders = emitted.filter((entry) => entry.table === "currency_rates");
    expect(fxOrders.map((entry) => entry.column)).toEqual(["rate_date", "id"]);
    expect(fxOrders.some((entry) => entry.column === "created_at")).toBe(false);
  });

  it("départage chaque table paginée sur une colonne UNIQUE", async () => {
    emitted.length = 0;
    mocks.from.mockImplementation((table: string) => builder(table));
    await createSupabaseRepository().getDashboardState();

    // Une pagination par `range` n'est déterministe que sur un ordre TOTAL. `created_at`
    // n'étant pas unique, il ne suffisait pas à le garantir, même là où il existe.
    for (const table of Object.keys(SCHEMA)) {
      const orders = emitted.filter((entry) => entry.table === table);
      expect(orders.length, `${table} : aucun tri émis`).toBeGreaterThanOrEqual(2);
      expect(orders.at(-1)?.column, `${table} : départage non unique`).toBe("id");
    }
  });
});
