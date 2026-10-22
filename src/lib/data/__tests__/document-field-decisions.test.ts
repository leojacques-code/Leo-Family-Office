import { describe, expect, it, vi } from "vitest";
import { readDocumentFieldDecisions } from "../document-field-decisions";
import type { supabaseAdmin } from "../supabase-client";

const row = (rank: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `trace-${rank}`,
  user_id: "proprietaire-A",
  run_id: "lecture-A",
  field_id: "case-A",
  decision_rank: rank,
  action: "CORRECT",
  before_status: "EXTRACTED",
  before_value: "10",
  before_date: null,
  after_status: "CORRECTED",
  after_value: "0",
  after_date: null,
  reason: "Correction synthétique",
  decided_at: "2026-10-21T23:05:00Z",
  actor_user_id: "proprietaire-A",
  ...overrides,
});

function fakeClient(rows: ReturnType<typeof row>[], failure = false) {
  const queries: Array<{ filters: Record<string, unknown>; ranges: number[][] }> = [];
  const from = vi.fn(() => {
    const query = { filters: {} as Record<string, unknown>, ranges: [] as number[][] };
    queries.push(query);
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => {
        query.filters[key] = value;
        return chain;
      },
      order: () => chain,
      range: async (start: number, end: number) => {
        query.ranges.push([start, end]);
        return failure
          ? { data: null, error: { message: "Erreur synthétique", code: "XX000" } }
          : {
              data: rows
                .filter((item) =>
                  Object.entries(query.filters).every(([key, value]) => item[key] === value),
                )
                .slice(start, end + 1),
              error: null,
            };
      },
    };
    return chain;
  });
  return { client: { from } as unknown as ReturnType<typeof supabaseAdmin>, queries, from };
}

describe("Journal commun des cases documentaires", () => {
  it("relit toutes les pages du seul propriétaire et de la seule lecture, sans exposer les identifiants d'auteur", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row(i + 1));
    rows.push(row(1002, { user_id: "proprietaire-B" }), row(1003, { run_id: "lecture-B" }));
    const { client, queries } = fakeClient(rows);
    const result = await readDocumentFieldDecisions(client, "proprietaire-A", "lecture-A");
    expect(result).toHaveLength(1001);
    expect(result.at(-1)).toMatchObject({
      rank: 1001,
      beforeValue: 10,
      afterValue: 0,
      actor: "CURRENT_USER",
    });
    expect(queries.map((q) => q.filters)).toEqual(
      Array(2).fill({ user_id: "proprietaire-A", run_id: "lecture-A" }),
    );
    expect(queries.map((q) => q.ranges)).toEqual([[[0, 999]], [[1000, 1999]]]);
    expect(JSON.stringify(result)).not.toContain("proprietaire-");
  });

  it("n'attribue pas au lecteur un auteur différent ou absent", async () => {
    const { client } = fakeClient([
      row(1, { actor_user_id: "auteur-B" }),
      row(2, { actor_user_id: null }),
    ]);
    expect(
      (await readDocumentFieldDecisions(client, "proprietaire-A", "lecture-A")).map((d) => d.actor),
    ).toEqual(["OTHER", null]);
  });

  it("ne transforme pas une panne de lecture en historique vide", async () => {
    const { client } = fakeClient([], true);
    await expect(readDocumentFieldDecisions(client, "proprietaire-A", "lecture-A")).rejects.toThrow(
      "document_field_decisions",
    );
  });
});
