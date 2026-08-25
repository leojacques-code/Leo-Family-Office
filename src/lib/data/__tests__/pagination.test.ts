import { describe, expect, it } from "vitest";

import { LedgerTruncationError, readAllPages } from "@/lib/data/pagination";

/** Source paginée déterministe : `total` lignes, servies selon la fenêtre demandée. */
function source(total: number) {
  const calls: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, index) => ({ index }));
  return {
    calls,
    fetchPage: async (from: number, to: number) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    },
  };
}

describe("readAllPages", () => {
  it("lit toutes les pages et s’arrête sur la première page incomplète", async () => {
    const { calls, fetchPage } = source(25);
    const result = await readAllPages("ledger", fetchPage, { maxPages: 5, pageSize: 10 });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(25);
    expect(calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it("refuse de rendre un ledger tronqué comme exploitable", async () => {
    // 25 lignes pour 2 pages de 10 : la borne est atteinte sans page incomplète. Rendre
    // les 20 premières lignes produirait un cash et des quantités faux sans le dire.
    const { fetchPage } = source(25);
    await expect(
      readAllPages("portfolio_events", fetchPage, { maxPages: 2, pageSize: 10 }),
    ).rejects.toThrow(LedgerTruncationError);
  });

  it("nomme la source tronquée et la borne atteinte", async () => {
    const { fetchPage } = source(25);
    await expect(
      readAllPages("portfolio_events", fetchPage, { maxPages: 2, pageSize: 10 }),
    ).rejects.toThrow(/portfolio_events.*20 lignes/s);
  });

  it("ne tronque pas quand le total tombe juste sur une page pleine", async () => {
    // 20 lignes en 2 pages de 10 : la troisième page revient vide et clôt la lecture.
    const { fetchPage } = source(20);
    const result = await readAllPages("ledger", fetchPage, { maxPages: 5, pageSize: 10 });
    expect(result.data).toHaveLength(20);
  });

  it("propage une erreur de lecture sans rendre de lignes partielles", async () => {
    let page = 0;
    const result = await readAllPages<{ index: number }, { message: string }>(
      "ledger",
      async () => {
        page += 1;
        if (page === 1)
          return { data: Array.from({ length: 10 }, (_, i) => ({ index: i })), error: null };
        return { data: null, error: { message: "PostgREST down" } };
      },
      { maxPages: 5, pageSize: 10 },
    );
    expect(result.data).toBeNull();
    expect(result.error).toEqual({ message: "PostgREST down" });
  });
});
